// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The plugin checks itself, on every PR, with no model calls. Each check prints PASS, FAIL or OFF.
//   walls      the plugin's own modules.json, on code imports and on file references in prompts
//   duplicates repeated code blocks and repeated paragraphs (prompt text lives in knowledge/ once)
//   names      no two skills or agents share a name
//   manifest   plugin.json's generated lists, dist/fwos.mjs, plugin/LICENSE and plugin/NOTICE are up to date
//   fixtures   every check has a good and a bad fixture
//   shape      every module has a README with the fixed headings, every example a row in the index
//   validate   `claude plugin validate --strict` (off when the claude CLI isn't installed)
//   clean      no secrets, and none of the optional FWOS_BLOCKLIST terms
//   headers    every source file starts with the project's copyright line and the SPDX line
//   assets     every bundled image, font or video has a row in docs/legal/assets.md
// Run: node scripts/repo-check.ts   (Node 24+; Node 22 needs --experimental-strip-types)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { build } from 'esbuild';
import { loadProject, parseFrontmatter, readText, walkFiles } from '../plugin/kernel/index.ts';
import { runWalls } from '../plugin/modules/architecture/index.ts';
import { allChecks } from '../plugin/shells/cli/registry.ts';
import { render as renderManifest } from './manifest.mjs';
import { checkDistribution, distribution } from './plugin-distribution.mjs';

const REPO = new URL('..', import.meta.url).pathname;
const PLUGIN = join(REPO, 'plugin');
const EXCLUDE = ['**/fixtures/**', '**/templates/**', '**/starter/**', 'dist/**', '**/tests/**'];

interface Result {
  id: string;
  status: 'pass' | 'fail' | 'off';
  detail: string[];
}

const results: Result[] = [];
const report = (id: string, problems: string[], offReason?: string, summary = '') =>
  results.push(offReason ? { id, status: 'off', detail: [offReason] } : { id, status: problems.length ? 'fail' : 'pass', detail: problems.length ? problems : summary ? [summary] : [] });

// ---- walls ------------------------------------------------------------------------------------
{
  const project = loadProject(PLUGIN);
  project.paths.source = [];
  project.paths.ignore = ['**/fixtures/**', '**/templates/**', 'dist/**'];
  const r = runWalls(project, { modulesFile: 'modules.json' });
  report('walls', r.findings.map((f) => `${f.file}:${f.line ?? ''} ${f.message}`), r.status === 'off' ? r.reason : undefined, r.info?.[0]);
}

// ---- duplicates -------------------------------------------------------------------------------
{
  const problems: string[] = [];
  const WINDOW = 8;
  const code = walkFiles(PLUGIN, { include: ['**/*.ts'], exclude: EXCLUDE });
  const seen = new Map<string, string>();
  for (const f of code) {
    const lines = readFileSync(join(PLUGIN, f), 'utf8')
      .split('\n')
      .map((l, i) => ({ t: l.trim(), n: i + 1 }))
      .filter((l) => l.t.length > 3 && !/^(\/\/|\*|\/\*|import |export \{|[})\]];?,?$)/.test(l.t));
    for (let i = 0; i + WINDOW <= lines.length; i++) {
      const key = lines.slice(i, i + WINDOW).map((l) => l.t).join('\n');
      const here = `${f}:${lines[i]!.n}`;
      const prev = seen.get(key);
      if (prev && !prev.startsWith(`${f}:`)) {
        problems.push(`code repeated: ${here} and ${prev} (${WINDOW}+ lines)`);
        i += WINDOW;
      } else if (!prev) seen.set(key, here);
    }
  }
  const text = walkFiles(PLUGIN, { include: ['**/*.md'], exclude: EXCLUDE });
  const paras = new Map<string, string>();
  for (const f of text) {
    for (const p of parseFrontmatter(readFileSync(join(PLUGIN, f), 'utf8')).body.split(/\n\s*\n/)) {
      const norm = p.replace(/\s+/g, ' ').trim();
      if (norm.length < 200 || norm.startsWith('|') || norm.startsWith('```')) continue;
      const prev = paras.get(norm);
      if (prev && prev !== f) problems.push(`paragraph repeated in ${f} and ${prev}: "${norm.slice(0, 60)}..." (put it in knowledge/ once and link it)`);
      else paras.set(norm, f);
    }
  }
  report('duplicates', problems, undefined, `${code.length} code files, ${text.length} text files`);
}

