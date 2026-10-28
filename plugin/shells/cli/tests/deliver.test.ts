// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Delivering a change inside an adopted app, through the CLI: the team's own test commands run by
// fwos with their configs left alone, the change mapped onto the code it touches, its tests and
// the regression tests around it, a browser check, the team's branches and reviews, and approvals
// recorded only as people give them.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
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
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '--allow-empty', '-m', message);
};
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const write = (root: string, rel: string, text: string) => writeText(join(root, rel), text);

/**
 * Stand-ins for the team's runners in node_modules/.bin. Each writes the JUnit XML in
 * `fake-<runner>.xml` (or Jest's JSON in fake-jest.json) where the reporter fwos added says, and
 * fails when it holds a failure, as the real runner would. They echo their arguments.
 */
const FAKE_RUNNERS: Record<string, string> = {
  'node_modules/.bin/vitest': `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const out = (process.argv.find((a) => a.startsWith('--outputFile.junit=')) || '').slice('--outputFile.junit='.length);
const xml = fs.readFileSync('fake-vitest.xml', 'utf8');
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, xml); }
console.log('vitest ' + process.argv.slice(2).join(' '));
process.exit(xml.includes('<failure') ? 1 : 0);
`,
  'node_modules/.bin/playwright': `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const out = process.argv.includes('--reporter=list,junit') ? process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE : '';
const xml = fs.readFileSync('fake-playwright.xml', 'utf8');
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, xml); }
console.log('playwright ' + process.argv.slice(2).join(' '));
process.exit(xml.includes('<failure') ? 1 : 0);
`,
  'node_modules/.bin/jest': `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const out = (process.argv.find((a) => a.startsWith('--outputFile=')) || '').slice('--outputFile='.length);
const json = JSON.parse(fs.readFileSync('fake-jest.json', 'utf8'));
for (const r of json.testResults) r.name = path.resolve(r.name);
if (out && process.argv.includes('--json')) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(json)); }
process.exit(json.numFailedTests > 0 ? 1 : 0);
`,
};

const SPEC = `# Changes delivered through fwos

## What you're approving
Search on the members page.

## Context
- Route: /members, app/members/page.tsx.

## Request
### REQ-1: Search the members list
- AC: AC-members-1

## States
| State | What the user sees | Criterion |
|---|---|---|
| filtered-empty | No members match. | AC-members-1 |

## Acceptance criteria
### AC-members-1: Searching narrows the list
- Given three members, when I search "ada", then only Ada shows; when I search "zzz", then no member shows and the list says No members match.
- Proven against: mock

## Open questions
None.
`;

const junit = (...cases: string[]) => `<testsuites><testsuite name="s">${cases.join('')}</testsuite></testsuites>\n`;
const pass = (name: string, file = 'app/members/members.test.tsx') => `<testcase classname="${file}" name="${name}"/>`;
const fail = (name: string, message: string, file = 'app/members/members.test.tsx') => `<testcase classname="${file}" name="${name}"><failure message="${message}"/></testcase>`;

/** An adopted app at level delivery whose package.json runs Vitest and Playwright, with stand-in runners. */
function adoptedApp(scripts: Record<string, string> = { test: 'vitest run', e2e: 'playwright test' }, extra: Record<string, string | object> = {}) {
  const root = tempProject({
    'package.json': { name: 'example-org', private: true, scripts, dependencies: { next: '15.3.0', react: '19.1.0' } },
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    '.gitignore': 'node_modules\n',
    'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } },
    'app/layout.tsx': 'export default function Layout({ children }: { children: React.ReactNode }) {\n  return children;\n}\n',
    'app/members/page.tsx': "import { Input } from '@/components/ui/input';\nexport default function Members() {\n  return <main><Input /></main>;\n}\n",
    'app/settings/page.tsx': 'export default function Settings() {\n  return <main>Settings</main>;\n}\n',
    'components/ui/input.tsx': 'export const Input = () => null;\n',
    'app/members/members.test.tsx': "import Members from './page';\nit('lists members', () => {});\n",
    'e2e/members.spec.ts': "test('opens the page', async ({ page }) => {\n  await page.goto('/members');\n});\n",
    '.github/CODEOWNERS': '* @example-org/web\n/app/members/ @example-org/members\n',
    '.github/pull_request_template.md': '## What changed\n',
    'vitest.config.ts': 'export default {};\n',
    'playwright.config.ts': 'export default {};\n',
    'fake-vitest.xml': junit(pass('lists members')),
    'fake-playwright.xml': junit(pass('opens the page', 'members.spec.ts')),
    ...FAKE_RUNNERS,
    ...extra,
  });
  for (const f of Object.keys(FAKE_RUNNERS)) chmodSync(join(root, f), 0o755);
  git(root, 'init', '-q');
  commitAll(root, 'the app as the team has it');
  return root;
}

