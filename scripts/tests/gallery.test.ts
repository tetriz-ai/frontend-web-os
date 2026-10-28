// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The comparison gallery, for real, in Chromium. An app fwos scaffolds from the import example's
// shadcn theme, with the contrast correction the example suggests, then the same app with Ember's
// tokens swapped in; and nextjs/saas-starter (the adoption e2e's commit) adopted at level design,
// whose own shadcn components read variables no fwos slot holds. Each run's differences must be
// the ones the design system explains, traced to the row behind them. In saas-starter, which has no
// screens browser, the gallery is also where the team's components render in the states the
// registry asks for: `fwos doctor --start` renders one there before it calls the verify driver
// active, and fwos's state harness catches a state drawn wrong and a dead hit area planted in the
// team's own components, then passes once they're put back. With FWOS_GALLERY_SAMPLES=1 the first
// two runs also write the samples published in examples/*/gallery/. Slow and needs the network, so
// it runs with FWOS_E2E=1 (`pnpm test:e2e`).

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type AddressInfo, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseJUnit, runPath, type FidelityResults } from '../../plugin/kernel/index.ts';
import { CORRECTION, EMBER_SAMPLE, IMPORT_SAMPLE, REPO, correctContrast, publish } from './support/gallery-samples.ts';
import { commitAll, proveDoctor } from './support/truth.ts';

const FWOS = join(REPO, 'plugin/dist/fwos.mjs');
const SAAS = { repo: 'https://github.com/nextjs/saas-starter.git', commit: '6e33e58b1e553a41fe22e6b941a7229a002de361' };
const enabled = process.env.FWOS_E2E === '1';
const samples = process.env.FWOS_GALLERY_SAMPLES === '1';
const made: string[] = [];
const temp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), name));
  made.push(d);
  return d;
};

afterAll(() => {
  if (!enabled || process.env.FWOS_E2E_KEEP) return;
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const env = { ...process.env, CI: '1', NO_COLOR: '1' };
const sh = (cwd: string, cmd: string, ...args: string[]) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env, timeout: 900_000 });
const fwos = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [FWOS, ...args], { cwd, encoding: 'utf8', env });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr };
};
const results = (root: string) => JSON.parse(readFileSync(join(root, '.fwos/local/results/fidelity.json'), 'utf8')) as FidelityResults;
const report = (root: string) => readFileSync(join(root, 'docs/app/reports/design-system.md'), 'utf8');
/** Each distinct difference: component, where, property and the variables behind it. */
const differences = (r: FidelityResults) => [...new Set(r.cells.flatMap((c) => c.differences.map((d) => `${c.component} ${c.mode} ${d.element} ${d.property} <- ${d.causes.join(',') || 'nothing'}`)))].sort();

/** Runs the comparison the way `fwos design-system gallery` says to, on its own port. */
function compare(root: string, command: string, port: number, extra: Record<string, string> = {}): void {
  const [cmd, ...args] = command.split(' ').map((a) => a.replace(/^"|"$/g, ''));
  const r = spawnSync(cmd!, args, { cwd: root, encoding: 'utf8', env: { ...env, FWOS_GALLERY_PORT: String(port), ...extra }, timeout: 1_800_000 });
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
}

