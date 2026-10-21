import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Persistence. SQLite (built into Node 22) keeps the game runnable locally with zero
 * external services. Career world state is a versioned aggregate; matches, audit entries
 * and idempotency keys are separate append-only tables. See docs/DATABASE.md for the
 * relational target schema used when moving to PostgreSQL.
 */
// Loaded via require so bundlers/test runners that do not know the new builtin leave it alone.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
export type DB = DatabaseSyncType;

export function openDb(file = process.env.KURCIV_DB ?? path.resolve(process.cwd(), 'data', 'kurciv.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     token TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX idx_sessions_user ON sessions(user_id);
   CREATE TABLE careers (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     club_id TEXT NOT NULL,
     season INTEGER NOT NULL,
     phase TEXT NOT NULL,
     version INTEGER NOT NULL,
     world BLOB NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX idx_careers_user ON careers(user_id);
   CREATE TABLE match_records (
     career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
     fixture_id TEXT NOT NULL,
     season INTEGER NOT NULL,
     involves_user INTEGER NOT NULL,
     engine_version TEXT NOT NULL,
     seed TEXT NOT NULL,
     data BLOB NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (career_id, fixture_id)
   );
   CREATE TABLE live_matches (
     career_id TEXT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
     slot TEXT NOT NULL,
     fixture_id TEXT NOT NULL,
     version INTEGER NOT NULL,
     data BLOB NOT NULL,
     updated_at TEXT NOT NULL,
     PRIMARY KEY (career_id, slot)
   );
   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     career_id TEXT,
     user_id TEXT,
     action TEXT NOT NULL,
     detail TEXT,
     at TEXT NOT NULL
   );
   CREATE INDEX idx_audit_career ON audit_log(career_id);
   CREATE TABLE idempotency (
     user_id TEXT NOT NULL,
     key TEXT NOT NULL,
     status INTEGER NOT NULL,
     body TEXT NOT NULL,
     at TEXT NOT NULL,
     PRIMARY KEY (user_id, key)
   );`,
];

function migrate(db: DB) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  const current = row.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(i + 1, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function pack(v: unknown): Uint8Array {
  return gzipSync(Buffer.from(JSON.stringify(v)));
}

export function unpack<T>(b: Uint8Array): T {
  return JSON.parse(gunzipSync(b).toString('utf8')) as T;
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(db: DB, careerId: string | null, userId: string | null, action: string, detail?: unknown) {
  db.prepare('INSERT INTO audit_log (career_id, user_id, action, detail, at) VALUES (?, ?, ?, ?, ?)').run(
    careerId, userId, action, detail === undefined ? null : JSON.stringify(detail).slice(0, 2000), new Date().toISOString(),
  );
}