async function atDelivery(root: string) {
  expect((await fwos(root, 'adopt', '--level', 'delivery', '--yes')).code).toBe(0);
  commitAll(root, 'adopt fwos');
}

describe("fwos tests run: the team's own commands, results mapped into fwos", () => {
  it('runs each test script through the package manager with a JUnit reporter on the command line, and leaves the configs alone', async () => {
    const root = adoptedApp();
    await atDelivery(root);
    const r = await fwos(root, 'tests', 'run');
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out.split('\n')).toEqual([
      'pnpm test (Vitest): 1 passed. Results in .fwos/local/results/test.xml.',
      'pnpm e2e (Playwright, in a browser): 1 passed. Results in .fwos/local/results/e2e.xml.',
    ]);
    expect(read(root, '.fwos/local/results/test.xml')).toBe(read(root, 'fake-vitest.xml'));
    expect(read(root, '.fwos/local/results/e2e.xml')).toBe(read(root, 'fake-playwright.xml'));
    // Nothing of the team's changed: their configs, scripts and lockfile are as they were.
    expect(git(root, 'status', '--porcelain')).toBe('');
    // Each run is a run record of kind tests, on the code it ran on: the runners changed none of it.
    const record = (target: string) => JSON.parse(read(root, `.fwos/local/runs/tests/${target}.json`));
    expect(record('test')).toMatchObject({
      schema: 1,
      kind: 'tests',
      target: 'test',
      revision: expect.stringMatching(/^[0-9a-f]+$/),
      observations: { script: 'test', dir: '.', display: 'pnpm test', command: 'vitest run', runner: 'Vitest', browser: false, mapped: true, exit: 0, results: ['.fwos/local/results/test.xml'], cases: { passed: 1, failed: 0, skipped: 0 } },
    });
    expect(record('e2e')).toMatchObject({ kind: 'tests', revision: expect.stringMatching(/^[0-9a-f]+$/), observations: { script: 'e2e', runner: 'Playwright', browser: true, mapped: true, exit: 0, results: ['.fwos/local/results/e2e.xml'] } });
  });

  it('fails when a script fails, names the failing tests, and its results prove what they prove', async () => {
    const root = adoptedApp({ test: 'vitest run' }, { 'fake-vitest.xml': junit(pass('lists members'), fail('narrows the list @AC-members-1', 'Unable to find a label with the text of: Search')) });
    await atDelivery(root);
    write(root, 'docs/app/spec.md', SPEC);
    const r = await fwos(root, 'tests', 'run');
    expect(r.code).toBe(1);
    expect(r.out).toContain('pnpm test (Vitest): 1 failed, 1 passed. Results in .fwos/local/results/test.xml.');
    expect(r.out).toContain('  failed: narrows the list @AC-members-1 (Unable to find a label with the text of: Search)');
    const trace = (await json(root, 'check', 'tests/traceability')).results.find((x: { id: string }) => x.id === 'tests/traceability');
    expect(trace.info[0]).toBe('1 failing');
  });

  it("runs a script it can't read results from as it is, and says the run proves nothing", async () => {
    const root = adoptedApp({ 'test:links': 'node check-links.js' }, { 'check-links.js': "console.log('links ok');\n" });
    await atDelivery(root);
    const r = await fwos(root, 'tests', 'run');
    expect(r.code).toBe(0);
    expect(r.out).toBe("pnpm test:links: exit 0. Not mapped: fwos doesn't know how to read results from `node check-links.js`, so this run proves no criterion.");
    expect((await json(root, 'tests', 'run')).runs).toEqual([expect.objectContaining({ script: 'test:links', runner: null, mapped: false, exit: 0, results: [], reason: "fwos doesn't know how to read results from `node check-links.js`" })]);
  });

  it("turns Jest's own JSON into JUnit, so its tagged tests prove their criteria", async () => {
    const jest = {
      numFailedTests: 0,
      testResults: [{ name: 'app/members/members.test.tsx', assertionResults: [{ fullName: 'members narrows the list @AC-members-1', title: 'narrows the list @AC-members-1', status: 'passed', failureMessages: [] }] }],
    };
    const root = adoptedApp({ test: 'jest' }, { 'fake-jest.json': jest });
    await atDelivery(root);
    write(root, 'docs/app/spec.md', SPEC);
    expect((await fwos(root, 'tests', 'run')).out).toBe('pnpm test (Jest): 1 passed. Results in .fwos/local/results/test.xml.');
    const trace = (await json(root, 'check', 'tests/traceability')).results.find((x: { id: string }) => x.id === 'tests/traceability');
    expect(trace).toMatchObject({ status: 'pass', info: ['1 proven'] });
  });

  it('removes what an earlier run of the same script left, so a run that writes nothing proves nothing', async () => {
    const crash = '#!/usr/bin/env node\nconsole.error("vitest: the config failed to load");\nprocess.exit(1);\n';
    const root = adoptedApp({ test: 'vitest run' }, { 'node_modules/.bin/vitest': crash });
    await atDelivery(root);
    write(root, '.fwos/local/results/test.xml', junit(pass('narrows the list @AC-members-1')));
    const r = await fwos(root, 'tests', 'run');
    expect(r.code).toBe(1);
    expect(r.out).toContain('pnpm test (Vitest): exit 1, and it wrote no results, so this run proves nothing.');
    expect(r.out).toContain('  vitest: the config failed to load');
    expect(existsSync(join(root, '.fwos/local/results/test.xml'))).toBe(false);
  });

  it('runs only the scripts it is asked for', async () => {
    const root = adoptedApp();
    await atDelivery(root);
    expect((await fwos(root, 'tests', 'run', 'e2e')).out).toBe('pnpm e2e (Playwright, in a browser): 1 passed. Results in .fwos/local/results/e2e.xml.');
    expect(existsSync(join(root, '.fwos/local/results/test.xml'))).toBe(false);
    expect(await fwos(root, 'tests', 'run', 'smoke')).toMatchObject({ code: 2, err: expect.stringContaining('No script "smoke" in package.json') });
  });

  it('says so when either an adopted or a new app has no test script', async () => {
    const root = adoptedApp({ dev: 'next dev' });
    await atDelivery(root);
    expect(await fwos(root, 'tests', 'run')).toMatchObject({ code: 2, err: expect.stringContaining('No test script in package.json') });
    const fresh = tempProject({ '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] }, 'package.json': { scripts: { dev: 'next dev' } } });
    expect(await fwos(fresh, 'tests', 'run')).toMatchObject({ code: 2, err: expect.stringContaining('No test script in package.json') });
  });

  it("shows on the test-results capability what fwos would run, and what it can't read", async () => {
    const caps = async (root: string) => ((await json(root, 'status')).adoption.capabilities as { id: string; on: boolean; status: string }[]).find((c) => c.id === 'test-results');
    const none = adoptedApp({ dev: 'next dev' });
    await atDelivery(none);
    expect(await caps(none)).toMatchObject({ on: false, status: expect.stringContaining('no test script in package.json (test, test:*, e2e or e2e:*)') });
    const two = adoptedApp();
    await atDelivery(two);
    expect(await caps(two)).toMatchObject({ on: false, status: '`fwos tests run` runs pnpm test (Vitest) and pnpm e2e (Playwright, in a browser), with a JUnit reporter added on the command line' });
    await fwos(two, 'tests', 'run');
    expect(await caps(two)).toMatchObject({ on: true, status: '2 result files in .fwos/local/results/' });
    const links = adoptedApp({ 'test:links': 'node check-links.js' });
    await atDelivery(links);
    expect(await caps(links)).toMatchObject({ on: false, status: expect.stringMatching(/^pnpm test:links runs as it is, but fwos can't read its results/) });
  });
});

const COMPONENT_CASE = `### TC-members-1: search narrows the list
- AC: AC-members-1
- Level: component
- Status: new
`;
const BROWSER_CASE = `### TC-members-2: search narrows the list in a browser
- AC: AC-members-1
- Level: e2e
- Status: new
`;
const PLAN = `# Test plan

${COMPONENT_CASE}
${BROWSER_CASE}
## Regression scope

- app/members/members.test.tsx: the list as it is
- e2e/members.spec.ts: the page opens
`;

describe('fwos change map: a change grounded in the code it touches', () => {
  async function withChange(route = 'touches-ac') {
    const root = adoptedApp();
    await atDelivery(root);
    expect((await fwos(root, 'change', 'new', 'search the members list', '--route', route)).code).toBe(0);
    return root;
  }
  const result = async (root: string, id: string) => (await json(root, 'check', id)).results.find((x: { id: string }) => x.id === id) as { status: string; reason?: string; findings: { file?: string; message: string }[] };
  const messages = async (root: string, id: string) => (await result(root, id)).findings.map((f) => f.message);

  it('maps a route onto its page, components, data, tests and owners, and records it on the change', async () => {
    const root = await withChange();
    const r = await fwos(root, 'change', 'map', '/members');
    expect(r.code, r.err).toBe(0);
    expect(r.out.split('\n')).toEqual([
      'Mapped change 0002-search-the-members-list onto the code it touches:',
      '  /members     app/members/page.tsx',
      '  wrapped by   app/layout.tsx',
      '  components   components/ui/input.tsx',
      '  data         none found',
      '  tests        app/members/members.test.tsx (imports app/members/page.tsx), e2e/members.spec.ts (visits /members)',
      '  owners       @example-org/members',
      '  in all       3 files it renders or imports (`fwos change show` lists them)',
      "Its spec delta's Context names what it touches, and its test plan names these tests as its regression scope.",
    ]);
    const change = JSON.parse((await fwos(root, 'change', 'show')).out);
    expect(change.map).toMatchObject({
      targets: [{ target: '/members', file: 'app/members/page.tsx' }],
      files: ['app/layout.tsx', 'app/members/page.tsx', 'components/ui/input.tsx'],
      tests: [
        { file: 'app/members/members.test.tsx', via: 'imports app/members/page.tsx' },
        { file: 'e2e/members.spec.ts', via: 'visits /members' },
      ],
      owners: ['@example-org/members'],
    });
  });

  it('refuses with no change open, with nothing named, and for what matches no route or file', async () => {
    const root = adoptedApp();
    await atDelivery(root);
    expect(await fwos(root, 'change', 'map', '/members')).toMatchObject({ code: 2, err: expect.stringContaining('No change is open') });
    await fwos(root, 'change', 'new', 'search the members list', '--route', 'touches-ac');
    expect(await fwos(root, 'change', 'map')).toMatchObject({ code: 2, err: expect.stringContaining('Name what the change touches') });
    expect(await fwos(root, 'change', 'map', '/memebers')).toMatchObject({ code: 2, err: expect.stringContaining('/memebers matches no route or file. Routes: /members, /settings.') });
  });

  it("holds the spec's approval until the change is mapped, and its Context names the page it maps", async () => {
    const root = await withChange();
    write(root, 'docs/app/spec.md', SPEC.replace('- Route: /members, app/members/page.tsx.', '- Route: the members list.'));
    write(root, 'docs/app/test-plan.md', PLAN);
    expect(await fwos(root, 'approve', 'spec', '--by', 'Example Owner')).toMatchObject({ code: 2, err: expect.stringContaining('`fwos change map <route or file>`') });
    await fwos(root, 'change', 'map', '/members');
    expect(await messages(root, 'spec/format')).toEqual(["the Context section doesn't name app/members/page.tsx, which the change maps (/members)"]);
    write(root, 'docs/app/spec.md', SPEC);
    expect(await result(root, 'spec/format')).toMatchObject({ status: 'pass' });
    expect((await fwos(root, 'approve', 'spec', '--by', 'Example Owner')).code).toBe(0);
  });

  it('asks a change for a criterion of its own: the ones it carries were approved by the changes before it', async () => {
    const root = adoptedApp();
    await atDelivery(root);
    write(root, 'docs/app/spec.md', SPEC);
    commitAll(root, 'an earlier change');
    await fwos(root, 'change', 'new', 'tidy the members page', '--route', 'touches-ac');
    expect(await messages(root, 'spec/format')).toEqual([
      'change 0002-tidy-the-members-page (touches-ac) adds or changes no acceptance criterion, so there is nothing new to approve: write its criteria in the spec delta, or route it code-only',
    ]);
    write(root, 'docs/app/spec.md', SPEC.replace('then only Ada shows', 'then only Ada shows, highlighted'));
    expect(await result(root, 'spec/format')).toMatchObject({ status: 'pass' });
  });

  it('wants a case in a browser and a regression scope that names the tests the map found', async () => {
    const root = await withChange();
    write(root, 'docs/app/spec.md', SPEC);
    await fwos(root, 'change', 'map', '/members');
    write(root, 'docs/app/test-plan.md', `# Test plan\n\n${COMPONENT_CASE}`);
    expect(await messages(root, 'tests/plan')).toEqual([
      "no case runs in a browser: give AC-members-1 a case at level e2e or browser-component, so the change is seen working in a real browser, or name GAP-browser with what's missing (- Missing: ...) for a person to sign off",
      'no "## Regression scope": name the existing tests around the change by path (the map found app/members/members.test.tsx, e2e/members.spec.ts), or write "None" and why',
    ]);
    write(root, 'docs/app/test-plan.md', PLAN.replace('- e2e/members.spec.ts: the page opens\n', '- e2e/nothing.spec.ts: a test that is not there\n'));
    expect(await messages(root, 'tests/plan')).toEqual([
      'the regression scope names e2e/nothing.spec.ts, which is not a test file in the project',
      "the change's map found e2e/members.spec.ts (visits /members): name it in ## Regression scope, so it runs as regression evidence",
    ]);
    write(root, 'docs/app/test-plan.md', PLAN);
    expect(await messages(root, 'tests/plan')).toEqual([]);
    // A gap a person signs off stands in for the browser case when the app can't run one yet.
    write(root, 'docs/app/test-plan.md', PLAN.replace(BROWSER_CASE, '### GAP-browser: no browser runner yet\n- Missing: a Playwright setup with a test database\n'));
    expect(await messages(root, 'tests/plan')).toEqual([]);
  });

  it('flags an edit the change makes outside what it maps, leaves new files and tests to it, and holds the change open', async () => {
    const root = await withChange();
    expect(await fwos(root, 'change', 'drift')).toMatchObject({ code: 2, err: expect.stringContaining('fwos change map') });
    await fwos(root, 'change', 'map', '/members');
    write(root, 'app/members/page.tsx', `${read(root, 'app/members/page.tsx')}\n// searched\n`);
    write(root, 'app/members/search.tsx', 'export const Search = () => null;\n');
    write(root, 'app/members/search.test.tsx', "it('searches', () => {});\n");
    expect(await fwos(root, 'change', 'drift')).toMatchObject({ code: 0, out: 'Change 0002-search-the-members-list stayed inside what it maps (/members): 1 file of yours edited, 1 added.' });
    write(root, 'app/settings/page.tsx', `${read(root, 'app/settings/page.tsx')}\n// tidied\n`);
    const r = await fwos(root, 'change', 'drift');
    expect(r.code).toBe(1);
    expect(r.out.split('\n')).toEqual([
      'app/settings/page.tsx: edited outside what change 0002-search-the-members-list maps (/members)',
      'Map it as well (`fwos change map /members app/settings/page.tsx`) and have the spec approved again, or make it a change of its own.',
    ]);
    expect((await json(root, 'change', 'drift')).outside).toEqual(['app/settings/page.tsx']);
    expect(await fwos(root, 'change', 'done')).toMatchObject({ code: 2, err: expect.stringContaining('edited outside what it maps: app/settings/page.tsx') });
  });
});

const REVIEW = 'https://github.com/example-org/app/pull/7#pullrequestreview-1';

describe('approvals in an adopted app: recorded as people give them, on the change they are for', () => {
  it("records none for the team's own product, and none with no change to hold it", async () => {
    const root = adoptedApp();
    await atDelivery(root);
    write(root, 'docs/app/brief.md', '# Brief\nWhat the team wrote before fwos.\n');
    for (const [target, noun] of [['brief', 'the brief is'], ['research', 'the research is'], ['architecture', 'the architecture is'], ['design-system', 'the design system is'], ['screens', 'the screens are']]) {
      expect(await fwos(root, 'approve', target!, '--by', 'Example Owner')).toMatchObject({ code: 2, err: expect.stringContaining(`${noun} your team's`) });
    }
    expect(await fwos(root, 'approve', 'spec', '--by', 'Example Owner')).toMatchObject({ code: 2, err: expect.stringContaining('No change is open') });
    expect(await fwos(root, 'approve', 'acceptance', '--by', 'Example Owner')).toMatchObject({ code: 2, err: expect.stringContaining('No change is open') });
    expect(await fwos(root, 'skip', 'research', '--reason', 'we have our own', '--by', 'Example Owner')).toMatchObject({ code: 2, err: expect.stringContaining('no research step to skip') });
    // The adoption record holds no approval of what was there before.
    expect(JSON.parse(read(root, '.fwos/changes/0001-initial.json')).approvals).toEqual({});
  });

  it('records the review a yes was given in, and shows it', async () => {
    const root = adoptedApp();
    await atDelivery(root);
    await fwos(root, 'change', 'new', 'search the members list', '--route', 'touches-ac');
    write(root, 'docs/app/spec.md', SPEC);
    write(root, 'docs/app/test-plan.md', PLAN);
    await fwos(root, 'change', 'map', '/members');
    expect(await fwos(root, 'approve', 'spec', '--by', 'Example Owner', '--via', 'pr')).toMatchObject({ code: 2, err: expect.stringContaining('--ref <the review URL>') });
    expect(await fwos(root, 'approve', 'spec', '--by', 'Example Owner', '--ref', REVIEW)).toMatchObject({ code: 2, err: expect.stringContaining('use it with --via pr') });
    expect((await fwos(root, 'approve', 'spec', '--by', 'Example Owner', '--via', 'pr', '--ref', REVIEW)).code).toBe(0);
    expect((await json(root, 'status')).approvals[0]).toMatchObject({ target: 'spec', status: 'approved', by: 'Example Owner', via: 'pr', ref: REVIEW });
    expect((await fwos(root, 'status')).out).toMatch(/spec\s+approved by Example Owner in https:\/\/github\.com\/example-org\/app\/pull\/7#pullrequestreview-1/);
  });
});

describe("the evidence a change needs: seen in a browser, and the tests around it still passing", () => {
  const result = async (root: string, id: string) => (await json(root, 'check', id)).results.find((x: { id: string }) => x.id === id) as { status: string; reason?: string; findings: { file?: string; message: string }[]; info?: string[] };
  /** A change mapped, its spec approved in review, at the build. */
  async function building() {
    const root = adoptedApp();
    await atDelivery(root);
    await fwos(root, 'change', 'new', 'search the members list', '--route', 'touches-ac');
    write(root, 'docs/app/spec.md', SPEC);
    write(root, 'docs/app/test-plan.md', PLAN);
    await fwos(root, 'change', 'map', '/members');
    expect((await fwos(root, 'approve', 'spec', '--by', 'Example Owner', '--via', 'pr', '--ref', REVIEW)).code).toBe(0);
    expect((await fwos(root, 'step', 'build')).code).toBe(0);
    return root;
  }

  it('wants a criterion the plan checks in a browser proven by a test that ran in one', async () => {
    const root = await building();
    write(root, 'fake-vitest.xml', junit(pass('narrows the list @AC-members-1', 'app/members/search.test.tsx'), pass('lists members')));
    write(root, 'fake-playwright.xml', junit(pass('opens the page', 'members.spec.ts')));
    await fwos(root, 'tests', 'run');
    // During the build it waits; at acceptance it fails.
    expect(await result(root, 'tests/traceability')).toMatchObject({ status: 'pass', info: ['1 proven', 'not seen in a browser yet: AC-members-1'] });
    await fwos(root, 'step', 'accept');
    expect((await result(root, 'tests/traceability')).findings.map((f) => f.message)).toEqual([
      'AC-members-1: TC-members-2 checks it in a browser (e2e), but no passing test from a browser run proves it; run your browser tests with `fwos tests run`',
    ]);
    write(root, 'fake-playwright.xml', junit(pass('opens the page', 'members.spec.ts'), pass('narrows the list in a browser @AC-members-1', 'search.spec.ts')));
    await fwos(root, 'tests', 'run', 'e2e');
    expect(await result(root, 'tests/traceability')).toMatchObject({ status: 'pass', findings: [] });
    // A browser run of older code proves nothing about this code.
    write(root, 'app/members/page.tsx', `${read(root, 'app/members/page.tsx')}\n// tidied\n`);
    expect((await result(root, 'tests/traceability')).findings.map((f) => f.message)).toEqual([
      'no test results in .fwos/local/results/**/*.xml, so no first-release AC is proven (AC-members-1); run the tests first',
    ]);
  });

  it("runs the plan's regression scope as evidence: a failure there fails the change, with every criterion proven", async () => {
    const root = await building();
    expect(await result(root, 'tests/regression')).toMatchObject({ status: 'off', reason: expect.stringContaining('no test results') });
    write(root, 'fake-vitest.xml', junit(pass('narrows the list @AC-members-1', 'app/members/search.test.tsx'), fail('lists members', 'expected 3 rows, got 2')));
    write(root, 'fake-playwright.xml', junit(pass('narrows the list in a browser @AC-members-1', 'search.spec.ts')));
    await fwos(root, 'tests', 'run');
    expect(await result(root, 'tests/traceability')).toMatchObject({ status: 'pass' });
    expect(await result(root, 'tests/regression')).toMatchObject({
      status: 'fail',
      findings: [{ file: 'app/members/members.test.tsx', message: 'lists members: failed (expected 3 rows, got 2)' }],
      info: ['1 of 2 ran: 1 failed', 'not run yet: e2e/members.spec.ts'],
    });
    // At acceptance, a regression test that never ran is a finding too.
    write(root, 'fake-vitest.xml', junit(pass('narrows the list @AC-members-1', 'app/members/search.test.tsx'), pass('lists members')));
    await fwos(root, 'tests', 'run');
    await fwos(root, 'step', 'accept');
    expect((await result(root, 'tests/regression')).findings.map((f) => f.message)).toEqual(['no result names it, so it never ran: run your tests with `fwos tests run`']);
    write(root, 'fake-playwright.xml', junit(pass('narrows the list in a browser @AC-members-1', 'search.spec.ts'), pass('opens the page', 'members.spec.ts')));
    await fwos(root, 'tests', 'run');
    expect(await result(root, 'tests/regression')).toMatchObject({ status: 'pass', info: ['2 of 2 ran: 2 passed'] });
  });

  it('reports what was approved in the change apart from what it builds on, with the runs, the browser and the regression scope', async () => {
    const root = await building();
    write(root, 'fake-vitest.xml', junit(pass('narrows the list @AC-members-1', 'app/members/search.test.tsx'), pass('lists members')));
    write(root, 'fake-playwright.xml', junit(pass('narrows the list in a browser @AC-members-1', 'search.spec.ts'), pass('opens the page', 'members.spec.ts')));
    await fwos(root, 'tests', 'run');
    await fwos(root, 'step', 'accept');
    const r = await fwos(root, 'report');
    expect(r.code, r.out).toBe(0);
    const report = read(root, 'docs/app/reports/acceptance.md');
    expect(report).toContain(
      `## Approved in this change\n\nWhat people approved for 0002-search-the-members-list, as they gave it. Its acceptance is approved on this report itself.\n\n- Spec and test plan: approved by Example Owner on ${new Date().toISOString().slice(0, 10)} in ${REVIEW}. It adds AC-members-1.\n`,
    );
    expect(report).toContain(
      [
        '## Imported context',
        '',
        'What the change builds on. None of it was approved in this change.',
        '',
        '- Request: "search the members list"',
        '- Grounded in: /members (app/members/page.tsx)',
        '- Existing tests run as regression: app/members/members.test.tsx, e2e/members.spec.ts',
        '- Pre-existing debt: the baseline, below',
      ].join('\n'),
    );
    expect(report).toContain('Seen in a browser: AC-members-1.');
    expect(report).toContain(
      [
        '## Test runs',
        '',
        'Your own commands, as `fwos tests run` last ran them on this code:',
        '',
        '| Command | Runner | Result | Results |',
        '|---|---|---|---|',
        '| pnpm e2e | Playwright, in a browser | 2 passed | .fwos/local/results/e2e.xml |',
        '| pnpm test | Vitest | 2 passed | .fwos/local/results/test.xml |',
      ].join('\n'),
    );
    expect(report).toContain(
      [
        '## Regression (your existing tests)',
        '',
        "The existing tests the plan names as the change's regression scope, as they last ran.",
        '',
        '| Test file | Result |',
        '|---|---|',
        '| app/members/members.test.tsx | 1 passed |',
        '| e2e/members.spec.ts | 1 passed |',
      ].join('\n'),
    );
    // Writing the report is no new code, so the same evidence is the same report.
    expect((await fwos(root, 'report')).out).toMatch(/Unchanged: docs\/app\/reports\/acceptance\.md/);
    // An edit outside what the change maps keeps it from being done.
    write(root, 'app/settings/page.tsx', `${read(root, 'app/settings/page.tsx')}\n// tidied\n`);
    expect((await fwos(root, 'report')).code).toBe(1);
    expect(read(root, 'docs/app/reports/acceptance.md')).toContain('- app/settings/page.tsx was edited outside what the change maps (/members)');
    // And the runs from before the edit no longer count.
    expect(read(root, 'docs/app/reports/acceptance.md')).toContain('## Test runs\n\nNot counted, since the code changed after they ran: pnpm e2e and pnpm test. Run them again with `fwos tests run`.\n');
  });
});

describe("a change on the team's own workflow: its branch names, its pull request template, its code owners", () => {
  it('suggests a branch named as the team names theirs, and points at their template and owners', async () => {
    const root = adoptedApp();
    await atDelivery(root);
    for (const b of ['feat/billing', 'feat/invites', 'fix/sign-in']) git(root, 'branch', b);
    const r = await fwos(root, 'change', 'new', 'search the members list', '--route', 'touches-ac');
    expect(r.out.split('\n').slice(1)).toEqual([
      'Your workflow:',
      '  branch   your branches are named <type>/<name>: git switch -c feat/search-the-members-list (ask before you create it)',
      '  review   your pull request template is .github/pull_request_template.md: the spec delta and the acceptance report go up for review there, and each yes is recorded as it is given (fwos approve spec --by "<name>" --via pr --ref <review URL>)',
      '  owners   .github/CODEOWNERS says who reviews; `fwos change map` names the owners of what the change touches',
    ]);
    expect((await json(root, 'next')).workflow).toEqual({ branch: 'feat/search-the-members-list', template: '.github/pull_request_template.md', codeowners: '.github/CODEOWNERS' });
    const fix = await fwos(root, 'change', 'new', 'fix the members heading', '--route', 'code-only');
    expect(fix.out).toContain('git switch -c fix/fix-the-members-heading');
  });

  it("proposes, at level delivery, to take a change's approvals from the team's own review", async () => {
    const root = adoptedApp();
    const p = await json(root, 'adopt', '--level', 'delivery');
    expect(p.proposal.reuse).toContainEqual({
      what: "your review, for each change's approvals: a reviewer's yes in a pull request is recorded with its link (--via pr --ref <review URL>)",
      from: '.github/pull_request_template.md, .github/CODEOWNERS',
    });
    expect((await json(root, 'adopt')).proposal.reuse.map((r: { what: string }) => r.what)).not.toContain(expect.stringContaining('your review'));
  });

  it('suggests no branch name when the team has no convention, and still says how a yes is recorded', async () => {
    const root = adoptedApp({ test: 'vitest run' }, { '.github/pull_request_template.md': '', '.github/CODEOWNERS': '' });
    git(root, 'rm', '-q', '.github/pull_request_template.md', '.github/CODEOWNERS');
    commitAll(root, 'no review files');
    await atDelivery(root);
    const r = await fwos(root, 'change', 'new', 'search the members list', '--route', 'touches-ac');
    expect(r.out.split('\n').slice(1)).toEqual([
      'Your workflow:',
      "  branch   fwos found no naming convention in your branches: name it as your team does (ask before you create it)",
      '  review   each yes is recorded as it is given, in chat or in a review (fwos approve spec --by "<name>" [--via pr --ref <review URL>])',
    ]);
    expect((await json(root, 'next')).workflow).toEqual({ branch: null, template: null, codeowners: null });
  });
});
