// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { transformSync } from 'esbuild';
import { fingerprint, loadProject, readJson, writeText } from '../../plugin/kernel/index.ts';
import { cleanupTempProjects, copyFixture, tempProject } from '../../plugin/kernel/testing.ts';
import { honouredBaseline, applyBaseline } from '../../plugin/modules/state/index.ts';
import { changedFiles } from '../../plugin/modules/build/index.ts';
import { loadComponents, parseColor } from '../../plugin/modules/design-system/index.ts';
import { mockFetchSource } from '../../plugin/platforms/web/index.ts';
import { renderTemplate } from '../../plugin/modules/screens/index.ts';
import { regressionResults } from '../../plugin/modules/tests/index.ts';
afterAll(cleanupTempProjects);
it.each([true, false])('never widens an uncommitted mixed baseline representation: %s', (legacy) => {
  const finding = { file: 'app/x.ts', rule: 'x', message: 'new defect' };
  const head: any = { schema: 1, createdAt: '', checks: { x: '' }, findings: { x: legacy ? [] : {} } };
  const known = legacy ? { [fingerprint('x', finding)]: 99 } : [['x', finding.file, finding.rule, finding.message].join('|')];
  const working = { ...head, findings: { x: known } };
  const baseline = honouredBaseline(working, head).baseline;
  expect(applyBaseline([{ id: 'x', status: 'fail', findings: [finding], inputs: [] }], baseline)[0]?.findings).toHaveLength(1);
});
it('keeps unicode and newline git paths losslessly in scope drift', () => {
  const root = tempProject({ 'apps/web/src/é.ts': 'old', 'apps/web/src/line\nbreak.ts': 'old' });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('add', '-A'); git('-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD').trim();
  for (const path of ['apps/web/src/é.ts', 'apps/web/src/line\nbreak.ts']) writeText(join(root, path), 'changed');
  expect(changedFiles(root, commit)).toEqual(['apps/web/src/line\nbreak.ts', 'apps/web/src/é.ts']);
});
it('honors the configured component registry even without an explicit design-system argument', () => {
  const root = copyFixture(new URL('../../plugin/modules/design-system/checks/fixtures/schema/good/', import.meta.url).pathname);
  const path = join(root, 'design-system/design-system.json'); const config = readJson<any>(path)!; config.components = 'registry.json'; writeText(path, JSON.stringify(config));
  writeText(join(root, 'design-system/registry.json'), JSON.stringify({ schema: 1, components: [{ id: 'button', status: 'stable', source: 'local', requiredStates: ['loading'] }] }));
  expect(loadComponents(loadProject(root))?.path).toBe('design-system/registry.json');
});
it('reads grad as a quarter turn at 100grad', () => { expect(parseColor('hsl(100grad 100% 50%)')).toEqual(parseColor('hsl(90deg 100% 50%)')); });
it('does not count a skipped-only regression file as executed', () => {
  const root = tempProject({ '.fwos/local/results/r.xml': '<testsuite><testcase classname="app/a.test.ts" name="skipped"><skipped/></testcase></testsuite>' });
  expect(regressionResults(loadProject(root), [{ path: 'app/a.test.ts' }])[0]?.ran).toBe(false);
});
it('serializes nonidentifier operation keys and nested fixture import paths', () => {
  const contract: any = { source: 'packages/api-contract/openapi.yaml', dir: 'packages/api-contract', operations: [{ operationId: 'list-items', method: 'GET', path: '/items' }], fixtures: [{ operationId: 'list-items', variant: 'default', file: 'packages/api-contract/fixtures/nested/list-items.default.json', value: { status: 200 } }] };
  const source = mockFetchSource(contract);
  expect(() => transformSync(source, { loader: 'ts' })).not.toThrow();
  expect(source).toContain('../fixtures/nested/list-items.default.json');
});
it.each(['My "App"', 'A\\B', 'one\ntwo'])('quotes app display names in generated TS/JSON/YAML: %s', (APP_NAME) => {
  const files = renderTemplate('web', { APP_NAME, APP_SLUG: 'example-app' });
  for (const file of files.filter((file) => file.path.endsWith('.json'))) expect(() => JSON.parse(file.content.replace(/^\s*\/\/.*$/gm, '')), file.path).not.toThrow();
  const layout = files.find((file) => file.path.endsWith('app/layout.tsx'))!;
  expect(() => transformSync(layout.content, { loader: 'tsx' })).not.toThrow();
});
