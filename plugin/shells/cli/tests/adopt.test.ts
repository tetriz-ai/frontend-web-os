// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos adopt` and an adopted app's journey through the CLI: the read-only proposal, the levels,
// upgrading, picking one app in a monorepo, the cases where fwos must stop or say less, a defect
// hidden behind the baseline, and delivering a change in place.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readJson, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, syntheticTestRun, tempProject } from '../../../kernel/testing.ts';
import { dispatch } from '../../hooks/index.ts';
import type { Io } from '../commands.ts';
import { main } from '../main.ts';

afterAll(cleanupTempProjects);

async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}
const json = async (cwd: string, ...argv: string[]) => JSON.parse((await fwos(cwd, ...argv, '--json')).out);

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const commitAll = (root: string, message = 'snapshot') => {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--no-verify', '--allow-empty', '-m', message);
};
/** `git status --porcelain`, one entry per line, untracked folders unexpanded. */
const changed = (root: string) => git(root, 'status', '--porcelain').split('\n').filter(Boolean);
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const state = (root: string) => JSON.parse(read(root, '.fwos/state.json'));

const THEME = read(new URL('../../../../examples/import-a-shadcn-theme/', import.meta.url).pathname, 'globals.css');

/** A small Next.js app fwos had no hand in: its own components, theme, tests, CI and agent guidance. */
const APP = {
  'package.json': {
    name: 'example-org',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', test: 'vitest run', lint: 'eslint .' },
    dependencies: { next: '15.3.0', react: '19.1.0', 'react-dom': '19.1.0' },
    devDependencies: { tailwindcss: '4.1.0', typescript: '5.8.0', vitest: '3.0.0' },
  },
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
  '.gitignore': 'node_modules\n.next\n',
  'components.json': { style: 'new-york', tailwind: { css: 'app/globals.css' }, aliases: { components: '@/components', ui: '@/components/ui' } },
  'app/globals.css': THEME,
  'app/layout.tsx': 'export default function Layout({ children }: { children: React.ReactNode }) {\n  return children;\n}\n',
  // A finding that was there before fwos: an image with no alt text.
  'app/page.tsx': 'export default function Home() {\n  return <img src="/logo.png" />;\n}\n',
  'app/members/page.tsx': 'export default function Members() {\n  return <main className="bg-surface text-fg">Members</main>;\n}\n',
  'components/ui/button.tsx': 'export const Button = () => null;\n',
  'components/ui/table.tsx': 'export const Table = () => null;\n',
  'lib/utils.ts': 'export const cn = (...c: string[]) => c.join(" ");\n',
  'vitest.config.ts': 'export default {};\n',
  'app/members/members.test.tsx': "import { it } from 'vitest';\nit('lists members', () => {});\n",
  '.github/workflows/ci.yml': 'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n',
  'AGENTS.md': '# Agents\nBuild with the components in components/ui.\n',
  'README.md': '# Acme\n',
  'docs/product/members-prd.md': '# Members\nTeams need to find a member by name.\n',
};

function app(extra: Record<string, string | object> = {}) {
  const root = tempProject({ ...APP, ...extra });
  git(root, 'init', '-q');
  commitAll(root, 'the app as the team has it');
  return root;
}

