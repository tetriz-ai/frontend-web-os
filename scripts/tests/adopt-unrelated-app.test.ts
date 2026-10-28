// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
// Copyright (c) 2025 Vercel; adapted session and UI patch fixtures (see NOTICE).

// Adoption on an app fwos had no hand in: nextjs/saas-starter (MIT), pinned to one commit, with a
// team's review workflow around it. `fwos adopt` must read it and cite each finding, propose before
// it writes, adopt it level by level without touching the team's files or resetting a record, and
// keep a new defect out of the baseline. Every check doctor then calls ON must catch a planted
// violation ("doctor tells the truth"). At level delivery the app then ships two changes through the
// whole flow, driven by the CLI with no model: each mapped onto the code it touches, with a spec and
// test delta, on the team's branches, the team's own test commands run by fwos with their configs
// left as they are, tests that fail first and get locked, the feature seen in a real browser against
// the real app, the team's existing tests run as regression evidence, approvals recorded as people
// give them, and a report that keeps what was approved apart from what it builds on. A fresh clone
// resumes the second change mid-build, and edits made outside fwos are reported, never overwritten.
// A monorepo built around the same app proves one app can be adopted alone, and the negative cases
// stop or say less instead of guessing. Controlled challenges then plant one known gap each (an
// ambiguity, a missing state, a coverage gap in the test plan, a defect only behaviour shows) and
// check fwos catches it at its stage, against a clean control it lets through. Needs the network,
// so it runs with FWOS_E2E=1 (`pnpm test:e2e`), in CI and before every release. With
// FWOS_E2E_EVIDENCE=<dir>, each challenge's artifacts and fwos's output are kept there.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FWOS, commitAll, fwos, proveDoctor } from './support/truth.ts';

const APP = { repo: 'https://github.com/nextjs/saas-starter.git', commit: '6e33e58b1e553a41fe22e6b941a7229a002de361' };
const enabled = process.env.FWOS_E2E === '1';
const dir = enabled ? mkdtempSync(join(tmpdir(), 'fwos-adopt-')) : '';
const made: string[] = [];
const sh = (cmd: string, ...args: string[]) =>
  execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', NO_COLOR: '1' }, timeout: 600_000 });

/** The bundled CLI with its exit code, in `cwd`. */
function run(cwd: string, ...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(process.execPath, [FWOS, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, timeout: 600_000 });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
}
const json = (cwd: string, ...args: string[]) => JSON.parse(run(cwd, ...args, '--json').out);
const status = (cwd: string) => execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);
const write = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
/** What the agent's edit hook says about a Write to `rel`: deny, or nothing. */
const hookOn = (root: string, rel: string) =>
  execFileSync(process.execPath, [FWOS, 'hook', 'pre-tool-use'], { cwd: root, input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(root, rel), content: 'x' } }), encoding: 'utf8' });
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const commit = (message: string) => {
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=fwos test', '-c', 'user.email=fwos@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', message], { cwd: dir });
};
/** Replaces each `from` with its `to` in a file of the app, where `from` occurs exactly once. */
function edit(rel: string, ...pairs: [string, string][]) {
  let text = read(rel);
  for (const [from, to] of pairs) {
    expect(text.split(from).length - 1, `${rel}: ${from.split('\n')[0]}`).toBe(1);
    text = text.replace(from, () => to);
  }
  write(dir, rel, text);
}
const check = (cwd: string, id: string) => (json(cwd, 'check', id).results as { id: string; status: string; findings: { file?: string; message: string }[]; info?: string[] }[]).find((r) => r.id === id)!;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Keeps a challenge's artifacts (its spec delta, test plan and report) and what fwos said under
 * FWOS_E2E_EVIDENCE/<challenge>/<arm>/, so the before/after evidence matrix can cite them.
 */
