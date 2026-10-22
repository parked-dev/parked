#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { open as openDb, setSetting } from './db.js'

const run = promisify(execFile)

export const REPO_URL = 'https://github.com/parked-dev/parked.git'
const REPO_SLUG = 'parked-dev/parked'
const START = '<!-- parked:start -->'
const END = '<!-- parked:end -->'
export const TERMINALS = ['ghostty', 'iterm']
export const LABEL = 'com.parked.dashboard'
export const PORT = 4747

export const serviceFile = (home = homedir()) => join(home, 'Library/LaunchAgents', `${LABEL}.plist`)

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// A login agent: starts at login, restarts on crash, no terminal and no admin rights.
// PATH must be explicit, because launchd's default would hide gh and npm from the app.
export function servicePlist({ nodePath, dir, home = homedir(), logFile }) {
  const path = [dirname(nodePath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
  const log = logFile ?? join(home, 'Library/Logs', `${LABEL}.log`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(join(dir, 'web.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(dir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(path)}</string>
    <key>HOME</key><string>${xml(home)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// After bootout, launchd needs a moment to reap the old process and release the port.
export async function waitForFreePort(isBusy, { attempts = 20, delay = 250 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (!(await isBusy())) return true
    await sleep(delay)
  }
  return !(await isBusy())
}

const portInUse = (port = PORT) => new Promise((resolve) => {
  const socket = connect({ host: '127.0.0.1', port })
    .on('connect', () => { socket.destroy(); resolve(true) })
    .on('error', () => resolve(false))
  setTimeout(() => { socket.destroy(); resolve(false) }, 500).unref()
})


export const INSTRUCTIONS = `When you stop because work is blocked on something outside this session (PR review, merge, deploy, a
teammate's answer), call the \`park_work\` tool with the current directory, what you are waiting on, the
next steps the human must take, and a 2-3 line \`resume_context\` so they need not re-read the session.
If it is a GitHub PR, include \`watch: {type: "github_pr", url}\`.
Do not call it for ordinary questions to the user.`

export const defaultDir = (env = process.env) => env.PARKED_DIR || join(homedir(), '.local/share/parked/app')
export const agentsFile = (home = homedir()) => join(home, '.config/opencode/AGENTS.md')

// Idempotent: re-running replaces the block between the markers instead of appending again.
export function upsertInstructions(text, block = INSTRUCTIONS) {
  const marked = `${START}\n${block.trim()}\n${END}`
  const start = text.indexOf(START)
  const end = text.indexOf(END, start + 1)
  if (start !== -1 && end !== -1) return text.slice(0, start) + marked + text.slice(end + END.length)
  if (!text.trim()) return marked + '\n'
  return text.replace(/\n*$/, '\n\n') + marked + '\n'
}

export function parseArgs(argv) {
  const args = { dryRun: false, dir: null, terminal: null, service: false, serviceRemove: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--dir') args.dir = argv[++i] ?? null
    else if (a === '--terminal') args.terminal = argv[++i] ?? null
    else if (a === '--service') args.service = true
    else if (a === '--service-remove') args.serviceRemove = true
    else throw new Error(`unknown argument: ${a}`)
  }
  if (args.terminal && !TERMINALS.includes(args.terminal)) throw new Error(`--terminal must be one of ${TERMINALS.join(', ')}`)
  return args
}

// e.g. "✓ parked  connected" or "parked  local"
export const mcpConfigured = (listOutput) => /(^|\n)[^\w\n]*parked\b/.test(listOutput)

export async function main({
  argv = process.argv.slice(2),
  home = homedir(),
  env = process.env,
  log = console.log,
  exec = run,
  opencode = 'opencode',
  nodePath = process.execPath,
  portBusy = portInUse,
  waitForPort = waitForFreePort,
} = {}) {
  const args = parseArgs(argv)
  const dry = args.dryRun
  const dir = args.dir ?? defaultDir(env)
  const say = (m) => log(dry ? `[dry-run] ${m}` : m)
  const step = async (message, fn) => { say(message); if (!dry) await fn() }
  const uid = process.getuid?.()

  if (args.serviceRemove) {
    const file = serviceFile(home)
    await step(`stopping and removing the login agent ${LABEL}`, async () => {
      await exec('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {})
      if (existsSync(file)) unlinkSync(file)
    })
    log('The dashboard will no longer start at login.')
    return 0
  }

  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 5)) throw new Error(`Node 22.5+ required (running ${process.versions.node})`)

  await step(`checking git`, () => exec('git', ['--version']))

  if (existsSync(join(dir, '.git'))) {
    await step(`updating existing install at ${dir}`, () => exec('git', ['-C', dir, 'pull', '--ff-only'], { stdio: 'inherit' }))
  } else {
    await step(`cloning ${REPO_SLUG} into ${dir}`, async () => {
      mkdirSync(dirname(dir), { recursive: true })
      await exec('git', ['clone', REPO_URL, dir], { stdio: 'inherit' })
    })
  }

  await step(`building the dashboard`, () => exec('npm', ['--prefix', dir, 'run', 'build'], { stdio: 'inherit' }))

  let hasOpencode = true
  try {
    await exec(opencode, ['--version'])
  } catch {
    hasOpencode = false
  }
  const mcpCommand = `opencode mcp add parked --global -- ${nodePath} --no-warnings ${join(dir, 'mcp.js')}`
  let listed = ''
  if (hasOpencode) {
    try {
      listed = (await exec(opencode, ['mcp', 'list'])).stdout
    } catch (e) {
      // `mcp list` exits non-zero when a server fails to start, but still names it.
      listed = `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`
    }
  }
  const configured = mcpConfigured(listed)
  if (configured) say('MCP server already configured for opencode')
  else if (!hasOpencode) say(`opencode CLI not found. Add the MCP server manually: ${mcpCommand}`)
  else await step(`registering the MCP server: ${mcpCommand}`, () => exec(opencode, ['mcp', 'add', 'parked', '--global', '--', nodePath, '--no-warnings', join(dir, 'mcp.js')], { stdio: 'inherit' }))

  const file = agentsFile(home)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const after = upsertInstructions(before)
  if (after === before) say(`global instructions already present in ${file}`)
  else await step(`adding the park_work instruction to ${file}`, () => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, after)
  })

  if (args.terminal) {
    await step(`setting the resume terminal to ${args.terminal}`, () => {
      const db = openDb()
      setSetting(db, 'terminal', args.terminal)
      db.close()
    })
  }

  if (args.service) {
    if (process.platform !== 'darwin') throw new Error('--service is macOS only')
    const file = serviceFile(home)
    await step(`installing the login agent ${file}`, async () => {
      mkdirSync(dirname(file), { recursive: true })
      mkdirSync(dirname(join(home, 'Library/Logs/x')), { recursive: true })
      writeFileSync(file, servicePlist({ nodePath, dir, home }))
      // Replace any previous instance first, which also frees the port it held.
      await exec('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => {})
      if (!(await waitForPort(portBusy))) throw new Error(`port ${PORT} is already in use. Stop the other parked instance (for example a terminal running web.js) and re-run with --service`)
      await exec('launchctl', ['bootstrap', `gui/${uid}`, file], { stdio: 'inherit' })
    })
  }

  const update = `npm --prefix ${dir} run update`
  const dbPath = env.PARKED_DB || join(homedir(), '.local/share/parked/parked.db')
  const logFile = join(home, 'Library/Logs', `${LABEL}.log`)
  log(`
Installed at ${dir}
Data in ${dbPath}

Start the dashboard:  ${args.service ? `starts at login now — http://127.0.0.1:${PORT} (logs: ${logFile})` : `node ${join(dir, 'web.js')}`}
${args.service ? '' : `Run it in the background: node ${join(dir, 'install.js')} --service\n`}Update it:            ${update}
Remove the app:       rm -rf ${dir}
Delete your data:     rm -rf ${dirname(dbPath)}
${args.service ? `Stop the login agent:  node ${join(dir, 'install.js')} --service-remove\n` : ''}
Restart any open opencode sessions so they pick up the park_work tool.`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => { console.error(`install failed: ${e.message}`); process.exit(1) },
  )
}
