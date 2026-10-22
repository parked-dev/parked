import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { addItem, getItem, listItems, open, setSetting, setStatus } from './db.js';
import { resolveSession } from './resolve.js';
import { ghosttyArgs, itermArgs, resolveTerminal, resumeCommand } from './resume.js';
import { checkWatch, pollOnce } from './poller.js';
import { handle, parkWork } from './mcp.js';
import { makeServer } from './web.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'parked-'));
const memDb = () => open(join(tmp(), 'p.db'));
const base = { project_dir: '/p', waiting_on: 'review', next_steps: ['merge'], resume_context: 'ctx' };

test('db: add and list', () => {
  const db = memDb();
  const id = addItem(db, { ...base, session_id: 'ses_1', watch: { type: 'github_pr', url: 'u' } });
  assert.equal(getItem(db, id).resume_mode, 'id');
  assert.deepEqual(getItem(db, id).watch, { type: 'github_pr', url: 'u' });
  assert.equal(addItem(db, base) > id, true);
  assert.equal(listItems(db)[0].resume_mode, 'continue');
});

test('db: done rows are purged when the DB is opened', () => {
  const path = join(tmp(), 'p.db');
  const db = open(path);
  const keep = addItem(db, base);
  setStatus(db, addItem(db, base), 'done');
  db.close();
  assert.deepEqual(listItems(open(path)).map((i) => i.id), [keep]);
});

