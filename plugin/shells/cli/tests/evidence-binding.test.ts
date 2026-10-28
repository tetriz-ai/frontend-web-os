// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { loadProject, writeText, type TestCommandAdapter } from '../../../kernel/index.ts';
import { cleanupTempProjects, contextFor, tempProject } from '../../../kernel/testing.ts';
import { initProject, updateChange } from '../../../modules/state/index.ts';
import { checks, readTestRuns } from '../../../modules/tests/index.ts';
import { runTests } from '../testrun.ts';
afterAll(cleanupTempProjects);
const xml = '<testsuite><testcase classname="test" name="synthetic tagged result @AC-x-1"/></testsuite>';
const result = '.fwos/local/results/test.xml';
const adapter: TestCommandAdapter = { platform: 'web', commands: () => ({ skipped: [], commands: [{ script: 'test', dir: '.', display: 'node runner.mjs', command: 'node runner.mjs', runner: 'fixture', browser: false, argv: [process.execPath, 'runner.mjs'], env: {}, results: result, format: 'junit' }] }) };
function project() {
  const root = tempProject({ 'docs/app/spec.md': '## 10. Acceptance criteria\n### AC-x-1: a\n- Proven against: local\n', 'apps/web/app/page.tsx': 'export default function P(){return null;}', 'apps/web/a.test.ts': 'test input', 'runner.mjs': `import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('.fwos/local/results',{recursive:true});writeFileSync('${result}',${JSON.stringify(xml)});` });
  initProject(root); updateChange(root, (change) => { change.step = 'accept'; });
  return root;
}
const check = (root: string) => checks.find((c) => c.id === 'tests/traceability')!.run(contextFor(root));
it('does not accept unbound XML as a test execution', async () => {
  const root = project(); writeText(join(root, result), xml);
  expect((await check(root)).status).toBe('fail');
});
it('accepts current results produced through the existing test runner', async () => {
  const root = project(); expect(runTests(loadProject(root), adapter, []).exit).toBe(0);
  expect((await check(root)).status).toBe('pass');
});
it.each([result, 'apps/web/app/page.tsx', 'apps/web/a.test.ts', 'runner.mjs'])('invalidates a recorded result after editing %s', async (path) => {
  const root = project(); runTests(loadProject(root), adapter, []);
  writeText(join(root, path), path === result ? xml.replace('synthetic', 'edited') : 'changed input');
  expect((await check(root)).status).toBe('fail');
});
it('does not bind tests changed while a command is running', async () => {
  const root = project(); writeText(join(root, 'runner.mjs'), `import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('.fwos/local/results',{recursive:true});writeFileSync('${result}',${JSON.stringify(xml)});writeFileSync('apps/web/a.test.ts','changed during execution');`);
  expect(runTests(loadProject(root), adapter, []).runs[0]?.revision).toBeNull();
  expect((await check(root)).status).toBe('fail');
});
it.each(['', 'not XML'])('a script producing no readable cases proves nothing: %s', async (output) => {
  const root = project(); writeText(join(root, 'runner.mjs'), `import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('.fwos/local/results',{recursive:true});writeFileSync('${result}',${JSON.stringify(output)});`);
  runTests(loadProject(root), adapter, []);
  expect(readTestRuns(loadProject(root))[0]?.mapped).toBe(false);
  expect((await check(root)).status).toBe('fail');
});

it('fails acceptance when a command exits nonzero despite passing XML', async () => {
  const root = project(); writeText(join(root, 'runner.mjs'), `import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('.fwos/local/results',{recursive:true});writeFileSync('${result}',${JSON.stringify(xml)});process.exitCode=1;`);
  expect(runTests(loadProject(root), adapter, []).exit).toBe(1);
  expect((await check(root)).status).toBe('fail');
});
