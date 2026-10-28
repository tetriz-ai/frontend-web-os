// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The design-system adoption commands through the CLI: the mapping report, the gallery, the
// decisions and the fidelity approval, and the outcomes they keep apart at every approval.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FIDELITY_RESULTS, type FidelityResults, readJson, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { galleryModel } from '../../../modules/design-system/index.ts';
import { dispatch } from '../../hooks/index.ts';
import type { Io } from '../commands.ts';
import { main } from '../main.ts';
import { PROFILES } from '../registry.ts';
import { adapterSet, loadProject } from '../../../kernel/index.ts';

afterAll(cleanupTempProjects);

async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const REPO = new URL('../../../../', import.meta.url).pathname;
const THEME = readFileSync(join(REPO, 'examples/import-a-shadcn-theme/globals.css'), 'utf8');
const UI = join(REPO, 'plugin/modules/screens/templates/web/apps/web/src/shared/ui');

/** An fwos project that imported the example theme, with fwos's button and its barrel installed. */
async function imported(): Promise<string> {
  const root = tempProject({
    'app/globals.css': THEME,
    'apps/web/app/layout.tsx': 'export default function L({ children }) { return children; }\n',
    'apps/web/src/shared/ui/button.tsx': readFileSync(join(UI, 'button.tsx'), 'utf8'),
    'apps/web/src/shared/ui/spinner.tsx': readFileSync(join(UI, 'spinner.tsx'), 'utf8'),
    'apps/web/src/shared/ui/index.ts': "export { Button, type ButtonVariant } from './button';\nexport { Spinner } from './spinner';\n",
  });
  await fwos(root, 'init', '--name', 'Acme');
  expect((await fwos(root, 'design-system', 'init', '--from-shadcn', 'app/globals.css', '--name', 'Acme')).code).toBe(0);
  // Only what is installed: the starter registry lists nine components, and this app has two.
  writeText(join(root, 'design-system/components.json'), `${JSON.stringify({ schema: 1, components: [{ id: 'button', status: 'stable', source: 'fwos', requiredStates: ['default'] }, { id: 'spinner', status: 'stable', source: 'fwos', requiredStates: [] }] }, null, 2)}\n`);
  return root;
}

/** Results for every cell of the current gallery, every one identical. */
function compared(root: string): void {
  const model = galleryModel(loadProject(root), adapterSet(PROFILES));
  const cells: FidelityResults['cells'] = [];
  for (const v of model.viewports) for (const mode of model.modes) for (const c of model.components) for (const cell of c.adopted!.cells) cells.push({ component: c.id, cell: cell.id, mode, viewport: v.name, differences: [], behaviour: [] });
  const data = JSON.parse(readFileSync(join(root, 'apps/web/app/(fwos-screens)/fwos-screens/fwos-gallery/gallery.json'), 'utf8')) as { hash: string };
  writeText(join(root, FIDELITY_RESULTS), `${JSON.stringify({ schema: 1, gallery: data.hash, browser: 'chromium', cells, errors: [] }, null, 2)}\n`);
}

describe('fwos design-system init --from-shadcn', () => {
  it('keeps a copy of the theme and writes the mapping report in place of the old import report', async () => {
    const root = tempProject({ 'app/globals.css': THEME });
    await fwos(root, 'init');
    const r = await fwos(root, 'design-system', 'init', '--from-shadcn', 'app/globals.css');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(
      /^Wrote design-system\/ \(8 files, from app\/globals\.css\)\. These files are yours\.\nMapping report in docs\/app\/reports\/design-system\.md: 20 preserved, 5 approximated, 36 defaulted, 4 unsupported\. A PASS from the design-system checks means valid and readable, not a match with your theme: `fwos design-system report` keeps the outcomes apart\.\n/,
    );
    expect(readFileSync(join(root, 'design-system/source/globals.css'), 'utf8')).toBe(THEME);
    expect(existsSync(join(root, 'design-system/import-report.md'))).toBe(false);
    expect(readFileSync(join(root, 'docs/app/reports/design-system.md'), 'utf8')).toContain('# Design-system adoption: Imported shadcn theme');
  });
});

