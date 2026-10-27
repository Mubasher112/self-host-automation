import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';

test('database migrations create critical tables and enforce foreign keys',()=>{const db=openDb(':memory:');const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);for(const name of ['users','workspaces','workflows','workflow_versions','executions','step_attempts','credentials','audit_events'])assert.ok(names.includes(name));assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);db.close()});
