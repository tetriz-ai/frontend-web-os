// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The marketplace copies its source folder verbatim. Keep the committed install payload small
// while retaining the relative layout the bundle and its prompts use to find their assets.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../', import.meta.url));
export const source = join(repo, 'plugin');
export const distribution = join(repo, 'distribution/plugin');

function filesUnder(root, prefix = '') {
  if (!existsSync(join(root, prefix))) return [];
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(root, path) : [path];
  }).sort();
}

export function distributionFiles() {
  return filesUnder(source).filter((path) =>
    ['LICENSE', 'NOTICE', 'modules.json', '.claude-plugin/plugin.json'].includes(path) ||
    path.startsWith('dist/') ||
    /^shells\/hooks\/[^/]+\.(json|mjs|sh)$/.test(path) ||
    /^(?:kernel|modules\/[^/]+|platforms\/[^/]+|shells\/[^/]+)\/(?:knowledge|schema|skills|agents|templates|starter|lenses|pack)\//.test(path),
  );
}

export function checkDistribution() {
  const expected = distributionFiles();
  const actual = filesUnder(distribution);
  const problems = actual.filter((path) => !expected.includes(path)).map((path) => `unexpected ${path}`);
  for (const path of expected) {
    const file = join(distribution, path);
    if (!existsSync(file)) problems.push(`missing ${path}`);
    else if (!readFileSync(file).equals(readFileSync(join(source, path)))) problems.push(`stale ${path}`);
    else if ((statSync(file).mode & 0o111) !== (statSync(join(source, path)).mode & 0o111)) problems.push(`executable mode differs: ${path}`);
  }
  return problems;
}

export function writeDistribution() {
  const expected = distributionFiles();
  for (const path of filesUnder(distribution)) if (!expected.includes(path)) rmSync(join(distribution, path));
  for (const path of expected) {
    const target = join(distribution, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, path), target);
    chmodSync(target, statSync(join(source, path)).mode & 0o777);
  }
  return expected.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const problems = checkDistribution();
    if (problems.length) {
      console.error(`Marketplace payload differs from plugin/: run pnpm build\n${problems.join('\n')}`);
      process.exitCode = 1;
    } else console.log('marketplace payload matches plugin/');
  } else console.log(`assembled distribution/plugin (${writeDistribution()} runtime files)`);
}