describe.runIf(enabled)('the gallery on an app fwos scaffolds', () => {
  const dir = enabled ? temp('fwos-gallery-') : '';

  it('imports the example theme with its contrast correction, scaffolds and installs', () => {
    sh(dir, 'git', 'init', '-q');
    cpSync(join(REPO, 'examples/import-a-shadcn-theme/globals.css'), join(dir, 'globals.css'));
    expect(fwos(dir, 'init', '--name', 'Gallery sample').code).toBe(0);
    expect(fwos(dir, 'design-system', 'init', '--from-shadcn', 'globals.css', '--name', 'shadcn default').code).toBe(0);
    correctContrast(dir);
    expect(fwos(dir, 'scaffold', 'web').code).toBe(0);
    expect(fwos(dir, 'tokens', 'build').code).toBe(0);
    sh(dir, 'pnpm', 'install');
    sh(dir, 'pnpm', '--filter', 'web', 'exec', 'playwright', 'install', 'chromium');
  }, 900_000);

  it('renders both sides, and every difference is the correction, accounted for by its row', () => {
    const g = fwos(dir, 'design-system', 'gallery');
    expect(g.code).toBe(0);
    const command = /Compare both sides in a browser: (.+)/.exec(g.out)![1]!;
    compare(dir, command, 3293);
    const r = results(dir);
    expect(r.errors).toEqual([]);
    expect(r.cells.length).toBeGreaterThan(100);
    // Only the corrected red differs, only in light mode, and the run traces it there.
    const found = differences(r);
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) expect(d).toMatch(/ light .* <- --ds-status-critical-text$/);
    expect(found.some((d) => d.startsWith('button light 0 background-color'))).toBe(true);
    expect(r.cells.every((c) => c.behaviour.every((b) => b.original === b.adopted))).toBe(true);
    // Decided, the correction is intentional; the rest of the adoption still waits on decisions.
    expect(fwos(dir, 'design-system', 'decide', 'status.critical.text', '--as', 'intentional', '--reason', CORRECTION.reason, '--by', CORRECTION.by).code).toBe(0);
    const out = fwos(dir, 'design-system', 'report').out;
    expect(out).toMatch(/Token validity {5}FAIL/);
    expect(out).toMatch(/Generated CSS {6}current/);
    expect(out).toMatch(/Fidelity {11}unresolved/);
    const md = report(dir);
    expect(md).toMatch(/Intentional: \d+ differences?, accounted for by a row someone decided\./);
    expect(md).toContain('Unresolved: 0 differences wait on a decision.');
    expect(md).toContain('`status.critical.text` (changed), intentional: approved contrast correction');
    if (samples) publish(dir, IMPORT_SAMPLE);
  }, 1_800_000);

  it('swaps in Ember, and renders the same on both sides: its tokens are its source', () => {
    rmSync(join(dir, 'design-system'), { recursive: true });
    rmSync(join(dir, '.fwos/fidelity.json'), { force: true });
    cpSync(join(REPO, 'examples/swap-in-a-design-system/ember'), join(dir, 'design-system'), { recursive: true });
    expect(fwos(dir, 'tokens', 'build').code).toBe(0);
    const g = fwos(dir, 'design-system', 'gallery');
    expect(g.code).toBe(0);
    compare(dir, /Compare both sides in a browser: (.+)/.exec(g.out)![1]!, 3294);
    const r = results(dir);
    expect(r.errors).toEqual([]);
    expect(differences(r)).toEqual([]);
    const out = fwos(dir, 'design-system', 'report').out;
    expect(out).toMatch(/Token validity {5}PASS/);
    expect(out).toMatch(/Adoption coverage {2}partial {7}slots: 31 preserved, 30 defaulted; 2 source entries not consumed; components: 9 fwos starter/);
    expect(report(dir)).toContain('Faithful: every one of the');
    if (samples) publish(dir, EMBER_SAMPLE);
  }, 1_800_000);
});

