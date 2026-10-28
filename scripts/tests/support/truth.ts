// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// "doctor tells the truth": for every check `fwos doctor` calls ON in a project, plant a violation
// it should catch and prove `fwos check` fails. A check doctor calls ON that no plant can trip is
// a check that would pass a broken app, which is worse than one that says it's OFF. Each check id
// needs an entry here, so a new check can't ship without a way to prove it.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { syntheticTestRun } from '../../../plugin/kernel/testing.ts';
import { loadProject, type IaRun, type StateObservation } from '../../../plugin/kernel/index.ts';
import { loadDesignSystem, tokenOutputs } from '../../../plugin/modules/design-system/index.ts';
import { type Ia, visibleUnder } from '../../../plugin/modules/screens/index.ts';

export const FWOS = new URL('../../../plugin/dist/fwos.mjs', import.meta.url).pathname;

interface CheckJson {
  id: string;
  status: 'pass' | 'fail' | 'off';
  reason?: string;
  findings: { file?: string; message: string }[];
}
interface DoctorJson {
  adapters: Record<string, { adapter: string; loaded: boolean; matched: string | null; active: string | null; catches?: string }[]>;
  checks: { id: string; on: boolean; reason?: string }[];
}

/** Runs the bundled CLI in `root`. A failing check exits 1; its JSON is still the answer. */
export function fwos(root: string, ...args: string[]): string {
  try {
    return execFileSync(process.execPath, [FWOS, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
  } catch (e) {
    const out = (e as { stdout?: string }).stdout;
    if (out) return out;
    throw e;
  }
}

function checkOne(root: string, id: string): CheckJson {
  const all = JSON.parse(fwos(root, 'check', id, '--json')) as { results: CheckJson[] };
  const r = all.results.find((x) => x.id === id);
  if (!r) throw new Error(`fwos check ${id} didn't report ${id}`);
  return r;
}

export class Ctx {
  readonly root: string;
  readonly written = new Set<string>();
  readonly originals = new Map<string, Buffer | null>();
  remember(rel: string) { if (!this.originals.has(rel)) this.originals.set(rel, this.exists(rel) ? readFileSync(this.abs(rel)) : null); }
  constructor(root: string) {
    this.root = root;
  }
  abs = (rel: string) => join(this.root, rel);
  exists = (rel: string) => existsSync(this.abs(rel));
  read = (rel: string) => readFileSync(this.abs(rel), 'utf8');
  write(rel: string, text: string) {
    this.remember(rel);
    mkdirSync(dirname(this.abs(rel)), { recursive: true });
    writeFileSync(this.abs(rel), text);
    this.written.add(rel);
  }
  append = (rel: string, text: string) => this.write(rel, this.read(rel) + text);
  json = <T = any>(rel: string): T => JSON.parse(this.read(rel)) as T;
  writeJson = (rel: string, v: unknown) => this.write(rel, `${JSON.stringify(v, null, 2)}\n`);
  /** `.fwos/state.json` paths, over the defaults the CLI uses. */
  get paths() {
    const p = this.json<{ paths?: { apps?: { web?: string }; ui?: { web?: string }; docs?: string; designSystem?: string; contract?: string } }>('.fwos/state.json').paths ?? {};
    const app = p.apps?.web ?? 'apps/web';
    return {
      app,
      ui: p.ui?.web ?? posix.join(app, 'src/shared/ui'),
      docs: p.docs ?? 'docs/app',
      ds: p.designSystem ?? 'design-system',
      contract: p.contract ?? 'packages/api-contract',
    };
  }
  /** A folder of app source where a planted file is scanned: next to the UI components folder. */
  get srcDir() {
    return posix.dirname(this.paths.ui);
  }
  /** The App Router folder. */
  get routesDir() {
    const { app } = this.paths;
    for (const d of ['app', 'src/app']) if (this.exists(posix.join(app, d))) return posix.join(app, d);
    throw new Error(`no app router folder in ${app}`);
  }
  /** Files under a folder (relative to the root), recursively. */
  list(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(this.abs(d), { withFileTypes: true })) {
        const rel = posix.join(d, e.name);
        if (e.isDirectory()) walk(rel);
        else out.push(rel);
      }
    };
    if (this.exists(dir)) walk(dir);
    return out.sort();
  }
}

