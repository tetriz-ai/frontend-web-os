// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos doctor`: a health report. Tools, platforms, each adapter at 3 levels (loaded, matched real
// app data, active check), the design system, and every check as on or off with why. A check never
// shows as on if its inputs matched 0 files: it reports off, and doctor says so. It reads only,
// unless `--start` asks it to start the app: the verify driver is active only once it rendered a
// state fixture in the running app, and then it names the defects it can catch.

import { type CheckResult, type PlatformProfile, type Project, pluginVersion, readJson, stateClasses } from '../../kernel/index.ts';
import { loadContract } from '../../modules/architecture/index.ts';
import { SLOTS, loadDesignSystem } from '../../modules/design-system/index.ts';
import { TEST_ACCESS_COOKIE, loadIa } from '../../modules/screens/index.ts';
import { type AdoptionStatus, adoptionStatus, formatCapabilities } from './adopt.ts';
import { CODEX_AGENTS_DIR, cliOnlyDistribution, codexAgentsStatus, inCodex } from './codex.ts';
import { PROFILES, checksFor, profilesFor } from './registry.ts';
import { runChecks } from './runner.ts';
import { stateTargets } from './targets.ts';
import { VENDORED_PIN, vendoredNote } from './vendor.ts';

export interface AdapterHealth {
  adapter: 'components' | 'screens' | 'fixtures' | 'verify';
  loaded: boolean;
  matched: string | null;
  active: string | null;
  /** For an active verify driver: the defects what it rendered shows it can catch. */
  catches?: string;
  note?: string;
}

export interface DoctorOptions {
  /** Start the app (or use the one at `url`) and render a state fixture before calling the verify driver active. */
  start?: boolean;
  url?: string;
  /** The platform profiles to read the app through; this project's, by default. */
  profiles?: PlatformProfile[];
}

/** What fwos's IA harness catches once the app takes its test identity. */
const IA_CATCHES = 'a page or nav link shown to a role or flag setting ia.json hides it from, and a nav page missing from the nav';

/** The verify driver's row: installed at most, unless it started the app and rendered a state fixture. */
async function verifyHealth(project: Project, p: PlatformProfile, opts: DoctorOptions): Promise<AdapterHealth> {
  const verify = p.verify!;
  const probe = verify.probe(project);
  const row: AdapterHealth = { adapter: 'verify', loaded: true, matched: probe.ready ? (probe.detail ?? verify.name) : null, active: null };
  if (!probe.ready) return { ...row, ...(probe.reason ? { note: probe.reason } : {}) };
  if (!opts.start) return { ...row, note: 'installed, not started: `fwos doctor --start` starts the app and renders a state fixture before calling it active' };
  if (!verify.render || !verify.fixture) return { ...row, note: `the ${verify.name} driver can't start the app here` };
  const targets = stateTargets(project);
  if (targets.length === 0) return { ...row, note: 'nothing to render: no page in ia.json lists a state, and no registered component has a required state' };
  // Each target with the states something in the app renders: only those can be shown, and claimed.
  const renderable = targets
    .map((t) => ({ ...t, states: t.states.filter((state) => verify.fixture!(project, { kind: t.kind, id: t.id, state }) !== null) }))
    .filter((t) => t.states.length > 0);
  const target = renderable[0];
  if (!target) {
    const first = targets[0]!;
    return { ...row, note: `nothing renders ${first.kind} ${first.id} "${first.states[0]}" in the app: no screens browser, and for a component no comparison gallery (\`fwos design-system gallery\` writes one)` };
  }
  const fixture = { kind: target.kind, id: target.id, state: target.states[0]! };
  const path = verify.fixture(project, fixture)!;
  const role = loadIa(project)?.ia?.roles[0];
  const r = await verify.render(project, { fixture, path, ...(role ? { as: { cookie: TEST_ACCESS_COOKIE, role } } : {}), ...(opts.url ? { url: opts.url } : {}) });
  if (!r.ok) return { ...row, note: `couldn't render a state fixture: ${r.reason ?? 'no reason given'}` };
  return {
    ...row,
    active: `rendered ${r.detail ?? `${target.kind} ${target.id}`}`,
    // Only what the states it renders can show, and the IA classes only once the app took the test identity.
    catches: [stateClasses(renderable.map((t) => t.states)), ...(r.access ? [IA_CATCHES] : [])].join('; '),
    ...(r.access === false ? { note: 'the app didn\'t take the test identity on / (no <meta name="fwos-access"> for that role), so the IA classes aren\'t claimed' } : {}),
  };
}