// ---- names ------------------------------------------------------------------------------------
{
  const problems: string[] = [];
  const skills = new Map<string, string>();
  const agents = new Map<string, string>();
  for (const f of walkFiles(PLUGIN, { include: ['**/skills/*/SKILL.md'], exclude: ['**/templates/**'] })) {
    const fm = parseFrontmatter(readFileSync(join(PLUGIN, f), 'utf8')).data;
    const name = String(fm.name ?? f.split('/').slice(-2, -1)[0]);
    if (!fm.description) problems.push(`${f} has no description`);
    if (skills.has(name)) problems.push(`skill "${name}" in ${f} and ${skills.get(name)}`);
    skills.set(name, f);
  }
  for (const f of walkFiles(PLUGIN, { include: ['**/agents/*.md'] })) {
    const fm = parseFrontmatter(readFileSync(join(PLUGIN, f), 'utf8')).data;
    const name = String(fm.name ?? '');
    if (!name) problems.push(`${f} has no name`);
    if (!fm.tools) problems.push(`${f} has no tools allowlist (an omitted list inherits every tool)`);
    if (agents.has(name)) problems.push(`agent "${name}" in ${f} and ${agents.get(name)}`);
    agents.set(name, f);
  }
  report('names', problems, undefined, `${skills.size} skills, ${agents.size} agents, all fwos:<name>`);
}

