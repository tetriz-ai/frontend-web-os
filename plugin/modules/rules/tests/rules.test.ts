// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type CheckResult, adapterSet, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { checks, effectiveRules, fixtureErrors, hooks, loadPack, matchRule, ruleErrors } from '../index.ts';

afterAll(cleanupTempProjects);

const run = async (root: string) =>
  (await checks[0]!.run({ project: loadProject(root), adapters: adapterSet([]) })) as CheckResult;

describe('the rule pack', () => {
  const pack = loadPack();

  it('has rules, each valid', () => {
    expect(pack.length).toBeGreaterThanOrEqual(7);
    for (const { origin: _origin, ...raw } of pack) expect(ruleErrors(raw), raw.id).toEqual([]);
  });

  it('rejects a key the engine does not read, so a rule cannot claim a scope nothing applies', () => {
    const { origin: _origin, ...raw } = pack[0]!;
    expect(ruleErrors({ ...raw, appliesTo: 'all' })).not.toEqual([]);
  });

  it.each(loadPack().map((r) => [r.id, r] as const))('%s: bad fixtures match, good ones do not', (_, rule) => {
    expect(fixtureErrors(rule)).toEqual([]);
  });

  it('ignores matches inside comments and honours an inline ignore', () => {
    const rule = pack.find((r) => r.id === 'no-raw-intl')!;
    expect(matchRule(rule, 'a.ts', '// d.toLocaleDateString() is banned')).toEqual([]);
    expect(matchRule(rule, 'a.ts', 'd.toLocaleDateString(); // fwos-ignore no-raw-intl')).toEqual([]);
    expect(matchRule(rule, 'a.ts', 'x\nd.toLocaleDateString();')[0]!.line).toBe(2);
  });

  it('honours an ignore marker only in comment text, not inside a string on the line', () => {
    const rule = pack.find((r) => r.id === 'no-raw-intl')!;
    expect(matchRule(rule, 'a.ts', "const l = 'fwos-ignore no-raw-intl'; d.toLocaleDateString();").map((f) => f.rule)).toEqual(['no-raw-intl']);
    expect(matchRule(rule, 'a.ts', 'd.toLocaleDateString(); /* fwos-ignore no-raw-intl */')).toEqual([]);
  });

  it('honours an ignore marker in a Sass or Less line comment, and in a comment on an MDX import or export line', () => {
    const important = { ...pack[0]!, id: 'no-important', pattern: '!important', files: ['**/*'], fixtures: { bad: [], good: [] } };
    for (const file of ['a.scss', 'a.less']) {
      expect(matchRule(important, file, '.a { color: red !important; } // fwos-ignore no-important'), file).toEqual([]);
      expect(matchRule(important, file, '.a { content: "// fwos-ignore no-important"; color: red !important; }').map((f) => f.rule), file).toEqual(['no-important']);
    }
    const rule = pack.find((r) => r.id === 'no-raw-intl')!;
    expect(matchRule(rule, 'a.mdx', 'export const d = n.toLocaleDateString(); // fwos-ignore no-raw-intl\n\n# Title')).toEqual([]);
    expect(matchRule(rule, 'a.mdx', 'export const d = n.toLocaleDateString();\n\nfwos-ignore no-raw-intl in prose').map((f) => f.rule)).toEqual(['no-raw-intl']);
  });
});