describe('fwos adopt: the proposal', () => {
  it('shows what it found, with where, and what it would do, and writes nothing', async () => {
    const root = app();
    const r = await fwos(root, 'adopt');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Nothing is written until you run it with --yes.');
    expect(r.out).toContain('Supported: the Next.js app at . (package.json dependencies.next).');
    expect(r.out).toMatch(/framework\s+Next\.js 15\.3\.0 {2}\(package\.json dependencies\.next\)/);
    expect(r.out).toMatch(/components\s+2 UI components in components\/ui {2}\(components\.json aliases\.ui \(@\/components\/ui\)\)/);
    expect(r.out).toMatch(/ci\s+GitHub Actions workflow \(runs the tests\) {2}\(\.github\/workflows\/ci\.yml\)/);
    expect(r.out).toMatch(/guidance\s+agent instructions {2}\(AGENTS\.md\)/);
    expect(r.out).toMatch(/flags\s+no feature flags found \(looked for /);
    expect(r.out).toContain('Run `fwos adopt --yes` to adopt at level checks');
    // Read-only: no .fwos/, no log, no .gitignore line.
    expect(changed(root)).toEqual([]);
  });

  it('proposes what it reuses, adds and changes, and previews the state and hooks before writing them', async () => {
    const root = app();
    const p = await json(root, 'adopt');
    expect(p).toMatchObject({ support: 'supported', app: '.', level: 'checks', adopted: false, written: false, decisions: [] });
    expect(p.proposal.reuse).toEqual(
      expect.arrayContaining([
        { what: 'your Next.js app at .', from: 'package.json dependencies.next' },
        { what: 'your UI components in components/ui', from: 'components.json aliases.ui (@/components/ui)' },
        { what: 'your test command `pnpm test` (vitest run)', from: 'package.json scripts.test' },
        { what: 'your CI, unchanged', from: '.github/workflows/ci.yml' },
        { what: 'your agent instructions, unchanged', from: 'AGENTS.md' },
      ]),
    );
    expect(p.proposal.add.map((a: { path: string }) => a.path)).toEqual(['.fwos/state.json', '.fwos/manifest.json', '.fwos/provenance.json', '.fwos/changes/0001-initial.json', '.fwos/baseline.json']);
    expect(p.proposal.change).toEqual([{ path: '.gitignore', what: 'adds .fwos/local/, where fwos keeps local evidence' }]);
    expect(p.proposal.untouched).toEqual(['package.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml', 'AGENTS.md', 'app code, tests and configs']);
    expect(p.proposal.state).toEqual({
      schema: 1,
      pluginVersion: expect.any(String),
      mode: 'adopt',
      platforms: ['web'],
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      adopt: { level: 'checks', history: [{ level: 'checks', at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }] },
      paths: { apps: { web: '.' }, source: ['app/**', 'components/**', 'lib/**'], ui: { web: 'components/ui' } },
    });
    expect(p.proposal.hooks.agent).toMatch(/never block an edit to your code/);
    expect(p.proposal.hooks.commit).toBe('not installed by adopt; `fwos git-hook install` would write .git/hooks/pre-commit to run `fwos check --staged`');
    expect(p.proposal.hooks.ci).toBe('unchanged; to gate pull requests, add `- run: pnpm exec fwos check` after the tests in .github/workflows/ci.yml');
    // The checks it would run today, and the findings that would become debt.
    expect(p.proposal.checks.on).toEqual(expect.arrayContaining(['rules/pack', 'web/security']));
    expect(p.proposal.checks.off).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'design-system/contrast' })]));
    expect(p.proposal.checks.findings).toBeGreaterThanOrEqual(2);
    // Delivery previews a gate on the app, and only the app.
    const d = await json(root, 'adopt', '--level', 'delivery');
    expect(d.proposal.hooks.agent).toMatch(/while an fwos change is open, they block edits to app\/\*\*, components\/\*\*, lib\/\*\* until that change's spec and test plan are approved/);
    expect(changed(root)).toEqual([]);
  });

  it('lists each capability by level, with what it needs while it is off', async () => {
    const root = app();
    const caps = (await json(root, 'adopt')).capabilities as { id: string; level: string; enabled: boolean; on: boolean; status: string }[];
    expect(caps.map((c) => `${c.level}:${c.id}`)).toEqual([
      'checks:checks',
      'checks:baseline',
      'checks:commit-hook',
      'checks:ci',
      'design:design-system',
      'design:components',
      'delivery:changes',
      'delivery:spec-gate',
      'delivery:test-results',
      'delivery:test-locks',
    ]);
    expect(caps.find((c) => c.id === 'design-system')).toMatchObject({ enabled: false, on: false, status: 'at level design: imports app/globals.css into design-system/' });
    expect(caps.find((c) => c.id === 'test-results')).toMatchObject({ enabled: false, on: false });
    expect(caps.find((c) => c.id === 'ci')).toMatchObject({ enabled: true, on: false, status: 'optional: add `- run: pnpm exec fwos check` after the tests in .github/workflows/ci.yml' });
  });

  it('says plainly when it cannot adopt the app, and sets nothing up', async () => {
    const root = tempProject({ 'package.json': { dependencies: { vite: '6.0.0', react: '19.0.0' } }, 'src/main.tsx': '' });
    const r = await fwos(root, 'adopt');
    expect(r.code).toBe(1);
    expect(r.out).toContain('Unsupported: No Next.js app: found Vite at . (package.json dependencies.vite).');
    expect(r.out).not.toContain('--yes');
    const yes = await fwos(root, 'adopt', '--yes');
    expect(yes.code).toBe(2);
    expect(yes.err).toMatch(/^fwos: Not adopted: No Next\.js app/);
    expect(existsSync(join(root, '.fwos'))).toBe(false);
  });

  it('labels what is missing and keeps what needs it visibly off, never fills it from fwos', async () => {
    const root = tempProject({ 'package.json': { dependencies: { next: '15.3.0' } }, 'app/page.tsx': 'export default function Home() {\n  return null;\n}\n' });
    const p = await json(root, 'adopt', '--level', 'design');
    expect(p.unknowns.map((u: { area: string }) => u.area)).toEqual(expect.arrayContaining(['components', 'theme', 'tests', 'ci']));
    expect(p.capabilities.find((c: { id: string }) => c.id === 'design-system')).toMatchObject({ enabled: true, on: false, status: 'needs your theme: no shadcn CSS or design-system/ found, so nothing is imported' });
    expect((await fwos(root, 'adopt', '--level', 'design', '--yes')).code).toBe(0);
    // No starter design system in its place.
    expect(existsSync(join(root, 'design-system'))).toBe(false);
    expect((await fwos(root, 'status')).out).toMatch(/OFF\s+design system\s+needs your theme/);
  });
});

