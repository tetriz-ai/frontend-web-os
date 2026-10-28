// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos doctor --start`: the verify driver is active only once it started the app and rendered a
// state fixture in a real browser, and it names the defects that showed it can catch. Without
// --start, or when nothing renders, it is installed at most, never active. The driver here is a
// stand-in for the browser; scripts/tests/e2e.test.ts runs the real one on a scaffolded app.

import { afterAll, describe, expect, it } from 'vitest';
import { type PlatformProfile, type RenderProbe, type RenderRequest, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import type { Io } from '../commands.ts';
import { type AdapterHealth, doctor, formatDoctor } from '../doctor.ts';
import { main } from '../main.ts';
import { PROFILES } from '../registry.ts';

afterAll(cleanupTempProjects);

async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const web = PROFILES.find((p) => p.platform === 'web')!;
const IA = { schema: 1, roles: ['member', 'admin'], pages: [{ id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready', 'loading', 'error'] }] };

/** The web profile with a verify driver that finds Playwright installed and renders as `render` says, noting each call. */
function driver(render?: (request: RenderRequest) => RenderProbe): { profile: PlatformProfile; calls: RenderRequest[] } {
  const calls: RenderRequest[] = [];
  const profile: PlatformProfile = {
    ...web,
    verify: {
      platform: 'web',
      name: 'Playwright',
      probe: () => ({ ready: true, detail: '@playwright/test 1.64.1' }),
      fixture: (_project, f) => `/fwos-screens/${f.kind === 'page' ? '' : 'components/'}${f.id}?state=${f.state}`,
      ...(render
        ? {
            render: async (_project, request) => {
              calls.push(request);
              return render(request);
            },
          }
        : {}),
    },
  };
  return { profile, calls };
}

async function project(files: Record<string, string | object> = { 'docs/app/ia.json': IA }) {
  const root = tempProject(files);
  await fwos(root, 'init', '--name', 'Doctor');
  return loadProject(root);
}

const verifyRow = async (p: ReturnType<typeof loadProject>, opts: Parameters<typeof doctor>[1]) =>
  (await doctor(p, opts)).adapters.web!.find((a) => a.adapter === 'verify') as AdapterHealth;

const STATES = 'a state that renders wrong (another state under its name, stale content on error, a loading state not busy) and a hover with a dead hit area';
const IA_RUNS = 'a page or nav link shown to a role or flag setting ia.json hides it from, and a nav page missing from the nav';

describe('doctor --start', () => {
  it("never calls the verify driver active without starting the app, and says how to: finding Playwright isn't running it", async () => {
    const p = await project();
    const { profile, calls } = driver(() => ({ ok: true, detail: 'x' }));
    expect(await verifyRow(p, { profiles: [profile] })).toEqual({
      adapter: 'verify',
      loaded: true,
      matched: '@playwright/test 1.64.1',
      active: null,
      note: 'installed, not started: `fwos doctor --start` starts the app and renders a state fixture before calling it active',
    });
    expect(calls).toEqual([]);
  });

  it('renders the first state fixture in the running app, then calls the driver active and names what it can catch', async () => {
    const p = await project();
    const { profile, calls } = driver(() => ({ ok: true, detail: 'page home "ready" at /fwos-screens/home?state=ready (next dev, chromium 141)', access: true }));
    expect(await verifyRow(p, { start: true, profiles: [profile] })).toEqual({
      adapter: 'verify',
      loaded: true,
      matched: '@playwright/test 1.64.1',
      active: 'rendered page home "ready" at /fwos-screens/home?state=ready (next dev, chromium 141)',
      catches: `${STATES}; ${IA_RUNS}`,
    });
    // The first page state, and the first role ia.json lists for the IA harness's test identity.
    expect(calls).toEqual([{ fixture: { kind: 'page', id: 'home', state: 'ready' }, path: '/fwos-screens/home?state=ready', as: { cookie: 'fwos-test-access', role: 'member' } }]);
    expect(formatDoctor(await doctor(p, { start: true, profiles: [profile] }))).toContain(`verify      loaded | matched: @playwright/test 1.64.1 | active: rendered page home "ready" at /fwos-screens/home?state=ready (next dev, chromium 141)\n              catches ${STATES}; ${IA_RUNS}`);
  });

  it("claims the state classes only, when the app doesn't take the IA harness's test identity", async () => {
    const p = await project();
    const { profile } = driver(() => ({ ok: true, detail: 'page home "ready"', access: false }));
    const row = await verifyRow(p, { start: true, profiles: [profile] });
    expect(row).toMatchObject({ active: 'rendered page home "ready"', catches: STATES, note: "the app didn't take the test identity on / (no <meta name=\"fwos-access\"> for that role), so the IA classes aren't claimed" });
  });

  it('stays inactive, with the reason, when the app does not start or the fixture does not render', async () => {
    const p = await project();
    const { profile } = driver(() => ({ ok: false, reason: '/fwos-screens/home?state=ready has no state fixture on it (HTTP 404)' }));
    const row = await verifyRow(p, { start: true, profiles: [profile] });
    expect(row).toEqual({ adapter: 'verify', loaded: true, matched: '@playwright/test 1.64.1', active: null, note: "couldn't render a state fixture: /fwos-screens/home?state=ready has no state fixture on it (HTTP 404)" });
  });

  it('renders a component state when no page lists one, and starts nothing when there is nothing to render', async () => {
    const withComponent = await project({
      'design-system/components.json': { schema: 1, components: [{ id: 'button', status: 'stable', source: 'fwos', requiredStates: ['default', 'disabled'] }] },
    });
    const a = driver(() => ({ ok: true, detail: 'component button "default"' }));
    // Only what its states can show: no loading or error state here, so no stale content and no loading to be busy.
    expect(await verifyRow(withComponent, { start: true, profiles: [a.profile] })).toMatchObject({
      active: 'rendered component button "default"',
      catches: 'a state that renders wrong (another state under its name) and a hover with a dead hit area',
    });
    expect(a.calls).toEqual([{ fixture: { kind: 'component', id: 'button', state: 'default' }, path: '/fwos-screens/components/button?state=default' }]);

    const empty = await project({});
    const b = driver(() => ({ ok: true, detail: 'x' }));
    expect(await verifyRow(empty, { start: true, profiles: [b.profile] })).toMatchObject({
      active: null,
      note: 'nothing to render: no page in ia.json lists a state, and no registered component has a required state',
    });
    expect(b.calls).toEqual([]);
  });

  it('renders the first state the app has a fixture for, and claims only what the states it can render show', async () => {
    // An adopted app's shape: its pages have no screens browser to render them, its components have the gallery.
    const p = await project({
      'docs/app/ia.json': IA,
      'design-system/components.json': { schema: 1, components: [{ id: 'button', status: 'stable', source: 'shadcn', requiredStates: ['default', 'disabled'] }] },
    });
    const { profile, calls } = driver(() => ({ ok: true, detail: 'component button "default"' }));
    const gallery = { ...profile, verify: { ...profile.verify!, fixture: (_p: unknown, f: { kind: string; id: string; state: string }) => (f.kind === 'page' ? null : `/fwos-screens/fwos-gallery?fixture=${f.id}&state=${f.state}`) } };
    expect(await verifyRow(p, { start: true, profiles: [gallery as PlatformProfile] })).toMatchObject({
      active: 'rendered component button "default"',
      // The page's loading and error states can't render here, so neither their classes.
      catches: 'a state that renders wrong (another state under its name) and a hover with a dead hit area',
    });
    expect(calls.map((c) => c.path)).toEqual(['/fwos-screens/fwos-gallery?fixture=button&state=default']);
  });

  it('starts nothing when no route in the app renders the fixture', async () => {
    const p = await project();
    const { profile, calls } = driver(() => ({ ok: true, detail: 'x' }));
    const row = await verifyRow(p, { start: true, profiles: [{ ...profile, verify: { ...profile.verify!, fixture: () => null } }] });
    expect(row).toMatchObject({
      active: null,
      note: 'nothing renders page home "ready" in the app: no screens browser, and for a component no comparison gallery (`fwos design-system gallery` writes one)',
    });
    expect(calls).toEqual([]);
  });

  it("starts nothing when the driver can't render, or isn't installed", async () => {
    const p = await project();
    expect(await verifyRow(p, { start: true, profiles: [driver().profile] })).toMatchObject({ active: null, note: "the Playwright driver can't start the app here" });
    // The real driver, in a project with no app installed: its probe says why, and nothing starts.
    const r = await fwos(p.root, 'doctor', '--start', '--json');
    expect(r.code).toBe(0);
    const row = (JSON.parse(r.out) as { adapters: { web: AdapterHealth[] } }).adapters.web.find((a) => a.adapter === 'verify');
    expect(row).toEqual({ adapter: 'verify', loaded: true, matched: null, active: null, note: 'no apps/web/package.json yet (the scaffold creates it)' });
  });
});