describe('fwos design-system report', () => {
  it('prints the outcomes apart, writes the report, and stays the same for the same evidence', async () => {
    const root = await imported();
    expect((await fwos(root, 'design-system', 'report')).out).toContain('Wrote docs/app/reports/design-system.md');
    const r = await fwos(root, 'design-system', 'report');
    expect(r.code).toBe(0);
    const lines = r.out.split('\n');
    expect(lines[0]).toMatch(/^Token validity {5}FAIL {10}design-system\/schema PASS, design-system\/contrast FAIL \(1 finding\)/);
    expect(lines[1]).toMatch(/^Generated CSS {6}not built/);
    expect(lines[2]).toBe('Adoption coverage  partial       slots: 20 preserved, 5 approximated, 36 defaulted; 4 source entries not consumed; components: 2 fwos starter');
    expect(lines[3]).toMatch(/^Fidelity {11}not compared  no rendered comparison yet: run `fwos design-system gallery`/);
    expect(lines[4]).toBe('Preview            -             /fwos-screens shows the app on fake data. It compares nothing with your source.');
    expect(r.out).toContain('Unchanged: docs/app/reports/design-system.md');
    const json = JSON.parse((await fwos(root, 'design-system', 'report', '--json')).out);
    expect(json.outcomes.coverage.status).toBe('partial');
    expect(json.report).toBe('docs/app/reports/design-system.md');
  });

  it('refuses a project with no design system', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    expect(await fwos(root, 'design-system', 'report')).toMatchObject({ code: 2, err: expect.stringMatching(/No design-system\/design-system\.json/) });
  });
});

describe('fwos design-system gallery', () => {
  it('writes the dev-only route and its runner into the app, and prints how to run it', async () => {
    const root = await imported();
    const r = await fwos(root, 'design-system', 'gallery');
    expect(r.code).toBe(0);
    expect(r.out).toContain('wrote apps/web/app/(fwos-screens)/fwos-screens/fwos-gallery/page.tsx');
    expect(r.out).toContain('Open http://localhost:3000/fwos-screens/fwos-gallery with `pnpm dev` to look at it.');
    expect(r.out).toContain('Compare both sides in a browser: pnpm --dir apps/web exec playwright test -c "app/(fwos-screens)/fwos-screens/fwos-gallery/playwright.config.ts"');
    expect((await fwos(root, 'design-system', 'gallery')).out).toContain('unchanged apps/web/app/(fwos-screens)/fwos-screens/fwos-gallery/page.tsx');
    // The gallery is fwos's: a hand edit stops the next write, all of it, so it never ends up half new.
    const data = join(root, 'apps/web/app/(fwos-screens)/fwos-screens/fwos-gallery/gallery.json');
    const before = readFileSync(data, 'utf8');
    writeText(join(root, 'apps/web/app/(fwos-screens)/fwos-screens/fwos-gallery/page.tsx'), 'edited');
    writeText(join(root, 'design-system/components.json'), `${JSON.stringify({ schema: 1, components: [{ id: 'button', status: 'stable', source: 'fwos', requiredStates: ['default'] }] }, null, 2)}\n`);
    expect(await fwos(root, 'design-system', 'gallery')).toMatchObject({ code: 2, err: expect.stringMatching(/edited by hand/) });
    expect(readFileSync(data, 'utf8')).toBe(before);
  });

  it('refuses the neutral starter and an app with no app/ folder, saying why', async () => {
    const plain = tempProject({});
    await fwos(plain, 'init');
    await fwos(plain, 'design-system', 'init');
    expect(await fwos(plain, 'design-system', 'gallery')).toMatchObject({ code: 2, err: expect.stringMatching(/nothing was adopted/) });
    const bare = tempProject({ 'app/globals.css': THEME });
    await fwos(bare, 'init');
    await fwos(bare, 'design-system', 'init', '--from-shadcn', 'app/globals.css');
    expect(await fwos(bare, 'design-system', 'gallery')).toMatchObject({ code: 2, err: expect.stringMatching(/scaffold the app first/) });
  });
});

