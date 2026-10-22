import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function open(path = process.env.PARKED_DB || join(homedir(), '.local/share/parked/parked.db')) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      project_dir TEXT NOT NULL,
      session_id TEXT,
      resume_mode TEXT NOT NULL,
      waiting_on TEXT NOT NULL,
      link TEXT,
      watch TEXT,
      next_steps TEXT NOT NULL DEFAULT '[]',
      resume_context TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'waiting',
      status_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    DELETE FROM items WHERE status = 'done';
  `);
  // Early versions supported several harnesses and stored one per item.
  if (db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'harness')) {
    db.exec('ALTER TABLE items DROP COLUMN harness');
  }
  return db;
}

export function addItem(db, i) {
  const r = db.prepare(`INSERT INTO items
    (project_dir, session_id, resume_mode, waiting_on, link, watch, next_steps, resume_context)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    i.project_dir, i.session_id ?? null, i.session_id ? 'id' : 'continue',
    i.waiting_on, i.link ?? null, i.watch ? JSON.stringify(i.watch) : null,
    JSON.stringify(i.next_steps ?? []), i.resume_context ?? '');
  return Number(r.lastInsertRowid);
}

const parse = (r) => r && { ...r, watch: r.watch ? JSON.parse(r.watch) : null, next_steps: JSON.parse(r.next_steps) };

export const getItem = (db, id) => parse(db.prepare('SELECT * FROM items WHERE id=?').get(id));
export const listItems = (db) => db.prepare('SELECT * FROM items ORDER BY id DESC').all().map(parse);
export const deleteItem = (db, id) => db.prepare('DELETE FROM items WHERE id=?').run(id);
export const setStatus = (db, id, status, reason = null) =>
  db.prepare('UPDATE items SET status=?, status_reason=? WHERE id=?').run(status, reason, id);
export const getSetting = (db, key, dflt) => db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value ?? dflt;
export const setSetting = (db, key, value) =>
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
