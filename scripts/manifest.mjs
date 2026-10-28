// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Generates the skill and agent lists in plugin/.claude-plugin/plugin.json from what's on disk.
// Each module owns its skills/ and agents/; this keeps the manifest honest. `--check` fails on drift.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = 'plugin';
const OWNERS = ['shells', 'modules', 'platforms'];

function owners() {
  const out = [];
  for (const group of OWNERS) {
    for (const name of readdirSync(join(PLUGIN, group)).sort()) {
      if (existsSync(join(PLUGIN, group, name))) out.push(`${group}/${name}`);
    }
  }
  return out;
}

export function expectedLists() {
  const skills = [];
  const agents = [];
  for (const o of owners()) {
    const sdir = join(PLUGIN, o, 'skills');
    if (existsSync(sdir) && readdirSync(sdir).some((s) => existsSync(join(sdir, s, 'SKILL.md')))) skills.push(`./${o}/skills`);
    const adir = join(PLUGIN, o, 'agents');
    if (existsSync(adir)) for (const f of readdirSync(adir).sort()) if (f.endsWith('.md')) agents.push(`./${o}/agents/${f}`);
  }
  return { skills, agents };
}

const path = join(PLUGIN, '.claude-plugin', 'plugin.json');

export function render() {
  const current = JSON.parse(readFileSync(path, 'utf8'));
  const { skills, agents } = expectedLists();
  return `${JSON.stringify({ ...current, skills, agents, hooks: './shells/hooks/hooks.json' }, null, 2)}\n`;
}

export function writeManifest() {
  writeFileSync(path, render());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== render()) {
      console.error(`${path} is out of date with the skills and agents on disk. Run: pnpm build`);
      process.exit(1);
    }
    console.log(`${path} matches the skills and agents on disk`);
  } else {
    writeManifest();
    console.log(`wrote ${path}`);
  }
}
