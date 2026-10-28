// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Regenerates the planted-violation fixtures: for every check, a `good/` project it must pass and
// a `bad/` project it must fail. Run after changing a check's inputs: `pnpm fixtures`.
// `pnpm fixtures --check` writes nothing and fails when the committed fixtures differ.
// Hashes use the real state functions; observations/results are explicit synthetic check fixtures, not real executions.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type IaRun, type RunKind, type StateObservation, hashText, loadProject, revisionOf, writeRun, writeText } from '../plugin/kernel/index.ts';
import { loadContract } from '../plugin/modules/architecture/index.ts';
import { loadDesignSystem, starterFiles, tokenOutputs } from '../plugin/modules/design-system/index.ts';
import { approve, initProject, listChanges, updateChange, writeOwned } from '../plugin/modules/state/index.ts';
import { syntheticTestRun } from '../plugin/kernel/testing.ts';
import { lockTests } from '../plugin/modules/tests/index.ts';
import { type Ia, iaRunPlan } from '../plugin/modules/screens/index.ts';
import { fixtures as mockFetch, verify } from '../plugin/platforms/web/index.ts';

const ROOT = new URL('../plugin/', import.meta.url).pathname;
type Files = Record<string, string | object>;
type Setup = (dir: string) => void;
interface Pair {
  good: Files;
  bad: Files;
  setupGood?: Setup;
  setupBad?: Setup;
}

const write = (dir: string, files: Files) => {
  for (const [rel, c] of Object.entries(files)) writeText(join(dir, rel), typeof c === 'string' ? c : `${JSON.stringify(c, null, 2)}\n`);
};
const starter = (): Files => Object.fromEntries(starterFiles().map((f) => [`design-system/${f.path}`, f.content]));
const state = { '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] } };
const change = (extra: object = {}) => ({
  '.fwos/changes/0001-initial.json': { schema: 1, id: '0001-initial', title: 'Initial app', route: 'initial', step: 'discovery', status: 'open', createdAt: '2026-10-07', approvals: {}, ...extra },
});
const light = () => JSON.parse(starter()['design-system/tokens/light.json'] as string);
const xml = (cases: string) => `<?xml version="1.0"?>\n<testsuites><testsuite name="fixture">\n${cases}\n</testsuite></testsuites>\n`;
const tc = (name: string, fail?: string) => `  <testcase classname="fixture.test.tsx" name="${name}"${fail ? `><failure message="${fail}"/></testcase>` : '/>'}`;

const FIXED_DATE = '2026-10-07';

/** Drops machine-specific git facts and pins every date, so `pnpm fixtures` is idempotent. */
function scrub(dir: string) {
  const statePath = join(dir, '.fwos/state.json');
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.createdAt) state.createdAt = FIXED_DATE;
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // no state file in this fixture
  }
  for (const c of listChanges(dir)) {
    const p = join(dir, '.fwos/changes', `${c.id}.json`);
    const data = JSON.parse(readFileSync(p, 'utf8'));
    data.createdAt = FIXED_DATE;
    delete data.branch;
    delete data.head;
    for (const a of Object.values<{ at: string }>(data.approvals ?? {})) a.at = '2026-10-07T00:00:00.000Z';
    for (const l of Object.values<{ at: string }>(data.lockedTests ?? {})) l.at = '2026-10-07T00:00:00.000Z';
    writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);
  }
}

const spec = (acs = '### AC-list-1: Save a link\n- Proven against: local\n') =>
  `# Spec\n\n${[
    "What you're approving",
    'Journeys',
    'Scope by platform',
    'Screens and navigation',
    'States per screen',
    'Data and API contract',
    'Architecture',
    'Design system binding',
    'Cross-cutting',
  ]
    .map((s, i) => `## ${i + 1}. ${s}\n\nText.\n`)
    .join('\n')}\n## 10. Acceptance criteria\n\n${acs}\n${['Release and distribution', 'Open questions', 'Slices'].map((s, i) => `## ${i + 11}. ${s}\n\nText.\n`).join('\n')}`;