function keep(challenge: string, arm: string, root: string, outputs: Record<string, unknown>) {
  const into = process.env.FWOS_E2E_EVIDENCE;
  if (!into) return;
  const at = join(into, challenge, arm);
  mkdirSync(at, { recursive: true });
  for (const f of ['docs/app/spec.md', 'docs/app/test-plan.md', 'docs/app/reports/acceptance.md']) if (existsSync(join(root, f))) writeFileSync(join(at, basename(f)), readFileSync(join(root, f)));
  for (const [name, v] of Object.entries(outputs)) writeFileSync(join(at, name), typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`);
}

/** Ports nothing listens on, for the app and its test database. */
async function freePorts(n: number): Promise<number[]> {
  const servers = await Promise.all(
    Array.from({ length: n }, () => new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
      const s = createServer().listen(0, '127.0.0.1', () => resolve(s)).on('error', reject);
    })),
  );
  const ports = servers.map((s) => (s.address() as AddressInfo).port);
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  return ports;
}

/** A fresh folder holding the pinned app's files, as committed upstream, under `sub`. */
function copyOfApp(sub = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'fwos-adopt-copy-'));
  made.push(root);
  mkdirSync(join(root, sub), { recursive: true });
  execFileSync('sh', ['-c', `git -C "${dir}" archive ${APP.commit} | tar -x -C "${join(root, sub)}"`]);
  return root;
}

afterAll(() => {
  if (!enabled || process.env.FWOS_E2E_KEEP) return;
  for (const d of [dir, ...made]) rmSync(d, { recursive: true, force: true });
});

// The team's workflow, which the public repo doesn't carry: a pull request template, code owners
// for the dashboard, and the branches its earlier work went through.
const TEMPLATE = '## What changed\n\n## How it was tested\n\n- [ ] A code owner reviewed it\n';
const CODEOWNERS = '* @example-org/web\n/app/(dashboard)/ @example-org/dashboard\n';
const BRANCHES = ['feat/billing-portal', 'feat/invite-by-email', 'fix/sign-in-redirect'];
/** Where the team's reviewer approves, in the pull request. */
const REVIEW = 'https://example.com/reviews/7';

describe.runIf(enabled)(`adoption on an unrelated app (${APP.repo} at ${APP.commit.slice(0, 7)})`, () => {
  it("fetches the pinned app and installs it, with the team's review workflow around it", () => {
    sh('git', 'init', '-q');
    sh('git', 'fetch', '-q', '--depth', '1', APP.repo, APP.commit);
    sh('git', 'checkout', '-q', '-b', 'main', 'FETCH_HEAD');
    write(dir, '.github/pull_request_template.md', TEMPLATE);
    write(dir, '.github/CODEOWNERS', CODEOWNERS);
    commit('chore: our pull request template and code owners');
    for (const b of BRANCHES) sh('git', 'branch', b);
    sh('pnpm', 'install', '--frozen-lockfile', '--ignore-scripts');
  }, 600_000);

  it('reads the app and cites each finding, labels what it lacks, and writes nothing', () => {
    const p = json(dir, 'adopt');
    expect(p).toMatchObject({ support: 'supported', app: '.', adopted: false, decisions: [] });
    expect(p.findings).toEqual(
      expect.arrayContaining([
        { area: 'framework', what: 'Next.js 15.6.0-canary.59', from: 'package.json dependencies.next' },
        { area: 'framework', what: 'Tailwind CSS 4.1.7', from: 'package.json dependencies.tailwindcss' },
        { area: 'routes', what: expect.stringMatching(/^App Router: \d+ pages, \d+ layouts$/), from: 'app/' },
        { area: 'routes', what: 'middleware', from: 'middleware.ts' },
        { area: 'components', what: 'shadcn/ui (new-york)', from: 'components.json' },
        { area: 'components', what: '7 UI components in components/ui', from: 'components.json aliases.ui (@/components/ui)' },
        { area: 'theme', what: 'CSS variables, with a dark theme', from: 'app/globals.css' },
        { area: 'data', what: 'Drizzle ORM', from: 'drizzle.config.ts' },
        { area: 'data', what: 'SWR', from: 'package.json dependencies.swr' },
        { area: 'data', what: '2 files of server actions', from: 'app/(login)/actions.ts, lib/payments/actions.ts' },
        { area: 'auth', what: 'a role field', from: 'lib/db/schema.ts' },
        { area: 'scripts', what: 'db:migrate: drizzle-kit migrate', from: 'package.json scripts.db:migrate' },
        { area: 'review', what: 'pull request template', from: '.github/pull_request_template.md' },
        { area: 'review', what: 'code owners', from: '.github/CODEOWNERS' },
        { area: 'review', what: 'branches named <type>/<name> (feat, fix)', from: `git branches ${BRANCHES.join(', ')}` },
        { area: 'package-manager', what: 'pnpm', from: 'pnpm-lock.yaml' },
      ]),
    );
    // What the app doesn't have is said, never filled from fwos's own defaults.
    expect(p.unknowns.map((u: { area: string }) => u.area)).toEqual(expect.arrayContaining(['flags', 'tests', 'ci', 'guidance']));
    expect(p.proposal.state.paths).toEqual({ apps: { web: '.' }, source: ['app/**', 'components/**', 'lib/**', 'middleware.ts'], ui: { web: 'components/ui' } });
    // Stage by stage: what the team has, read from the repo with its file, what that leaves open and what fwos would add.
    const stage = (id: string) => p.stages.find((x: { id: string }) => x.id === id);
    expect(p.stages.map((x: { id: string; status: string }) => `${x.id}:${x.status}`)).toEqual(['idea:later', 'design:later', 'spec:later', 'test-plan:later', 'build:later', 'acceptance:fwos']);
    expect(stage('design').today).toEqual(expect.arrayContaining([{ what: 'shadcn/ui (new-york)', from: 'components.json' }, { what: 'CSS variables, with a dark theme', from: 'app/globals.css' }]));
    expect(stage('acceptance').today).toEqual(expect.arrayContaining([{ what: 'pull request template', from: '.github/pull_request_template.md' }, { what: 'code owners', from: '.github/CODEOWNERS' }]));
    // The app has no tests: its test planning has no practice to keep yet, and the gap says so.
    expect(stage('test-plan')).toMatchObject({ today: [], gap: 'no test runner found, so nothing can prove a change works yet' });
    keep('stages', 'proposal', dir, { 'adopt.json': p.stages });
    expect(p.proposal.hooks.agent).toMatch(/never block an edit to your code/);
    expect(status(dir)).toEqual([]);
  });

  it("adopts at level checks, writing .fwos/ and one .gitignore line and nothing of the app's", () => {
    const r = run(dir, 'adopt', '--name', 'SaaS starter', '--yes');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Adopted the app at . at level checks.');
    expect(r.out).toMatch(/Baseline: \d+ findings recorded as debt\./);
    expect(status(dir).sort()).toEqual([' M .gitignore', '?? .fwos/']);
    expect(run(dir, 'check').code).toBe(0);
  });

  it("upgrades to design without resetting a record, from the app's own theme and components", () => {
    commitAll(dir);
    const before = JSON.parse(readFileSync(join(dir, '.fwos/baseline.json'), 'utf8'));
    const changes = readFileSync(join(dir, '.fwos/changes/0001-initial.json'), 'utf8');
    const r = run(dir, 'adopt', '--level', 'design', '--yes');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Wrote design-system/ from app/globals.css');
    const after = JSON.parse(readFileSync(join(dir, '.fwos/baseline.json'), 'utf8'));
    for (const [id, f] of Object.entries(before.findings)) expect(after.findings[id], id).toEqual(f);
    for (const [id, at] of Object.entries(before.checks)) expect(after.checks[id], id).toBe(at);
    expect(readFileSync(join(dir, '.fwos/changes/0001-initial.json'), 'utf8')).toBe(changes);
    // The registry is the app's components, never fwos's starter ones.
    const registry = JSON.parse(readFileSync(join(dir, 'design-system/components.json'), 'utf8')) as { components: { id: string; requiredStates: string[] }[] };
    expect(registry.components.map((c) => c.id)).toEqual(['avatar', 'button', 'card', 'dropdown-menu', 'input', 'label', 'radio-group']);
    expect(registry.components.every((c) => c.requiredStates.length === 0)).toBe(true);
    expect(run(dir, 'check').code).toBe(0);
  });

  it('turns on the token and component checks, and shows each capability on or off', () => {
    const d = JSON.parse(fwos(dir, 'doctor', '--json')) as { checks: { id: string; on: boolean; reason?: string }[]; adoption: { level: string; capabilities: { id: string; on: boolean }[] } };
    const on = d.checks.filter((c) => c.on).map((c) => c.id);
    expect(on).toEqual(expect.arrayContaining(['design-system/tokens', 'design-system/contrast', 'design-system/registry', 'rules/pack', 'web/licences']));
    expect(d.checks.find((check) => check.id === 'web/security')).toMatchObject({ on: false, reason: expect.stringContaining('cannot be determined statically') });
    expect(d.adoption.level).toBe('design');
    expect(d.adoption.capabilities.filter((c) => c.on).map((c) => c.id)).toEqual(['checks', 'baseline', 'design-system', 'components']);
  });

  it('catches a planted violation for every check doctor calls ON', () => {
    commitAll(dir);
    const r = proveDoctor(dir);
    expect(r.problems).toEqual([]);
    expect(r.proven).toEqual(r.on);
  }, 300_000);

  it('fails a new defect behind the baseline, and the baseline refuses to take it in', () => {
    write(dir, 'components/fwos-planted-new.tsx', 'export const New = () => <div className="bg-[#123456]" />;\n');
    const r = run(dir, 'check', 'design-system/tokens');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/1 new finding \(\d+ baselined\)/);
    expect(run(dir, 'baseline')).toMatchObject({ code: 2, err: expect.stringContaining('The baseline can only shrink; 1 finding is new.') });
    rmSync(join(dir, 'components/fwos-planted-new.tsx'));
  });

  it("delivers a change in place at level delivery: linked, gated on the app, on the team's branch, honest about its tests", () => {
    expect(run(dir, 'adopt', '--level', 'delivery', '--yes').code).toBe(0);
    // An approval is recorded on a change, as a person gives it: never for the product as it was.
    expect(run(dir, 'approve', 'brief', '--by', 'Example Owner')).toMatchObject({ code: 2, err: expect.stringContaining("the brief is your team's") });
    expect(run(dir, 'approve', 'spec', '--by', 'Example Owner')).toMatchObject({ code: 2, err: expect.stringContaining('No change is open') });
    const c = run(dir, 'change', 'new', 'add search and an empty state to the team members table', '--route', 'touches-ac', '--link', 'README.md');
    expect(c.out).toMatch(/^Created change 0002-[a-z-]+ \(route touches-ac, enters at spec\)\./);
    expect(c.out).toMatch(/Linked: README\.md \(at [0-9a-f]{12}\)/);
    // The team's workflow: a branch named as theirs are, and their pull request template for the review.
    const branch = /git switch -c (feat\/add-search[a-z-]*)/.exec(c.out)?.[1];
    expect(branch, c.out).toBeDefined();
    expect(c.out).toContain('.github/pull_request_template.md');
    sh('git', 'switch', '-q', '-c', branch!);
    expect(hookOn(dir, 'app/(dashboard)/dashboard/page.tsx')).toMatch(/permissionDecision":"deny/);
    expect(hookOn(dir, 'docs/app/spec.md')).toBe('');
    // The app has no test script yet: the capability says so rather than claim evidence.
    const caps = json(dir, 'status').adoption.capabilities as { id: string; on: boolean; status: string }[];
    expect(caps.find((x) => x.id === 'test-results')).toMatchObject({ on: false, status: expect.stringContaining('no test script in package.json') });
  });
});

// ---- the team's work on two changes -------------------------------------------------------------
// What an agent following fwos writes in the app: the spec deltas and test plans, component and
// browser tests tagged with the criteria they prove, and the code, built with the app's own
// components. The app gets its test runners the way the team would add them: Vitest as Next.js
// documents it, and Playwright running the real app on a test database. fwos writes none of this:
// it maps, gates, runs the team's own commands, records and checks.

const PAGE = 'app/(dashboard)/dashboard/page.tsx';
const TEST = 'app/(dashboard)/dashboard/team-members.test.tsx';
const E2E = 'e2e/team-members.spec.ts';
const E2E_COUNT = 'e2e/member-count.spec.ts';
const E2E_INVITE = 'e2e/invite.spec.ts';
// Exact versions of what the team adds. Their own dependencies resolve to the newest that fit.
const TEST_DEPS = ['vitest@5.0.3', '@vitejs/plugin-react@6.1.1', 'jsdom@30.1.1', '@testing-library/react@16.3.3', '@testing-library/dom@10.4.1'];
const BROWSER_DEPS = ['@playwright/test@1.64.0', '@electric-sql/pglite@0.5.11', '@electric-sql/pglite-socket@0.2.14'];

/** Vitest as Next.js documents it (with Vite's own tsconfig paths), kept off the browser tests. No JUnit setting. */
const VITEST_CONFIG = `import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
`;

/**
 * Playwright on the real app: \`pnpm dev\` on a test database of its own, one test at a time, since
 * the dev server compiles each page on its first request. No JUnit setting either.
 */
const PLAYWRIGHT_CONFIG = `import { defineConfig } from '@playwright/test';
import { AUTH_SECRET, BASE_URL, DB_PORT } from './e2e/session';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: BASE_URL, actionTimeout: 10_000 },
  expect: { timeout: 10_000 },
  webServer: [
    { command: 'node e2e/db.mjs', port: DB_PORT, env: { E2E_DB_PORT: String(DB_PORT) } },
    {
      command: \`pnpm dev --port \${new URL(BASE_URL).port}\`,
      url: BASE_URL,
      env: { POSTGRES_URL: \`postgres://postgres:postgres@127.0.0.1:\${DB_PORT}/postgres\`, AUTH_SECRET, BASE_URL },
      timeout: 120_000,
    },
  ],
});
`;

/** The browser tests' helpers: where the app and its database run, and signing in as a seeded user. */
const sessionHelpers = (web: number, db: number) => `import type { BrowserContext } from '@playwright/test';
import { SignJWT } from 'jose';

export const BASE_URL = 'http://localhost:${web}';
export const DB_PORT = ${db};
export const AUTH_SECRET = 'e2e-only-not-a-secret';

/** Signs in as a seeded user the way the app does: a session cookie signed with AUTH_SECRET. */
export async function signInAs(context: BrowserContext, userId: number) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const token = await new SignJWT({ user: { id: userId }, expires })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1 day from now')
    .sign(new TextEncoder().encode(AUTH_SECRET));
  await context.addCookies([{ name: 'session', value: token, url: BASE_URL }]);
}
`;

/** The test database: Postgres in-process (PGlite) on a local port, with the app's own migration and a seeded team. */
const TEST_DB = `import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const db = await PGlite.create();
await db.exec(readFileSync('lib/db/migrations/0000_soft_the_anarchist.sql', 'utf8'));
await db.exec(\`
  insert into users (id, name, email, password_hash, role) values
    (1, 'Example Owner', 'owner@example.com', '-', 'owner'),
    (2, 'Example Member', 'member@example.com', '-', 'member'),
    (3, null, 'unnamed@example.com', '-', 'member');
  insert into teams (id, name, plan_name, subscription_status) values (1, 'Example Team', 'Base', 'active');
  insert into team_members (user_id, team_id, role) values (1, 1, 'owner'), (2, 1, 'member'), (3, 1, 'member');
\`);
await new PGLiteSocketServer({ db, host: '127.0.0.1', port: Number(process.env.E2E_DB_PORT), maxConnections: 10 }).start();
`;

const CRITERIA = `### AC-team-members-1: Searching narrows the list
- Given Example Owner, Example Member and unnamed@example.com, when I type "member" or "UNNAMED" in "Search members", then only that member shows, with their role and the Remove button they had.
- Proven against: mock

### AC-team-members-2: A search that matches no one says so
- Given the same team, when I search for "zzz", then no member shows and the card says No members match "zzz".
- Proven against: mock

### AC-team-members-3: Without a search the list is as it was
- Given the same team and an empty search, then every member shows in the team's order with their role, and only the members after the first two have a Remove button.
- Proven against: mock
`;

const SPEC = `# Changes delivered through fwos

## What you're approving
Search and an empty state for the Team Members card on the team settings page. Typing in "Search members" narrows the list to the members whose name or email contains the text, and a search that matches no one says so. Without a search the card lists the team as it does today.

## Context
- Request: "add search and an empty state to the team members table", linked to README.md.
- Route: /dashboard, app/(dashboard)/dashboard/page.tsx, the Team Members card (TeamMembers). It reads GET /api/team (app/api/team/route.ts) with SWR and removes members with removeTeamMember from app/(login)/actions.ts.
- Components: Input and Label from components/ui, beside the Card, Avatar and Button the card uses.
- Tests: the app has none yet. It gets Vitest with Testing Library, run with pnpm test, and Playwright on the real app, run with pnpm e2e.

## Request
"add search and an empty state to the team members table"

### REQ-1: Search the team members
- AC: AC-team-members-1, AC-team-members-3

### REQ-2: An empty state when a search matches no one
- AC: AC-team-members-2

## States
The Team Members card on /dashboard, as the change leaves it:

| State | What the user sees | Criterion |
|---|---|---|
| ready | every member in the team's order with their role, and Remove after the first two | AC-team-members-3 |
| filtered | the members whose name or email holds the search, each with the Remove button they had | AC-team-members-1 |
| filtered-empty | No members match "<search>". | AC-team-members-2 |
| empty | No team members yet. | unchanged |
| loading | the card's skeleton | unchanged |

## Acceptance criteria
${CRITERIA}
## Open questions
### Q-1: Does a search match emails as well as names?
- Answer: Names and emails: a member with no name shows their email on the card, so the email is what a person searches for (the card's own getUserDisplayName)
`;

const CASES = `### TC-team-members-1: search narrows the list by name or email
- AC: AC-team-members-1
- Level: component
- Status: new

### TC-team-members-2: a search with no match shows the empty state
- AC: AC-team-members-2
- Level: component
- Status: new

### TC-team-members-3: with no search every member shows as before
- AC: AC-team-members-3
- Level: component
- Status: existing
`;

const BROWSER_CASES = `### TC-team-members-4: search narrows the team in a browser, on the real app
- AC: AC-team-members-1
- Level: e2e
- Status: new

### TC-team-members-5: a search with no match says so in a browser
- AC: AC-team-members-2
- Level: e2e
- Status: new
`;

const PLAN = `# Test plan

${CASES}
${BROWSER_CASES}
## Regression scope

None: the app had no tests before this change, so TC-team-members-3 pins the list as it was.
`;

/** The second change keeps the first one's criteria, which stay proven, and adds its own. */
const SPEC_2 = (first: string) => `# Changes delivered through fwos

## What you're approving
How many members a search matches, on the Team Members card: while a search matches someone, the card says how many of the team it matches. The search, its empty state and the list without a search stay as change ${first} delivered them.

## Context
- Request: "show how many members match a search", given as text.
- Route: /dashboard, app/(dashboard)/dashboard/page.tsx, the Team Members card and the search change ${first} added to it.
- Tests: the ones \`fwos change map\` found around the card, named in the test plan's regression scope. The card's component tests are locked by change ${first}; this change unlocks them to add a case.

## Request
"show how many members match a search"

### REQ-1: Say how many members a search matches
- AC: AC-team-members-4

## States
| State | What the user sees | Criterion |
|---|---|---|
| filtered | the members a search matches, and how many of the team that is | AC-team-members-4 |
| filtered-empty | No members match "<search>", with no count | unchanged |
| ready | every member, with no count | AC-team-members-4 |

## Acceptance criteria
${CRITERIA}
### AC-team-members-4: A search says how many members it matches
- Given the same team, when I search for "member", then the card says 1 of 3 members match; with no search it says nothing.
- Proven against: mock

## Open questions
None.
`;

/** The tests the map finds around the card, as the plan names them: the first change's, and the team's own. */
const REGRESSION = (first: string) => [
  `- ${TEST}: the search, its empty state and the list, locked by change ${first}`,
  `- ${E2E}: the search and its empty state in a browser, from change ${first}`,
];
const REGRESSION_INVITE = `- ${E2E_INVITE}: the team's own test that only an owner can invite, on the same page`;

const PLAN_2 = (regression: string[]) => `# Test plan

${CASES}
${BROWSER_CASES}
### TC-team-members-6: a search says how many members match
- AC: AC-team-members-4
- Level: component
- Status: new

### TC-team-members-7: the match count in a browser, on the real app
- AC: AC-team-members-4
- Level: e2e
- Status: new

## Regression scope

${regression.join('\n')}
`;

const TEST_FILE = `import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SettingsPage from './page';

const { team } = vi.hoisted(() => ({
  team: {
    id: 1,
    name: 'Example Team',
    planName: 'Base',
    subscriptionStatus: 'active',
    teamMembers: [
      { id: 1, role: 'owner', user: { id: 1, name: 'Example Owner', email: 'owner@example.com' } },
      { id: 2, role: 'member', user: { id: 2, name: 'Example Member', email: 'member@example.com' } },
      { id: 3, role: 'member', user: { id: 3, name: null, email: 'unnamed@example.com' } },
    ],
  },
}));

// The page's data boundaries: SWR for /api/team and /api/user, and its server actions.
vi.mock('swr', () => ({ default: (key: string) => ({ data: key === '/api/team' ? team : { id: 1, role: 'owner' } }) }));
vi.mock('@/app/(login)/actions', () => ({ removeTeamMember: vi.fn(), inviteTeamMember: vi.fn() }));
vi.mock('@/lib/payments/actions', () => ({ customerPortalAction: vi.fn() }));

// jsdom has no ResizeObserver, which the radio group in the invite card uses.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(cleanup);

const card = () => within(screen.getByText('Team Members').closest('[data-slot="card"]') as HTMLElement);
/** Each member row as "name (role)", with " [Remove]" when it has the button. */
const rows = () =>
  card()
    .queryAllByRole('listitem')
    .map((li) => {
      const [name, role] = [...li.querySelectorAll('p')].map((p) => p.textContent ?? '');
      const remove = within(li).queryByRole('button', { name: 'Remove' }) ? ' [Remove]' : '';
      return name + ' (' + role + ')' + remove;
    });
const search = (text: string) => fireEvent.change(card().getByLabelText('Search members'), { target: { value: text } });

it('lists every member as before when nothing is searched @AC-team-members-3', () => {
  render(<SettingsPage />);
  expect(rows()).toEqual(['Example Owner (owner)', 'Example Member (member)', 'unnamed@example.com (member) [Remove]']);
});

it('narrows the list to the members whose name or email matches @AC-team-members-1', () => {
  render(<SettingsPage />);
  search('member');
  expect(rows()).toEqual(['Example Member (member)']);
  search('UNNAMED');
  expect(rows()).toEqual(['unnamed@example.com (member) [Remove]']);
});

it('says so when no member matches @AC-team-members-2', () => {
  render(<SettingsPage />);
  search('zzz');
  expect(rows()).toEqual([]);
  expect(card().getByText('No members match "zzz".')).toBeTruthy();
});
`;

const COUNT_TEST = `
it('says how many members a search matches @AC-team-members-4', () => {
  render(<SettingsPage />);
  search('member');
  expect(card().getByText('1 of 3 members match.')).toBeTruthy();
  search('');
  expect(card().queryByText(/members match\\.$/)).toBeNull();
});
`;

/** The same behaviour on the real app, in Chromium, signed in as Example Owner. */
const E2E_FILE = `import { expect, test, type Page } from '@playwright/test';
import { signInAs } from './session';

test.beforeEach(({ context }) => signInAs(context, 1));

const members = (page: Page) => page.locator('[data-slot="card"]', { hasText: 'Team Members' }).getByRole('listitem');

test('searching narrows the team in the browser @AC-team-members-1', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByLabel('Search members').fill('member');
  await expect(members(page)).toHaveText([/Example Member/]);
  await page.getByLabel('Search members').fill('UNNAMED');
  await expect(members(page)).toHaveText([/unnamed@example\\.com.*Remove/]);
});

test('a search with no match says so in the browser @AC-team-members-2', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByLabel('Search members').fill('zzz');
  await expect(members(page)).toHaveCount(0);
  await expect(page.getByText('No members match "zzz".')).toBeVisible();
});
`;

const COUNT_E2E = `import { expect, test } from '@playwright/test';
import { signInAs } from './session';

test('a search says how many members match, in the browser @AC-team-members-4', async ({ page, context }) => {
  await signInAs(context, 1);
  await page.goto('/dashboard');
  await page.getByLabel('Search members').fill('member');
  await expect(page.getByText('1 of 3 members match.')).toBeVisible();
});
`;

/** The team's own browser test, written outside fwos: no criterion tag, never locked. */
const INVITE_E2E = `import { expect, test } from '@playwright/test';
import { signInAs } from './session';

test('only an owner can invite a member', async ({ page, context }) => {
  await signInAs(context, 2);
  await page.goto('/dashboard');
  await expect(page.getByText('You must be a team owner to invite new members.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Invite Member' })).toBeDisabled();
});
`;

/** The search and its empty state, in the card's own markup with the app's Input and Label. */
const SEARCH: [string, string][] = [
  ["import { useActionState } from 'react';", "import { useActionState, useState } from 'react';"],
  ['  >(removeTeamMember, {});\n', "  >(removeTeamMember, {});\n  const [query, setQuery] = useState('');\n"],
  [
    `  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Team Members</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {teamData.teamMembers.map((member, index) => (`,
    `  const search = query.trim().toLowerCase();
  // Each member keeps their place in the team, so a Remove button stays with the same person.
  const shown = teamData.teamMembers
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => [member.user.name, member.user.email].some((v) => v?.toLowerCase().includes(search)));

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Team Members</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Label htmlFor="member-search" className="mb-2">
            Search members
          </Label>
          <Input
            id="member-search"
            type="search"
            placeholder="Name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {shown.length === 0 && (
          <p className="text-muted-foreground">No members match &quot;{query.trim()}&quot;.</p>
        )}
        <ul className="space-y-4">
          {shown.map(({ member, index }) => (`,
  ],
];

/**
 * A first attempt at the search that renders, in jsdom and in the browser, and passes every test
 * but one: it filters the rows and keeps their index in the filtered list, so the Remove button
 * (members after the first two) follows a row's place on screen instead of the member, and
 * searching "UNNAMED" shows unnamed without it.
 */
const NAIVE_SEARCH: [string, string][] = [
  SEARCH[0]!,
  SEARCH[1]!,
  [
    SEARCH[2]![0],
    SEARCH[2]![1]
      .replace(
        `  // Each member keeps their place in the team, so a Remove button stays with the same person.
  const shown = teamData.teamMembers
    .map((member, index) => ({ member, index }))
    .filter(({ member }) => [member.user.name, member.user.email].some((v) => v?.toLowerCase().includes(search)));`,
        `  const shown = teamData.teamMembers.filter((member) => [member.user.name, member.user.email].some((v) => v?.toLowerCase().includes(search)));`,
      )
      .replace('{shown.map(({ member, index }) => (', '{shown.map((member, index) => ('),
  ],
];

const EMPTY_STATE = `          <p className="text-muted-foreground">No members match &quot;{query.trim()}&quot;.</p>
        )}
`;
const COUNT: [string, string][] = [
  [
    EMPTY_STATE,
    `${EMPTY_STATE}        {search && shown.length > 0 && (
          <p className="text-muted-foreground mb-4">
            {shown.length} of {teamData.teamMembers.length} members match.
          </p>
        )}
`,
  ],
];
/** The invite card's footer for members, which only the team's own browser test covers. */
const INVITE_FOOTER = `      {!isOwner && (
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            You must be a team owner to invite new members.
          </p>
        </CardFooter>
      )}
`;

// The delivery journey, on the same app: it goes on from the change the last test above opened.
describe.runIf(enabled)('delivering changes in place on the adopted app, driven by the CLI with no model', () => {
  let first = '';
  let second = '';
  const testResults = (cwd: string) => (json(cwd, 'status').adoption.capabilities as { id: string; on: boolean; status: string }[]).find((c) => c.id === 'test-results')!;

  it("maps the change onto the code, writes its spec delta and test plan, and its gate opens only on a reviewer's approval", () => {
    // A fresh process knows where the change is from the files alone.
    const next = json(dir, 'next');
    expect(next).toMatchObject({ step: 'spec', skill: 'fwos:spec', blocked: [], adopt: { level: 'delivery' } });
    first = next.change.id;
    write(dir, 'docs/app/spec.md', SPEC);
    // A first plan, with no case in a browser and nothing said about the tests around the change.
    write(dir, 'docs/app/test-plan.md', `# Test plan\n\n${CASES}`);
    expect(check(dir, 'tests/plan').findings.map((f) => f.message)).toEqual([expect.stringContaining('no case runs in a browser'), expect.stringContaining('no "## Regression scope"')]);
    write(dir, 'docs/app/test-plan.md', PLAN);
    expect(run(dir, 'check', 'spec/format', 'tests/plan').code).toBe(0);
    expect(run(dir, 'step', 'build')).toMatchObject({ code: 2, err: expect.stringContaining(`spec isn't approved in change ${first}`) });
    expect(hookOn(dir, PAGE)).toMatch(/permissionDecision":"deny/);
    // The spec delta is grounded in the code before anyone approves it.
    expect(run(dir, 'approve', 'spec', '--by', 'Example Owner', '--via', 'pr', '--ref', REVIEW)).toMatchObject({ code: 2, err: expect.stringContaining('fwos change map') });
    const map = json(dir, 'change', 'map', '/dashboard');
    expect(map.targets).toEqual([{ target: '/dashboard', file: PAGE }]);
    expect(map.components).toEqual(expect.arrayContaining(['components/ui/card.tsx', 'components/ui/input.tsx', 'components/ui/label.tsx']));
    expect(map.data).toEqual(
      expect.arrayContaining([
        { kind: 'api', what: 'GET /api/team', file: 'app/api/team/route.ts' },
        { kind: 'action', what: 'removeTeamMember', file: 'app/(login)/actions.ts' },
      ]),
    );
    expect(map.tests).toEqual([]);
    expect(map.owners).toEqual(['@example-org/dashboard']);
    // The team's reviewer approves it in the pull request, and fwos records it there, as it's given.
    // Its one question was answered first, and nothing else is open as it goes to the build.
    const approved = run(dir, 'approve', 'spec', '--by', 'Example Owner', '--via', 'pr', '--ref', REVIEW);
    expect(approved.code, approved.err).toBe(0);
    expect(approved.out).toContain('Nothing open carried into the build.');
    expect(json(dir, 'status').approvals[0]).toMatchObject({ target: 'spec', status: 'approved', by: 'Example Owner', via: 'pr', ref: REVIEW });
    expect(hookOn(dir, PAGE)).toBe('');
    expect(json(dir, 'next').action).toBe('spec is approved. Move on: `fwos step build`, then follow fwos:build.');
    expect(run(dir, 'step', 'build').code).toBe(0);
    expect(json(dir, 'next')).toMatchObject({ change: { id: first, step: 'build' }, skill: 'fwos:build', blocked: [] });
  });

  it('gives the app its test runners as the team would: Vitest as Next.js documents it, Playwright on a test database, no JUnit setting', async () => {
    sh('pnpm', 'add', '-D', '--ignore-scripts', ...TEST_DEPS, ...BROWSER_DEPS);
    sh('pnpm', 'exec', 'playwright', 'install', 'chromium');
    const [web, db] = await freePorts(2);
    write(dir, 'vitest.config.mts', VITEST_CONFIG);
    write(dir, 'playwright.config.ts', PLAYWRIGHT_CONFIG);
    write(dir, 'e2e/session.ts', sessionHelpers(web!, db!));
    write(dir, 'e2e/db.mjs', TEST_DB);
    write(dir, '.gitignore', `${read('.gitignore')}\n# Playwright\n/test-results/\n/playwright-report/\n`);
    const pkg = JSON.parse(read('package.json'));
    write(dir, 'package.json', `${JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, test: 'vitest run', e2e: 'playwright test' } }, null, 2)}\n`);
    // fwos runs these as the team does, and adds the JUnit reporter on the command line.
    expect(testResults(dir)).toMatchObject({ on: false, status: expect.stringContaining('`fwos tests run` runs pnpm test (Vitest) and pnpm e2e (Playwright, in a browser)') });
  }, 600_000);

  it('writes the tests first, sees them fail for want of the feature in jsdom and in a browser, and locks them', () => {
    write(dir, TEST, TEST_FILE);
    write(dir, E2E, E2E_FILE);
    const red = run(dir, 'tests', 'run');
    expect(red.code, red.out).toBe(1);
    expect(red.out).toContain('pnpm test (Vitest): 2 failed, 1 passed.');
    expect(red.out).toContain('pnpm e2e (Playwright, in a browser): 2 failed.');
    // The reporter came on the command line: the team's configs are as they wrote them.
    expect(read('vitest.config.mts')).toBe(VITEST_CONFIG);
    expect(read('playwright.config.ts')).toBe(PLAYWRIGHT_CONFIG);
    // fwos reads the app's own runners: the search fails for want of the feature, the list as it was passes.
    const trace = check(dir, 'tests/traceability');
    expect(trace.findings.map((f) => f.message)).toEqual([expect.stringMatching(/^AC-team-members-1: failing \(/), expect.stringMatching(/^AC-team-members-2: failing \(/)]);
    expect(trace.info?.[0]).toBe('2 failing, 1 proven');
    expect(testResults(dir)).toMatchObject({ on: true, status: '2 result files in .fwos/local/results/' });
    expect(run(dir, 'tests', 'lock', TEST, E2E, '--red').out).toContain('Locked 2 test files (red run kept: 4 failing tests).');
    expect(hookOn(dir, TEST)).toMatch(/permissionDecision":"deny/);
    expect(hookOn(dir, E2E)).toMatch(/permissionDecision":"deny/);
  }, 300_000);

  it('challenge, at acceptance: a defect only behaviour shows, the Remove button following the wrong member, fails the evidence and the change is not done', () => {
    expect(NAIVE_SEARCH[2]![1]).not.toBe(SEARCH[2]![1]);
    edit(PAGE, ...NAIVE_SEARCH);
    const red = run(dir, 'tests', 'run');
    expect(red.code, red.out).toBe(1);
    // In jsdom and in the browser, only the search that should keep unnamed's Remove button fails.
    expect(red.out).toContain('pnpm test (Vitest): 1 failed, 2 passed.');
    expect(red.out).toContain('pnpm e2e (Playwright, in a browser): 1 failed, 1 passed.');
    expect(check(dir, 'tests/traceability').findings.map((f) => f.message)).toEqual([expect.stringMatching(/^AC-team-members-1: failing \(/)]);
    // The report carries the failure back to the ask it came from, and the change is not done.
    expect(run(dir, 'report').code).toBe(1);
    const report = read('docs/app/reports/acceptance.md');
    expect(report).toContain('- Verdict: **Not done yet**');
    expect(report).toMatch(/\| AC-team-members-1 \| [^|]+ \| FAILING: /);
    expect(report).toContain('| REQ-1: Search the team members | AC-team-members-1, AC-team-members-3 | FAILING |');
    const trace = json(dir, 'change', 'trace');
    expect(trace.asks[0]).toMatchObject({ id: 'REQ-1', verdict: 'failing' });
    keep('defect', 'planted', dir, { 'tests-run.txt': red.out, 'trace.json': trace });
    execFileSync('git', ['checkout', '--', PAGE], { cwd: dir });
  }, 300_000);

  it("builds it in place with the app's own components until its tests, in jsdom and in the browser, and every check pass", () => {
    edit(PAGE, ...SEARCH);
    const green = run(dir, 'tests', 'run');
    expect(green.code, green.out).toBe(0);
    expect(green.out).toContain('pnpm test (Vitest): 3 passed.');
    expect(green.out).toContain('pnpm e2e (Playwright, in a browser): 2 passed.');
    expect(check(dir, 'tests/traceability').info?.[0]).toBe('3 proven');
    // An edit outside what the change maps is caught, and kept out of it.
    const pricing = 'app/(dashboard)/pricing/page.tsx';
    write(dir, pricing, `${read(pricing)}\n// tidied while passing by\n`);
    expect(run(dir, 'change', 'drift')).toMatchObject({ code: 1, out: expect.stringContaining(`${pricing}: edited outside what change ${first} maps (/dashboard)`) });
    execFileSync('git', ['checkout', '--', pricing], { cwd: dir });
    expect(run(dir, 'change', 'drift').code).toBe(0);
    const all = json(dir, 'check');
    expect(all.results.filter((r: { status: string }) => r.status === 'fail')).toEqual([]);
    expect(all.exit).toBe(0);
  }, 300_000);

  it("accepts it on a report that keeps what was approved apart from what it builds on, and closes it on a person's yes", () => {
    expect(run(dir, 'step', 'accept').code).toBe(0);
    expect(json(dir, 'next')).toMatchObject({ step: 'accept', skill: 'fwos:accept', blocked: [] });
    expect(run(dir, 'report').code).toBe(0);
    const report = read('docs/app/reports/acceptance.md');
    expect(report).toContain(`- Change: ${first} (add search and an empty state to the team members table)`);
    expect(report).toContain('- Verdict: **Done**');
    // What people approved in this change, and where; apart from it, what the change builds on.
    expect(report).toMatch(new RegExp(`## Approved in this change\\n\\n[^#]*- Spec and test plan: approved by Example Owner on \\d{4}-\\d{2}-\\d{2} in ${escape(REVIEW)}\\. It adds AC-team-members-1, AC-team-members-2, AC-team-members-3\\.`));
    expect(report).toMatch(/## Imported context\n\n[^#]*- README\.md \(unchanged since it was linked\)/);
    expect(report).toContain('- Grounded in: /dashboard (app/(dashboard)/dashboard/page.tsx)');
    for (const n of [1, 2, 3]) expect(report).toMatch(new RegExp(`\\| AC-team-members-${n} \\| [^|]+ \\| PROVEN \\| mock \\|`));
    // The team's own commands ran it, and the feature was seen in a real browser.
    expect(report).toContain('| pnpm test | Vitest | 3 passed |');
    expect(report).toContain('| pnpm e2e | Playwright, in a browser | 2 passed |');
    expect(report).toContain('Seen in a browser: AC-team-members-1, AC-team-members-2.');
    expect(report).toContain('## New findings\n\nNone.');
    expect(report).toMatch(/## Pre-existing debt \(baseline\)\n\nFindings recorded before this change\. They are not evidence that it works/);
    expect(report).toMatch(/\| design-system\/tokens \| \d+ \| \d{4}-\d{2}-\d{2} \|/);
    // The trace, from the request to the evidence: each ask, the question settled before the build, the states and each criterion's cases.
    expect(report).toContain('| REQ-1: Search the team members | AC-team-members-1, AC-team-members-3 | PROVEN |');
    expect(report).toContain('| REQ-2: An empty state when a search matches no one | AC-team-members-2 | PROVEN |');
    expect(report).toContain('- Q-1: Does a search match emails as well as names? Names and emails:');
    expect(report).toContain('| filtered-empty | AC-team-members-2 |');
    expect(report).toContain('| AC-team-members-1 | added | TC-team-members-1 (component, new), TC-team-members-4 (e2e, new) | PROVEN, seen in a browser |');
    expect(report).toContain('Nothing open at acceptance.');
    keep('defect', 'control', dir, { 'trace.json': json(dir, 'change', 'trace') });
    expect(run(dir, 'approve', 'acceptance', '--by', 'Example Owner', '--via', 'pr', '--ref', REVIEW).code).toBe(0);
    expect(json(dir, 'next').action).toBe('Acceptance is approved. Close the change: `fwos change done`.');
    expect(run(dir, 'change', 'done').code).toBe(0);
    expect(json(dir, 'status').change).toBeNull();
    expect(json(dir, 'next').action).toMatch(/^This app is adopted at level delivery/);

    // The feature apart from fwos's records: the page, its tests, the test runners and the change's docs.
    // `next dev` writes its own settings into tsconfig.json, so that comes along too.
    const head = JSON.parse(run(dir, 'change', 'show', first).out).head as string;
    commit('feat: search and an empty state for the team members card');
    const feature = execFileSync('git', ['diff', '--name-only', head, 'HEAD'], { cwd: dir, encoding: 'utf8' }).split('\n');
    expect(feature.filter((f) => f && !f.startsWith('.fwos/'))).toEqual([
      '.gitignore',
      PAGE,
      TEST,
      'docs/app/reports/acceptance.md',
      'docs/app/spec.md',
      'docs/app/test-plan.md',
      'e2e/db.mjs',
      'e2e/session.ts',
      E2E,
      'package.json',
      'playwright.config.ts',
      'pnpm-lock.yaml',
      'tsconfig.json',
      'vitest.config.mts',
    ]);
    // Closing the change is no new evidence: the report the person approved is the same file.
    expect(run(dir, 'report').out).toContain('Unchanged: docs/app/reports/acceptance.md');
  }, 120_000);

  it('reports an edit made outside fwos to a locked test or a linked doc, and overwrites neither', () => {
    // Someone loosens the locked test in their editor, and someone updates the README the change linked.
    const loosened = read(TEST).replace("expect(rows()).toEqual(['Example Member (member)']);", 'expect(rows().length).toBeGreaterThan(0);');
    expect(loosened).not.toBe(read(TEST));
    write(dir, TEST, loosened);
    const readme = `${read('README.md')}\nTeam members can be searched by name or email.\n`;
    write(dir, 'README.md', readme);

    expect(check(dir, 'tests/locked')).toMatchObject({
      status: 'fail',
      findings: [{ file: TEST, message: expect.stringContaining(`locked test changed without a recorded unlock (locked in ${first})`) }],
    });
    expect(run(dir, 'report').code).toBe(1);
    const report = read('docs/app/reports/acceptance.md');
    expect(report).toContain(`- Change: ${first} (add search and an empty state to the team members table)`);
    expect(report).toContain('- README.md (changed since it was linked)');
    expect(report).toContain('- check tests/locked fails');
    // Said, never undone: both files stay as they were written.
    expect(read(TEST)).toBe(loosened);
    expect(read('README.md')).toBe(readme);

    // The team puts the test back. The README edit is theirs to keep, and a person approves the report that says so.
    execFileSync('git', ['checkout', '--', TEST], { cwd: dir });
    expect(run(dir, 'check').code).toBe(0);
    expect(run(dir, 'report').code).toBe(0);
    expect(json(dir, 'next').stale).toEqual(['acceptance']);
    expect(run(dir, 'approve', 'acceptance', '--by', 'Example Owner').code).toBe(0);
    expect(json(dir, 'next').stale).toEqual([]);
    commit('docs: the README says team members can be searched');
  }, 120_000);

  it('starts a second change without adopting again: mapped onto the tests around it, gated on its own approval', () => {
    // Meanwhile the team writes a browser test of its own, outside fwos and with no criterion tag.
    write(dir, E2E_INVITE, INVITE_E2E);
    commit('test: only an owner can invite');
    const adoption = read('.fwos/state.json');
    const c = run(dir, 'change', 'new', 'show how many members match a search', '--route', 'touches-ac');
    expect(c.out).toMatch(/^Created change 0003-show-how-many-members-match-a-search \(route touches-ac, enters at spec\)\./);
    expect(c.out).toContain('git switch -c feat/show-how-many-members-match-a-search');
    second = '0003-show-how-many-members-match-a-search';
    sh('git', 'switch', '-q', '-c', 'feat/show-how-many-members-match-a-search');
    // The first change approved this spec file, which says nothing for this one: the gate closes again.
    expect(hookOn(dir, PAGE)).toMatch(/permissionDecision":"deny/);
    // The map finds the tests around the card: the first change's, and the team's own.
    expect(json(dir, 'change', 'map', '/dashboard').tests.map((t: { file: string }) => t.file)).toEqual([TEST, E2E_INVITE, E2E]);
    write(dir, 'docs/app/spec.md', SPEC_2(first));
    write(dir, 'docs/app/test-plan.md', PLAN_2(REGRESSION(first)));
    expect(check(dir, 'tests/plan').findings.map((f) => f.message)).toEqual([expect.stringContaining(`${E2E_INVITE} (visits /dashboard)`)]);
    write(dir, 'docs/app/test-plan.md', PLAN_2([...REGRESSION(first), REGRESSION_INVITE]));
    expect(run(dir, 'check', 'spec/format', 'tests/plan').code).toBe(0);
    expect(run(dir, 'approve', 'spec', '--by', 'Example Member').code).toBe(0);
    expect(hookOn(dir, PAGE)).toBe('');
    expect(run(dir, 'step', 'build').code).toBe(0);
    // Its cases: one in the file the first change locked, through an unlock with a reason and a
    // reviewer, and a browser test of its own. Both fail first and are locked on that red run.
    expect(run(dir, 'tests', 'unlock', TEST, '--reason', 'the match count is tested with the rest of the card', '--reviewer', 'Example Owner').code).toBe(0);
    write(dir, TEST, `${read(TEST)}${COUNT_TEST}`);
    write(dir, E2E_COUNT, COUNT_E2E);
    const red = run(dir, 'tests', 'run');
    expect(red.code, red.out).toBe(1);
    expect(check(dir, 'tests/traceability').findings.map((f) => f.message)).toEqual([expect.stringMatching(/^AC-team-members-4: failing \(/)]);
    expect(run(dir, 'tests', 'lock', TEST, E2E_COUNT, '--red').out).toMatch(/^Locked 2 test files \(red run kept: 2 failing tests/);
    expect(read('.fwos/state.json')).toBe(adoption);
  }, 300_000);

  it('resumes the second change mid-build from the committed files alone, in a fresh process', () => {
    commit('wip: failing tests for the match count');
    const clone = mkdtempSync(join(tmpdir(), 'fwos-adopt-resume-'));
    made.push(clone);
    execFileSync('git', ['clone', '-q', dir, clone], { stdio: 'ignore' });
    // Nothing local comes along: no test results, no log, no session.
    expect(existsSync(join(clone, '.fwos/local'))).toBe(false);
    expect(json(clone, 'next')).toMatchObject({ change: { id: second, step: 'build' }, step: 'build', skill: 'fwos:build', blocked: [], stale: [] });
    expect(json(clone, 'status')).toMatchObject({
      change: { id: second, step: 'build' },
      approvals: [{ target: 'spec', status: 'approved', by: 'Example Member' }, { target: 'acceptance' }],
      lockedTests: { total: 3, changed: [], unlocked: [] },
    });
  });

  it("finishes the second change: a regression only the team's own test covers is caught, then every criterion is proven and it closes on approval", () => {
    // A first attempt at the count that also drops the invite card's footer for members.
    edit(PAGE, ...COUNT, [INVITE_FOOTER, '']);
    expect(run(dir, 'tests', 'run').code).toBe(1);
    // Every criterion is proven; only the team's untagged test sees what broke next to the change.
    expect(check(dir, 'tests/traceability').info?.[0]).toBe('4 proven');
    expect(check(dir, 'tests/regression')).toMatchObject({ status: 'fail', findings: [{ file: E2E_INVITE, message: expect.stringContaining('only an owner can invite a member') }] });
    execFileSync('git', ['checkout', '--', PAGE], { cwd: dir });
    edit(PAGE, ...COUNT);
    const green = run(dir, 'tests', 'run');
    expect(green.code, green.out).toBe(0);
    expect(run(dir, 'check').code).toBe(0);
    expect(run(dir, 'step', 'accept').code).toBe(0);
    expect(run(dir, 'report').code).toBe(0);
    const report = read('docs/app/reports/acceptance.md');
    expect(report).toContain(`- Change: ${second} (show how many members match a search)`);
    for (const n of [1, 2, 3, 4]) expect(report).toMatch(new RegExp(`\\| AC-team-members-${n} \\| [^|]+ \\| PROVEN \\| mock \\|`));
    // Approved here: the criterion it adds. Imported: the first change's criteria, and the team's own tests.
    expect(report).toMatch(/- Spec and test plan: approved by Example Member on \d{4}-\d{2}-\d{2} in chat\. It adds AC-team-members-4\./);
    expect(report).toContain(`- Criteria carried from earlier changes: AC-team-members-1, AC-team-members-2, AC-team-members-3 (from ${first})`);
    expect(report).toContain('| REQ-1: Say how many members a search matches | AC-team-members-4 | PROVEN |');
    expect(report).toContain('| AC-team-members-1 | carried | TC-team-members-1 (component, new), TC-team-members-4 (e2e, new) | PROVEN, seen in a browser |');
    expect(report).toContain('| AC-team-members-4 | added | TC-team-members-6 (component, new), TC-team-members-7 (e2e, new) | PROVEN, seen in a browser |');
    expect(report).toContain(`| ${E2E_INVITE} | 1 passed |`);
    expect(report).toContain(`- ${TEST}: the match count is tested with the rest of the card (reviewer: Example Owner; locked again; ${second})`);
    expect(run(dir, 'approve', 'acceptance', '--by', 'Example Member').code).toBe(0);
    expect(run(dir, 'change', 'done').code).toBe(0);
    expect(run(dir, 'report').out).toContain('Unchanged: docs/app/reports/acceptance.md');
    expect(run(dir, 'check').code).toBe(0);
  }, 300_000);
});

// ---- the value fwos adds, stage by stage: controlled challenges ------------------------------------
// Each challenge plants one known gap in a change on a fresh copy of the same app and checks fwos
// finds it at the stage it belongs to, before any of the app's code changes. Its clean control is
// the same change without the gap, which fwos lets through. The fourth challenge, a defect only
// behaviour shows, runs on the delivered app above, where the team's tests really run.

/** The challenges' request, and the parts of its spec delta a challenge can plant a gap in. */
const ASK = 'add search to the team members table';
const PARTS = {
  context: `## Context\n- Request: "${ASK}".\n- Route: /dashboard, app/(dashboard)/dashboard/page.tsx, the Team Members card.\n`,
  request: `## Request\n"${ASK}"\n\n### REQ-1: Search the team members\n- AC: AC-team-members-1, AC-team-members-2, AC-team-members-3\n`,
  states: `## States\n| State | What the user sees | Criterion |\n|---|---|---|\n| filtered | the members whose name or email holds the search | AC-team-members-1 |\n| filtered-empty | No members match "<search>". | AC-team-members-2 |\n`,
  criteria: `## Acceptance criteria\n${CRITERIA}`,
  questions: '## Open questions\n### Q-1: Does a search match emails as well as names?\n- Answer: Names and emails: a member with no name shows their email on the card (Example Owner)\n',
};
const delta = (over: Partial<typeof PARTS> = {}) => {
  const d = { ...PARTS, ...over };
  return `# Changes delivered through fwos\n\n## What you're approving\nSearch on the Team Members card.\n\n${d.context}\n${d.request}\n${d.states}\n${d.criteria}\n${d.questions}`;
};
const CHALLENGE_PLAN = `# Test plan\n\n${CASES}\n${BROWSER_CASES}\n## Regression scope\n\nNone: the app has no tests yet.\n`;

/** A fresh copy of the app at level delivery, under git, with a change open and mapped onto /dashboard. */
function delivering(request = ASK, ...adopt: string[]): string {
  const root = copyOfApp();
  commitAll(root);
  expect(run(root, 'adopt', '--level', 'delivery', ...adopt, '--yes').code).toBe(0);
  commitAll(root);
  expect(run(root, 'change', 'new', request, '--route', 'touches-ac').code).toBe(0);
  expect(run(root, 'change', 'map', '/dashboard').code).toBe(0);
  return root;
}
/** The findings of one rule of a check. */
const caught = (root: string, id: string, rule: string) => check(root, id).findings.filter((f) => (f as { rule?: string }).rule === rule).map((f) => f.message);
/** Nothing of the app's own code changed: only fwos's records and the change's docs. */
const codeUntouched = (root: string) => expect(status(root).filter((f) => !/ (?:docs|\.fwos)\//.test(f))).toEqual([]);

describe.runIf(enabled)('the value fwos adds at each stage: controlled challenges on the same app, each with a clean control', () => {
  it('ambiguity, at the spec: a criterion that needs interpretation and an open question stop the approval before any code changes', () => {
    const planted = delivering();
    const vague = CRITERIA.replace('then only that member shows, with their role and the Remove button they had', 'then the relevant members show quickly');
    const open = '## Open questions\n### Q-1: Does a search match emails as well as names?\n';
    write(planted, 'docs/app/spec.md', delta({ criteria: `## Acceptance criteria\n${vague}`, questions: open }));
    write(planted, 'docs/app/test-plan.md', CHALLENGE_PLAN);
    expect(caught(planted, 'spec/format', 'vague')).toEqual(['AC-team-members-1 says "relevant" and "quickly", which need interpretation: say exactly what the user sees, with the values or numbers that decide it']);
    const refused = run(planted, 'approve', 'spec', '--by', 'Example Owner');
    expect(refused).toMatchObject({ code: 2, err: expect.stringContaining('Q-1 is still open ("Does a search match emails as well as names?")') });
    codeUntouched(planted);
    keep('ambiguity', 'planted', planted, { 'spec-format.json': check(planted, 'spec/format'), 'approve-spec.txt': refused.err });

    const control = delivering();
    write(control, 'docs/app/spec.md', delta());
    write(control, 'docs/app/test-plan.md', CHALLENGE_PLAN);
    expect(check(control, 'spec/format')).toMatchObject({ status: 'pass', findings: [] });
    const approved = run(control, 'approve', 'spec', '--by', 'Example Owner');
    expect(approved.code, approved.err).toBe(0);
    expect(json(control, 'change', 'trace').questions).toEqual([{ id: 'Q-1', text: 'Does a search match emails as well as names?', answer: 'Names and emails: a member with no name shows their email on the card (Example Owner)' }]);
    keep('ambiguity', 'control', control, { 'spec-format.json': check(control, 'spec/format'), 'approve-spec.txt': approved.out });
  });

  it("missing state, at design: a search whose no-match state the delta leaves out is caught before any code changes", () => {
    const planted = delivering();
    // The delta covers the search and the list as it was, and says nothing of a search that finds no one.
    const withoutEmpty = (CRITERIA.split('### ').filter(Boolean).filter((c) => !c.startsWith('AC-team-members-2')).map((c) => `### ${c}`)).join('');
    write(planted, 'docs/app/spec.md', delta({
      request: `## Request\n"${ASK}"\n\n### REQ-1: Search the team members\n- AC: AC-team-members-1, AC-team-members-3\n`,
      states: '## States\n| State | What the user sees | Criterion |\n|---|---|---|\n| filtered | the members whose name or email holds the search | AC-team-members-1 |\n| ready | every member, as before | AC-team-members-3 |\n',
      criteria: `## Acceptance criteria\n${withoutEmpty}`,
    }));
    write(planted, 'docs/app/test-plan.md', CHALLENGE_PLAN.replace(/### TC-team-members-2:[\s\S]*?(?=###)/, '').replace(/### TC-team-members-5:[\s\S]*?(?=##)/, ''));
    expect(caught(planted, 'spec/format', 'states')).toEqual([
      'the change searches ("search" in the request), so a search or filter can match nothing: add "filtered-empty" to ## States with the criterion that covers it, or "none: <why>" if it can\'t happen',
    ]);
    codeUntouched(planted);
    keep('missing-state', 'planted', planted, { 'spec-format.json': check(planted, 'spec/format') });

    const control = delivering();
    write(control, 'docs/app/spec.md', delta());
    write(control, 'docs/app/test-plan.md', CHALLENGE_PLAN);
    expect(caught(control, 'spec/format', 'states')).toEqual([]);
    expect(json(control, 'change', 'trace').states).toEqual(expect.arrayContaining([{ state: 'filtered-empty', what: 'No members match "<search>".', criteria: ['AC-team-members-2'] }]));
    keep('missing-state', 'control', control, { 'spec-format.json': check(control, 'spec/format') });
  });

  it('coverage gap, at test planning: a criterion the change rewrites, planned only with the cases that proved its old text, is caught before any code changes', () => {
    /** A copy where an earlier change left the search criteria in the spec, by name only. */
    const earlier = () => {
      const root = copyOfApp();
      commitAll(root);
      expect(run(root, 'adopt', '--level', 'delivery', '--yes').code).toBe(0);
      write(root, 'docs/app/spec.md', delta({ criteria: `## Acceptance criteria\n${CRITERIA.replace('when I type "member" or "UNNAMED" in "Search members"', 'when I type "member" in "Search members"')}` }));
      commitAll(root);
      expect(run(root, 'change', 'new', 'let a search match emails too', '--route', 'touches-ac').code).toBe(0);
      expect(run(root, 'change', 'map', '/dashboard').code).toBe(0);
      // The change rewrites AC-team-members-1: an email matches too.
      write(root, 'docs/app/spec.md', delta({ request: `## Request\n"let a search match emails too"\n\n### REQ-1: Match a member's email as well as their name\n- AC: AC-team-members-1\n` }));
      return root;
    };
    const planted = earlier();
    // The plan keeps the case that proved the old criterion, marked existing, and adds none.
    write(planted, 'docs/app/test-plan.md', CHALLENGE_PLAN.replace(/(### TC-team-members-1:[^\n]*\n- AC: [^\n]*\n- Level: component\n)- Status: new/, '$1- Status: existing').replace(/(### TC-team-members-4:[^\n]*\n- AC: [^\n]*\n- Level: e2e\n)- Status: new/, '$1- Status: existing'));
    expect(caught(planted, 'tests/plan', 'changed-ac')).toEqual([
      'AC-team-members-1 changes in this change, but its only cases are existing ones (TC-team-members-1, TC-team-members-4): they prove what it said before, so give it a new case that fails first',
    ]);
    codeUntouched(planted);
    keep('coverage-gap', 'planted', planted, { 'tests-plan.json': check(planted, 'tests/plan'), 'trace.json': json(planted, 'change', 'trace') });

    const control = earlier();
    write(control, 'docs/app/test-plan.md', CHALLENGE_PLAN);
    expect(caught(control, 'tests/plan', 'changed-ac')).toEqual([]);
    const ac = (json(control, 'change', 'trace').criteria as { id: string; own: string; cases: { id: string; status: string }[] }[]).find((c) => c.id === 'AC-team-members-1')!;
    expect(ac).toMatchObject({ own: 'changed', cases: [{ id: 'TC-team-members-1', status: 'new' }, { id: 'TC-team-members-4', status: 'new' }] });
    keep('coverage-gap', 'control', control, { 'tests-plan.json': check(control, 'tests/plan'), 'trace.json': json(control, 'change', 'trace') });
  });

  it("a kept stage: a team that reviews every state in Figma keeps design, fwos stops asking for the states, and the change links the team's design", () => {
    const without = delta({ states: '' });
    const control = delivering();
    write(control, 'docs/app/spec.md', without);
    expect(caught(control, 'spec/format', 'states')).toEqual([expect.stringContaining('no "## States"')]);
    const kept = delivering(ASK, '--keep', 'design', '--reason', 'our designers review every state');
    write(kept, 'docs/app/spec.md', without);
    expect(caught(kept, 'spec/format', 'states')).toEqual([]);
    expect(json(kept, 'next').open.unlinked).toEqual([{ stage: 'design', label: 'Design and exploration' }]);
    expect(run(kept, 'change', 'link', 'https://example.com/design/file/example-team-members', '--stage', 'design').code).toBe(0);
    const trace = json(kept, 'change', 'trace');
    expect(trace.stages.find((x: { id: string }) => x.id === 'design')).toEqual({ id: 'design', label: 'Design and exploration', by: 'team', reason: 'our designers review every state', artifacts: ['https://example.com/design/file/example-team-members'] });
    expect(trace.open.unlinked).toEqual([]);
    keep('kept-design', 'kept', kept, { 'trace.json': trace });
  });
});

describe.runIf(enabled)('adoption: one app of a monorepo, and the cases where fwos stops', () => {
  it('lists every app, adopts only the one picked, and never checks or gates the others', () => {
    const root = copyOfApp('apps/site');
    write(root, 'package.json', `${JSON.stringify({ private: true }, null, 2)}\n`);
    write(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n  - 'packages/*'\n");
    const site = JSON.parse(readFileSync(join(root, 'apps/site/package.json'), 'utf8'));
    write(root, 'apps/site/package.json', `${JSON.stringify({ ...site, dependencies: { ...site.dependencies, '@example-org/ui': 'workspace:*' } }, null, 2)}\n`);
    write(root, 'packages/ui/package.json', `${JSON.stringify({ name: '@example-org/ui' }, null, 2)}\n`);
    write(root, 'packages/ui/src/badge.tsx', 'export const Badge = () => null;\n');
    // Another team's app, with findings of its own, and a docs site on another framework.
    write(root, 'apps/admin/package.json', `${JSON.stringify({ dependencies: { next: '15.3.0' } }, null, 2)}\n`);
    write(root, 'apps/admin/app/page.tsx', 'export default function Admin() {\n  return <img src="/a.png" className="bg-[#123456]" />;\n}\n');
    write(root, 'apps/docs/package.json', `${JSON.stringify({ dependencies: { astro: '5.0.0' } }, null, 2)}\n`);
    execFileSync('git', ['init', '-q'], { cwd: root });
    commitAll(root);

    const p = json(root, 'adopt');
    expect(p.apps.map((a: { dir: string; framework: string }) => `${a.dir} ${a.framework}`)).toEqual(['apps/admin Next.js', 'apps/docs Astro', 'apps/site Next.js']);
    expect(p.decisions).toEqual(['Pick the app to adopt: --app apps/admin or --app apps/site.']);
    expect(run(root, 'adopt', '--yes').code).toBe(2);
    expect(existsSync(join(root, '.fwos'))).toBe(false);

    expect(run(root, 'adopt', '--app', 'apps/site', '--yes').code).toBe(0);
    const state = JSON.parse(readFileSync(join(root, '.fwos/state.json'), 'utf8'));
    expect(state.paths.apps).toEqual({ web: 'apps/site' });
    expect(state.paths.source).toContain('packages/ui/src/**');
    expect(state.paths.ignore).toEqual(expect.arrayContaining(['apps/admin/**', 'apps/docs/**']));
    expect(readFileSync(join(root, '.fwos/baseline.json'), 'utf8')).not.toMatch(/apps\/admin|apps\/docs/);
    write(root, 'apps/admin/app/users/page.tsx', 'export default function Users() {\n  return <img src="/u.png" className="bg-[#654321]" />;\n}\n');
    expect(run(root, 'check').code).toBe(0);

    expect(run(root, 'adopt', '--level', 'delivery', '--yes').code).toBe(0);
    expect(run(root, 'change', 'new', 'add a badge to the members list', '--route', 'touches-ac').code).toBe(0);
    expect(hookOn(root, 'apps/site/app/(dashboard)/dashboard/page.tsx')).toMatch(/permissionDecision":"deny/);
    expect(hookOn(root, 'packages/ui/src/badge.tsx')).toMatch(/permissionDecision":"deny/);
    expect(hookOn(root, 'apps/admin/app/page.tsx')).toBe('');
    // The map reads the picked app's routes, and the package it uses.
    expect(json(root, 'change', 'map', '/dashboard').targets).toEqual([{ target: '/dashboard', file: 'apps/site/app/(dashboard)/dashboard/page.tsx' }]);
  });

  it("stops when the team's own docs sit where fwos keeps its records, until they pick another folder", () => {
    const root = copyOfApp();
    write(root, 'docs/app/spec.md', '# Our spec\nThe team keeps its own spec here.\n');
    const p = json(root, 'adopt');
    expect(p.decisions).toEqual(['docs/app/spec.md is yours, and fwos keeps its records in docs/app/: pass --docs <folder> to keep them apart (for example --docs docs/fwos).']);
    expect(run(root, 'adopt', '--yes')).toMatchObject({ code: 2, err: expect.stringContaining('docs/app/spec.md is yours') });
    expect(run(root, 'adopt', '--docs', 'docs/fwos', '--yes').code).toBe(0);
    expect(readFileSync(join(root, 'docs/app/spec.md'), 'utf8')).toBe('# Our spec\nThe team keeps its own spec here.\n');
  });

  it("runs a test command it can't read results from as it is, and says its run proves nothing", () => {
    const root = copyOfApp();
    // The team's own link check, run by its own script: fwos knows no reporter for it.
    write(root, 'scripts/check-links.mjs', "console.log('every link resolves');\n");
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    write(root, 'package.json', `${JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, 'test:links': 'node scripts/check-links.mjs' } }, null, 2)}\n`);
    execFileSync('git', ['init', '-q'], { cwd: root });
    commitAll(root);
    expect(run(root, 'adopt', '--level', 'delivery', '--yes').code).toBe(0);
    const r = run(root, 'tests', 'run');
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toContain("pnpm test:links: exit 0. Not mapped: fwos doesn't know how to read results from `node scripts/check-links.mjs`, so this run proves no criterion.");
    expect(json(root, 'tests', 'run').runs).toEqual([expect.objectContaining({ script: 'test:links', runner: null, mapped: false, exit: 0, results: [] })]);
    const caps = json(root, 'status').adoption.capabilities as { id: string; on: boolean; status: string }[];
    expect(caps.find((x) => x.id === 'test-results')).toMatchObject({ on: false, status: expect.stringContaining('pnpm test:links') });
  });

  it('says Unsupported for an app on another framework, and sets nothing up', () => {
    const root = mkdtempSync(join(tmpdir(), 'fwos-adopt-vite-'));
    made.push(root);
    write(root, 'package.json', `${JSON.stringify({ dependencies: { vite: '6.0.0', react: '19.0.0' } }, null, 2)}\n`);
    write(root, 'src/main.tsx', 'export {};\n');
    const r = run(root, 'adopt');
    expect(r.code).toBe(1);
    expect(r.out).toContain('Unsupported: No Next.js app: found Vite at . (package.json dependencies.vite).');
    expect(run(root, 'adopt', '--yes').code).toBe(2);
    expect(existsSync(join(root, '.fwos'))).toBe(false);
  });
});