// ---- manifest ---------------------------------------------------------------------------------
{
  const problems: string[] = [];
  const manifestPath = join(PLUGIN, '.claude-plugin/plugin.json');
  if (readFileSync(manifestPath, 'utf8') !== renderManifest()) problems.push('plugin.json skills/agents lists are out of date: run pnpm build');
  for (const f of ['LICENSE', 'NOTICE']) {
    if (readFileSync(join(REPO, f), 'utf8') !== (readText(join(PLUGIN, f)) ?? '')) problems.push(`plugin/${f} doesn't match ${f}: run pnpm build`);
  }
  const tmp = mkdtempSync(join(tmpdir(), 'fwos-dist-'));
  try {
    const out = join(tmp, 'fwos.mjs');
    const cfg = (await import('./build-config.mjs')).config(out);
    await build(cfg);
    if (readFileSync(out, 'utf8') !== readFileSync(join(PLUGIN, 'dist/fwos.mjs'), 'utf8')) problems.push('plugin/dist/fwos.mjs is out of date with the source: run pnpm build');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  problems.push(...checkDistribution().map((problem) => `distribution/plugin: ${problem} (run pnpm build)`));
  report('manifest', problems, undefined, 'plugin.json and dist/fwos.mjs match the source');
}

// ---- fixtures ---------------------------------------------------------------------------------
{
  const problems: string[] = [];
  for (const c of allChecks()) {
    const [mod, name] = c.id.split('/') as [string, string];
    const dir = mod === 'web' ? join(PLUGIN, 'platforms/web/checks/fixtures', name) : join(PLUGIN, 'modules', mod, 'checks/fixtures', name);
    for (const kind of ['good', 'bad']) if (!existsSync(join(dir, kind))) problems.push(`${c.id} has no ${kind} fixture (${relative(REPO, dir)}/${kind})`);
  }
  report('fixtures', problems, undefined, `${allChecks().length} checks, each with good and bad fixtures (run by the test suite)`);
}

// ---- module shape -----------------------------------------------------------------------------
{
  const HEADINGS = ['Owns', 'Public entry', 'Skills and agents', 'Checks', 'Depends on', 'Debugging'];
  const problems: string[] = [];
  const modules = JSON.parse(readFileSync(join(PLUGIN, 'modules.json'), 'utf8')).modules as { name: string; path: string }[];
  for (const m of modules) {
    const readme = join(PLUGIN, m.path, 'README.md');
    if (!existsSync(readme)) {
      problems.push(`${m.name} has no README.md`);
      continue;
    }
    const headings = [...readFileSync(readme, 'utf8').matchAll(/^## (.+)$/gm)].map((x) => x[1]!.trim());
    for (const h of HEADINGS) if (!headings.includes(h)) problems.push(`${m.name}/README.md is missing "## ${h}"`);
  }
  // Every example folder is a row in examples/README.md, so nobody adds one that the index hides.
  const index = readText(join(REPO, 'examples/README.md')) ?? '';
  const examples = readdirSync(join(REPO, 'examples'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  for (const e of examples) if (!index.includes(`](${e}/)`)) problems.push(`examples/${e} has no row in examples/README.md`);
  report('shape', problems, undefined, `${modules.length} modules, ${examples.length} examples indexed`);
}

// ---- validate ---------------------------------------------------------------------------------
{
  let claude = true;
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
  } catch {
    claude = false;
  }
  if (!claude) report('validate', [], 'the claude CLI is not installed here');
  else {
    const problems: string[] = [];
    for (const target of [PLUGIN, distribution, REPO]) {
      try {
        execFileSync('claude', ['plugin', 'validate', '--strict', target], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        problems.push(`claude plugin validate --strict ${relative(REPO, target) || '.'} failed:\n${String((e as { stdout?: Buffer }).stdout ?? e)}`);
      }
    }
    report('validate', problems, undefined, 'plugin and marketplace manifests pass --strict');
  }
}

// ---- clean scan -------------------------------------------------------------------------------
const tracked = (() => {
  try {
    return execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: REPO }).toString().split('\n').filter(Boolean);
  } catch {
    return walkFiles(REPO);
  }
})().filter((f) => !f.startsWith('node_modules/') && !/\.(png|jpe?g|gif|ico|woff2?|ttf|otf|webp|mp4)$/.test(f) && existsSync(join(REPO, f)));
{
  const SECRETS: [RegExp, string][] = [
    [/\bsk_live_[0-9a-zA-Z]{10,}/, 'a live Stripe key'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
    [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'a private key'],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
    [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'an Anthropic key'],
  ];
  const problems: string[] = [];
  // Optional terms that must not appear, as a comma or newline separated list. A term may still
  // appear on a copyright line, and CONTRIBUTORS.md credits people by design.
  const blocklist = (process.env.FWOS_BLOCKLIST ?? (process.env.FWOS_BLOCKLIST_FILE ? readFileSync(process.env.FWOS_BLOCKLIST_FILE, 'utf8') : ''))
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const f of tracked) {
    // A line marked `gitleaks:allow` holds a made-up value a test needs; both scanners skip it.
    const lines = readFileSync(join(REPO, f), 'utf8').split('\n').filter((l) => !l.includes('gitleaks:allow'));
    const text = lines.join('\n');
    for (const [re, what] of SECRETS) if (re.test(text)) problems.push(`${f} contains what looks like ${what}`);
    if (f === 'CONTRIBUTORS.md') continue;
    const scanned = lines.filter((l) => !/Copyright (\(c\) )?\d{4} /.test(l)).join('\n');
    for (const term of blocklist) if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(scanned)) problems.push(`${f} mentions a blocked term`);
  }
  report('clean', problems, undefined, `${tracked.length} files; ${blocklist.length ? `${blocklist.length} blocked terms checked` : 'secrets only (FWOS_BLOCKLIST not set)'}`);
}

// ---- headers ----------------------------------------------------------------------------------
{
  // A file copied out of the repo keeps its notice (the scaffold copies the web template into a
  // user's project). The demo app is project code, so it carries the notice too. Generated check
  // fixtures and all example files are exempt; the root license covers copyable examples. The line is fixed
  // here to keep first-party source attribution consistent with LICENSE and NOTICE.
  const copyright = 'Copyright 2026 Workloom Solutions Private Limited';
  // A committed fwos project pins some files by hash: what fwos generates or vendors
  // (.fwos/manifest.json) and its locked tests (.fwos/changes/*.json). Those keep the bytes fwos
  // recorded, because a header edit there reads as a hand-edited generated file or a changed
  // locked test.
  const pinned = new Set<string>();
  for (const f of tracked.filter((t) => !t.includes('/checks/fixtures/') && /(^|\/)\.fwos\/(manifest|changes\/[^/]+)\.json$/.test(t))) {
    const root = f.slice(0, f.lastIndexOf('.fwos/'));
    const record = JSON.parse(readFileSync(join(REPO, f), 'utf8')) as { files?: object; lockedTests?: object };
    for (const p of Object.keys((f.endsWith('manifest.json') ? record.files : record.lockedTests) ?? {})) pinned.add(root + p);
  }
  const sources = tracked.filter(
    (f) =>
      /\.(ts|tsx|mts|mjs|cjs|js|css|sh|tape)$/.test(f) &&
      !f.includes('/checks/fixtures/') &&
      !f.startsWith('examples/') &&
      !pinned.has(f),
  );
  const problems = sources
    .filter((f) => {
      const head = readFileSync(join(REPO, f), 'utf8').split('\n').slice(0, 5).join('\n');
      return !head.includes(copyright) || !head.includes('SPDX-License-Identifier: MIT');
    })
    .map((f) => `${f} is missing the copyright or SPDX line in its first 5 lines`);
  report('headers', problems, undefined, `${sources.length} source files`);
}

// ---- assets -----------------------------------------------------------------------------------
{
  const assets = walkFiles(REPO, { include: ['**/*.{png,jpg,jpeg,gif,svg,ico,webp,woff,woff2,ttf,otf,mp4}'], exclude: ['node_modules/**', '**/node_modules/**', '**/.next/**', '**/test-results/**', '.claude/**'] });
  const register = existsSync(join(REPO, 'docs/legal/assets.md')) ? readFileSync(join(REPO, 'docs/legal/assets.md'), 'utf8') : '';
  const problems = assets.filter((a) => !register.includes(a)).map((a) => `${a} has no row in docs/legal/assets.md (source and licence, right to redistribute, attribution)`);
  report('assets', problems, undefined, `${assets.length} bundled assets`);
}

// ---- print ------------------------------------------------------------------------------------
const LABEL = { pass: 'PASS', fail: 'FAIL', off: 'OFF ' };
for (const r of results) {
  console.log(`${LABEL[r.status]}  ${r.id.padEnd(10)}  ${r.status === 'fail' ? '' : (r.detail[0] ?? '')}`);
  if (r.status === 'fail') for (const d of r.detail.slice(0, 15)) console.log(`      ${d}`);
}
const failed = results.filter((r) => r.status === 'fail').length;
console.log(`\n${results.length - failed} ok, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
