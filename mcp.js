#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { addItem, open } from './db.js';
import { resolveSession } from './resolve.js';

const TOOL = {
  name: 'park_work',
  description:
    'Record that work in this session is paused on something external (PR review, merge, deploy, a teammate reply). ' +
    'Call it when you stop and the human must act later. Do not call it for ordinary questions to the user.',
  inputSchema: {
    type: 'object',
    required: ['project_dir', 'waiting_on', 'next_steps', 'resume_context'],
    properties: {
      project_dir: { type: 'string', description: 'Absolute path of the current working directory' },
      waiting_on: { type: 'string', description: 'What is awaited, e.g. "review of PR #12 by team X"' },
      link: { type: 'string', description: 'PR/ticket URL, if any' },
      watch: {
        type: 'object',
        description: 'Optional auto-check. Only {"type":"github_pr","url":"<PR url>"} is supported',
        properties: { type: { type: 'string', enum: ['github_pr'] }, url: { type: 'string' } },
      },
      next_steps: { type: 'array', items: { type: 'string' }, description: 'What the human does once unblocked' },
      resume_context: { type: 'string', description: '2-3 lines: where things stand, so the human need not re-read the session' },
    },
  },
};

export function parkWork(db, args, opts = {}) {
  for (const k of ['project_dir', 'waiting_on', 'resume_context']) {
    if (typeof args[k] !== 'string' || !args[k]) throw new Error(`${k} is required`);
  }
  if (!Array.isArray(args.next_steps)) throw new Error('next_steps must be an array');
  const session_id = resolveSession(args.project_dir, opts);
  addItem(db, { ...args, session_id });
  return 'Parked.';
}

export function handle(db, msg) {
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      return reply({ protocolVersion: msg.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'parked', version: '0.1.0' } });
    case 'tools/list':
      return reply({ tools: [TOOL] });
    case 'tools/call':
      try {
        if (msg.params.name !== TOOL.name) throw new Error('unknown tool');
        return reply({ content: [{ type: 'text', text: parkWork(db, msg.params.arguments ?? {}) }] });
      } catch (e) {
        return reply({ isError: true, content: [{ type: 'text', text: e.message }] });
      }
    case 'ping':
      return reply({});
    default:
      if (msg.id === undefined) return null; // notification
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = open();
  let buf = '';
  process.stdin.on('data', (d) => {
    buf += d;
    let n;
    while ((n = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, n).trim();
      buf = buf.slice(n + 1);
      if (!line) continue;
      const out = handle(db, JSON.parse(line));
      if (out) process.stdout.write(JSON.stringify(out) + '\n');
    }
  });
}
