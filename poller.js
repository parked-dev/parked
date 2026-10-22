import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listItems, setStatus } from './db.js';

const run = promisify(execFile);
const ghPr = async (url) => JSON.parse((await run('gh', ['pr', 'view', url, '--json', 'state,reviewDecision'])).stdout);

// Returns a reason string when the PR needs the human, else null.
export async function checkWatch(item, gh = ghPr) {
  if (item.watch?.type !== 'github_pr') return null;
  const pr = await gh(item.watch.url);
  if (pr.state === 'MERGED') return 'PR merged';
  if (pr.state === 'CLOSED') return 'PR closed';
  if (pr.reviewDecision === 'APPROVED') return 'PR approved';
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'Changes requested';
  return null;
}

export async function pollOnce(db, gh) {
  for (const item of listItems(db).filter((i) => i.status === 'waiting' && i.watch)) {
    try {
      const reason = await checkWatch(item, gh);
      if (reason) setStatus(db, item.id, 'ready', reason);
    } catch (e) {
      const why = (e.stderr?.toString().trim() || e.message).split('\n')[0];
      db.prepare('UPDATE items SET status_reason=? WHERE id=?').run(`poll error: ${why}`, item.id);
    }
  }
}
