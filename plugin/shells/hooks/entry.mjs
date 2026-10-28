// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Keep the CLI bundle unloaded outside fwos projects. All tool names still reach the dispatcher
// inside a project: narrowing the matcher would let the test planner read files or run commands.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const event = process.argv[2];
if (!['pre-tool-use', 'post-tool-use'].includes(event) || process.argv.length !== 3) {
  process.stderr.write('usage: node entry.mjs <pre-tool-use|post-tool-use>\n');
  process.exit(2);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let input;
try {
  const raw = Buffer.concat(chunks).toString('utf8');
  input = raw.trim() ? JSON.parse(raw) : {};
} catch {
  process.exit(0);
}
if (typeof input !== 'object' || input === null || Array.isArray(input)) process.exit(0);

// Use the same ancestry and payload cwd as findProjectRoot; leave parsing state and fail-closed
// decisions to the dispatcher, including a state file that exists but contains invalid JSON.
let dir = resolve(typeof input.cwd === 'string' ? input.cwd : process.cwd());
for (;;) {
  if (existsSync(join(dir, '.fwos/state.json'))) break;
  const parent = dirname(dir);
  if (parent === dir) process.exit(0);
  dir = parent;
}

const { dispatch } = await import('../../dist/fwos.mjs');
const result = dispatch(event, input, process.cwd());
if (result.stdout) process.stdout.write(result.stdout + '\n');
process.exitCode = result.code;
