// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// What the stage and trace tests share: the CLI run in-process, git, and an adopted app whose own
// test runners are stand-ins that write the results a test gives them.

import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeText } from '../../../kernel/index.ts';
import { tempProject } from '../../../kernel/testing.ts';
import { dispatch } from '../../hooks/index.ts';
import type { Io } from '../commands.ts';
import { main } from '../main.ts';

export async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}
export const json = async (cwd: string, ...argv: string[]) => JSON.parse((await fwos(cwd, ...argv, '--json')).out);
export const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
export const commitAll = (root: string, message = 'snapshot') => {
  git(root, 'add', '-A');
  git(root, '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '--allow-empty', '-m', message);
};
export const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
/** A shadcn theme with a dark mode, as a team's globals.css holds it. */
const THEME = read(new URL('../../../../examples/import-a-shadcn-theme/', import.meta.url).pathname, 'globals.css');
export const write = (root: string, rel: string, text: string) => writeText(join(root, rel), text);
/** `git status --porcelain`, one entry per line. */
export const changed = (root: string) => git(root, 'status', '--porcelain').split('\n').filter(Boolean);
/** One check's result. */
export const result = async (root: string, id: string) =>
  (await json(root, 'check', id)).results.find((x: { id: string }) => x.id === id) as { status: string; reason?: string; findings: { file?: string; rule?: string; message: string }[]; info?: string[] };
export const messages = async (root: string, id: string, rule?: string) => (await result(root, id)).findings.filter((f) => !rule || f.rule === rule).map((f) => f.message);
/** Whether the agent's edit hook refuses a Write of `rel`. */
export const denied = (root: string, rel: string) => /permissionDecision":"deny/.test(dispatch('pre-tool-use', { tool_name: 'Write', tool_input: { file_path: join(root, rel), content: 'x' } }, root).stdout);

export const junit = (...cases: string[]) => `<testsuites><testsuite name="s">${cases.join('')}</testsuite></testsuites>\n`;
export const pass = (name: string, file = 'app/members/members.test.tsx') => `<testcase classname="${file}" name="${name}"/>`;
export const fail = (name: string, message: string, file = 'app/members/members.test.tsx') => `<testcase classname="${file}" name="${name}"><failure message="${message}"/></testcase>`;

/**
 * Stand-ins for the team's runners in node_modules/.bin: each writes the JUnit XML in
 * `fake-<runner>.xml` where the reporter fwos added on the command line says, and fails when it
 * holds a failure, as the real runner would.
 */
const RUNNERS: Record<string, string> = {
  'node_modules/.bin/vitest': `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const out = (process.argv.find((a) => a.startsWith('--outputFile.junit=')) || '').slice('--outputFile.junit='.length);
const xml = fs.readFileSync('fake-vitest.xml', 'utf8');
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, xml); }
process.exit(xml.includes('<failure') ? 1 : 0);
`,
  'node_modules/.bin/playwright': `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const out = process.argv.includes('--reporter=list,junit') ? process.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE : '';
const xml = fs.readFileSync('fake-playwright.xml', 'utf8');
if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, xml); }
process.exit(xml.includes('<failure') ? 1 : 0);
`,
};

/**
 * A Next.js app fwos had no hand in, with the practices a team brings: its components and theme,
 * Vitest and Playwright, lint, CI, a review workflow, an issue template, a product doc and agent
 * guidance. Committed, with stand-in runners that pass by default.
 */
export function teamApp(extra: Record<string, string | object> = {}, scripts: Record<string, string> = { test: 'vitest run', e2e: 'playwright test', lint: 'eslint .' }) {
  const root = tempProject({
    'package.json': { name: 'example-app', private: true, scripts, dependencies: { next: '15.3.0', react: '19.1.0' }, devDependencies: { vitest: '3.0.0', '@playwright/test': '1.50.0' } },
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    '.gitignore': 'node_modules\n',
    'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } },
    'components.json': { style: 'new-york', tailwind: { css: 'app/globals.css' }, aliases: { components: '@/components', ui: '@/components/ui' } },
    'app/globals.css': THEME,
    'app/layout.tsx': 'export default function Layout({ children }: { children: React.ReactNode }) {\n  return children;\n}\n',
    'app/members/page.tsx': "import { Input } from '@/components/ui/input';\nexport default function Members() {\n  return <main><Input /></main>;\n}\n",
    'app/settings/page.tsx': 'export default function Settings() {\n  return <main>Settings</main>;\n}\n',
    'components/ui/input.tsx': 'export const Input = () => null;\n',
    'components/ui/button.tsx': 'export const Button = () => null;\n',
    'app/members/members.test.tsx': "import Members from './page';\nit('lists members', () => {});\n",
    'e2e/members.spec.ts': "test('opens the page', async ({ page }) => {\n  await page.goto('/members');\n});\n",
    'vitest.config.ts': 'export default {};\n',
    'playwright.config.ts': 'export default {};\n',
    'eslint.config.mjs': 'export default [];\n',
    '.github/workflows/ci.yml': 'on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n',
    '.github/pull_request_template.md': '## What changed\n',
    '.github/CODEOWNERS': '* @example-org/web\n/app/members/ @example-org/members\n',
    '.github/ISSUE_TEMPLATE/feature.md': '## What should it do?\n',
    'docs/product/members-prd.md': '# Members\nTeams need to find a member by name.\n',
    'AGENTS.md': '# Agents\nBuild with the components in components/ui.\n',
    'fake-vitest.xml': junit(pass('lists members')),
    'fake-playwright.xml': junit(pass('opens the page', 'members.spec.ts')),
    ...RUNNERS,
    ...extra,
  });
  for (const f of Object.keys(RUNNERS)) chmodSync(join(root, f), 0o755);
  git(root, 'init', '-q');
  commitAll(root, 'the app as the team has it');
  return root;
}

/** A Next.js app with nothing around it: no tests, docs, lint, CI or review workflow. */
export function bareApp() {
  const root = tempProject({
    'package.json': { name: 'bare', private: true, dependencies: { next: '15.3.0', react: '19.1.0' } },
    'app/page.tsx': 'export default function Home() {\n  return <main>Home</main>;\n}\n',
  });
  git(root, 'init', '-q');
  commitAll(root, 'the app');
  return root;
}

/** The request the tests' changes deliver, and the issue it came from. */
export const REQUEST = 'search the members list';
export const ISSUE = 'https://github.com/example-org/app/issues/12';
export const REVIEW = 'https://github.com/example-org/app/pull/7#pullrequestreview-1';

export const CRITERION = `### AC-members-1: Searching narrows the list
- Given three members, when I search "ada", then only Ada shows; when I search "zzz", then no member shows and the list says No members match.
- Proven against: mock
`;

/** The parts of the change's spec delta, each replaceable by a test that plants a gap in it. */
export interface Delta {
  context: string;
  request: string;
  states: string;
  criteria: string;
  questions: string;
}

export const DELTA: Delta = {
  context: `## Context
- Request: "${REQUEST}", from ${ISSUE}.
- Route: /members, app/members/page.tsx, with Input from components/ui.
- [ASSUMED] A team has at most 100 members, so the list isn't paged.
`,
  request: `## Request
"${REQUEST}"

### REQ-1: Search the members by name
- AC: AC-members-1

### REQ-2: Export the list as CSV
- Dropped: the app has no download route; a change of its own (Example Owner)
`,
  states: `## States
The members list (app/members/page.tsx), as the change leaves it:

| State | What the user sees | Criterion |
|---|---|---|
| filtered | only the members whose name holds the search | AC-members-1 |
| filtered-empty | No members match. | AC-members-1 |
`,
  criteria: `## Acceptance criteria
${CRITERION}`,
  questions: `## Open questions
### Q-1: Does a search match emails as well as names?
- Answer: Names only, as the list shows them (Example Owner)
`,
};

export const spec = (over: Partial<Delta> = {}) => {
  const d = { ...DELTA, ...over };
  return `# Changes delivered through fwos

## What you're approving
Search on the members page.

${d.context}
${d.request}
${d.states}
${d.criteria}
${d.questions}`;
};

export const COMPONENT_CASE = `### TC-members-1: search narrows the list
- AC: AC-members-1
- Level: component
- Status: new
`;
export const BROWSER_CASE = `### TC-members-2: search narrows the list in a browser
- AC: AC-members-1
- Level: e2e
- Status: new
`;
export const REGRESSION = `## Regression scope

- app/members/members.test.tsx: the list as it is
- e2e/members.spec.ts: the page opens
`;
export const PLAN = `# Test plan

${COMPONENT_CASE}
${BROWSER_CASE}
${REGRESSION}`;

/** Results that prove AC-members-1 in jsdom and in a browser, and keep the team's own tests passing. */
export function proving(root: string) {
  write(root, 'fake-vitest.xml', junit(pass('narrows the list @AC-members-1', 'app/members/search.test.tsx'), pass('lists members')));
  write(root, 'fake-playwright.xml', junit(pass('narrows the list in a browser @AC-members-1', 'search.spec.ts'), pass('opens the page', 'members.spec.ts')));
}

/** Adopts `root` at level delivery, with `adopt` flags (say, a kept stage), and commits it. */
export async function atDelivery(root: string, ...adopt: string[]) {
  const r = await fwos(root, 'adopt', '--level', 'delivery', ...adopt, '--yes');
  if (r.code !== 0) throw new Error(`fwos adopt failed: ${r.err}`);
  commitAll(root, 'adopt fwos');
}

/** A change for REQUEST, linked to its issue, mapped onto /members, with its spec delta and test plan written. */
export async function specified(root: string, files: { spec?: string; plan?: string | null } = {}) {
  const r = await fwos(root, 'change', 'new', REQUEST, '--route', 'touches-ac', '--link', ISSUE);
  if (r.code !== 0) throw new Error(`fwos change new failed: ${r.err}`);
  write(root, 'docs/app/spec.md', files.spec ?? spec());
  if (files.plan !== null) write(root, 'docs/app/test-plan.md', files.plan ?? PLAN);
  await fwos(root, 'change', 'map', '/members');
}

/** On to the build: the spec approved in review. */
export async function building(root: string) {
  const a = await fwos(root, 'approve', 'spec', '--by', 'Example Owner', '--via', 'pr', '--ref', REVIEW);
  if (a.code !== 0) throw new Error(`fwos approve spec failed: ${a.err}`);
  const s = await fwos(root, 'step', 'build');
  if (s.code !== 0) throw new Error(`fwos step build failed: ${s.err}`);
}

/** Built and proven, at acceptance, with the report written. */
export async function accepting(root: string) {
  await building(root);
  write(root, 'app/members/search.test.tsx', "it('narrows the list @AC-members-1', () => {});\n");
  proving(root);
  await fwos(root, 'tests', 'run');
  await fwos(root, 'step', 'accept');
  await fwos(root, 'report');
}
