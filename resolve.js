import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Newest top-level opencode session for dir, or null (callers fall back to `opencode -c`).
export function resolveSession(dir, opts = {}) {
  const path = opts.opencodeDb ?? join(homedir(), '.local/share/opencode/opencode.db');
  if (!existsSync(path)) return null;
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      // OpenCode v2 keeps live sessions in session_v2 and leaves the v1 `session` table stale; v1 installs only have `session`.
      for (const table of ['session_v2', 'session']) {
        try {
          const row = db.prepare(`SELECT id FROM ${table} WHERE directory=? AND parent_id IS NULL ORDER BY time_updated DESC LIMIT 1`).get(dir);
          if (row) return row.id;
        } catch { /* table missing in this opencode version */ }
      }
      return null;
    } finally { db.close(); }
  } catch { return null; }
}