/** A colour token's value in the DTCG files: finds `path` (dot-separated) in any token file that has it. */
function tokenFiles(c: Ctx): string[] {
  return c.list(posix.join(c.paths.ds, 'tokens')).filter((f) => f.endsWith('.json'));
}
function getAt(obj: any, path: string[]): any {
  return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
/**
 * The token a colour slot reads in this pack: the one design-system.json maps it to in `slots`, or
 * fwos's default name (`color.<slot>`). A pack with its own token names keeps them there.
 */
function slotToken(c: Ctx, slot: string): string {
  return c.json<{ slots?: Record<string, string> }>(posix.join(c.paths.ds, 'design-system.json')).slots?.[slot] ?? `color.${slot}`;
}
/** Sets slot `to`'s token to slot `from`'s value in every token file that has both. Returns how many files changed. */
function copySlot(c: Ctx, from: string, to: string): number {
  const [src, dst] = [slotToken(c, from), slotToken(c, to)];
  let n = 0;
  for (const f of tokenFiles(c)) {
    const doc = c.json(f);
    const a = getAt(doc, src.split('.'));
    const b = getAt(doc, dst.split('.'));
    if (a?.$value === undefined || b === undefined) continue;
    b.$value = structuredClone(a.$value);
    c.writeJson(f, doc);
    n++;
  }
  if (n === 0) throw new Error(`no token file sets both ${src} (${from}) and ${dst} (${to})`);
  return n;
}
/**
 * Changes the colour behind surface.base slightly, so the CSS that slot generates changes: in the
 * first token file that sets its token, following aliases (`{palette.sand.0}`) to the colour itself,
 * a DTCG colour object or a hex string.
 */
function nudgeAColour(c: Ctx): void {
  let path = slotToken(c, 'surface.base');
  for (let hop = 0; hop < 10; hop++) {
    const f = tokenFiles(c).find((x) => getAt(c.json(x), path.split('.'))?.$value !== undefined);
    if (!f) break;
    const doc = c.json(f);
    const token = getAt(doc, path.split('.'));
    const v = token.$value;
    if (typeof v === 'string' && /^\{[^{}]+\}$/.test(v)) {
      path = v.slice(1, -1);
      continue;
    }
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) {
      const last = Number.parseInt(v.slice(5), 16);
      token.$value = `${v.slice(0, 5)}${(last > 0 ? last - 1 : 1).toString(16).padStart(2, '0')}`;
      return c.writeJson(f, doc);
    }
    if (v?.hex && Array.isArray(v.components)) {
      v.components = v.components.map((x: number) => Math.min(1, Math.max(0, x === 0 ? 0.0039 : x - 0.0039)));
      v.hex = '#' + v.components.map((x: number) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
      return c.writeJson(f, doc);
    }
    break;
  }
  throw new Error(`no colour behind surface.base (${path}) to change`);
}
/** A first-release AC appended to the spec, which no test plan case and no test result covers. */
function addUnprovenAc(c: Ctx): void {
  const spec = posix.join(c.paths.docs, 'spec.md');
  const id = (c.read(spec).match(/### (AC-[a-z0-9]+)-\d+:/) ?? [])[1] ?? 'AC-planted';
  c.append(spec, `\n### ${id}-99: A planted requirement nothing proves\n- Journey: J1\n- Given the list, when I do the planted thing, then the planted result shows.\n- Proven against: local\n- Release: first\n`);
}

export interface Plant {
  /** What the violation is, as the report names it. */
  what: string;
  plant(c: Ctx): void;
}

export const PLANTS: Record<string, Plant> = {
  'state/schema': {
    what: 'a .fwos/state.json from an unsupported schema version',
    plant: (c) => c.writeJson('.fwos/state.json', { ...c.json<Record<string, unknown>>('.fwos/state.json'), schema: 99 }),
  },
  'state/owned': {
    what: 'a generated file edited by hand',
    plant(c) {
      const listed = () => Object.keys(c.json<{ files: Record<string, unknown> }>('.fwos/manifest.json').files).filter((f) => c.exists(f));
      // Nothing generated yet (an adopted app): generate the token CSS first, as the design-system step would.
      if (listed().length === 0) {
        c.remember('.fwos/manifest.json');
        const project = loadProject(c.root);
        const designSystem = loadDesignSystem(project);
        if (!designSystem) throw new Error('no design system for the generated-file probe');
        for (const output of tokenOutputs(project, designSystem)) c.remember(output.path);
        fwos(c.root, 'tokens', 'build');
        for (const f of listed()) c.written.add(f);
        c.written.add('.fwos/manifest.json');
      }
      const first = listed()[0];
      if (!first) throw new Error('fwos generated no file to edit');
      c.append(first, '\n/* edited by hand */\n');
    },
  },
  'state/approvals': {
    what: 'the approved brief changed after its approval',
    plant: (c) => c.append(posix.join(c.paths.docs, 'brief.md'), '\nA planted sentence nobody approved.\n'),
  },
  'design-system/schema': {
    what: 'a design system from an unsupported schema version',
    plant(c) {
      const f = posix.join(c.paths.ds, 'design-system.json');
      c.writeJson(f, { ...c.json<Record<string, unknown>>(f), schema: 99 });
    },
  },
  'design-system/contrast': {
    what: 'primary text the same colour as the surface it sits on',
    plant: (c) => copySlot(c, 'surface.base', 'text.primary'),
  },
  'design-system/chart-palette': {
    what: 'two chart colours the same',
    plant: (c) => copySlot(c, 'chart.1', 'chart.2'),
  },
  'design-system/tokens': {
    what: 'a raw hex colour in app source',
    plant: (c) => c.write(posix.join(c.srcDir, 'fwos-planted-colour.tsx'), "export const Planted = () => <p style={{ color: '#ff0033' }}>planted</p>;\n"),
  },
  'design-system/generated': {
    what: 'a token changed without regenerating the CSS',
    plant: nudgeAColour,
  },
  'design-system/registry': {
    what: 'an installed component missing from components.json',
    plant: (c) => c.write(posix.join(c.paths.ui, 'fwos-planted-widget.tsx'), 'export function FwosPlantedWidget() {\n  return null;\n}\n'),
  },
  'design-system/required-states': {
    what: 'a required state no test renders',
    plant(c) {
      const f = posix.join(c.paths.ds, 'components.json');
      const doc = c.json<{ components: { requiredStates?: string[] }[] }>(f);
      const comp = doc.components.find((x) => x.requiredStates) ?? doc.components[0];
      if (!comp) throw new Error('components.json registers no component');
      comp.requiredStates = [...(comp.requiredStates ?? []), 'planted-state'];
      c.writeJson(f, doc);
    },
  },
  'architecture/walls': {
    what: 'a module importing another module it doesn\'t depend on',
    plant(c) {
      const map = c.json<{ modules: { name: string; path: string; dependsOn: string[] }[] }>(posix.join(c.paths.docs, 'modules.json'));
      for (const a of map.modules) {
        const b = map.modules.find((m) => m !== a && !a.dependsOn.includes(m.name) && !m.path.startsWith(`${a.path}/`) && !a.path.startsWith(`${m.path}/`));
        if (!b) continue;
        c.write(posix.join(b.path, 'fwos-planted-target.ts'), 'export const target = 1;\n');
        const rel = relative(a.path, posix.join(b.path, 'fwos-planted-target')).split('\\').join('/');
        c.write(posix.join(a.path, 'fwos-planted-import.ts'), `import { target } from '${rel.startsWith('.') ? rel : `./${rel}`}';\nexport const planted = target;\n`);
        return;
      }
      throw new Error('every module may import every other');
    },
  },
  'architecture/contract': {
    what: 'a fixture for an operation the contract doesn\'t declare',
    plant: (c) => c.writeJson(posix.join(c.paths.contract, 'fixtures', 'fwosPlantedOperation.default.json'), { status: 200, body: {} }),
  },
  'architecture/mocks': {
    what: 'an operation moved to another path without regenerating the mocks',
    plant(c) {
      const f = ['openapi.yaml', 'openapi.yml'].map((n) => posix.join(c.paths.contract, n)).find((x) => c.exists(x));
      if (!f) throw new Error(`no openapi.yaml in ${c.paths.contract}`);
      const before = c.read(f);
      const after = before.replace(/^(paths:[ \t]*\r?\n[ \t]+)\//m, '$1/fwos-planted/');
      if (after === before) throw new Error(`no path to move in ${f}`);
      c.write(f, after);
    },
  },
  'screens/ia': {
    what: 'a page the app exposes that ia.json doesn\'t list',
    plant: (c) => c.write(posix.join(c.routesDir, 'fwos-planted', 'page.tsx'), 'export default function Planted() {\n  return null;\n}\n'),
  },
  'screens/states': {
    what: 'a page state no test proves',
    plant(c) {
      const f = posix.join(c.paths.docs, 'ia.json');
      const doc = c.json<{ pages: { states?: string[] }[] }>(f);
      const page = doc.pages.find((p) => p.states) ?? doc.pages[0];
      if (!page) throw new Error('ia.json lists no page');
      page.states = [...(page.states ?? []), 'planted-state'];
      c.writeJson(f, doc);
    },
  },
  'spec/format': {
    what: 'two acceptance criteria with the same ID',
    plant(c) {
      const spec = posix.join(c.paths.docs, 'spec.md');
      const block = c.read(spec).match(/### AC-[^\n]+\n(?:- [^\n]*\n)+/);
      if (!block) throw new Error('no AC block in the spec');
      c.append(spec, `\n${block[0]}`);
    },
  },
  'tests/plan': { what: 'a first-release AC with no case in the test plan', plant: addUnprovenAc },
  'tests/traceability': { what: 'a first-release AC no passing test proves', plant: addUnprovenAc },
  'tests/locked': {
    what: 'a locked test edited without an unlock',
    plant(c) {
      // Each change records its locked tests (path -> hash) in .fwos/changes/<id>.json.
      for (const f of c.list('.fwos/changes').filter((x) => x.endsWith('.json'))) {
        const first = Object.keys(c.json<{ lockedTests?: Record<string, unknown> }>(f).lockedTests ?? {}).find((t) => c.exists(t));
        if (first) return c.append(first, '\n// edited after locking\n');
      }
      throw new Error('no change records a locked test that exists');
    },
  },
  'tests/regression': {
    what: 'a failing test in the regression scope',
    plant(c) {
      const plan = c.read(posix.join(c.paths.docs, 'test-plan.md'));
      const scope = plan.split(/^#{1,6}\s+regression scope\b.*$/im)[1] ?? '';
      const path = /^\s*[-*]\s+`?([^\s`:]+)/m.exec(scope)?.[1];
      if (!path) throw new Error('the test plan names no regression test');
      c.write('.fwos/local/results/fwos-planted-regression.xml', `<testsuite><testcase classname="${path}" name="planted"><failure message="a planted regression"/></testcase></testsuite>\n`);
      c.remember('.fwos/local/runs/tests/synthetic-fixture.json');
      c.written.add('.fwos/local/runs/tests/synthetic-fixture.json');
      syntheticTestRun(c.root);
    },
  },
  'build/slices': {
    what: 'a slice manifest that no longer parses',
    plant(c) {
      const s = c.list('.fwos/slices').find((f) => f.endsWith('.json'));
      if (!s) throw new Error('no slice manifest');
      c.write(s, '{ "planted": ');
    },
  },
  'rules/pack': {
    what: 'raw HTML injection (dangerouslySetInnerHTML)',
    plant: (c) => c.write(posix.join(c.srcDir, 'fwos-planted-html.tsx'), "export const Planted = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;\n"),
  },
  'web/security': {
    what: 'a secret-looking NEXT_PUBLIC_ variable',
    // Built at run time, so the secret scanner over this repo doesn't flag the test itself.
    plant: (c) => c.write(posix.join(c.srcDir, 'fwos-planted-env.ts'), `export const key = process.env.${['NEXT', 'PUBLIC', 'API', 'SECRET'].join('_')};\n`),
  },
  'web/licences': {
    what: 'a runtime dependency under the AGPL',
    plant(c) {
      const pkgPath = posix.join(c.paths.app, 'package.json');
      const pkg = c.json<{ dependencies?: Record<string, string> }>(pkgPath);
      c.writeJson(pkgPath, { ...pkg, dependencies: { ...pkg.dependencies, 'fwos-planted-agpl': '1.0.0' } });
      for (const dir of [posix.join(c.paths.app, 'node_modules'), 'node_modules']) {
        if (c.exists(dir)) c.writeJson(posix.join(dir, 'fwos-planted-agpl', 'package.json'), { name: 'fwos-planted-agpl', version: '1.0.0', license: 'AGPL-3.0-only' });
      }
    },
  },
};

export interface TruthReport {
  on: string[];
  proven: string[];
  problems: string[];
}

/**
 * Proves doctor's ON/OFF calls in a git repo at `root` whose working tree is clean: each ON check
 * passes as it is, fails once its violation is planted, and the tree is reset in between.
 */
export function proveDoctor(root: string): TruthReport {
  const doctor = JSON.parse(fwos(root, 'doctor', '--json')) as DoctorJson;
  const problems: string[] = [];
  for (const [platform, rows] of Object.entries(doctor.adapters)) {
    for (const a of rows) {
      if (a.active && !a.matched) problems.push(`${platform} ${a.adapter} adapter is active (${a.active}) without matching any app data`);
      if (a.matched && !a.loaded) problems.push(`${platform} ${a.adapter} adapter matched app data without being loaded`);
      // What an adapter claims to catch is the claim its planted defects must prove: never without it running.
      if (a.catches && !a.active) problems.push(`${platform} ${a.adapter} adapter claims to catch ${a.catches} without being active`);
    }
  }
  for (const c of doctor.checks) if (!c.on && !c.reason) problems.push(`${c.id} is OFF without saying why`);

  const on = doctor.checks.filter((c) => c.on).map((c) => c.id);
  const proven: string[] = [];
  for (const id of on) {
    const p = PLANTS[id];
    if (!p) {
      problems.push(`doctor calls ${id} ON, but there's no planted violation to prove it (add one to scripts/tests/support/truth.ts)`);
      continue;
    }
    const before = checkOne(root, id);
    if (before.status !== 'pass') {
      problems.push(`${id} is ON but doesn't pass before anything is planted: ${before.findings[0]?.message ?? before.reason ?? before.status}`);
      continue;
    }
    const c = new Ctx(root);
    try {
      p.plant(c);
      const after = checkOne(root, id);
      if (after.status === 'fail') proven.push(id);
      else problems.push(`doctor calls ${id} ON, but it missed ${p.what} (${after.status}${after.reason ? `: ${after.reason}` : ''})`);
    } catch (e) {
      problems.push(`${id}: couldn't plant ${p.what}: ${(e as Error).message}`);
    } finally {
      reset(root, c);
    }
  }
  return { on, proven, problems };
}

/** Restore only this case's named mutation journal; never discard a project tree. */
function reset(root: string, journal: Ctx): void {
  for (const rel of journal.written) {
    if (journal.originals.has(rel)) {
      const bytes = journal.originals.get(rel)!;
      if (bytes === null) rmSync(join(root, rel), { force: true });
      else { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), bytes); }
      continue;
    }
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (tracked.status === 0) {
      const bytes = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root });
      mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), bytes);
    } else rmSync(join(root, rel), { force: true });
  }
}

