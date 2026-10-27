import { id, now, run, one } from './db.js';
import { resolveTemplate } from './workflows.js';
import { validateOutboundUrl, decryptSecret, redact } from './security.js';
import { config } from './config.js';

export async function execute(db, execution) {
  const version = one(db, 'SELECT graph_json FROM workflow_versions WHERE id=?', execution.workflow_version_id);
  const graph = JSON.parse(version.graph_json); const input = JSON.parse(execution.input_json); const outputs = {}; const secrets = [];
  run(db, `UPDATE executions SET status='running', started_at=?, locked_at=?, locked_by=? WHERE id=?`, now(), now(), process.pid.toString(), execution.id);
  try {
    const ordered = topological(graph); let finalOutput = input;
    for (const node of ordered) {
      if (['manual','webhook'].includes(node.type)) { outputs[node.id] = input; continue; }
      const attemptId = id('step'); const started = now(); const context = { trigger: input, steps: outputs, execution: { id: execution.id } };
      run(db, `INSERT INTO step_attempts(id,execution_id,node_id,node_name,status,input_json,started_at) VALUES(?,?,?,?,?,?,?)`, attemptId, execution.id, node.id, node.name, 'running', JSON.stringify(redactedJson(context, secrets)), started);
      try {
        let output;
        if (node.type === 'map') output = resolveTemplate(node.config.mapping, context);
        else if (node.type === 'http') output = await httpAction(db, node, context, execution.workspace_id, secrets);
        outputs[node.id] = output; finalOutput = output;
        run(db, `UPDATE step_attempts SET status='succeeded',output_json=?,completed_at=? WHERE id=?`, JSON.stringify(redactedJson(output, secrets)), now(), attemptId);
      } catch (error) {
        run(db, `UPDATE step_attempts SET status='failed',error=?,completed_at=? WHERE id=?`, redact(error.message, secrets), now(), attemptId); throw error;
      }
    }
    run(db, `UPDATE executions SET status='succeeded',output_json=?,completed_at=?,locked_at=NULL,locked_by=NULL WHERE id=?`, JSON.stringify(redactedJson(finalOutput, secrets)), now(), execution.id);
  } catch (error) {
    run(db, `UPDATE executions SET status='failed',error=?,completed_at=?,locked_at=NULL,locked_by=NULL WHERE id=?`, redact(error.message, secrets), now(), execution.id);
  }
}

async function httpAction(db, node, context, workspaceId, secrets) {
  const cfg = resolveTemplate(node.config, context); const url = await validateOutboundUrl(cfg.url); const headers = { ...(cfg.headers || {}) };
  if (cfg.credentialId) { const credential = one(db, 'SELECT encrypted_value,type FROM credentials WHERE id=? AND workspace_id=?', cfg.credentialId, workspaceId); if (!credential) throw new Error('Configured credential was not found.'); const value = decryptSecret(credential.encrypted_value); secrets.push(value); if (credential.type === 'bearer') headers.authorization = `Bearer ${value}`; else headers['x-api-key'] = value; }
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.min(Number(cfg.timeoutMs || config.requestTimeoutMs), 30_000));
  try {
    const response = await fetch(url, { method: cfg.method || 'GET', headers, body: ['GET','HEAD'].includes(cfg.method || 'GET') ? undefined : cfg.body, redirect:'manual', signal:controller.signal });
    const body = (await response.text()).slice(0, 262144); const result = { status:response.status, ok:response.ok, headers:Object.fromEntries(response.headers), body: tryJson(body) };
    if (!response.ok) throw new Error(`HTTP request failed with status ${response.status}.`); return result;
  } catch (error) { if (error.name === 'AbortError') throw new Error('HTTP request timed out.'); throw error; } finally { clearTimeout(timer); }
}
function tryJson(value) { try { return JSON.parse(value); } catch { return value; } }
function redactedJson(value, secrets) { try { return JSON.parse(redact(value, secrets)); } catch { return '[REDACTED]'; } }
function topological(graph) { const map = new Map(graph.nodes.map((n) => [n.id,n])); const incoming = new Map(graph.nodes.map((n) => [n.id,0])); const adj = new Map(graph.nodes.map((n) => [n.id,[]])); for (const e of graph.edges) { incoming.set(e.to,incoming.get(e.to)+1); adj.get(e.from).push(e.to); } const q = graph.nodes.filter((n)=>incoming.get(n.id)===0).map((n)=>n.id); const out=[]; while(q.length){const x=q.shift();out.push(map.get(x));for(const y of adj.get(x)){incoming.set(y,incoming.get(y)-1);if(incoming.get(y)===0)q.push(y)}} return out; }
