import test from 'node:test'
import assert from 'node:assert/strict'
import { ago, linkLabel, projectName, safeUrl, statusText } from './format.ts'

const NOW = Date.parse('2026-10-22T12:00:00Z')

test('ago: sqlite UTC timestamps become relative times', () => {
  assert.equal(ago('2026-10-22 12:00:00', NOW), 'just now')
  assert.equal(ago('2026-10-22 11:59:40', NOW), 'just now')
  assert.equal(ago('2026-10-22 11:15:00', NOW), '45m ago')
  assert.equal(ago('2026-10-22 09:00:00', NOW), '3h ago')
  assert.equal(ago('2026-10-20 12:00:00', NOW), '2d ago')
  assert.equal(ago('2026-10-22 12:05:00', NOW), 'just now') // clock skew never shows the future
})

test('safeUrl: only http(s) links are ever rendered as links', () => {
  assert.equal(safeUrl('https://github.com/a/b/pull/1'), 'https://github.com/a/b/pull/1')
  assert.equal(safeUrl('http://x.test'), 'http://x.test')
  assert.equal(safeUrl('javascript:alert(1)'), '')
  assert.equal(safeUrl('data:text/html,hi'), '')
  assert.equal(safeUrl(null), '')
  assert.equal(safeUrl(''), '')
})

test('linkLabel: short readable label for a URL', () => {
  assert.equal(linkLabel('https://github.com/acme/svc/pull/482'), 'github.com/acme/svc/pull/482')
  assert.equal(linkLabel('https://www.example.com/'), 'example.com')
})

test('projectName: last path segment', () => {
  assert.equal(projectName('/Users/me/src/payments-service'), 'payments-service')
  assert.equal(projectName('/Users/me/src/payments-service/'), 'payments-service')
  assert.equal(projectName('/'), '/')
})

test('statusText: ready shows why, waiting hides poll errors from the badge', () => {
  assert.deepEqual(statusText({ status: 'ready', status_reason: 'PR approved' }), { label: 'PR approved', note: null })
  assert.deepEqual(statusText({ status: 'ready', status_reason: null }), { label: 'Ready', note: null })
  assert.deepEqual(statusText({ status: 'waiting', status_reason: null }), { label: 'Waiting', note: null })
  assert.deepEqual(
    statusText({ status: 'waiting', status_reason: 'poll error: rate limited' }),
    { label: 'Waiting', note: 'Last check failed: rate limited' },
  )
})