export interface DoctorReport {
  fwos: string;
  node: string;
  project: { root: string; initialized: boolean; mode: string; platforms: string[] };
  /** An adopted app's level and what each capability needs: the same rows `fwos status` shows. */
  adoption: AdoptionStatus | null;
  platforms: { platform: string; status: string; reason?: string; enabled: boolean }[];
  tools: { name: string; ok: boolean; version?: string; fix?: string; neededFor: string; installedBy: string }[];
  adapters: Record<string, AdapterHealth[]>;
  designSystem: { name: string; modes: string[]; blank: string[]; assumed: number; errors: number } | null;
  fwosCheckPin: { pinned: string | null; note: string };
  /** fwos's agents for Codex: shown when the project has some, or doctor runs inside Codex. */
  codex: { agents: number; expected: number; stale: string[]; note: string } | null;
  checks: { id: string; on: boolean; status: string; reason?: string; catches: string; inputs: string[] }[];
}

export async function doctor(project: Project, opts: DoctorOptions = {}): Promise<DoctorReport> {
  const enabled = opts.profiles ?? profilesFor(project);
  const results = await runChecks(project);
  const byId = new Map(results.map((r) => [r.id, r]));
  const isOn = (id: string) => {
    const r = byId.get(id);
    return r && r.status !== 'off' ? id : null;
  };

  const adapters: Record<string, AdapterHealth[]> = {};
  for (const p of enabled) {
    const rows: AdapterHealth[] = [];
    if (p.components) {
      const n = p.components.listInstalled(project).length;
      const folder = p.components.folder?.(project);
      rows.push({
        adapter: 'components',
        loaded: true,
        matched: n > 0 ? `${n} installed component${n === 1 ? '' : 's'}` : null,
        active: n > 0 ? isOn('design-system/registry') : null,
        ...(n === 0 && folder ? { note: `none in ${folder}` } : {}),
      });
    } else rows.push({ adapter: 'components', loaded: false, matched: null, active: null });
    if (p.screens) {
      const found = p.screens.listScreens(project);
      const n = found?.screens.filter((s) => !s.devOnly).length ?? 0;
      rows.push({ adapter: 'screens', loaded: true, matched: n > 0 ? `${n} route${n === 1 ? '' : 's'}` : null, active: n > 0 ? isOn('screens/ia') : null, ...(found ? {} : { note: 'no app yet' }) });
    } else rows.push({ adapter: 'screens', loaded: false, matched: null, active: null });
    if (p.fixtures) {
      let generated = 0;
      let note: string | undefined;
      try {
        const c = loadContract(project);
        if (c) generated = p.fixtures.generate(project, c.model).length;
        else note = 'no openapi.yaml yet';
      } catch (e) {
        note = `contract unreadable: ${(e as Error).message}`;
      }
      rows.push({ adapter: 'fixtures', loaded: true, matched: generated > 0 ? 'mock fetch generated from the contract' : null, active: isOn('architecture/mocks'), ...(note ? { note } : {}) });
    } else rows.push({ adapter: 'fixtures', loaded: false, matched: null, active: null });
    if (p.verify) rows.push(await verifyHealth(project, p, opts));
    else rows.push({ adapter: 'verify', loaded: false, matched: null, active: null });
    adapters[p.platform] = rows;
  }

  let designSystem: DoctorReport['designSystem'] = null;
  try {
    const ds = loadDesignSystem(project);
    if (ds) {
      designSystem = {
        name: ds.config.name,
        modes: ds.modes,
        blank: SLOTS.filter((s) => ds.slots.get(s.id)?.status === 'blank').map((s) => s.id),
        assumed: ds.config.assumed?.length ?? 0,
        errors: ds.errors.length + ds.missing.length,
      };
    }
  } catch {
    designSystem = null;
  }

  const pkg = readJson<{ devDependencies?: Record<string, string>; dependencies?: Record<string, string> }>(project.abs('package.json'));
  const pinned = pkg ? ({ ...pkg.dependencies, ...pkg.devDependencies }['fwos-check'] ?? null) : null;
  const fwosCheckPin = {
    pinned,
    // The vendored copy travels with the app, so CI needs no registry package.
    note: pinned === VENDORED_PIN
      ? vendoredNote(project.root)
      : pinned?.startsWith('link:')
      ? `pinned to ${pinned}, a clone CI won't have: set it to "${VENDORED_PIN}", run fwos vendor, then pnpm install`
      : pinned
      ? pinned.replace(/^[\^~]/, '') === pluginVersion()
        ? 'pinned to this plugin version'
        : `project pins ${pinned}, plugin is ${pluginVersion()}; the project's pin wins in CI`
      : `not pinned: CI and the git commit hook need the CLI in the project. Run fwos vendor, then pnpm add -D ${VENDORED_PIN}`,
  };

  let codex: DoctorReport['codex'] = null;
  try {
    const s = cliOnlyDistribution() ? { found: 0, expected: 0, stale: [] } : codexAgentsStatus(project.root);
    if (!cliOnlyDistribution() && (s.found > 0 || inCodex())) {
      codex = {
        agents: s.found,
        expected: s.expected,
        stale: s.stale,
        note:
          s.stale.length === 0
            ? `${s.expected} agents in ${CODEX_AGENTS_DIR}/, current`
            : `${s.stale.length} of ${s.expected} agents in ${CODEX_AGENTS_DIR}/ missing or from another fwos version or folder: run \`fwos codex agents\``,
      };
    }
  } catch {
    // A vendored CLI has no agent files to compare with: say nothing rather than guess.
    codex = null;
  }

  const checks = checksFor(project).map((c) => {
    const r = byId.get(c.id) as CheckResult;
    return { id: c.id, on: r.status !== 'off', status: r.status, ...(r.reason ? { reason: r.reason } : {}), catches: c.catches, inputs: r.inputs };
  });

  return {
    fwos: pluginVersion(),
    node: process.versions.node,
    project: { root: project.root, initialized: project.initialized, mode: project.mode, platforms: project.platforms },
    adoption: project.initialized && project.mode === 'adopt' ? adoptionStatus(project) : null,
    platforms: PROFILES.map((p) => ({ platform: p.platform, status: p.status, ...(p.statusReason ? { reason: p.statusReason } : {}), enabled: project.platforms.includes(p.platform) })),
    // Tools for this project's platforms only; other platforms show their status above.
    tools: [...new Map((enabled.length > 0 ? enabled : PROFILES.filter((p) => p.platform === 'web')).flatMap((p) => p.tools).map((t) => [t.name, t])).values()].map((t) => {
      const probe = t.probe();
      return { name: t.name, ok: probe.ok, neededFor: t.neededFor, installedBy: t.installedBy, ...(probe.version ? { version: probe.version } : {}), ...(probe.fix ? { fix: probe.fix } : {}) };
    }),
    adapters,
    designSystem,
    fwosCheckPin,
    codex,
    checks,
  };
}