const defaults = ['crawl', 'a11y', 'keyboard', 'themes', 'phone', 'prod'].map((r) => `### TC-default-${r}: ${r}\n- Level: e2e\n`).join('\n');
const ia = (pages: object[]) => ({ schema: 1, roles: ['user'], pages });
const modules = {
  schema: 1,
  modules: [
    { name: 'app', path: 'apps/web/app', dependsOn: ['*'] },
    { name: 'list', path: 'apps/web/src/features/list', dependsOn: ['shared-ui'] },
    { name: 'settings', path: 'apps/web/src/features/settings', dependsOn: ['shared-ui'] },
    { name: 'shared-ui', path: 'apps/web/src/shared/ui', dependsOn: [] },
  ],
};
const openapi = `openapi: 3.1.0
info: { title: fixture, version: '1' }
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { type: array, items: { $ref: '#/components/schemas/Item' } }
components:
  schemas:
    Item:
      type: object
      required: [id, url]
      properties: { id: { type: string }, url: { type: string } }
`;

/** Writes the mock fetch the web adapter generates from the contract in `dir`. */
const generateMocks = (dir: string) => {
  const p = loadProject(dir);
  write(dir, Object.fromEntries(mockFetch.generate(p, loadContract(p)!.model).map((o) => [o.path, o.content])));
};

/** fwos's own harness files, as `fwos harness` writes them into the app. */
const harnessFiles = (): Files => Object.fromEntries(verify.harness!(loadProject(ROOT)).map((h) => [h.file, h.content]));

/** A run of fwos's harness on `dir` as it is now, as `fwos harness record` writes it, with a fixed date. */
const recordRun = (dir: string, kind: RunKind, target: string, observations: unknown) => {
  const project = loadProject(dir);
  const harness = verify.harness!(project).find((h) => h.kind === kind)!;
  writeRun(project, {
    schema: 1,
    kind,
    target,
    fwos: '0.1.0',
    harness: { file: harness.file, sha: hashText(harness.content) },
    revision: revisionOf(project),
    config: { server: 'production build', browser: 'chromium' },
    at: `${FIXED_DATE}T00:00:00.000Z`,
    observations,
  });
};

/** What the state harness sees in one state's fixture: some text and, by default, nothing else. */
const seen = (state: string, over: Partial<StateObservation> = {}): StateObservation => ({
  state,
  status: 200,
  found: true,
  nodes: 3,
  text: `${state} view`,
  busy: 0,
  alerts: [],
  statuses: [],
  items: [],
  disabled: 0,
  invalid: 0,
  ...over,
});

