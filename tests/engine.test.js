import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.ALLOW_PRIVATE_NETWORK = 'true';
process.env.ENCRYPTION_KEY = 'test-key-that-is-not-used-in-production';

test('worker engine executes the immutable published graph and redacts credentials', async (t) => {
  const [{ openDb, id, now, run, one, all }, { execute }, { encryptSecret }] = await Promise.all([
    import('../src/db.js'), import('../src/engine.js'), import('../src/security.js')
  ]);
  let observedAuth;
  const target = createServer(async (req, res) => {
    observedAuth = req.headers.authorization;
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ received: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
  });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  t.after(() => target.close());
  const port = target.address().port;
  const db = openDb(':memory:'); t.after(() => db.close());
  const ws = id('ws'), wf = id('wf'), version = id('wfv'), executionId = id('exe'), credential = id('cred'), created = now();
  run(db, 'INSERT INTO workspaces VALUES(?,?,?)', ws, 'Test', created);
  const publishedGraph = { name:'Published', nodes:[
    { id:'trigger',type:'manual',name:'Trigger',config:{} },
    { id:'map',type:'map',name:'Map',config:{mapping:{order:'{{trigger.order}}'}} },
    { id:'send',type:'http',name:'Send',config:{method:'POST',url:`http://127.0.0.1:${port}/orders`,headers:{'content-type':'application/json'},credentialId:credential,body:'{"order":"{{steps.map.order}}"}'} }
  ], edges:[{id:'e1',from:'trigger',to:'map'},{id:'e2',from:'map',to:'send'}] };
  const editedDraft = { name:'Edited later', nodes:[], edges:[] };
  run(db, `INSERT INTO workflows(id,workspace_id,name,draft_json,published_version_id,webhook_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, wf, ws, 'Published', JSON.stringify(editedDraft), version, 'hook', created, created);
  run(db, 'INSERT INTO workflow_versions VALUES(?,?,?,?,?)', version, wf, 1, JSON.stringify(publishedGraph), created);
  run(db, 'INSERT INTO credentials VALUES(?,?,?,?,?,?,?)', credential, ws, 'Token', 'bearer', encryptSecret('never-log-me'), created, created);
  run(db, `INSERT INTO executions(id,workspace_id,workflow_id,workflow_version_id,trigger_type,status,input_json,created_at) VALUES(?,?,?,?,?,'queued',?,?)`, executionId, ws, wf, version, 'manual', JSON.stringify({order:'A-42'}), created);
  await execute(db, one(db, 'SELECT * FROM executions WHERE id=?', executionId));
  const result = one(db, 'SELECT * FROM executions WHERE id=?', executionId);
  assert.equal(result.status, 'succeeded');
  assert.equal(observedAuth, 'Bearer never-log-me');
  assert.equal(JSON.parse(result.output_json).body.received.order, 'A-42');
  const persisted = JSON.stringify(all(db, 'SELECT * FROM step_attempts WHERE execution_id=?', executionId));
  assert.doesNotMatch(persisted, /never-log-me/);
  assert.equal(all(db, 'SELECT * FROM step_attempts WHERE execution_id=?', executionId).length, 2);
});