export function formatDoctor(d: DoctorReport): string {
  const out: string[] = [`fwos doctor  (fwos ${d.fwos}, Node ${d.node})`, ''];
  out.push(`Project  ${d.project.root}`);
  out.push(d.project.initialized ? `         mode ${d.project.mode}, platforms ${d.project.platforms.join(', ')}` : '         not an fwos project yet (run /fwos:start)');
  if (d.adoption) out.push('', `Adoption  level ${d.adoption.level} (since ${d.adoption.since}), app ${d.adoption.app}`, ...formatCapabilities(d.adoption.capabilities));
  out.push('', 'Platforms');
  for (const p of d.platforms) {
    const label = p.status === 'unavailable' ? 'not in this release' : p.status;
    out.push(`  ${p.platform.padEnd(9)} ${label}${p.enabled ? ' (this project)' : ''}${p.reason ? `: ${p.reason}` : ''}`);
  }
  out.push('', 'Tools');
  for (const t of d.tools) out.push(`  ${t.ok ? 'ok     ' : 'MISSING'} ${t.name}${t.version ? ` ${t.version}` : ''}  (${t.neededFor})${t.fix ? `\n          fix: ${t.fix}` : ''}`);
  for (const [platform, rows] of Object.entries(d.adapters)) {
    out.push('', `Adapters (${platform})`);
    for (const a of rows) {
      const levels = [a.loaded ? 'loaded' : 'not loaded', a.matched ? `matched: ${a.matched}` : 'no app data matched', a.active ? `active: ${a.active}` : 'no active check'];
      out.push(`  ${a.adapter.padEnd(11)} ${levels.join(' | ')}${a.note ? `  (${a.note})` : ''}`);
      if (a.catches) out.push(`              catches ${a.catches}`);
    }
  }
  out.push('', 'Design system');
  if (!d.designSystem) out.push(`  none yet (${d.project.mode === 'adopt' ? '`fwos design-system init`' : 'the design-system step'} writes design-system/)`);
  else {
    out.push(`  ${d.designSystem.name}: modes ${d.designSystem.modes.join(', ')}; ${d.designSystem.errors} problem${d.designSystem.errors === 1 ? '' : 's'}; ${d.designSystem.assumed} [ASSUMED] to confirm`);
    if (d.designSystem.blank.length > 0) out.push(`  blank slots (their checks are off): ${d.designSystem.blank.join(', ')}`);
  }
  out.push('', `fwos-check pin  ${d.fwosCheckPin.note}`);
  if (d.codex) out.push('', `Codex  ${d.codex.note}`);
  out.push('', 'Checks');
  const w = Math.max(...d.checks.map((c) => c.id.length));
  for (const c of d.checks) {
    out.push(`  ${c.on ? 'ON ' : 'OFF'}  ${c.id.padEnd(w)}  ${c.on ? `catches ${c.catches}` : c.reason}`);
  }
  return out.join('\n');
}
