// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Bundles the CLI and hooks into one file with no runtime dependencies: plugin/dist/fwos.mjs.
// The plugin's hooks run it, and apps run the same file in CI from their vendored .fwos/cli or a
// linked clone. GitHub Releases also carry a standalone CLI archive. Next to the bundle,
// THIRD-PARTY-LICENSES.txt carries the licence text of every package the bundle includes.
// LICENSE and NOTICE are copied into plugin/, the folder Claude Code installs on its own.

import { chmodSync, copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { config } from './build-config.mjs';
import { writeManifest } from './manifest.mjs';
import { writeDistribution } from './plugin-distribution.mjs';

const outfile = new URL('../plugin/dist/fwos.mjs', import.meta.url).pathname;
const result = await build({ ...config(outfile), metafile: true });
chmodSync(outfile, 0o755);

const packages = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input.split('node_modules/.pnpm/').pop().replace(/^[^/]+\//, ''));
  if (!m) continue;
  const root = input.slice(0, input.lastIndexOf(`node_modules/${m[1]}/`) + `node_modules/${m[1]}`.length);
  packages.set(m[1], root);
}
const parts = ['Third-party code bundled into fwos.mjs, with each licence as shipped by the package.\n'];
for (const [name, root] of [...packages].sort()) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const file = readdirSync(root).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
  const text = file ? readFileSync(join(root, file), 'utf8').trim() : `(no licence file shipped; package.json says ${pkg.license})`;
  parts.push(`${'='.repeat(78)}\n${name}@${pkg.version} (${pkg.license})\n${'='.repeat(78)}\n${text}\n`);
}
writeFileSync(join(dirname(outfile), 'THIRD-PARTY-LICENSES.txt'), parts.join('\n'));
writeManifest();
for (const f of ['LICENSE', 'NOTICE']) copyFileSync(new URL(`../${f}`, import.meta.url), new URL(`../plugin/${f}`, import.meta.url));
writeDistribution();
console.log(`built plugin/dist/fwos.mjs (${Math.round(statSync(outfile).size / 1024)} KB, ${packages.size} bundled packages) and plugin/.claude-plugin/plugin.json`);
