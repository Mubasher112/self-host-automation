import { getDb, one, run, now } from './db.js';
import { execute } from './engine.js';

const db = getDb(); let stopping = false;
console.log(JSON.stringify({ level:'info', message:'worker_started', pid:process.pid }));
run(db, `UPDATE executions SET status='queued',locked_at=NULL,locked_by=NULL WHERE status='running' AND locked_at < ?`, new Date(Date.now()-300000).toISOString());
async function poll() {
  if (stopping) return;
  const job = one(db, `SELECT * FROM executions WHERE status='queued' ORDER BY created_at LIMIT 1`);
  if (job) {
    const claimed = run(db, `UPDATE executions SET status='claiming',locked_at=?,locked_by=? WHERE id=? AND status='queued'`, now(), process.pid.toString(), job.id);
    if (claimed.changes) { job.status='claiming'; await execute(db, job); }
  }
  setTimeout(poll, job ? 100 : 700);
}
process.on('SIGTERM',()=>{stopping=true;setTimeout(()=>process.exit(0),1000)}); process.on('SIGINT',()=>{stopping=true;process.exit(0)}); poll();
