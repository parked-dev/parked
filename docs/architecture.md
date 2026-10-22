# Architecture

How parked is built today. Requirements live in [requirements/](requirements/); this file exists so that
implementation detail does not leak into them, and so a change can be placed before it is made.

## Shape

A single-user, local app with three moving parts:

```
opencode session ──MCP (stdio)──> mcp.js ──┐
                                           ├──> SQLite (~/.local/share/parked/parked.db)
browser ──HTTP (127.0.0.1)──> web.js ──────┘
                                  │
                                  ├──> gh (PR status, every 2 min)
                                  └──> osascript (open terminal on a session)
```

- Backend: plain Node ESM, no runtime dependencies.
- UI: Vite + React + TypeScript, built to `ui/dist` and served by `web.js`.
- The MCP server runs as a stdio child of each opencode session; nothing is hosted.

## Modules

| File | Responsibility | Must not |
|---|---|---|
| `db.js` | Schema, open, CRUD, settings | Know about HTTP, MCP or terminals |
| `resolve.js` | Find the newest opencode session for a directory | Write anything |
| `resume.js` | Build and run the terminal command for an item | Accept a command from outside |
| `poller.js` | Ask `gh` about watched PRs, update status | Talk to the UI directly |
| `mcp.js` | `park_work` tool over stdio, JSON-RPC | Contain the installer or the UI |
| `web.js` | HTTP API, static UI, auth guards, wiring | Contain domain rules |
| `install.js` | Install, MCP registration, instruction block, login agent | Require a private repo |
| `ui/` | Dashboard (React) | Assume anything about storage |

## Data

One table, `items`: `project_dir`, `session_id`, `resume_mode`, `waiting_on`, `link`, `watch`,
`next_steps`, `resume_context`, `status` (`waiting` | `ready`), `status_reason`, `created_at`.
A `settings` table holds `terminal` (`ghostty` | `iterm`).

- Status is derived from the world, not authored: the poller promotes `waiting` to `ready` with a reason.
- Dismissing deletes the row. Done rows from older versions are purged on open.
- Migrations run on open and are forward-only. An older database must still open; there is a test for it.

## MCP surface

`park_work(project_dir, waiting_on, next_steps[], resume_context, link?, watch?)`.

- The agent supplies the working directory, never a session id: a model cannot reliably know its own.
- The server resolves the session (below) and stores it, returning only a confirmation.
- `watch` is `{type: "github_pr", url}`; anything else is ignored rather than pretended.

## Session resolution

opencode keeps sessions in `~/.local/share/opencode/opencode.db`. v2 writes `session_v2` and leaves the v1
`session` table stale, so `resolve.js` prefers `session_v2` and falls back to `session`. It takes the most
recent top-level session for the directory. If nothing matches, the item is stored with
`resume_mode: continue` and Resume uses `opencode -c`.

Known limitation: two sessions open in the same directory can resolve to the wrong one. Fixing it needs a
reliable identity for the calling session, which this design does not have.

## Resume

A fixed command template per harness — `opencode -s <id>` or `opencode -c` — filled with a session id read
from the database and validated against `^[A-Za-z0-9_-]+$`. The directory and command are passed to
`osascript` as `argv`, never interpolated into the script text.

The AppleScript creates a window in the running terminal and types the command into the user's shell, so
the user's environment applies and no separate command prompt is required:

- **Ghostty:** `new window with configuration {initial working directory, initial input}`.
- **iTerm:** `create window with default profile`, then `write text`.

Terminal choice: `PARKED_TERMINAL`, else the `terminal` setting, else whichever app is installed.
Ghostty is verified; iTerm is written from the dictionary and unverified.

## HTTP surface

`GET /api/state` (items plus the per-run token), `POST /api/items/:id/resume`, `POST /api/items/:id/done`,
and static files from `ui/dist` with an SPA fallback.

Controls, all tested:

- Bind `127.0.0.1` only.
- Reject requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding).
- Require the per-run token header and a matching `Origin` on every change.
- Resolve static paths inside `ui/dist` and refuse anything that escapes it.

The token is generated per process and delivered by `/api/state`; the UI refetches and retries once when
a restarted server rejects the old token.

## Install and lifecycle

`install.js` clones or fast-forwards `~/.local/share/parked/app`, builds the UI, registers the MCP server
with `opencode mcp add` (so opencode owns its own config format), and upserts the `park_work` instruction
in `~/.config/opencode/AGENTS.md` between markers. `--dry-run` prints everything and writes nothing.

`--service` writes `~/Library/LaunchAgents/com.parked.dashboard.plist`: `RunAtLoad`, `KeepAlive`,
`ThrottleInterval` and an explicit `PATH` (launchd's default would hide `gh` and `npm`). It waits for a
previous instance to release the port, then bootstraps into the user's GUI domain; no admin rights.
`--service-remove` reverses it.

`npm run update` pulls fast-forward, rebuilds and restarts the agent. `web.js` prints a one-line update
notice at startup using read-only `git ls-remote` — it never fetches, because a concurrent `git fetch`
races an installer's `git pull` via `FETCH_HEAD`.

## Testing

- `parked.test.js`: storage, resolution, resume command construction, poller transitions, HTTP guards.
- `install.test.js`: installer plan, instruction markers, MCP detection, login agent.
- `ui/src/lib/format.test.ts`: pure UI formatting, run by Node's native TypeScript support.

No test framework beyond `node:test`; no network in tests.