describe('fwos adopt: decisions only the user can make', () => {
  const monorepo = {
    'package.json': { private: true },
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    'apps/site/package.json': { dependencies: { next: '15.3.0', '@example-org/ui': 'workspace:*' } },
    'apps/site/app/page.tsx': 'export default function Home() {\n  return null;\n}\n',
    'apps/admin/package.json': { dependencies: { next: '15.3.0', '@example-org/charts': 'workspace:*' } },
    // Another team's app, with a finding of its own.
    'apps/admin/app/page.tsx': 'export default function Admin() {\n  return <img src="/admin.png" />;\n}\n',
    'packages/ui/package.json': { name: '@example-org/ui' },
    'packages/ui/src/button.tsx': 'export const Button = () => null;\n',
    'packages/charts/package.json': { name: '@example-org/charts' },
    'packages/charts/src/line.tsx': 'export const Line = () => <img src="/line.png" />;\n',
  };

  it('asks which app to adopt in a monorepo, then checks and gates only that one', async () => {
    const root = tempProject(monorepo);
    const p = await fwos(root, 'adopt');
    expect(p.code).toBe(0);
    expect(p.out).toContain('Pick the app to adopt: --app apps/admin or --app apps/site.');
    expect(await fwos(root, 'adopt', '--yes')).toMatchObject({ code: 2, err: expect.stringContaining('Pick the app to adopt') });
    expect(await fwos(root, 'adopt', '--app', 'apps/nope')).toMatchObject({ code: 2, err: expect.stringContaining("apps/nope isn't a Next.js app here. Next.js apps: apps/admin, apps/site.") });
    expect(existsSync(join(root, '.fwos'))).toBe(false);

    expect((await fwos(root, 'adopt', '--app', 'apps/site', '--yes')).code).toBe(0);
    expect(state(root).paths).toEqual({
      apps: { web: 'apps/site' },
      source: ['apps/site/app/**', 'packages/ui/src/**'],
      ignore: ['spikes/**', '.fwos/cli/**', 'apps/admin/**', 'packages/charts/**'],
    });
    // The other team's findings were never read, so none became debt, and a new one there is theirs.
    expect(read(root, '.fwos/baseline.json')).not.toMatch(/apps\/admin|packages\/charts/);
    writeText(join(root, 'apps/admin/app/users/page.tsx'), 'export default function Users() {\n  return <img src="/u.png" />;\n}\n');
    expect((await json(root, 'check')).exit).toBe(0);

    // Delivery gates the adopted app while a change is open, and never the other team's.
    expect((await fwos(root, 'adopt', '--level', 'delivery', '--yes')).code).toBe(0);
    expect((await fwos(root, 'change', 'new', 'add search', '--route', 'touches-ac')).code).toBe(0);
    const write = (file: string) => dispatch('pre-tool-use', { tool_name: 'Write', tool_input: { file_path: join(root, file), content: 'x' } }, root).stdout;
    expect(write('apps/site/app/search/page.tsx')).toMatch(/permissionDecision":"deny/);
    expect(write('packages/ui/src/button.tsx')).toMatch(/permissionDecision":"deny/);
    expect(write('apps/admin/app/page.tsx')).toBe('');
    expect(write('packages/charts/src/line.tsx')).toBe('');
  });

  it("stops when fwos's docs folder already holds the team's files, until they pick another", async () => {
    const root = app({ 'docs/app/spec.md': "# Our spec\nThe team's own spec, in its own format.\n" });
    const p = await json(root, 'adopt');
    expect(p.decisions).toEqual(['docs/app/spec.md is yours, and fwos keeps its records in docs/app/: pass --docs <folder> to keep them apart (for example --docs docs/fwos).']);
    expect(await fwos(root, 'adopt', '--yes')).toMatchObject({ code: 2, err: expect.stringContaining('docs/app/spec.md is yours') });
    expect((await fwos(root, 'adopt', '--docs', 'docs/fwos', '--yes')).code).toBe(0);
    expect(state(root).paths.docs).toBe('docs/fwos');
    const spec = (await json(root, 'check')).results.find((r: { id: string }) => r.id === 'spec/format');
    expect(spec).toMatchObject({ status: 'off', reason: expect.stringContaining('docs/fwos/spec.md') });
    expect(read(root, 'docs/app/spec.md')).toBe("# Our spec\nThe team's own spec, in its own format.\n");
  });

  it("stops when design-system/ is the team's own and isn't fwos's format", async () => {
    const root = app({ 'design-system/design-system.json': { tokens: ['brand.json'] } });
    const p = await json(root, 'adopt');
    expect(p.decisions).toEqual([
      "design-system/design-system.json is yours and not in fwos's format, which would stop every check: pass --design-system <folder> for fwos's copy (for example --design-system design/fwos).",
    ]);
    expect((await fwos(root, 'adopt', '--design-system', 'design/fwos', '--level', 'design', '--yes')).code).toBe(0);
    expect(existsSync(join(root, 'design/fwos/design-system.json'))).toBe(true);
    expect(read(root, 'design-system/design-system.json')).toContain('brand.json');
    expect((await json(root, 'check')).exit).toBe(0);
  });

  it('refuses to adopt a project fwos started', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    expect(await fwos(root, 'adopt')).toMatchObject({ code: 2, err: expect.stringContaining('fwos started this project') });
  });
});