/**
 * JUnit results for an app whose tests aren't run here: every test title that carries a tag
 * (`@AC-x-1`, `@TC-...`, `@state:...`) as a pass. It stands in for the green run CI's Examples
 * job proves, so the checks that read results are ON and can be proven.
 */
export function passingResultsFromTitles(root: string, dir = '.'): number {
  const c = new Ctx(root);
  const titles = c
    .list(dir)
    .filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) && !f.includes('node_modules/'))
    .flatMap((f) => [...c.read(f).matchAll(/\b(?:it|test)\(\s*(['"`])((?:(?!\1).)*@(?:(?!\1).)*)\1/g)].map((m) => m[2]!));
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const cases = titles.map((t) => `<testcase classname="stand-in" name="${esc(t)}"/>`).join('');
  c.write('.fwos/local/results/stand-in.xml', `<testsuites><testsuite name="stand-in">${cases}</testsuite></testsuites>\n`);
  syntheticTestRun(root);
  return titles.length;
}

/** What a fixture that renders its state right shows, by the state's name: a stand-in for the harness's eyes. */
function rightRender(state: string): StateObservation {
  const seen: StateObservation = { state, status: 200, found: true, nodes: 3, text: `stand-in ${state}`, busy: 0, alerts: [], statuses: [], items: [], disabled: 0, invalid: 0 };
  if (state === 'loading') return { ...seen, busy: 1 };
  if (['error', 'critical'].includes(state)) return { ...seen, alerts: [state] };
  if (['empty', 'zero', 'filtered', 'filtered-empty', 'info', 'offline', 'no-permission'].includes(state)) return { ...seen, statuses: [state] };
  if (state === 'partial') return { ...seen, statuses: [state], items: [`${state} row`] };
  if (state === 'disabled') return { ...seen, disabled: 1 };
  if (state === 'invalid') return { ...seen, invalid: 1 };
  return seen;
}

/**
 * Run records for an app whose harness isn't run here: every state fixture rendering right and every
 * role and flag setting seeing what ia.json says, kept through `fwos harness record` on the code as
 * it is. Like passingResultsFromTitles, it stands in for the green run CI's Examples job proves, so
 * the state and IA checks are ON and can be proven.
 */
export function passingRunsFromTargets(root: string): number {
  const record = (kind: string, target: string, revision: string, observations: unknown) => {
    const r = spawnSync(process.execPath, [FWOS, 'harness', 'record', kind, target, '--revision', revision], { cwd: root, input: JSON.stringify({ config: { server: 'stand-in' }, observations }), encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`fwos harness record ${kind} ${target}: ${r.stdout}${r.stderr}`);
  };
  const states = JSON.parse(fwos(root, 'harness', 'targets', 'states')) as { revision: string; targets: { key: string; states: string[] }[] };
  for (const t of states.targets) record('states', t.key, states.revision, t.states.map(rightRender));
  const ia = JSON.parse(new Ctx(root).read(posix.join(new Ctx(root).paths.docs, 'ia.json'))) as Ia;
  const plan = JSON.parse(fwos(root, 'harness', 'targets', 'ia')) as { revision: string; runs: { key: string; role: string; flags: string[] }[]; visits: { page: string; path: string }[] };
  for (const r of plan.runs) {
    const flags = Object.fromEntries((ia.flags ?? []).map((f) => [f, r.flags.includes(f)]));
    const sees = (id: string) => visibleUnder(ia, ia.pages.find((p) => p.id === id)!, r.role, flags);
    const run: IaRun = {
      role: r.role,
      flags: r.flags,
      applied: true,
      nav: ia.pages.filter((p) => p.kind === 'nav' && p.route && !p.route.includes('[') && sees(p.id)).map((p) => p.route!),
      visits: plan.visits.map((v) => ({ page: v.page, path: v.path, status: sees(v.page) ? 200 : 404, finalPath: v.path, notFound: !sees(v.page) })),
    };
    record('ia', r.key, plan.revision, run);
  }
  return states.targets.length + plan.runs.length;
}

/** A git repo with everything committed, so planted changes can be undone. */
export function commitAll(root: string): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  if (!existsSync(join(root, '.git'))) git('init', '-q');
  git('add', '-A');
  git('-c', 'user.name=fwos test', '-c', 'user.email=fwos@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'fwos truth baseline');
}

/** Restore one explicitly named proof-case journal; exposed only to helper regressions. */
export { reset as restorePlant };
