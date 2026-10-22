#!/usr/bin/env node
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { deleteItem, getItem, getSetting, listItems, open } from './db.js';
import { launch, resolveTerminal } from './resume.js';
import { pollOnce } from './poller.js';

const DIST = fileURLToPath(new URL('./ui/dist', import.meta.url));
const REPO = fileURLToPath(new URL('.', import.meta.url));
const exec = promisify(execFile);

// Notice-only: never pulls, builds or writes to the repo. `git ls-remote` rather than `git fetch`
// so it cannot race with an installer running `git pull` (which reads FETCH_HEAD).
// Silent when offline or not a git checkout.
export async function nudgeUpdate(dir = REPO, log = console.log, git = defaultGit) {
  try {
    const head = await git(dir, 'rev-parse', 'HEAD')
    const branch = await git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')
    const remote = await git(dir, 'ls-remote', '--heads', 'origin', branch)
    const sha = remote.split(/\s+/)[0]
    if (sha && sha !== head) log(`Update available: npm --prefix ${dir} run update`)
  } catch { /* offline, detached, or no origin */ }
}

const defaultGit = (dir, ...args) =>
  exec('git', ['-C', dir, ...args], { timeout: 15_000 }).then((r) => r.stdout.trim())

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json',
};

export function makeServer(db, { token = randomBytes(16).toString('hex'), port = 4747, launcher = launch, distDir = DIST } = {}) {
  const root = resolve(distDir);
  const send = (res, code, body, type = 'application/json', headers = {}) => {
    res.writeHead(code, { 'content-type': type, ...headers });
    res.end(body);
  };

  function serveStatic(req, res) {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, '{}'); }
    const file = resolve(join(root, rel));
    if (file !== root && !file.startsWith(root + sep)) return send(res, 404, '{}');
    if (existsSync(file) && statSync(file).isFile()) {
      const hashed = rel.startsWith('/assets/');
      return send(res, 200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream',
        { 'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache' });
    }
    if (extname(rel)) return send(res, 404, '{}'); // a missing asset is a 404, not the app shell
    const index = join(root, 'index.html');
    if (!existsSync(index)) return send(res, 503, 'Parked UI is not built yet. Run: npm run build', 'text/plain; charset=utf-8');
    send(res, 200, readFileSync(index), TYPES['.html'], { 'cache-control': 'no-cache' });
  }

  const server = createServer(async (req, res) => {
    const p = server.address().port;
    // Only answer to our own loopback names: a rebound DNS name would otherwise be same-origin with this server.
    if (![`127.0.0.1:${p}`, `localhost:${p}`].includes(req.headers.host)) return send(res, 403, '{"error":"forbidden"}');

    if (req.method === 'GET' && req.url === '/api/state') return send(res, 200, JSON.stringify({ token, items: listItems(db) }));
    if (req.method === 'GET') return serveStatic(req, res);
    if (req.method !== 'POST') return send(res, 404, '{}');

    // Guard against other sites posting to localhost.
    const origin = req.headers.origin;
    const okOrigin = !origin || [`http://127.0.0.1:${p}`, `http://localhost:${p}`].includes(origin);
    if (req.headers['x-parked-token'] !== token || !okOrigin) return send(res, 403, '{"error":"forbidden"}');

    try {
      const m = req.url.match(/^\/api\/items\/(\d+)\/(done|resume)$/);
      if (m) {
        const item = getItem(db, Number(m[1]));
        if (!item) return send(res, 404, '{}');
        if (m[2] === 'done') deleteItem(db, item.id);
        else await launcher(item, { terminal: resolveTerminal({ setting: getSetting(db, 'terminal') }) });
        return send(res, 200, '{}');
      }
    } catch (e) {
      return send(res, 400, JSON.stringify({ error: e.message }));
    }
    send(res, 404, '{}');
  });
  return { server, token, listen: () => server.listen(port, '127.0.0.1') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = open();
  const port = Number(process.env.PARKED_PORT || 4747);
  makeServer(db, { port }).listen();
  setInterval(() => pollOnce(db), 2 * 60 * 1000).unref?.();
  pollOnce(db);
  console.log(`parked on http://127.0.0.1:${port}`);
  if (!existsSync(join(DIST, 'index.html'))) console.log('The UI is not built yet. Run: npm run build');
  void nudgeUpdate();
}
