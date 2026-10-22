# Parked

A local dashboard for agent work that is paused on something external — a PR awaiting review, a deploy,
a teammate's reply — so you don't have to reopen a session and re-read it to remember where you were.

- Agents record an entry with the `park_work` MCP tool when they stop.
- The dashboard shows what is **Ready for you** and what is **Waiting on others**, with the next steps and a one-click **Resume**.
- Entries watching a GitHub PR move to Ready on their own when it is approved, merged, closed or has changes requested. That is a plain `gh pr view` poll every two minutes: no LLM, no tokens.
- **Mark done** deletes the entry. Nothing accumulates.

## Status

`0.1.0` is deliberately narrow: **macOS**, **[opencode](https://opencode.ai) (v1 and v2)**, and resume into **Ghostty** or **iTerm**.
The `park_work` tool itself is plain MCP, but session lookup and resume are opencode-specific today.

## Requirements

- macOS
- Node 22.5+ (uses the built-in `node:sqlite`; developed on Node 24)
- [`gh`](https://cli.github.com), logged in, if you want PR watching
- opencode, for the agent side

## Install

```sh
git clone https://github.com/parked-dev/parked /tmp/parked-installer
node /tmp/parked-installer/install.js --dry-run   # shows every change first
node /tmp/parked-installer/install.js --service   # install, then run at login
```

`install.js` is idempotent. It:

1. installs the app to `~/.local/share/parked/app` (`PARKED_DIR` or `--dir` overrides that),
2. builds the dashboard,
3. registers the MCP server with `opencode mcp add parked --global`,
4. adds the `park_work` instruction to `~/.config/opencode/AGENTS.md` between `<!-- parked:start -->` and `<!-- parked:end -->` markers,
5. with `--service`, installs a login agent so the dashboard runs without a terminal.

Drop `--service` if you would rather run it yourself:

```sh
node ~/.local/share/parked/app/web.js   # http://127.0.0.1:4747
```

Data lives in `~/.local/share/parked/parked.db` (`PARKED_DB` overrides it).

Restart any open opencode session afterwards so it picks up the tool.

### The login agent

`--service` writes `~/Library/LaunchAgents/com.parked.dashboard.plist` and starts it now and at every
login. No admin rights are needed. Logs: `~/Library/Logs/com.parked.dashboard.log`. Remove it with
`node install.js --service-remove`.

The plist pins the absolute `node` path, so re-run `--service` after switching Node versions.

## Update

```sh
npm --prefix ~/.local/share/parked/app run update
```

Pulls `main` (fast-forward only), rebuilds, and restarts the login agent if one is installed. The
dashboard prints an update notice at startup when the checkout is behind; it never updates itself.
Updates are forward-only, because the database schema migrates on open.

## Uninstall

```sh
node ~/.local/share/parked/app/install.js --service-remove
rm -rf ~/.local/share/parked/app ~/.local/share/parked
opencode mcp remove parked   # if your opencode has that subcommand
```

Then delete the `<!-- parked:start -->` … `<!-- parked:end -->` block from `~/.config/opencode/AGENTS.md`.

## How resume works

`park_work` takes only the working directory. The MCP server looks up the newest top-level session for
that directory in opencode's own database (`session_v2` on v2, `session` on v1) and stores its id. If
nothing is found, Resume falls back to `opencode -c`. With two sessions open in one directory, "newest"
can pick the wrong one.

Resume opens a window in the running terminal and types the command into your shell, so your normal
environment applies. The first click triggers a one-time macOS prompt allowing the login agent (or your
terminal) to control Ghostty or iTerm; macOS remembers it per controller.

## Security

The server binds to `127.0.0.1` only and:

- rejects requests whose `Host` is not its own loopback address (DNS rebinding),
- requires a per-run token header and a matching `Origin` for every change,
- never executes a string from a request: Resume fills a fixed template with a session id read from the
  database and validated against `^[A-Za-z0-9_-]+$`, and passes the directory and command to `osascript`
  as arguments.

Nothing leaves your machine except `git` and `gh` calls you already make.

## Development

See [docs/](docs/) for the [functional requirements](docs/requirements/functional.md), the
[non-functional requirements](docs/requirements/non-functional.md) and the
[architecture](docs/architecture.md). [AGENTS.md](AGENTS.md) has the rules for changing the project.

```sh
node web.js        # backend on :4747
npm run dev        # Vite dev server on :5173, proxying /api
npm test           # backend, installer and UI helper tests (node:test, no test framework)
npm run build      # build the UI into ui/dist
```

- Backend: plain Node ESM, zero dependencies (`db.js`, `mcp.js`, `web.js`, `poller.js`, `resolve.js`, `resume.js`, `install.js`).
- UI: `ui/` — Vite, React, TypeScript, Tailwind v4, [shadcn/ui](https://ui.shadcn.com). Add components with `npx shadcn@latest add <name>`.
- Testable logic lives in `ui/src/lib/*.ts`; Node runs TypeScript directly, so UI tests need no framework.

## License

MIT. See [LICENSE](LICENSE).