describe('project overrides', () => {
  it('turns rules off, softens them, scopes them, and adds custom rules', () => {
    const root = tempProject({
      'design-system/rules.yaml': `schema: 1
rules:
  no-pie-chart: off
  no-dangerous-html: { hardness: review }
  no-raw-intl: { exclude: ["src/legacy/**"] }
custom:
  - id: no-moment
    title: Use date-fns, not moment
    hardness: check
    files: ["**/*.ts"]
    pattern: "from ['\\"]moment['\\"]"
    message: moment is large and mutable.
    fixtures:
      bad: ["import m from 'moment';"]
      good: ["import { format } from 'date-fns';"]
`,
    });
    const { rules, errors } = effectiveRules(loadProject(root));
    expect(errors).toEqual([]);
    expect(rules.find((r) => r.id === 'no-pie-chart')).toBeUndefined();
    expect(rules.find((r) => r.id === 'no-dangerous-html')!.hardness).toBe('review');
    expect(rules.find((r) => r.id === 'no-raw-intl')!.exclude).toContain('src/legacy/**');
    expect(rules.find((r) => r.id === 'no-moment')!.origin).toBe('project');
  });

  it('rejects unknown overrides and custom rules with failing fixtures', async () => {
    const root = tempProject({
      'design-system/rules.yaml': `schema: 1
rules:
  no-such-rule: off
custom:
  - id: broken
    title: x
    hardness: check
    files: ["**/*.ts"]
    pattern: "foo"
    message: m
    fixtures: { bad: ["bar"], good: ["baz"] }
`,
    });
    const r = await run(root);
    expect(r.status).toBe('fail');
    expect(r.findings.map((f) => f.message)).toEqual([
      'rules: "no-such-rule" isn\'t in the rule pack',
      "custom[0] (broken): bad fixture doesn't match: bar",
    ]);
  });
});

describe('rules/pack', () => {
  it('flags violations in app files and tests, and passes clean ones', async () => {
    const root = tempProject({
      'apps/web/src/features/list/view.tsx': 'export const V = () => <img src={x} />;',
      'apps/web/e2e/list.spec.ts': 'await page.waitForTimeout(500);',
      'apps/web/src/lib/format.ts': 'export const f = (d: Date) => d.toLocaleDateString();',
      'apps/web/src/ok.tsx': 'export const O = () => <img src={x} alt="" />;',
    });
    const r = await run(root);
    expect(r.findings.map((f) => `${f.rule}:${f.file}`)).toEqual([
      'img-needs-alt:apps/web/src/features/list/view.tsx',
      'no-fixed-sleep:apps/web/e2e/list.spec.ts',
    ]);
  });

  it('skips generated output by its folder, never by a header app code could copy', async () => {
    const header = '/* generated by fwos, do not edit. */\n';
    const root = tempProject({
      'apps/web/src/features/list/view.tsx': `${header}export const V = () => <img src={x} />;`,
      'packages/api-contract/generated/mock-fetch.ts': `${header}await new Promise((r) => setTimeout(r, 500));`,
    });
    expect((await run(root)).findings.map((f) => `${f.rule}:${f.file}`)).toEqual(['img-needs-alt:apps/web/src/features/list/view.tsx']);
  });

  it('reads comment markers in JSX text as text, so the rest of the file is still checked', async () => {
    const root = tempProject({ 'apps/web/src/features/list/view.tsx': 'export const V = () => <><p>Globs look like apps/*</p><img src={x} /></>;' });
    expect((await run(root)).findings.map((f) => f.rule)).toEqual(['img-needs-alt']);
  });

  it('counts one active rule in the singular', async () => {
    const off = loadPack().filter((r) => r.id !== 'img-needs-alt');
    const yaml = `schema: 1\nrules:\n${off.map((r) => `  ${r.id}: off`).join('\n')}\n`;
    const root = tempProject({ 'design-system/rules.yaml': yaml, 'apps/web/src/ok.tsx': 'export const O = () => <img src={x} alt="" />;' });
    expect((await run(root)).info).toEqual(['1 rule active (0 from rules.yaml)']);
  });

  it('is off when nothing matches', async () => {
    expect((await run(tempProject({ 'README.md': '# hi' }))).status).toBe('off');
  });
});

describe('edit-time hook', () => {
  it('reports only on the inserted text', () => {
    const root = tempProject({ '.fwos/state.json': { schema: 1, pluginVersion: '0', mode: 'new', platforms: ['web'] } });
    const p = loadProject(root);
    const hook = hooks.postToolUse![0]!;
    const out = hook(
      { tool_name: 'Edit', tool_input: { file_path: join(root, 'apps/web/src/a.tsx'), new_string: '<img src={a} />' } },
      p,
    );
    expect(out?.context).toMatch(/trips 1 rule/);
    expect(hook({ tool_name: 'Edit', tool_input: { file_path: join(root, 'apps/web/src/a.tsx'), new_string: 'ok' } }, p)).toBeNull();
    expect(hook({ tool_name: 'Read', tool_input: { file_path: join(root, 'apps/web/src/a.tsx') } }, p)).toBeNull();
  });
});