test('db: a pre-opencode-only DB (harness column) still works', () => {
  const path = join(tmp(), 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE items (
    id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    project_dir TEXT NOT NULL, harness TEXT NOT NULL, session_id TEXT, resume_mode TEXT NOT NULL,
    waiting_on TEXT NOT NULL, link TEXT, watch TEXT, next_steps TEXT NOT NULL DEFAULT '[]',
    resume_context TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'waiting', status_reason TEXT)`);
  old.exec(`INSERT INTO items (project_dir, harness, session_id, resume_mode, waiting_on) VALUES ('/p','opencode','ses_old','id','x')`);
  old.close();
  const db = open(path);
  assert.equal(listItems(db)[0].session_id, 'ses_old');
  assert.equal(addItem(db, base) > 1, true);
});

test('resolve: opencode picks newest top-level session in dir', () => {
  const path = join(tmp(), 'oc.db');
  const d = new DatabaseSync(path);
  d.exec('CREATE TABLE session (id TEXT, directory TEXT, parent_id TEXT, time_updated INTEGER)');
  d.exec(`INSERT INTO session VALUES ('old','/p',NULL,1),('new','/p',NULL,5),('child','/p','new',9),('other','/q',NULL,7)`);
  d.close();
  assert.equal(resolveSession('/p', { opencodeDb: path }), 'new');
  assert.equal(resolveSession('/none', { opencodeDb: path }), null);
  assert.equal(resolveSession('/p', { opencodeDb: join(tmp(), 'missing.db') }), null);

  // v2: session_v2 wins over a stale v1 row, even if the v1 timestamp is newer
  const d2 = new DatabaseSync(path);
  d2.exec('CREATE TABLE session_v2 (id TEXT, directory TEXT, parent_id TEXT, time_updated INTEGER)');
  d2.exec(`INSERT INTO session_v2 VALUES ('v2-live','/p',NULL,2),('v2-child','/p','v2-live',99)`);
  d2.close();
  assert.equal(resolveSession('/p', { opencodeDb: path }), 'v2-live');
  assert.equal(resolveSession('/q', { opencodeDb: path }), 'other');
});

test('resume: command and id validation', () => {
  assert.equal(resumeCommand({ resume_mode: 'id', session_id: 'ses_a1' }), 'opencode -s ses_a1');
  assert.equal(resumeCommand({ resume_mode: 'continue' }), 'opencode -c');
  assert.throws(() => resumeCommand({ resume_mode: 'id', session_id: 'x; rm -rf ~' }));
  assert.throws(() => resumeCommand({ resume_mode: 'id' }));
});

test('resume: osascript gets dir and command as arguments, not in the script', () => {
  const evil = { resume_mode: 'id', session_id: 'ses_1', project_dir: '/tmp/a" & (do shell script "x") & "' };
  const [flag, script, dir, cmd] = ghosttyArgs(evil);
  assert.equal(flag, '-e');
  assert.equal(dir, evil.project_dir);
  assert.equal(cmd, 'opencode -s ses_1');
  assert.equal(script.includes('ses_1') || script.includes('/tmp'), false);
  assert.match(script, /new window with configuration/);
  assert.throws(() => ghosttyArgs({ ...evil, session_id: 'x; rm -rf ~' }));
});

test('resume: terminal selection and per-terminal scripts', () => {
  const item = { resume_mode: 'id', session_id: 'ses_1', project_dir: '/tmp/x' };
  const [gFlag, gScript, gDir, gCmd] = ghosttyArgs(item);
  const [iFlag, iScript, iDir, iCmd] = itermArgs(item);
  assert.equal(gFlag, '-e');
  assert.equal(iFlag, '-e');
  assert.deepEqual([gDir, gCmd], ['/tmp/x', 'opencode -s ses_1']);
  assert.deepEqual([iDir, iCmd], ['/tmp/x', 'opencode -s ses_1']);
  assert.match(gScript, /tell application "Ghostty"/);
  assert.match(iScript, /tell application "iTerm"/);
  assert.equal(iScript.includes('ses_1') || iScript.includes('/tmp'), false);
  assert.notEqual(gScript, iScript);

  assert.equal(resolveTerminal({ env: { PARKED_TERMINAL: 'iterm' } }), 'iterm');
  assert.equal(resolveTerminal({ env: {}, setting: 'iterm' }), 'iterm');
  assert.equal(resolveTerminal({ env: { PARKED_TERMINAL: 'iterm' }, setting: 'ghostty' }), 'iterm');
  assert.equal(resolveTerminal({ env: { PARKED_TERMINAL: 'nope' }, setting: 'bogus' }), resolveTerminal({ env: {} }));
});

test('web: resumes with the terminal from the settings table', async () => {
  const db = memDb();
  setSetting(db, 'terminal', 'iterm');
  const id = addItem(db, { ...base, session_id: 'ses_1' });
  const spoken = [];
  const { makeServer } = await import('./web.js');
  const { server, token } = makeServer(db, { launcher: (item, opts) => spoken.push(opts.terminal) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await fetch(`http://127.0.0.1:${port}/api/items/${id}/resume`, { method: 'POST', headers: { 'x-parked-token': token }, body: '{}' });
  assert.deepEqual(spoken, ['iterm']);
  server.close();
});

test('poller: transitions', async () => {
  const w = { watch: { type: 'github_pr', url: 'u' } };
  const gh = (o) => async () => o;
  assert.equal(await checkWatch(w, gh({ state: 'MERGED' })), 'PR merged');
  assert.equal(await checkWatch(w, gh({ state: 'OPEN', reviewDecision: 'APPROVED' })), 'PR approved');
  assert.equal(await checkWatch(w, gh({ state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' })), null);
  assert.equal(await checkWatch({ watch: null }, gh({})), null);

  const db = memDb();
  const a = addItem(db, { ...base, watch: w.watch });
  await pollOnce(db, gh({ state: 'OPEN' }));
  assert.equal(getItem(db, a).status, 'waiting');
  await pollOnce(db, gh({ state: 'MERGED' }));
  assert.equal(getItem(db, a).status, 'ready');
  const b = addItem(db, { ...base, watch: w.watch });
  await pollOnce(db, async () => { throw new Error('rate limited'); });
  assert.match(getItem(db, b).status_reason, /rate limited/);
  assert.equal(getItem(db, b).status, 'waiting');

  // gh failures: show gh's own message (stderr), not the whole command line
  const c = addItem(db, { ...base, watch: w.watch });
  await pollOnce(db, async () => { throw Object.assign(new Error('Command failed: gh pr view u --json x\nboom'), { stderr: 'GraphQL: Could not resolve to a PullRequest\n' }); });
  assert.equal(getItem(db, c).status_reason, 'poll error: GraphQL: Could not resolve to a PullRequest');
});

test('mcp: park_work via JSON-RPC falls back to continue when no session is found', () => {
  const db = memDb();
  const list = handle(db, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(list.result.tools[0].name, 'park_work');
  const call = (args) => handle(db, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'park_work', arguments: args } });
  const r = call({ ...base, project_dir: '/definitely/not/a/session' });
  assert.equal(r.result.isError, undefined);
  assert.equal(r.result.content[0].text, 'Parked.');
  assert.equal(listItems(db)[0].resume_mode, 'continue');
  assert.equal(call({}).result.isError, true);
  assert.equal(handle(db, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.throws(() => parkWork(db, { ...base, next_steps: 'x' }));
});

async function startServer(db, opts = {}) {
  const root = tmp();
  const distDir = join(root, 'dist');
  mkdirSync(join(distDir, 'assets'), { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>Parked</title>');
  writeFileSync(join(distDir, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'secret.txt'), 'nope');
  const launched = [];
  const { server, token } = makeServer(db, { launcher: (i) => launched.push(i.id), distDir, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}`;
  return { server, token, launched, url, port, distDir };
}

test('web: token + origin guard, resume, done', async () => {
  const db = memDb();
  const id = addItem(db, { ...base, session_id: 'ses_1' });
  const { server, token, launched, url } = await startServer(db);
  const post = (path, headers = {}) => fetch(url + path, { method: 'POST', headers, body: '{}' }).then((r) => r.status);

  assert.equal(await post(`/api/items/${id}/resume`), 403);
  assert.equal(await post(`/api/items/${id}/resume`, { 'x-parked-token': 'wrong' }), 403);
  assert.equal(await post(`/api/items/${id}/resume`, { 'x-parked-token': token, origin: 'http://evil.example' }), 403);
  assert.deepEqual(launched, []);
  assert.equal(await post(`/api/items/${id}/resume`, { 'x-parked-token': token, origin: url }), 200);
  assert.deepEqual(launched, [id]);
  assert.equal(await post('/api/harness', { 'x-parked-token': token }), 404);
  assert.equal(await post(`/api/items/${id}/done`, { 'x-parked-token': token }), 200);
  assert.equal(getItem(db, id), undefined);
  const state = await (await fetch(url + '/api/state')).json();
  assert.deepEqual(state.items, []);
  assert.equal(state.token, token);
  server.close();
});

test('web: rejects foreign Host headers (DNS rebinding)', async () => {
  const { server, port } = await startServer(memDb());
  const get = (host) => new Promise((resolve) => {
    import('node:http').then(({ request }) => {
      request({ host: '127.0.0.1', port, path: '/api/state', headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); }).end();
    });
  });
  assert.equal(await get(`127.0.0.1:${port}`), 200);
  assert.equal(await get(`localhost:${port}`), 200);
  assert.equal(await get(`evil.example:${port}`), 403);
  assert.equal(await get('127.0.0.1'), 403);
  server.close();
});

test('web: serves the built UI and nothing outside it', async () => {
  const { server, url } = await startServer(memDb());
  const index = await fetch(url + '/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(url + '/assets/app.js')).headers.get('content-type').startsWith('text/javascript'), true);
  assert.equal((await fetch(url + '/assets/missing.js')).status, 404);
  assert.equal((await fetch(url + '/some/client/route')).status, 200); // SPA fallback
  const escape = await fetch(url + '/..%2fsecret.txt');
  assert.equal(escape.status === 200 && (await escape.text()) === 'nope', false);
  server.close();
});

test('web: friendly message when the UI is not built', async () => {
  const { server, url } = await startServer(memDb(), { distDir: join(tmp(), 'nope') });
  const res = await fetch(url + '/');
  assert.equal(res.status, 503);
  assert.match(await res.text(), /npm run build/);
  server.close();
});

test('nudge: compares HEAD to the remote branch without writing to the repo', async () => {
  const { nudgeUpdate } = await import('./web.js')
  const lines = []
  const fake = (head, remoteBranch) => async (dir, ...args) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return 'aaa'
    if (args[0] === 'rev-parse') return remoteBranch
    if (args[0] === 'ls-remote') return `${head}\trefs/heads/${remoteBranch}`
    throw new Error(`unexpected ${args.join(' ')}`)
  }
  await nudgeUpdate('/x', (m) => lines.push(m), fake('bbb', 'main'))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /Update available: npm --prefix \/x run update/)
  lines.length = 0
  await nudgeUpdate('/x', (m) => lines.push(m), fake('aaa', 'main'))
  assert.deepEqual(lines, [])
  await nudgeUpdate('/x', (m) => lines.push(m), async () => { throw new Error('offline') })
  assert.deepEqual(lines, [])
})
