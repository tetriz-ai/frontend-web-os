// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readJson, writeText } from '../../../kernel/index.ts';
import { cleanupTempProjects, contextFor, copyFixture } from '../../../kernel/testing.ts';
import { checks, parseColor, parseDtcgColor, scanRawValues } from '../index.ts';

afterAll(cleanupTempProjects);
const malformed = ['rgb(wrong 0 0)', 'rgb(12oops 0 0)', 'rgb(1e999 0 0)', 'rgb(0 0 0 / nope)', 'rgb(0 0 0 / 1 / 2)', 'hsl(1turnoops 50% 50%)', 'hsl(30grad 50% nope)', 'oklch(50% bad 30)', 'oklab(.5 0 0 / Infinity)'];
describe('colour validation at the helper and schema boundary', () => {
  it.each(malformed)('refuses %s', async (value) => {
    expect(parseColor(value)).toBeNull();
    const root = copyFixture(new URL('../checks/fixtures/schema/good/', import.meta.url).pathname);
    const file = join(root, 'design-system/tokens/light.json');
    const tokens = readJson<any>(file)!;
    tokens.color.surface.base.$value = value;
    writeText(file, JSON.stringify(tokens));
    expect((await checks.find((c) => c.id === 'design-system/schema')!.run(contextFor(root))).status).toBe('fail');
  });
  it.each([null, true, '0', {}, Number.NaN, Number.POSITIVE_INFINITY])('refuses nonnumeric DTCG channels: %s', (value) => {
    expect(parseDtcgColor({ colorSpace: 'srgb', components: [value, 0, 0] })).toBeNull();
  });
  it.each([null, '0.5', Number.NaN, Number.POSITIVE_INFINITY])('refuses invalid explicit alpha: %s', (alpha) => {
    expect(parseDtcgColor({ colorSpace: 'srgb', components: [0, 0, 0], alpha })).toBeNull();
  });
  it.each(['rgb(1e2 0 0 / 50%)', 'hsl(100grad 50% 50%)', 'hsl(.25turn 50% 50%)', 'oklch(50% .1 90)', 'rgb(none 0 0)'])('keeps supported valid numeric syntax: %s', (value) => {
    const color = parseColor(value);
    expect(color).not.toBeNull();
    expect(Object.values(color!).every(Number.isFinite)).toBe(true);
  });
});
describe('literal design values', () => {
  it('does not let app custom properties impersonate generated tokens', () => {
    expect(scanRawValues('app.css', '.x { --ds-evil: #ff0000; color: var(--ds-evil); }').some((f) => f.rule === 'raw-color')).toBe(true);
  });
  it('decodes one-slash JS unicode escapes without evaluating runtime expressions', () => {
    const slash = String.fromCharCode(92);
    const source = `// heading\nconst c = '#${slash}u0066f0000';`;
    expect(scanRawValues('a.tsx', source)).toContainEqual(expect.objectContaining({ line: 2, rule: 'raw-color' }));
    expect(scanRawValues('a.tsx', `const c = '#${slash}${slash}u0066f0000';`)).toEqual([]);
    expect(scanRawValues('a.tsx', `const c = 'hello${slash}'world';`)).toEqual([]);
  });
  it('decodes CSS escapes and preserves source lines', () => {
    const slash = String.fromCharCode(92);
    expect(scanRawValues('a.css', `.x {\n background: r${slash}65 d;\n}`).some((f) => f.rule === 'raw-color' && f.line === 2)).toBe(true);
    expect(scanRawValues('a.css', `.x { background: var(--red); }`)).toEqual([]);
  });
  it.each(['+14', '-14', '+.5', '-1e2'])('reads unary style sizes %s', (value) => {
    expect(scanRawValues('a.tsx', `const s = { fontSize: ${value} };`).some((f) => f.rule === 'raw-size')).toBe(true);
  });
  it.each(['+0', '-0'])('keeps zero radius %s', (value) => {
    expect(scanRawValues('a.tsx', `const s = { borderRadius: ${value} };`)).toEqual([]);
  });
  it.each(['50', '100', '900', '950'])('recognizes palette boundary %s', (n) => {
    expect(scanRawValues('a.tsx', `const cls = 'bg-red-${n}';`).some((f) => f.rule === 'palette-class')).toBe(true);
  });
  it.each(['000', '00', '0', '49', '99', '999', '1000'])('does not invent palette shade %s', (n) => {
    expect(scanRawValues('a.tsx', `const cls = 'bg-red-${n}';`)).toEqual([]);
    expect(scanRawValues('a.css', `.x { color: var(--color-red-${n}); }`)).toEqual([]);
  });
});
