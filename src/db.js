import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

let singleton;
export function openDb(path = config.databasePath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  migrate(db);
  return db;
}
export function getDb() { return singleton ||= openDb(); }

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'owner', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, role TEXT NOT NULL, PRIMARY KEY(user_id, workspace_id));
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', draft_json TEXT NOT NULL, draft_revision INTEGER NOT NULL DEFAULT 1, published_version_id TEXT, active INTEGER NOT NULL DEFAULT 0, webhook_key TEXT UNIQUE NOT NULL, webhook_secret_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workflow_versions (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, version INTEGER NOT NULL, graph_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workflow_id, version));
    CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, type TEXT NOT NULL, encrypted_value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS executions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, workflow_id TEXT NOT NULL REFERENCES workflows(id), workflow_version_id TEXT NOT NULL REFERENCES workflow_versions(id), trigger_type TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, error TEXT, attempt INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, locked_at TEXT, locked_by TEXT);
    CREATE INDEX IF NOT EXISTS idx_executions_queue ON executions(status, created_at);
    CREATE TABLE IF NOT EXISTS step_attempts (id TEXT PRIMARY KEY, execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE, node_id TEXT NOT NULL, node_name TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT, output_json TEXT, error TEXT, started_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
  `);
}

export const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
export const now = () => new Date().toISOString();
export function one(db, sql, ...params) { return db.prepare(sql).get(...params); }
export function all(db, sql, ...params) { return db.prepare(sql).all(...params); }
export function run(db, sql, ...params) { return db.prepare(sql).run(...params); }