describe('adoption levels', () => {
  it("adopts at checks: .fwos/ and a baseline, and nothing of the team's changes", async () => {
    const root = app();
    const r = await fwos(root, 'adopt', '--yes');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Adopted the app at . at level checks.');
    expect(r.out).toMatch(/Baseline: \d+ findings? recorded as debt\. `fwos check` fails only on new ones\./);
    expect(changed(root).sort()).toEqual([' M .gitignore', '?? .fwos/']);
    expect(read(root, '.gitignore')).toBe('node_modules\n.next\n# fwos: evidence, run logs and test results (local only)\n.fwos/local/\n');
    expect((await fwos(root, 'check')).code).toBe(0);
    expect((await fwos(root, 'next', '--json')).out).toMatch(/adopted at level checks/);
  });

  it('shows the level and every capability, on or off and why, in status and doctor', async () => {
    const root = app();
    await fwos(root, 'adopt', '--yes');
    const status = await fwos(root, 'status');
    expect(status.out).toMatch(/^Adopted app at \. \(level checks since \d{4}-\d{2}-\d{2}\)/);
    expect(status.out).toMatch(/ON\s+checks\s+fwos check reads app\/\*\*, components\/\*\*, lib\/\*\*/);
    expect(status.out).toMatch(/ON\s+baseline\s+\d+ pre-existing findings?, recorded \d{4}-\d{2}-\d{2}/);
    expect(status.out).toMatch(/OFF\s+commit hook\s+optional: `fwos git-hook install`/);
    expect(status.out).toMatch(/--\s+design system\s+at level design: imports app\/globals\.css into design-system\//);
    // An adopted app has no greenfield approvals to show, and none are invented.
    expect(status.out).not.toMatch(/brief|research|architecture/);
    const s = await json(root, 'status');
    expect(s.adoption).toMatchObject({ level: 'checks', app: '.', history: [{ level: 'checks' }] });
    expect(s.adoption.capabilities.filter((c: { on: boolean }) => c.on).map((c: { id: string }) => c.id)).toEqual(['checks', 'baseline']);
    const d = await json(root, 'doctor');
    expect(d.adoption).toMatchObject({ level: 'checks', capabilities: s.adoption.capabilities });
    expect((await fwos(root, 'doctor')).out).toMatch(/Adoption\s+level checks/);
    // Turning an optional one on shows at once.
    await fwos(root, 'git-hook', 'install');
    expect((await fwos(root, 'status')).out).toMatch(/ON\s+commit hook/);
  });

  it('upgrades a level without resetting anything, and takes in only what the new level turns on', async () => {
    const root = app();
    await fwos(root, 'adopt', '--yes');
    commitAll(root, 'adopt fwos at level checks');
    const before = readJson<{ findings: Record<string, unknown>; checks: Record<string, string> }>(join(root, '.fwos/baseline.json'))!;
    const changes = read(root, '.fwos/changes/0001-initial.json');

    const preview = await fwos(root, 'adopt', '--level', 'design');
    expect(preview.out).toContain('Level checks -> design: imports app/globals.css into design-system/, then takes in the findings of the checks it turns on. Keeps 1 change record and the baseline.');
    expect(changed(root)).toEqual([]);

    const up = await fwos(root, 'adopt', '--level', 'design', '--yes');
    expect(up.code).toBe(0);
    expect(up.out).toContain('Wrote design-system/ from app/globals.css (8 files). They are yours.');
    expect(up.out).toMatch(/Mapped from the copy of your theme in design-system\/source\/: \d+ preserved/);
    expect(read(root, 'design-system/source/globals.css')).toBe(THEME);
    // The report is written when asked for, so adoption adds nothing to docs/.
    expect(existsSync(join(root, 'docs/app/reports/design-system.md'))).toBe(false);
    expect(up.out).toMatch(/Baseline: took in \d+ findings? of design-system\/[a-z-]+/);
    expect(state(root).adopt.history.map((h: { level: string }) => h.level)).toEqual(['checks', 'design']);
    expect(read(root, '.fwos/changes/0001-initial.json')).toBe(changes);
    const after = readJson<{ findings: Record<string, unknown>; checks: Record<string, string> }>(join(root, '.fwos/baseline.json'))!;
    for (const [id, f] of Object.entries(before.findings)) expect(after.findings[id], id).toEqual(f);
    for (const [id, at] of Object.entries(before.checks)) expect(after.checks[id], id).toBe(at);
    expect((await fwos(root, 'check')).code).toBe(0);

    expect((await fwos(root, 'adopt', '--level', 'delivery', '--yes')).code).toBe(0);
    expect(state(root).adopt.level).toBe('delivery');
    expect((await fwos(root, 'adopt', '--level', 'delivery')).out).toContain('Already at level delivery.');
    // Leaving delivery would strand an open change.
    await fwos(root, 'change', 'new', 'add search', '--route', 'touches-ac');
    expect(await fwos(root, 'adopt', '--level', 'checks', '--yes')).toMatchObject({ code: 2, err: expect.stringContaining('Change 0002-add-search is open') });
    expect(await fwos(root, 'adopt', '--app', 'apps/other', '--yes')).toMatchObject({ code: 2, err: expect.stringContaining('This adoption covers the app at .') });
  });
});

describe('a defect behind the baseline', () => {
  it('fails as new, the baseline refuses to hide it, and a hand-widened baseline is not honoured', async () => {
    const root = app();
    await fwos(root, 'adopt', '--yes');
    commitAll(root, 'adopt fwos');
    writeText(join(root, 'app/members/page.tsx'), 'export default function Members() {\n  return <img src="/avatar.png" />;\n}\n');
    const r = await fwos(root, 'check', 'rules/pack');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL\s+rules\/pack\s+1 new finding \(1 baselined\)/);
    expect(await fwos(root, 'baseline')).toMatchObject({ code: 2, err: expect.stringContaining('The baseline can only shrink; 1 finding is new.') });

    // Widened by hand, as a shell edit could: fwos check still fails, and says why.
    const base = readJson<{ findings: Record<string, Record<string, number>> }>(join(root, '.fwos/baseline.json'))!;
    const fp = Object.keys(base.findings['rules/pack']!)[0]!;
    base.findings['rules/pack']![fp.replace('app/page.tsx', 'app/members/page.tsx')] = 1;
    writeText(join(root, '.fwos/baseline.json'), JSON.stringify(base));
    const widened = await json(root, 'check', 'rules/pack');
    const pack = widened.results.find((x: { id: string }) => x.id === 'rules/pack');
    expect(pack.status).toBe('fail');
    expect(pack.info).toContain(".fwos/baseline.json covers 1 more finding than the last commit's, and fwos check doesn't honour it");

    // Starting the baseline over would hide it too.
    rmSync(join(root, '.fwos/baseline.json'));
    expect(await fwos(root, 'baseline', '--init')).toMatchObject({ code: 2, err: expect.stringContaining('The last commit has a baseline') });
  });

  it('honours a widened baseline once it is committed, which is why the pull request has to show it (a limit the README names)', async () => {
    const root = app();
    await fwos(root, 'adopt', '--yes');
    commitAll(root, 'adopt fwos');
    writeText(join(root, 'app/members/page.tsx'), 'export default function Members() {\n  return <img src="/avatar.png" />;\n}\n');
    const base = readJson<{ findings: Record<string, Record<string, number>> }>(join(root, '.fwos/baseline.json'))!;
    const fp = Object.keys(base.findings['rules/pack']!)[0]!;
    base.findings['rules/pack']![fp.replace('app/page.tsx', 'app/members/page.tsx')] = 1;
    writeText(join(root, '.fwos/baseline.json'), JSON.stringify(base));
    expect((await fwos(root, 'check', 'rules/pack')).code).toBe(1);
    commitAll(root, 'widen the baseline by hand');
    expect((await fwos(root, 'check', 'rules/pack')).code).toBe(0);
    expect(git(root, 'show', '--stat', 'HEAD')).toContain('.fwos/baseline.json');
  });
});

