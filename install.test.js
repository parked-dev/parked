import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { defaultDir, INSTRUCTIONS, LABEL, main, mcpConfigured, parseArgs, serviceFile, servicePlist, upsertInstructions, waitForFreePort } from './install.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'parked-install-'))

test('install: default location is hidden and stable, PARKED_DIR overrides it', () => {
  assert.equal(defaultDir({ HOME: '/Users/x' }), join(process.env.HOME, '.local/share/parked/app'))
  assert.equal(defaultDir({ PARKED_DIR: '/opt/parked' }), '/opt/parked')
})

test('install: parseArgs', () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, dir: null, terminal: null, service: false, serviceRemove: false })
  assert.deepEqual(parseArgs(['--dry-run', '--dir', '/x', '--terminal', 'iterm']), { dryRun: true, dir: '/x', terminal: 'iterm', service: false, serviceRemove: false })
  assert.equal(parseArgs(['--service']).service, true)
  assert.equal(parseArgs(['--service-remove']).serviceRemove, true)
  assert.throws(() => parseArgs(['--terminal', 'tmux']))
  assert.throws(() => parseArgs(['--nope']))
})

test('install: instruction block is appended once and refreshed in place', () => {
  assert.equal(upsertInstructions(''), `<!-- parked:start -->\n${INSTRUCTIONS}\n<!-- parked:end -->\n`)
  const existing = '# My rules\n\nbe nice\n'
  const once = upsertInstructions(existing)
  assert.ok(once.startsWith('# My rules\n\nbe nice\n\n<!-- parked:start -->'))
  assert.equal(upsertInstructions(once), once) // idempotent
  const stale = once.replace('Do not call it for ordinary questions to the user.', 'old wording')
  const refreshed = upsertInstructions(stale)
  assert.equal(refreshed, once)
  assert.equal(refreshed.match(/parked:start/g).length, 1)
  assert.ok(refreshed.startsWith('# My rules'))
})

test('install: mcpConfigured reads opencode mcp list output', () => {
  assert.equal(mcpConfigured('parked\n  local  node mcp.js\n'), true)
  assert.equal(mcpConfigured('NAME  TYPE\nparked  local\n'), true)
  assert.equal(mcpConfigured('github  remote\n'), false)
  assert.equal(mcpConfigured('✓ parked                     connected\n✓ github                     connected'), true)
  assert.equal(mcpConfigured(''), false)
  assert.equal(mcpConfigured('my-parked-thing'), false)
})

test('install: --dry-run plans everything and writes nothing', async () => {
  const home = tmp()
  const lines = []
  await main({ argv: ['--dry-run', '--dir', join(home, 'app')], home, log: (m) => lines.push(m), exec: async () => ({ stdout: '' }) })
  const out = lines.join('\n')
  assert.match(out, /\[dry-run\] cloning parked-dev\/parked into/)
  assert.match(out, /\[dry-run\] building the dashboard/)
  assert.match(out, /opencode mcp add parked --global/)
  assert.match(out, /park_work instruction to .*AGENTS\.md/)
  assert.match(out, /Update it:\s+npm --prefix/)
  assert.match(out, /Remove the app:\s+rm -rf .*\/app$/m)
  assert.equal(existsSync(join(home, 'app')), false)
  assert.equal(existsSync(join(home, '.config')), false)
})

test('install: registers MCP, writes instructions once, and is safe to re-run', async () => {
  const home = tmp()
  const calls = []
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '))
    if (args[0] === 'mcp' && args[1] === 'list') return { stdout: calls.some((c) => c.includes('mcp add')) ? 'parked local\n' : 'github remote\n' }
    return { stdout: '' }
  }
  mkdirSync(join(home, 'app', '.git'), { recursive: true })
  const runOnce = () => main({ argv: ['--dir', join(home, 'app')], home, log: () => {}, exec })
  await runOnce()
  await runOnce()

  assert.equal(calls.filter((c) => c.includes('mcp add parked')).length, 1)
  assert.equal(calls.filter((c) => c.includes('clone')).length, 0) // existing install: update, don't clone
  assert.equal(calls.filter((c) => c.includes('pull --ff-only')).length, 2)
  const written = readFileSync(join(home, '.config/opencode/AGENTS.md'), 'utf8')
  assert.equal(written.match(/parked:start/g).length, 1)
  assert.ok(written.includes('park_work'))
})

test('install: mcp list that exits non-zero still counts as configured', async () => {
  const home = tmp()
  const calls = []
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '))
    if (args[0] === 'mcp' && args[1] === 'list') {
      throw Object.assign(new Error('Command failed'), { stdout: '✗ parked  failed to start\n', stderr: '' })
    }
    return { stdout: '' }
  }
  await main({ argv: ['--dir', join(home, 'app')], home, log: () => {}, exec })
  assert.equal(calls.some((c) => c.includes('mcp add parked')), false)
})

