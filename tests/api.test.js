import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function freePort() {
  const server = createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port;
}

test('authenticated API supports setup, draft validation, publishing and stable queued runs', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flowforge-api-')); t.after(() => rm(dir, { recursive:true, force:true }));
  const port = await freePort();
  const child = spawn(process.execPath, ['--experimental-sqlite', 'src/server.js'], { cwd:new URL('..', import.meta.url), env:{...process.env,PORT:String(port),DATABASE_PATH:join(dir,'test.db'),ENCRYPTION_KEY:'integration-test-key'}, stdio:['ignore','pipe','pipe'] });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  t.after(() => child.kill('SIGTERM'));
  await new Promise((resolve, reject) => { const timer=setTimeout(()=>reject(new Error('Server did not start')),5000); child.stdout.on('data',(chunk)=>{if(chunk.toString().includes('FlowForge web running')){clearTimeout(timer);resolve()}}); child.once('exit',(code)=>reject(new Error(`Server exited ${code}`))); });
  const base=`http://127.0.0.1:${port}`;
  const setup=await fetch(base+'/api/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@example.com',password:'correct horse battery',workspace:'Test workspace'})});
  assert.equal(setup.status,201); const cookie=setup.headers.get('set-cookie').split(';')[0];
  const meResponse=await fetch(base+'/api/me',{headers:{cookie}}); assert.equal(meResponse.status,200); const me=await meResponse.json(); assert.equal(me.workspace.name,'Test workspace');
  const unauthenticated=await fetch(base+'/api/workflows'); assert.equal(unauthenticated.status,401);
  const noCsrf=await fetch(base+'/api/workflows',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{"name":"Denied"}'}); assert.equal(noCsrf.status,403);
  const headers={cookie,'content-type':'application/json','x-csrf-token':me.csrfToken};
  const created=await fetch(base+'/api/workflows',{method:'POST',headers,body:'{"name":"Order relay"}'}).then(r=>r.json());
  const workflow=await fetch(base+`/api/workflows/${created.id}`,{headers:{cookie}}).then(r=>r.json());
  const validation=await fetch(base+`/api/workflows/${created.id}/validate`,{method:'POST',headers}).then(r=>r.json()); assert.equal(validation.valid,true);
  const publishedResponse=await fetch(base+`/api/workflows/${created.id}/publish`,{method:'POST',headers}); assert.equal(publishedResponse.status,201); const published=await publishedResponse.json(); assert.equal(published.version,1);
  workflow.draft.nodes[1].config.url='https://changed-after-publish.invalid';
  const saved=await fetch(base+`/api/workflows/${created.id}`,{method:'PUT',headers,body:JSON.stringify({revision:workflow.draft_revision,graph:workflow.draft})}); assert.equal(saved.status,200);
  const run=await fetch(base+`/api/workflows/${created.id}/run`,{method:'POST',headers,body:'{"input":{"order":"A-42"}}'}); assert.equal(run.status,202); const queued=await run.json();
  const detail=await fetch(base+`/api/executions/${queued.executionId}`,{headers:{cookie}}).then(r=>r.json()); assert.equal(detail.workflow_version_id,published.versionId); assert.equal(detail.status,'queued');
  const secretResponse=await fetch(base+`/api/workflows/${created.id}/webhook-secret`,{method:'POST',headers}); assert.equal(secretResponse.status,201); const secret=await secretResponse.json(); assert.ok(secret.secret.length>=32);
  const latest=await fetch(base+`/api/workflows/${created.id}`,{headers:{cookie}}).then(r=>r.json()); latest.draft.nodes[0].type='webhook'; latest.draft.nodes[0].name='Webhook trigger';
  const webhookDraft=await fetch(base+`/api/workflows/${created.id}`,{method:'PUT',headers,body:JSON.stringify({revision:latest.draft_revision,graph:latest.draft})}); assert.equal(webhookDraft.status,200);
  const publishedWebhook=await fetch(base+`/api/workflows/${created.id}/publish`,{method:'POST',headers}); assert.equal(publishedWebhook.status,201);
  const manualRejected=await fetch(base+`/api/workflows/${created.id}/run`,{method:'POST',headers,body:'{"input":{}}'}); assert.equal(manualRejected.status,409);
  const unauthenticatedHook=await fetch(base+workflow.webhookUrl,{method:'POST',headers:{'content-type':'application/json'},body:'{"order":"B-7"}'}); assert.equal(unauthenticatedHook.status,401);
  const hook=await fetch(base+workflow.webhookUrl,{method:'POST',headers:{'content-type':'application/json','x-flowforge-secret':secret.secret},body:'{"order":"B-7"}'}); assert.equal(hook.status,202);
});