describe('delivering a change in an adopted app', () => {
  const SPEC = `# Changes delivered through fwos

## What you're approving
Search on the members page.

## Context
- Request: https://github.com/example-org/app/issues/12
- Page: app/members/page.tsx. Components: components/ui/table.tsx. Tests: app/members/members.test.tsx.

## Request
### REQ-1: Search the members by name
- AC: AC-members-1

## States
| State | What the user sees | Criterion |
|---|---|---|
| filtered-empty | No members match. | AC-members-1 |

## Acceptance criteria
### AC-members-1: Searching by name narrows the list
- Given three members, when I type "ad", then only "Ada" shows; when I type "zz", then no member shows and the list says No members match.
- Proven against: local

## Open questions
None.
`;
  const PLAN = `# Test plan

### TC-members-1: search narrows the list
- AC: AC-members-1
- Level: component
- Status: new

### TC-members-2: search narrows the list in a browser
- AC: AC-members-1
- Level: e2e
- Status: new

## Regression scope

- app/members/members.test.tsx: the list as it is
`;
  /** Results that prove the criterion in jsdom and in a browser (Playwright's file). */
  const proven = (root: string) => {
    writeText(join(root, '.fwos/local/results/vitest.xml'), '<testsuite><testcase classname="app/members/search.test.tsx" name="narrows the list @AC-members-1"/><testcase classname="app/members/members.test.tsx" name="lists members"/></testsuite>\n');
    writeText(join(root, '.fwos/local/results/playwright.xml'), '<testsuite><testcase classname="members.spec.ts" name="narrows the list in a browser @AC-members-1"/></testsuite>\n');
    // This helper deliberately supplies current fixture evidence without executing a runner.
    syntheticTestRun(root);
  };

  it('needs the delivery level, and says how to turn it on', async () => {
    const root = app();
    await fwos(root, 'adopt', '--yes');
    expect(await fwos(root, 'change', 'new', 'add search', '--route', 'touches-ac')).toMatchObject({
      code: 2,
      err: expect.stringContaining('Change delivery is off at level checks. Turn it on with `fwos adopt --level delivery --yes`.'),
    });
  });

  it('starts from text or a linked issue or doc, records the links, and refuses routes that would take over the app', async () => {
    const root = app();
    await fwos(root, 'adopt', '--level', 'delivery', '--yes');
    const r = await fwos(root, 'change', 'new', 'add search to members', '--route', 'touches-ac', '--link', 'https://github.com/example-org/app/issues/12', '--link', 'docs/product/members-prd.md');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Created change 0002-add-search-to-members \(route touches-ac, enters at spec\)\./);
    expect(r.out).toContain('Linked: https://github.com/example-org/app/issues/12');
    expect(r.out).toMatch(/Linked: docs\/product\/members-prd\.md \(at [0-9a-f]{12}\)/);
    // The adoption record isn't a change waiting to be finished.
    expect(r.out).not.toMatch(/still open/);
    expect(JSON.parse((await fwos(root, 'change', 'show')).out).links).toEqual([
      { ref: 'https://github.com/example-org/app/issues/12' },
      { ref: 'docs/product/members-prd.md', sha: expect.stringMatching(/^[0-9a-f]{12}$/) },
    ]);
    expect(await fwos(root, 'change', 'new', 'x', '--route', 'touches-ac', '--link', 'docs/nope.md')).toMatchObject({ code: 2, err: expect.stringContaining("--link docs/nope.md isn't a URL or a file in the project") });
    for (const route of ['design-system', 'architecture', 'add-platform']) {
      expect(await fwos(root, 'change', 'new', 'x', '--route', route), route).toMatchObject({ code: 2, err: expect.stringContaining("isn't delivered through fwos in an adopted app") });
    }
    const fromLink = await fwos(root, 'change', 'new', '--route', 'code-only', '--link', 'https://github.com/example-org/app/issues/13');
    expect(fromLink.out).toMatch(/^Created change 0003-https-github-com-example-org-app-issues \(route code-only, enters at build\)\./);
  });

  it("goes through only the change's own steps, with a spec delta instead of the product's whole spec", async () => {
    const root = app();
    await fwos(root, 'adopt', '--level', 'delivery', '--yes');
    await fwos(root, 'change', 'new', 'add search to members', '--route', 'touches-ac');
    const next = await json(root, 'next');
    expect(next).toMatchObject({ step: 'spec', skill: 'fwos:spec', blocked: [], adopt: { level: 'delivery' } });
    expect(await fwos(root, 'step', 'build')).toMatchObject({ code: 2, err: expect.stringContaining("Can't move to build: spec isn't approved in change 0002-add-search-to-members") });
    expect(await fwos(root, 'step', 'discovery')).toMatchObject({ code: 2, err: expect.stringContaining('starts at spec') });
    writeText(join(root, 'docs/app/spec.md'), SPEC);
    writeText(join(root, 'docs/app/test-plan.md'), PLAN);
    await fwos(root, 'change', 'map', '/members');
    const checks = await json(root, 'check', 'spec/format', 'tests/plan');
    expect(checks.results.filter((x: { status: string }) => x.status === 'fail')).toEqual([]);
    expect((await fwos(root, 'approve', 'spec', '--by', 'Ada')).code).toBe(0);
    expect((await fwos(root, 'step', 'build')).code).toBe(0);
    expect((await json(root, 'next')).blocked).toEqual([]);
  });

  it('locks only the tests the change adds or changes, never the inherited suite', async () => {
    const root = app();
    await fwos(root, 'adopt', '--level', 'delivery', '--yes');
    commitAll(root, 'adopt fwos');
    expect(await fwos(root, 'tests', 'lock', 'app/members/members.test.tsx', '--existing')).toMatchObject({ code: 2, err: expect.stringContaining('Lock tests inside a change') });
    await fwos(root, 'change', 'new', 'add search to members', '--route', 'touches-ac');
    expect(await fwos(root, 'tests', 'lock', 'app/members/members.test.tsx', '--existing')).toMatchObject({
      code: 2,
      err: expect.stringContaining("app/members/members.test.tsx is part of your existing suite (unchanged since this change began), so it isn't locked"),
    });
    writeText(join(root, 'app/members/search.test.tsx'), "import { it } from 'vitest';\nit('narrows the list @AC-members-1', () => {});\n");
    expect((await fwos(root, 'tests', 'lock', 'app/members/search.test.tsx', '--existing')).code).toBe(0);
    writeText(join(root, 'app/members/members.test.tsx'), `${read(root, 'app/members/members.test.tsx')}it('still lists members after a search', () => {});\n`);
    expect((await fwos(root, 'tests', 'lock', 'app/members/members.test.tsx', '--existing')).code).toBe(0);
  });

  it('reports the request with its links, and keeps pre-existing debt apart from new findings', async () => {
    const root = app();
    await fwos(root, 'adopt', '--level', 'delivery', '--yes');
    commitAll(root, 'adopt fwos');
    await fwos(root, 'change', 'new', 'add search to members', '--route', 'touches-ac', '--link', 'https://github.com/example-org/app/issues/12', '--link', 'docs/product/members-prd.md');
    writeText(join(root, 'docs/app/spec.md'), SPEC);
    writeText(join(root, 'docs/app/test-plan.md'), PLAN);
    await fwos(root, 'change', 'map', '/members');
    expect((await fwos(root, 'approve', 'spec', '--by', 'Ada')).code).toBe(0);
    await fwos(root, 'step', 'build');
    proven(root);
    await fwos(root, 'step', 'accept');
    expect((await fwos(root, 'report')).code).toBe(0);
    const report = read(root, 'docs/app/reports/acceptance.md');
    expect(report).toContain('## Imported context');
    expect(report).toContain('- https://github.com/example-org/app/issues/12');
    expect(report).toMatch(/- docs\/product\/members-prd\.md \(unchanged since it was linked\)/);
    expect(report).toContain('## New findings\n\nNone.');
    expect(report).toMatch(/## Pre-existing debt \(baseline\)\n\nFindings recorded before this change\. They are not evidence that it works/);
    expect(report).toMatch(/\| rules\/pack \| 1 \| \d{4}-\d{2}-\d{2} \|/);

    // A new defect is a new finding in the report, not more debt, and the change isn't done.
    writeText(join(root, 'app/members/page.tsx'), 'export default function Members() {\n  return <img src="/avatar.png" />;\n}\n');
    writeText(join(root, 'docs/product/members-prd.md'), '# Members\nChanged after it was linked.\n');
    expect((await fwos(root, 'report')).code).toBe(1);
    const after = read(root, 'docs/app/reports/acceptance.md');
    // Changing app source also invalidates the prior run; don't silently rebind that evidence.
    expect(after).toMatch(/## New findings\n\n- tests\/traceability: no test results/);
    expect(after).toContain('- tests/regression: app/members/members.test.tsx no result names it, so it never ran');
    expect(after).toMatch(/- rules\/pack: app\/members\/page\.tsx:2 /);
    expect(after).toMatch(/\| rules\/pack \| 1 \| /);
    expect(after).toContain('- docs/product/members-prd.md (changed since it was linked)');
  });

  it('keeps the approved report when the change closes, and goes on reporting that change, not the adoption record', async () => {
    const root = app();
    await fwos(root, 'adopt', '--level', 'delivery', '--yes');
    commitAll(root, 'adopt fwos');
    await fwos(root, 'change', 'new', 'add search to members', '--route', 'touches-ac', '--link', 'docs/product/members-prd.md');
    writeText(join(root, 'docs/app/spec.md'), SPEC);
    writeText(join(root, 'docs/app/test-plan.md'), PLAN);
    await fwos(root, 'change', 'map', '/members');
    expect((await fwos(root, 'approve', 'spec', '--by', 'Ada')).code).toBe(0);
    await fwos(root, 'step', 'build');
    proven(root);
    await fwos(root, 'step', 'accept');
    expect((await fwos(root, 'report')).code).toBe(0);
    await fwos(root, 'approve', 'acceptance', '--by', 'Ada');
    expect((await fwos(root, 'change', 'done')).code).toBe(0);

    // Closing the change is no new evidence: the report the person approved is the same file.
    expect((await fwos(root, 'report')).out).toMatch(/Unchanged: docs\/app\/reports\/acceptance\.md/);
    expect((await json(root, 'next')).stale).toEqual([]);
    const approvals = async () => (await json(root, 'check', 'state/approvals')).results.find((r: { id: string }) => r.id === 'state/approvals');
    expect(await approvals()).toMatchObject({ status: 'pass' });

    // It still reports that change, so a doc the change linked shows when it moves on.
    writeText(join(root, 'docs/product/members-prd.md'), '# Members\nChanged after the change closed.\n');
    await fwos(root, 'report');
    const report = read(root, 'docs/app/reports/acceptance.md');
    expect(report).toContain('- Change: 0002-add-search-to-members (add search to members)');
    expect(report).toContain('- docs/product/members-prd.md (changed since it was linked)');
    // A yes to the new report is that change's, never the adoption record's.
    await fwos(root, 'approve', 'acceptance', '--by', 'Grace');
    const record = (id: string) => JSON.parse(read(root, `.fwos/changes/${id}.json`));
    expect(record('0002-add-search-to-members').approvals.acceptance).toMatchObject({ by: 'Grace' });
    expect(record('0001-initial').approvals).toEqual({});

    // And the spec it approved holds after it closes, as in an app fwos started.
    writeText(join(root, 'docs/app/spec.md'), SPEC.replace('Search on the members page.', 'Search and sorting on the members page.'));
    expect((await approvals()).findings).toEqual([
      expect.objectContaining({ message: expect.stringContaining('spec changed after change 0002-add-search-to-members approved it (docs/app/spec.md)') }),
    ]);
  });

  it('closes the change and goes back to checking the app as it is', async () => {
    const root = app();
    await fwos(root, 'adopt', '--level', 'delivery', '--yes');
    await fwos(root, 'change', 'new', 'fix the members heading', '--route', 'code-only');
    expect((await fwos(root, 'change', 'done')).code).toBe(0);
    expect((await json(root, 'next')).action).toMatch(/adopted at level delivery.*\/fwos:change/);
    expect((await json(root, 'status')).change).toBeNull();
  });
});

describe('removing fwos from an adopted app', () => {
  it("takes out what adoption added and leaves the team's files as they were", async () => {
    const root = app();
    await fwos(root, 'adopt', '--level', 'design', '--yes');
    expect((await fwos(root, 'eject', '--yes')).code).toBe(0);
    // Only the design system imported from the app's own theme is left, and it's theirs.
    expect(changed(root)).toEqual(['?? design-system/']);
  });
});