describe('decisions and the fidelity approval', () => {
  it('records decisions through the CLI only: the edit tools may not write them', async () => {
    const root = await imported();
    const r = await fwos(root, 'design-system', 'decide', 'text.disabled', '--as', 'intentional', '--reason', 'the theme has no disabled text colour', '--by', 'Ada');
    expect(r).toMatchObject({ code: 0, out: 'Decided text.disabled: intentional, by Ada.' });
    expect(readJson<{ decisions: { item: string }[] }>(join(root, '.fwos/fidelity.json'))!.decisions.map((d) => d.item)).toEqual(['text.disabled']);
    expect(await fwos(root, 'design-system', 'decide', 'surface.base', '--as', 'intentional', '--reason', 'x', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringMatching(/preserved: there is nothing to decide/) });
    expect(await fwos(root, 'design-system', 'decide', 'button', '--as', 'keep', '--reason', 'x', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringMatching(/--as must be replace, omit or intentional/) });
    const deny = JSON.parse(dispatch('pre-tool-use', { tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, '.fwos/fidelity.json') } }).stdout);
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(deny.hookSpecificOutput.permissionDecisionReason).toMatch(/fwos design-system decide/);
  });

  it('refuses the fidelity approval until the comparison ran and every difference is decided, then holds it to that evidence', async () => {
    const root = await imported();
    expect(await fwos(root, 'approve', 'fidelity', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringMatching(/Can't approve fidelity: no rendered comparison yet/) });
    await fwos(root, 'design-system', 'gallery');
    compared(root);
    await fwos(root, 'design-system', 'report');
    const undecided = await fwos(root, 'approve', 'fidelity', '--by', 'Ada');
    expect(undecided).toMatchObject({ code: 2, err: expect.stringMatching(/Can't approve fidelity: 47 items need a decision \(surface\.interactive, text\.secondary, /) });
    for (const s of ['approximated', 'defaulted', 'unsupported']) await fwos(root, 'design-system', 'decide', s, '--as', 'intentional', '--reason', 'accepted', '--by', 'Ada');
    await fwos(root, 'design-system', 'decide', 'defaulted', '--as', 'replace', '--reason', 'the theme came without components', '--by', 'Ada');
    // The decisions changed what the report says: approving the old one would approve stale text.
    expect(await fwos(root, 'approve', 'fidelity', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringMatching(/docs\/app\/reports\/design-system\.md is out of date: run `fwos design-system report`/) });
    await fwos(root, 'design-system', 'report');
    const ok = await fwos(root, 'approve', 'fidelity', '--by', 'Ada');
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/^Approved fidelity \([0-9a-f]{12}\) by Ada\./);
    expect(ok.out).toMatch(/Fidelity {11}approved {6}by Ada/);
    expect((await fwos(root, 'status')).out).toMatch(/fidelity\s+approved by Ada/);
    // Any change to the design system makes it stale.
    const light = JSON.parse(readFileSync(join(root, 'design-system/tokens/light.json'), 'utf8'));
    light.color.brand.primary = { $value: '#0f766e' };
    writeFileSync(join(root, 'design-system/tokens/light.json'), JSON.stringify(light));
    expect((await fwos(root, 'status')).out).toMatch(/fidelity\s+STALE/);
    expect((await fwos(root, 'design-system', 'report')).out).toMatch(/Fidelity {11}approval stale/);
  });

  it('shows the outcomes when the design system is approved, so an unresolved difference stays in view', async () => {
    const root = await imported();
    const r = await fwos(root, 'approve', 'design-system', '--by', 'Ada');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Approved design-system \([0-9a-f]{12}\) by Ada\. Any later edit makes it stale\./);
    expect(r.out).toContain('This approves the design system as it is. It is not a fidelity approval:');
    expect(r.out).toMatch(/Adoption coverage {2}partial/);
    expect(r.out).toMatch(/Fidelity {11}not compared/);
  });

  // In an adopted app fwos records no approval of the team's own design system, but the fidelity
  // approval reviews fwos's adoption of it, so a person can still give it there.
  it("records the fidelity approval in an adopted app, where the design system itself stays the team's", async () => {
    const root = await imported();
    const state = JSON.parse(readFileSync(join(root, '.fwos/state.json'), 'utf8'));
    writeText(join(root, '.fwos/state.json'), `${JSON.stringify({ ...state, mode: 'adopt', adopt: { level: 'design', history: [{ level: 'design', at: '2026-10-23T00:00:00.000Z' }] } }, null, 2)}\n`);
    expect(await fwos(root, 'approve', 'design-system', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringMatching(/the design system is your team's, from before fwos/) });
    await fwos(root, 'design-system', 'gallery');
    compared(root);
    for (const s of ['approximated', 'defaulted', 'unsupported']) await fwos(root, 'design-system', 'decide', s, '--as', 'intentional', '--reason', 'accepted', '--by', 'Ada');
    await fwos(root, 'design-system', 'decide', 'defaulted', '--as', 'replace', '--reason', 'the theme came without components', '--by', 'Ada');
    await fwos(root, 'design-system', 'report');
    const ok = await fwos(root, 'approve', 'fidelity', '--by', 'Ada');
    expect(ok.err).toBe('');
    expect(ok.out).toMatch(/^Approved fidelity \([0-9a-f]{12}\) by Ada\./);
    expect((await fwos(root, 'status')).out).toMatch(/fidelity\s+approved by Ada/);
  });

  it('leaves the fidelity approval out of status until there is a report to approve', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    await fwos(root, 'design-system', 'init');
    expect((await fwos(root, 'status')).out).not.toMatch(/fidelity/);
  });
});
