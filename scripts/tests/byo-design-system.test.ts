// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Bring your own design system: with the app code held constant, swapping the neutral starter for
// Ember (different values and token names) or an imported shadcn theme changes the generated
// output, every check follows, and no component code changes.

import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { adapterSet, type CheckResult, loadProject, writeText } from '../../plugin/kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../plugin/kernel/testing.ts';
import { checks, fromShadcn, loadDesignSystem, starterFiles, themeCss, tokensCss } from '../../plugin/modules/design-system/index.ts';
import { renderTemplate } from '../../plugin/modules/screens/index.ts';
import { profile as web } from '../../plugin/platforms/web/index.ts';

afterAll(cleanupTempProjects);

const REPO = new URL('../../', import.meta.url).pathname;

/** The scaffold's real components and app files, constant across every design system. */
function appWith(designSystem: Record<string, string>): string {
  const app = Object.fromEntries(
    renderTemplate('web', { APP_NAME: 'Swap test', APP_SLUG: 'swap-test' })
      .filter((f) => f.path.startsWith('apps/web/'))
      .map((f) => [f.path, f.content]),
  );
  const root = tempProject({ ...app, ...Object.fromEntries(Object.entries(designSystem).map(([k, v]) => [`design-system/${k}`, v])) });
  return root;
}

const neutral = () => Object.fromEntries(starterFiles().map((f) => [f.path, f.content]));
const ember = () => {
  const root = tempProject({});
  cpSync(join(REPO, 'examples/swap-in-a-design-system/ember'), join(root, 'ds'), { recursive: true });
  const files: Record<string, string> = {};
  for (const f of ['design-system.json', 'components.json', 'tokens/palette.json', 'tokens/day.json', 'tokens/night.json']) files[f] = readFileSync(join(root, 'ds', f), 'utf8');
  return files;
};
const shadcn = () => Object.fromEntries(fromShadcn(readFileSync(join(REPO, 'examples/import-a-shadcn-theme/globals.css'), 'utf8'), 'shadcn default').map((f) => [f.path, f.content]));

const SYSTEMS = { neutral, ember, shadcn };

const run = async (id: string, root: string) =>
  (await checks.find((c) => c.id === id)!.run({ project: loadProject(root), adapters: adapterSet([web]) })) as CheckResult;

describe.each(Object.entries(SYSTEMS))('%s', (name, make) => {
  it('passes the contract, tokens and registry checks with the same component code', async () => {
    const root = appWith(make());
    const ids = ['design-system/schema', 'design-system/tokens', 'design-system/registry'];
    if (name !== 'shadcn') ids.push('design-system/contrast');
    for (const id of ids) {
      const r = await run(id, root);
      expect(r.findings, `${id}: ${JSON.stringify(r.findings)}`).toEqual([]);
      expect(r.status, `${id}: ${r.reason}`).toBe('pass');
    }
  });
});

describe('contrast follows the imported values', () => {
  it("flags shadcn's default destructive red on a light red background, with a fix", async () => {
    const r = await run('design-system/contrast', appWith(shadcn()));
    expect(r.findings.map((f) => f.rule)).toEqual(['status.critical.text/status.critical.bg']);
    expect(r.findings[0]!.message).toMatch(/^light: status.critical.text on status.critical.bg is 4\.\d\d:1, under 4.5:1; nearest passing shade #[0-9a-f]{6}$/);
  });
});

describe('swapping systems', () => {
  const outputs = Object.fromEntries(
    Object.entries(SYSTEMS).map(([name, make]) => {
      const ds = loadDesignSystem(loadProject(appWith(make())))!;
      return [name, { tokens: tokensCss(ds), theme: themeCss(ds) }];
    }),
  );
  const themeVars = (css: string) => [...css.matchAll(/^\s+(--[\w-]+):/gm)].map((m) => m[1]).filter((v) => !v!.startsWith('--color-chart'));

  it('changes the values behind the slots', () => {
    expect(outputs.neutral!.tokens).not.toBe(outputs.ember!.tokens);
    expect(outputs.ember!.tokens).toContain('--ds-surface-base: #fffdf9;');
    expect(outputs.ember!.tokens).toContain('--ds-font-sans: "Iowan Old Style", Charter, Georgia, serif;');
    expect(outputs.shadcn!.tokens).toContain('--ds-brand-primary: oklch(0.205 0 0);');
  });

  it('keeps the class names components use identical', () => {
    expect(themeVars(outputs.ember!.theme)).toEqual(themeVars(outputs.neutral!.theme));
    expect(themeVars(outputs.shadcn!.theme)).toEqual(themeVars(outputs.neutral!.theme));
  });

  it("turns the chart check on only where a chart palette exists (off means off)", async () => {
    expect((await run('design-system/chart-palette', appWith(neutral()))).status).toBe('off');
    expect((await run('design-system/chart-palette', appWith(shadcn()))).status).not.toBe('off');
  });

  it('follows a token rename through the slots map, and fails when the map points nowhere', async () => {
    const files = ember();
    const ds = JSON.parse(files['design-system.json']!);
    ds.slots['surface.base'] = 'color.canvas.gone';
    const root = appWith({ ...files, 'design-system.json': JSON.stringify(ds) });
    const r = await run('design-system/schema', root);
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => f.message).join('\n')).toMatch(/required slot surface.base \(C3\) is blank; add token color.canvas.gone/);
  });

  it('a component with a raw colour fails under every system', async () => {
    for (const make of Object.values(SYSTEMS)) {
      const root = appWith(make());
      writeText(join(root, 'apps/web/src/shared/ui/card.tsx'), 'export const Card = () => <div className="bg-[#ffffff]" />;');
      expect((await run('design-system/tokens', root)).status).toBe('fail');
    }
  });
});