const FIXTURES: Record<string, Pair> = {
  'state/schema': {
    good: { ...state, ...change() },
    bad: { '.fwos/state.json': { schema: 2, pluginVersion: '9.0.0', mode: 'new', platforms: ['web'] }, ...change() },
  },
  'state/approvals': {
    good: { 'docs/app/brief.md': '# Brief\n', 'docs/app/spec.md': '# Spec\n', 'docs/app/test-plan.md': '# Plan\n' },
    bad: { 'docs/app/brief.md': '# Brief\n', 'docs/app/spec.md': '# Spec\n', 'docs/app/test-plan.md': '# Plan\n' },
    setupGood: (d) => {
      initProject(d);
      approve(loadProject(d), 'brief', 'Ada');
      approve(loadProject(d), 'spec', 'Ada');
      updateChange(d, (c) => void (c.step = 'build'));
    },
    setupBad: (d) => {
      initProject(d);
      approve(loadProject(d), 'brief', 'Ada');
      approve(loadProject(d), 'spec', 'Ada');
      updateChange(d, (c) => void (c.step = 'build'));
      writeText(join(d, 'docs/app/spec.md'), '# Spec\nEdited after approval.\n');
    },
  },
  'state/owned': {
    good: {},
    bad: {},
    setupGood: (d) => {
      initProject(d);
      writeOwned(d, 'packages/tokens/generated/tokens.css', '/* generated */\n', 'generated', 'design-system/');
    },
    setupBad: (d) => {
      initProject(d);
      writeOwned(d, 'packages/tokens/generated/tokens.css', '/* generated */\n', 'generated', 'design-system/');
      writeText(join(d, 'packages/tokens/generated/tokens.css'), '/* edited by hand */\n');
    },
  },
  'design-system/schema': {
    good: starter(),
    bad: (() => {
      const l = light();
      delete l.color.surface.base;
      return { ...starter(), 'design-system/tokens/light.json': l };
    })(),
  },
  'design-system/contrast': {
    // A translucent dark surface: it passes only when measured over the dark base, not over white.
    good: (() => {
      const d = JSON.parse(starter()['design-system/tokens/dark.json'] as string);
      d.color.surface.subtle = { $value: 'rgb(255 255 255 / 0.05)' };
      return { ...starter(), 'design-system/tokens/dark.json': d };
    })(),
    bad: (() => {
      const l = light();
      l.color.text.muted = { $value: '#bbbbbb' };
      return { ...starter(), 'design-system/tokens/light.json': l };
    })(),
  },
  'design-system/chart-palette': {
    good: (() => {
      const l = light();
      l.color.chart = { 1: { $value: '#1c7ed6' }, 2: { $value: '#e8590c' }, 3: { $value: '#2b8a3e' }, 4: { $value: '#ae3ec9' }, other: { $value: '#868e96' } };
      return { ...starter(), 'design-system/tokens/light.json': l };
    })(),
    bad: (() => {
      const l = light();
      l.color.chart = { 1: { $value: '#1c7ed6' }, 2: { $value: '#1d7fd7' }, 3: { $value: '#2b8a3e' }, 4: { $value: '#ae3ec9' }, other: { $value: '#868e96' } };
      return { ...starter(), 'design-system/tokens/light.json': l };
    })(),
  },
  'design-system/tokens': {
    good: {
      'apps/web/src/features/list/row.tsx': 'export const Row = () => <li className="bg-surface text-fg text-body rounded-md border-(--color-border)">x</li>;\n',
      'apps/web/src/features/list/row.css': '.row { color: var(--color-fg); }\n',
    },
    bad: {
      'apps/web/src/features/list/row.tsx': 'export const Row = () => <li className="bg-red-500 text-white text-sm border-(--color-red-500)">x</li>;\n',
      'apps/web/src/features/list/row.css': '.row { color: var(--color-red-500); }\n',
    },
  },
  'design-system/generated': {
    good: starter(),
    bad: { ...starter(), 'packages/tokens/generated/tokens.css': '/* stale */\n', 'packages/tokens/generated/theme.css': '/* stale */\n' },
    setupGood: (d) => {
      const p = loadProject(d);
      write(d, Object.fromEntries(tokenOutputs(p, loadDesignSystem(p)!).map((o) => [o.path, o.content])));
    },
  },
  // The bad one has a component missing from components.json, and an MDX page using a superseded one.
  'design-system/registry': (() => {
    const ui = {
      ...state,
      'design-system/components.json': {
        schema: 1,
        components: [
          { id: 'button', status: 'stable', requiredStates: [] },
          { id: 'old-button', status: 'superseded', supersededBy: 'button', requiredStates: [] },
        ],
      },
      'apps/web/src/shared/ui/button.tsx': 'export const Button = () => null;\n',
      'apps/web/src/shared/ui/old-button.tsx': 'export const OldButton = () => null;\n',
    };
    return {
      good: { ...ui, 'apps/web/app/docs/page.mdx': "import { Button } from '@/shared/ui/button'\n\nIt replaces `OldButton`.\n\n<Button />\n" },
      bad: {
        ...ui,
        'apps/web/src/shared/ui/mystery-table.tsx': 'export const MysteryTable = () => null;\n',
        'apps/web/app/docs/page.mdx': "import { OldButton } from '@/shared/ui/old-button'\n\n<OldButton />\n",
      },
    };
  })(),
  // Both have passing tests tagged with each state. The bad button's loading fixture renders it idle,
  // which fwos's state harness saw: the state-rendering fixture: tags alone prove no render.
  'design-system/required-states': (() => {
    const app = {
      'design-system/components.json': { schema: 1, components: [{ id: 'button', status: 'stable', requiredStates: ['default', 'loading'] }] },
      '.fwos/local/results/vitest.xml': xml([tc('renders @state:button:default'), tc('spins @state:button:loading')].join('\n')),
      ...harnessFiles(),
    };
    return {
      good: app,
      bad: app,
      setupGood: (d) => recordRun(d, 'states', 'component.button', [seen('default', { text: 'Save' }), seen('loading', { text: 'Loading', busy: 1, disabled: 1 })]),
      setupBad: (d) => recordRun(d, 'states', 'component.button', [seen('default', { text: 'Save' }), seen('loading', { text: 'Save', disabled: 1 })]),
    };
  })(),
  'architecture/walls': {
    good: { 'docs/app/modules.json': modules, 'apps/web/src/features/list/index.ts': "import { Button } from '../../shared/ui';\nexport const List = Button;\n", 'apps/web/src/shared/ui/index.ts': 'export const Button = 1;\n' },
    bad: {
      'docs/app/modules.json': modules,
      'apps/web/src/features/list/index.ts': "import { Settings } from '../settings';\nexport const List = Settings;\n",
      'apps/web/src/features/settings/index.ts': 'export const Settings = 1;\n',
      'apps/web/src/shared/ui/index.ts': 'export const Button = 1;\n',
    },
  },
  'architecture/contract': {
    good: { 'packages/api-contract/openapi.yaml': openapi, 'packages/api-contract/fixtures/listItems.default.json': { status: 200, body: [{ id: '1', url: 'https://example.com' }] } },
    bad: { 'packages/api-contract/openapi.yaml': openapi, 'packages/api-contract/fixtures/listItems.default.json': { status: 200, body: [{ id: 1 }] } },
  },
  // The bad mocks were generated before the contract moved listItems from /items to /links.
  'architecture/mocks': {
    good: { 'packages/api-contract/openapi.yaml': openapi, 'packages/api-contract/fixtures/listItems.default.json': { status: 200, body: [{ id: '1', url: 'https://example.com' }] } },
    bad: { 'packages/api-contract/openapi.yaml': openapi, 'packages/api-contract/fixtures/listItems.default.json': { status: 200, body: [{ id: '1', url: 'https://example.com' }] } },
    setupGood: generateMocks,
    setupBad: (d) => {
      generateMocks(d);
      writeText(join(d, 'packages/api-contract/openapi.yaml'), openapi.replace('/items:', '/links:'));
    },
  },
  // The good one links its settings page from the layout, guards members, and a fresh run of fwos's
  // IA harness shows each role and flag setting exactly what ia.json says. The bad one never links
  // settings, exposes /debug, which ia.json doesn't list, and its members page can't turn anyone away.
  'screens/ia': (() => {
    const ia: Ia = {
      schema: 1,
      roles: ['member', 'admin'],
      flags: ['members-enabled'],
      pages: [
        { id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] },
        { id: 'settings', title: 'Settings', route: '/settings', kind: 'nav', states: ['ready'] },
        { id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] },
      ],
    };
    const guard = "import { guardPage } from '../../src/shared/session';\n\nexport default async function M() {\n  await guardPage('members');\n  return null;\n}\n";
    const app = {
      ...state,
      'docs/app/ia.json': ia,
      'apps/web/app/page.tsx': 'export default function P() { return null; }\n',
      'apps/web/app/settings/page.tsx': 'export default function S() { return null; }\n',
    };
    const layout = (nav: string) => `import Link from 'next/link';\n\nexport default function L({ children }) {\n  return <body>${nav}{children}</body>;\n}\n`;
    const plan = iaRunPlan(ia);
    const faithful = (role: string, flags: string[]): IaRun => {
      const sees = (page: string) => page !== 'members' || (role === 'admin' && flags.includes('members-enabled'));
      return {
        role,
        flags,
        applied: true,
        nav: ['/', '/settings', ...(sees('members') ? ['/members'] : [])],
        visits: plan.visits.map((v) => ({ page: v.page, path: v.path, status: sees(v.page) ? 200 : 404, finalPath: v.path, notFound: !sees(v.page) })),
      };
    };
    return {
      good: { ...app, ...harnessFiles(), 'apps/web/app/members/page.tsx': guard, 'apps/web/app/layout.tsx': layout('<nav><Link href="/settings">Settings</Link><Link href="/members">Members</Link></nav>') },
      bad: {
        ...app,
        'apps/web/app/members/page.tsx': 'export default function M() { return <main>Members</main>; }\n',
        'apps/web/app/layout.tsx': layout('<nav><Link href="/members">Members</Link></nav>'),
        'apps/web/app/debug/page.tsx': 'export default function D() { return null; }\n',
      },
      setupGood: (d) => {
        for (const r of plan.runs) recordRun(d, 'ia', r.key, faithful(r.role, r.flags));
      },
    };
  })(),
  // Both have a passing test tagged with each page state. In the bad one, fwos's state harness saw
  // the error state keep the ready state's rows beside its alert.
  'screens/states': (() => {
    const app = {
      'docs/app/ia.json': ia([{ id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['loading', 'error', 'ready'] }]),
      '.fwos/local/results/e2e.xml': xml([tc('skeleton @state:home:loading'), tc('retry @state:home:error'), tc('list @state:home:ready')].join('\n')),
      ...harnessFiles(),
    };
    const rows = ['Dune example.com', 'Neuromancer example.org'];
    const loading = seen('loading', { busy: 1 });
    const ready = seen('ready', { items: rows });
    return {
      good: app,
      bad: app,
      setupGood: (d) => recordRun(d, 'states', 'page.home', [loading, seen('error', { alerts: ["Couldn't load the list Try again"] }), ready]),
      setupBad: (d) => recordRun(d, 'states', 'page.home', [loading, seen('error', { alerts: ["Couldn't load the list Try again"], items: rows }), ready]),
    };
  })(),
  'spec/format': {
    good: { 'docs/app/spec.md': spec() },
    bad: { 'docs/app/spec.md': '# Spec\n\n## 10. Acceptance criteria\n\n### AC-list-1: Save a link\n- Given nothing\n\n### AC-List-2: Delete a link\n- Proven against: local\n' },
  },
  'tests/plan': {
    good: { 'docs/app/spec.md': spec(), 'docs/app/test-plan.md': `# Plan\n\n### TC-list-1: saves\n- AC: AC-list-1\n- Level: component\n- Status: new\n\n${defaults}` },
    bad: { 'docs/app/spec.md': spec(), 'docs/app/test-plan.md': `# Plan\n\n${defaults}` },
  },
  'tests/traceability': {
    good: { 'docs/app/spec.md': spec(), '.fwos/local/results/vitest.xml': xml(tc('saves a link @AC-list-1')) },
    bad: { 'docs/app/spec.md': spec(), '.fwos/local/results/vitest.xml': xml(tc('saves a link @AC-list-1', 'expected the new row first')) },
  },
  'tests/locked': {
    good: { 'apps/web/e2e/list.spec.ts': "test('saves @AC-list-1', async () => {});\n" },
    bad: { 'apps/web/e2e/list.spec.ts': "test('saves @AC-list-1', async () => {});\n" },
    setupGood: (d) => {
      initProject(d);
      lockTests(loadProject(d), ['apps/web/e2e/list.spec.ts'], { evidence: 'existing', slice: 'S1' });
    },
    setupBad: (d) => {
      initProject(d);
      lockTests(loadProject(d), ['apps/web/e2e/list.spec.ts'], { evidence: 'existing', slice: 'S1' });
      writeText(join(d, 'apps/web/e2e/list.spec.ts'), "test.skip('saves @AC-list-1', async () => {});\n");
    },
  },
  // An adopted app's change names the existing tests around it; the bad run has one of them failing.
  'tests/regression': (() => {
    const adopted = {
      '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'adopt', platforms: ['web'], adopt: { level: 'delivery' }, paths: { apps: { web: '.' }, source: ['app/**'] } },
      'docs/app/test-plan.md': '# Test plan\n\n### TC-members-1: search narrows the list\n- AC: AC-members-1\n- Level: component\n- Status: new\n\n## Regression scope\n\n- app/members/members.test.tsx: the list as it is\n',
      'app/members/members.test.tsx': "it('lists members', () => {});\n",
    };
    const run = (failure?: string) => xml(`  <testcase classname="app/members/members.test.tsx" name="lists members"${failure ? `><failure message="${failure}"/></testcase>` : '/>'}`);
    return { good: { ...adopted, '.fwos/local/results/vitest.xml': run() }, bad: { ...adopted, '.fwos/local/results/vitest.xml': run('expected 3 rows, got 2') } };
  })(),
  'build/slices': {
    good: {
      'docs/app/spec.md': spec(),
      'design-system/components.json': { schema: 1, components: [{ id: 'button', status: 'stable', requiredStates: [] }] },
      '.fwos/slices/0001-initial/S1.json': { schema: 1, slice: 'S1', change: '0001-initial', title: 'Save', platform: 'web', modules: ['list'], components: ['button'], acs: ['AC-list-1'] },
    },
    bad: {
      'docs/app/spec.md': spec(),
      'design-system/components.json': { schema: 1, components: [{ id: 'button', status: 'stable', requiredStates: [] }] },
      '.fwos/slices/0001-initial/S1.json': { schema: 1, slice: 'S1', change: '0001-initial', title: 'Save', platform: 'web', modules: ['list'], components: ['fancy-grid'], acs: ['AC-list-9'] },
    },
  },
  'rules/pack': {
    good: { 'apps/web/src/features/stats/chart.tsx': "import { BarChart, Bar } from 'recharts';\nexport { BarChart, Bar };\n" },
    bad: { 'apps/web/src/features/stats/chart.tsx': "import { PieChart, Pie } from 'recharts';\nexport { PieChart, Pie };\n" },
  },
  // The secret scan reads JSON as well as script, and all of packages/*, not only src/.
  'web/security': {
    good: {
      'apps/web/package.json': { name: 'web' },
      'apps/web/next.config.ts': "export default { headers: async () => [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: \"default-src 'self'\" }] }] };\n",
      'apps/web/vercel.json': { build: { env: { NEXT_PUBLIC_MAPS_PUBLIC_KEY: '@maps-public-key' } } },
      'packages/config/env.ts': 'export const maps = process.env.NEXT_PUBLIC_MAPS_PUBLIC_KEY;\n',
    },
    bad: {
      'apps/web/package.json': { name: 'web' },
      'apps/web/next.config.ts': '// TODO: add a Content-Security-Policy header\nexport default {};\n',
      'apps/web/vercel.json': { build: { env: { NEXT_PUBLIC_PAYMENTS_SECRET: '@payments-secret' } } },
      'packages/config/env.ts': 'export const payments = process.env.NEXT_PUBLIC_PAYMENTS_SECRET;\n',
    },
  },
  'web/licences': {
    good: { 'package.json': { name: 'app', dependencies: { tidy: '1.0.0' } }, 'node_modules/tidy/package.json': { name: 'tidy', license: 'MIT' } },
    // grabby is not a direct dependency: tidy pulls it in.
    bad: {
      'package.json': { name: 'app', dependencies: { tidy: '1.0.0' } },
      'node_modules/tidy/package.json': { name: 'tidy', license: 'MIT', dependencies: { grabby: '1.0.0' } },
      'node_modules/grabby/package.json': { name: 'grabby', license: '(MIT AND AGPL-3.0-only)' },
    },
  },
};

export const FIXTURE_DIRS: Record<string, string> = {};
for (const id of Object.keys(FIXTURES)) {
  const [mod, name] = id.split('/') as [string, string];
  FIXTURE_DIRS[id] = mod === 'web' ? join(ROOT, 'platforms/web/checks/fixtures', name) : join(ROOT, 'modules', mod, 'checks/fixtures', name);
}

/** Writes one check's `good/` and `bad/` projects under `base`, replacing what was there. */
function generate(base: string, pair: Pair) {
  rmSync(base, { recursive: true, force: true });
  for (const kind of ['good', 'bad'] as const) {
    const dir = join(base, kind);
    write(dir, pair[kind]);
    const setup = kind === 'good' ? pair.setupGood : pair.setupBad;
    if (setup) setup(dir);
    scrub(dir);
    // Explicit synthetic evidence for planted check fixtures; not a recorded real execution.
    if (loadProject(dir).initialized && existsSync(join(dir, '.fwos/local/results'))) syntheticTestRun(dir);
    rmSync(join(dir, '.fwos/local/log.jsonl'), { force: true });
    rmSync(join(dir, '.fwos/local/lock.json'), { force: true });
    // Only this generator's scratch fixtures: lock leases are machine-local, never fixture input.
    rmSync(join(dir, '.fwos/local/lock-claims'), { recursive: true, force: true });
    rmSync(join(dir, '.fwos/local/lock-owners'), { recursive: true, force: true });
    rmSync(join(dir, '.gitignore'), { force: true });
  }
}

/** Every file under `dir`, dotfiles and node_modules included, as paths relative to it. */
function filesUnder(dir: string, rel = ''): string[] {
  if (!existsSync(join(dir, rel))) return [];
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const path = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? filesUnder(dir, path) : [path];
  });
}

/** Generates every fixture in a scratch folder and lists how the committed ones differ. */
function staleFixtures(): string[] {
  const scratch = mkdtempSync(join(tmpdir(), 'fwos-fixtures-'));
  const stale: string[] = [];
  try {
    for (const [id, pair] of Object.entries(FIXTURES)) {
      const fresh = join(scratch, id);
      generate(fresh, pair);
      const committed = FIXTURE_DIRS[id]!;
      const want = filesUnder(fresh);
      const have = new Set(filesUnder(committed));
      for (const f of want) {
        if (!have.has(f)) stale.push(`${id}: ${f} is missing`);
        else if (!readFileSync(join(fresh, f)).equals(readFileSync(join(committed, f)))) stale.push(`${id}: ${f} differs`);
        have.delete(f);
      }
      for (const f of have) stale.push(`${id}: ${f} is not generated by this script`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return stale;
}


/** Fixed synthetic trace example; rebuilding this record never creates a human approval. */
function refreshTraceExample(check: boolean): boolean {
  const example = new URL('../examples/prove-every-requirement/project/', import.meta.url).pathname;
  const scratch = mkdtempSync(join(tmpdir(), 'fwos-trace-fixture-'));
  const record = '.fwos/local/runs/tests/synthetic-fixture.json';
  try {
    cpSync(example, scratch, { recursive: true, filter: (file) => !file.includes('/.fwos/local') });
    syntheticTestRun(scratch);
    const expected = readFileSync(join(scratch, record));
    const current = existsSync(join(example, record)) ? readFileSync(join(example, record)) : null;
    const same = current !== null && current.equals(expected);
    if (!check && !same) writeText(join(example, record), expected.toString());
    return same;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  if (process.argv.includes('--check')) {
    // CI runs this: the committed fixtures must be exactly what this script writes.
    const stale = staleFixtures();
    if (!refreshTraceExample(true)) stale.push('trace example synthetic run differs');
    for (const s of stale) console.log(s);
    console.log(stale.length > 0 ? '\nThe fixtures are out of date: run pnpm fixtures and commit the result.' : `The fixtures match this script (${Object.keys(FIXTURES).length} checks).`);
    process.exitCode = stale.length > 0 ? 1 : 0;
  } else {
    refreshTraceExample(false);
    for (const [id, pair] of Object.entries(FIXTURES)) {
      generate(FIXTURE_DIRS[id]!, pair);
      console.log(`fixtures for ${id}`);
    }
  }
}
