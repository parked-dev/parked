import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The only string ever executed: a fixed template filled with a validated id.
export function resumeCommand(item) {
  if (item.resume_mode !== 'id') return 'opencode -c';
  if (!/^[A-Za-z0-9_-]+$/.test(item.session_id ?? '')) throw new Error('bad session id');
  return `opencode -s ${item.session_id}`;
}

// Both scripts take the directory and command as osascript arguments, so nothing from the
// database is ever interpolated into the script source.

// Ghostty: type the command into a window of the running instance, so its
// "Allow to execute" prompt (which applies to -e/command) does not appear.
const GHOSTTY = `on run argv
  tell application "Ghostty"
    activate
    new window with configuration {initial working directory:(item 1 of argv), initial input:((item 2 of argv) & linefeed)}
  end tell
end run`;

// iTerm: same idea, typed into a new window's shell.
const ITERM = `on run argv
  tell application "iTerm"
    activate
    set w to create window with default profile
    tell current session of w
      write text ("cd " & quoted form of (item 1 of argv) & " && " & (item 2 of argv))
    end tell
  end tell
end run`;

const SCRIPTS = { ghostty: GHOSTTY, iterm: ITERM };
const APPS = { ghostty: '/Applications/Ghostty.app', iterm: '/Applications/iTerm.app' };

// Explicit choice (PARKED_TERMINAL or the `terminal` setting) wins; otherwise whichever app is installed.
export function resolveTerminal({ env = process.env, setting } = {}) {
  const explicit = env.PARKED_TERMINAL || setting;
  if (explicit in SCRIPTS) return explicit;
  return existsSync(APPS.ghostty) ? 'ghostty' : 'iterm';
}

export const terminalArgs = (terminal, item) => ['-e', SCRIPTS[terminal], item.project_dir, resumeCommand(item)];
export const ghosttyArgs = (item) => terminalArgs('ghostty', item);
export const itermArgs = (item) => terminalArgs('iterm', item);

export async function launch(item, { terminal = resolveTerminal() } = {}) {
  await run('osascript', terminalArgs(terminal, item));
  return resumeCommand(item);
}