test('install: keeps an existing AGENTS.md and reports a missing opencode CLI', async () => {
  const home = tmp()
  mkdirSync(join(home, '.config/opencode'), { recursive: true })
  writeFileSync(join(home, '.config/opencode/AGENTS.md'), '# Existing rules\n')
  const logs = []
  const exec = async (cmd) => { if (cmd === 'opencode') throw new Error('not found'); return { stdout: '' } }
  await main({ argv: ['--dir', join(home, 'app')], home, log: (m) => logs.push(m), exec })
  const written = readFileSync(join(home, '.config/opencode/AGENTS.md'), 'utf8')
  assert.ok(written.startsWith('# Existing rules\n'))
  assert.match(logs.join('\n'), /opencode CLI not found/)
})

test('service: plist runs web.js at login with an explicit PATH', () => {
  const home = '/Users/x'
  const nodePath = '/Users/x/.nvm/versions/node/v24.8.0/bin/node'
  const dir = '/Users/x/.local/share/parked/app'
  const plist = servicePlist({ nodePath, dir, home })
  assert.match(plist, new RegExp(`<string>${LABEL}</string>`))
  assert.ok(plist.includes(`<string>${nodePath}</string>`))
  assert.ok(plist.includes(`<string>${dir}/web.js</string>`))
  assert.ok(plist.includes(`PATH</key><string>${dirname(nodePath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`))
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/)
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/)
  assert.ok(plist.includes('/Users/x/Library/Logs/com.parked.dashboard.log'))
  assert.equal(serviceFile(home), '/Users/x/Library/LaunchAgents/com.parked.dashboard.plist')
  // XML-escaped so a directory with & or < cannot break the plist
  assert.ok(servicePlist({ nodePath, dir: '/tmp/a&b', home }).includes('/tmp/a&amp;b/web.js'))
})

test('service: --service writes the plist and bootstraps it', async () => {
  const home = tmp()
  const calls = []
  const exec = async (cmd, args, opts) => { calls.push([cmd, ...args].join(' ')); return { stdout: '' } }
  const logs = []
  await main({ argv: ['--service', '--dir', join(home, 'app')], home, log: (m) => logs.push(m), exec, portBusy: async () => false })
  const file = serviceFile(home)
  assert.ok(existsSync(file))
  const plist = readFileSync(file, 'utf8')
  assert.ok(plist.includes(join(home, 'app', 'web.js')))
  assert.ok(calls.some((c) => c.startsWith(`launchctl bootout gui/${process.getuid()}/${LABEL}`)))
  assert.ok(calls.some((c) => c.startsWith(`launchctl bootstrap gui/${process.getuid()} ${file}`)))
  assert.match(logs.join('\n'), /starts at login now/)
})

test('service: refuses to start when the port is taken, and --service-remove cleans up', async () => {
  const home = tmp()
  const calls = []
  const exec = async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { stdout: '' } }
  await assert.rejects(
    () => main({ argv: ['--service', '--dir', join(home, 'app')], home, log: () => {}, exec, portBusy: async () => true, waitForPort: async () => false }),
    /port 4747 is already in use/,
  )
  assert.equal(calls.some((c) => c.startsWith('launchctl bootstrap')), false)

  await main({ argv: ['--service-remove'], home, log: () => {}, exec, portBusy: async () => false })
  assert.equal(existsSync(serviceFile(home)), false)
  assert.ok(calls.some((c) => c.startsWith(`launchctl bootout gui/${process.getuid()}/${LABEL}`)))
})

test('service: --dry-run --service writes no plist', async () => {
  const home = tmp()
  const logs = []
  await main({ argv: ['--dry-run', '--service', '--dir', join(home, 'app')], home, log: (m) => logs.push(m), exec: async () => ({ stdout: '' }), portBusy: async () => false })
  assert.equal(existsSync(serviceFile(home)), false)
  assert.match(logs.join('\n'), /\[dry-run\] installing the login agent/)
})

test('service: re-running --service tolerates the old agent still shutting down', async () => {
  const home = tmp()
  const calls = []
  const exec = async (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { stdout: '' } }
  let probes = 0
  const portBusy = async () => ++probes <= 3 // busy for the first few probes, then free
  await main({ argv: ['--service', '--dir', join(home, 'app')], home, log: () => {}, exec, portBusy, waitForPort: (b) => waitForFreePort(b, { delay: 1 }) })
  assert.ok(calls.some((c) => c.startsWith('launchctl bootstrap')))
  assert.ok(probes > 3)
})

test('service: waitForFreePort gives up when the port never frees', async () => {
  assert.equal(await waitForFreePort(async () => true, { attempts: 3, delay: 1 }), false)
  assert.equal(await waitForFreePort(async () => false, { attempts: 3, delay: 1 }), true)
})