describe.runIf(enabled)(`the gallery on an adopted app (${SAAS.repo} at ${SAAS.commit.slice(0, 7)})`, () => {
  const dir = enabled ? temp('fwos-gallery-adopt-') : '';
  // The app's root layout reads the database module, which wants these set; no page here queries it.
  const appEnv = { POSTGRES_URL: 'postgres://fwos:fwos@127.0.0.1:5999/fwos', AUTH_SECRET: 'fwos-gallery-e2e' };

  it('fetches the pinned app, installs it, and adopts it at level design', () => {
    sh(dir, 'git', 'init', '-q');
    sh(dir, 'git', 'fetch', '-q', '--depth', '1', SAAS.repo, SAAS.commit);
    sh(dir, 'git', 'checkout', '-q', 'FETCH_HEAD');
    sh(dir, 'pnpm', 'install', '--frozen-lockfile', '--ignore-scripts');
    expect(fwos(dir, 'adopt', '--name', 'SaaS starter', '--level', 'design', '--yes').code).toBe(0);
    expect(readFileSync(join(dir, 'design-system/source/globals.css'), 'utf8')).toBe(readFileSync(join(dir, 'app/globals.css'), 'utf8'));
  }, 900_000);

  it("reads the app's own components: their variants, states and interactions", () => {
    expect(fwos(dir, 'design-system', 'report').code).toBe(0);
    const md = report(dir);
    expect(md).toContain('| `button` | components/ui/button.tsx (Button, buttonVariants) | `button` (yours, components/ui/button.tsx) | variant: default, destructive, outline, secondary, ghost, link; size: default, sm, lg, icon | disabled, invalid | press, hover, focus | preserved: yours, reused as it is |');
    expect(md).toMatch(/\| `dropdown-menu` \|.*\| open, focus \| preserved/);
    expect(md).toMatch(/\| `radio-group` \|.*\| check, focus \| preserved/);
  });

  it('finds what the adopted tokens lose on your own components, and names the variable', async () => {
    // Playwright in the app, the way the gallery command asks for it.
    sh(dir, 'pnpm', 'add', '-D', '@playwright/test@1.64.1');
    sh(dir, 'pnpm', 'exec', 'playwright', 'install', 'chromium');
    const [warmupPort] = await freePorts(1);
    writeFileSync(join(dir, 'playwright.config.ts'), teamConfig(warmupPort!));
    // Give doctor an actual component fixture so its warmup must render the adopted app.
    const registryFile = join(dir, 'design-system/components.json');
    const registry = JSON.parse(readFileSync(registryFile, 'utf8')) as { components: { id: string; requiredStates: string[] }[] };
    registry.components.find((component) => component.id === 'button')!.requiredStates = ['default'];
    writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    expect(fwos(dir, 'design-system', 'gallery').code).toBe(0);
    // Next's first boot updates tsconfig.json. Render once, then bind the gallery to those
    // stabilized inputs before the single comparison; configuration stays part of freshness.
    const warmup = spawnSync(process.execPath, [FWOS, 'doctor', '--start', '--json'], { cwd: dir, encoding: 'utf8', env: { ...env, ...appEnv }, timeout: 600_000 });
    expect(warmup.status, `${warmup.stdout}\n${warmup.stderr}`).toBe(0);
    const verify = (JSON.parse(warmup.stdout) as { adapters: { web: { adapter: string; active: string | null; note?: string }[] } }).adapters.web.find((adapter) => adapter.adapter === 'verify')!;
    expect(verify.active, verify.note).toMatch(/^rendered component button "default" at \/fwos-screens\/fwos-gallery\?fixture=button&state=default \(next dev, chromium [\d.]+\)$/);
    const g = fwos(dir, 'design-system', 'gallery');
    expect(g.code).toBe(0);
    compare(dir, /Compare both sides in a browser: (.+)/.exec(g.out)![1]!, 3295, appEnv);
    const r = results(dir);
    expect(r.errors).toEqual([]);
    const found = differences(r);
    // shadcn's popover and secondary-foreground have no fwos slot: an open menu loses its
    // background, and the secondary button its text colour in light mode.
    expect(found).toEqual(expect.arrayContaining(['dropdown-menu light open:0 background-color <- --popover', 'dropdown-menu dark open:0 background-color <- --popover', 'button light 0 color <- --secondary-foreground']));
    for (const d of found) expect(d).not.toMatch(/<- nothing$/);
    expect(fwos(dir, 'design-system', 'report').code).toBe(0);
    const md = report(dir);
    expect(md).toContain('`--popover` (unsupported), needs a decision');
    // Decided, they are intentional; nothing else differs.
    expect(fwos(dir, 'design-system', 'decide', 'unsupported', '--as', 'intentional', '--reason', 'fwos has no popover or secondary text slot', '--by', 'e2e').code).toBe(0);
    fwos(dir, 'design-system', 'report');
    expect(report(dir)).toContain('Unresolved: 0 differences wait on a decision.');
  }, 1_800_000);

  it("renders the team's components in the states they ask for through the gallery, and fwos's harness catches a state drawn wrong and a dead hit area there", async () => {
    // The team asks for two states of its button and the default of its card.
    const file = join(dir, 'design-system/components.json');
    const registry = JSON.parse(readFileSync(file, 'utf8')) as { components: { id: string; requiredStates: string[] }[] };
    for (const c of registry.components) c.requiredStates = c.id === 'button' ? ['default', 'disabled'] : c.id === 'card' ? ['default'] : c.requiredStates;
    writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`);
    expect(fwos(dir, 'design-system', 'gallery').code).toBe(0);
    // The team runs Playwright with a config of its own; fwos's harness goes beside their tests, which only check that each fixture shows.
    const [port] = await freePorts(1);
    writeFileSync(join(dir, 'playwright.config.ts'), teamConfig(port!));
    mkdirSync(join(dir, 'e2e'), { recursive: true });
    writeFileSync(join(dir, 'e2e/states.spec.ts'), TEAM_STATE_TESTS);
    const packageFile = join(dir, 'package.json');
    const pkg = JSON.parse(readFileSync(packageFile, 'utf8'));
    writeFileSync(packageFile, JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, 'e2e:fwos-states': 'playwright test' } }, null, 2) + '\n');
    sh(dir, process.execPath, FWOS, 'vendor');
    sh(dir, 'pnpm', 'add', '-D', '--ignore-scripts', 'file:.fwos/cli');
    expect(fwos(dir, 'harness').code).toBe(0);
    // No screens browser here: doctor starts the app, renders the first state through the gallery, and claims only what those states can show.
    const doctor = spawnSync(process.execPath, [FWOS, 'doctor', '--start', '--json'], { cwd: dir, encoding: 'utf8', env: { ...env, ...appEnv }, timeout: 600_000 });
    const verify = (JSON.parse(doctor.stdout) as { adapters: { web: { adapter: string; active: string | null; catches?: string; note?: string }[] } }).adapters.web.find((a) => a.adapter === 'verify')!;
    expect(verify.active, verify.note).toMatch(/^rendered component button "default" at \/fwos-screens\/fwos-gallery\?fixture=button&state=default \(next dev, chromium [\d.]+\)$/);
    expect(verify.catches).toBe('a state that renders wrong (another state under its name) and a hover with a dead hit area');
    const e2e = () => {
      const ran = spawnSync(process.execPath, [FWOS, 'tests', 'run', 'e2e:fwos-states'], { cwd: dir, encoding: 'utf8', env: { ...env, ...appEnv }, timeout: 900_000 });
      const record = JSON.parse(readFileSync(join(dir, runPath('tests', 'e2e:fwos-states')), 'utf8'));
      const cases = record.observations.results.flatMap((file: string) => parseJUnit(readFileSync(join(dir, file), 'utf8'), file));
      return { ...ran, runnerExit: record.observations.exit, cases };
    };
    const clean = e2e();
    expect(clean.status, `${clean.stdout}\n${clean.stderr}`).toBe(0);
    expect(clean.runnerExit).toBe(0);
    expect(check(dir, 'design-system/required-states')).toMatchObject({ status: 'pass', findings: [] });
    commitAll(dir);

    // Planted: the button drops `disabled`, so its disabled state draws the default one, and the card paints on hover with nothing to click.
    edit(dir, 'components/ui/button.tsx', '  asChild = false,\n  ...props\n}', '  asChild = false,\n  disabled: _disabled,\n  ...props\n}');
    edit(dir, 'components/ui/card.tsx', '"bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",', '"bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm cursor-pointer hover:bg-accent",');
    const planted = e2e();
    expect(planted.status, planted.stdout).toBe(1);
    expect(planted.runnerExit).toBe(1);
    // The team's tagged tests still pass; fwos's harness fails on both components.
    expect(planted.cases).toContainEqual(expect.objectContaining({ status: 'passed', name: 'button renders @state:button:disabled' }));
    expect(planted.stdout).toMatch(/component button renders each state as its contract says/);
    expect(planted.stdout).toMatch(/component card renders each state as its contract says/);
    const r = check(dir, 'design-system/required-states');
    expect(r.status).toBe('fail');
    const messages = r.findings.map((f) => f.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe('button "disabled" state: no disabled control; renders exactly as "default", so the fixture ignores its state. A "disabled" state renders a disabled control');
    expect(messages[1]).toMatch(/^card "default" state: hovering "Card title A line that describes it Card content Footer" paints it \((?:background-color, )?cursor: pointer\), but a click on it does nothing\. In any state, /);

    // The clean control: both put back, and the harness passes again.
    sh(dir, 'git', 'checkout', '--', 'components/ui/button.tsx', 'components/ui/card.tsx');
    const fixed = e2e();
    expect(fixed.status, fixed.stdout).toBe(0);
    expect(fixed.runnerExit).toBe(0);
    expect(check(dir, 'design-system/required-states')).toMatchObject({ status: 'pass', findings: [] });
    // And every check doctor calls ON here, the rendered states among them, still catches its planted violation.
    commitAll(dir);
    const truth = proveDoctor(dir);
    expect(truth.problems).toEqual([]);
    expect(truth.on).toContain('design-system/required-states');
    expect(truth.proven).toEqual(truth.on);
  }, 1_800_000);
});

/** Ports nothing listens on. */
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

/** One check's result from `fwos check --json`. */
const check = (cwd: string, id: string) =>
  (JSON.parse(fwos(cwd, 'check', id, '--json').out) as { results: { id: string; status: string; findings: { message: string }[] }[] }).results.find((r) => r.id === id)!;

/** Replaces `from`, which occurs exactly once, with `to` in a file of the app. */
function edit(root: string, rel: string, from: string, to: string): void {
  const text = readFileSync(join(root, rel), 'utf8');
  expect(text.split(from).length - 1, `${rel}: ${from}`).toBe(1);
  writeFileSync(join(root, rel), text.replace(from, () => to));
}

/** The Playwright config a team might write: its own port, next dev, and the screens browser on for fwos's harness. */
const teamConfig = (port: number) => `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  retries: 0,
  reporter: [['list'], ['junit', { outputFile: '.fwos/local/results/e2e.xml' }]],
  use: { baseURL: 'http://localhost:${port}' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev --port ${port}',
    url: 'http://localhost:${port}',
    reuseExistingServer: false,
    timeout: 300_000,
    env: { FWOS_SCREENS: '1' },
  },
});
`;

/** The team's tests of their states, tagged as fwos asks: they check each fixture shows, not what it shows. */
const TEAM_STATE_TESTS = `import { expect, test } from '@playwright/test';

for (const [id, state] of [['button', 'default'], ['button', 'disabled'], ['card', 'default']]) {
  test(\`\${id} renders @state:\${id}:\${state}\`, async ({ page }) => {
    await page.goto(\`/fwos-screens/fwos-gallery?fixture=\${id}&state=\${state}\`);
    await expect(page.locator('[data-fwos-fixture]')).toBeVisible();
  });
}
`;
