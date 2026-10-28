// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The app's own test commands as `fwos tests run` runs them: which scripts count, which runner each
// calls, and the JUnit reporter fwos adds on the command line, never in the team's config. A runner
// fwos can't add a reporter to is still run, and says why its results can't count.

import { afterAll, describe, expect, it } from 'vitest';
import { loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { runnerOf, testCommands } from '../index.ts';

afterAll(cleanupTempProjects);

const adopted = (paths: object = { apps: { web: '.' }, source: ['app/**'] }) => ({ schema: 1, pluginVersion: '0.1.0', mode: 'adopt', platforms: ['web'], adopt: { level: 'delivery' }, paths });
const app = (scripts: Record<string, string>, extra: Record<string, string | object> = {}) =>
  loadProject(tempProject({ '.fwos/state.json': adopted(), 'package.json': { scripts, dependencies: { next: '15.3.0' } }, 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n", ...extra }));

describe('runnerOf: the runner a script calls', () => {
  it.each([
    ['vitest run', 'Vitest'],
    ['vitest', 'Vitest'],
    ['NODE_ENV=test vitest run --project unit', 'Vitest'],
    ['cross-env TZ=UTC jest --ci', 'Jest'],
    ['dotenv -e .env.test -- vitest run', 'Vitest'],
    ['playwright test', 'Playwright'],
    ['pnpm exec playwright test --project chromium', 'Playwright'],
    ['npx cypress run', 'Cypress'],
    ["mocha 'test/**/*.spec.js'", 'Mocha'],
    ['ava', 'AVA'],
    ['node --test', 'node:test'],
    ['jasmine', 'Jasmine'],
  ])('%s -> %s', (command, runner) => {
    expect(runnerOf(command).runner).toBe(runner);
  });

  it('says when it runs more than one command, or something no runner it knows', () => {
    expect(runnerOf('vitest run && playwright test')).toMatchObject({ runner: null, chained: true });
    expect(runnerOf('node scripts/check-links.mjs')).toMatchObject({ runner: null, chained: false });
  });

  it('knows the modes that wait for a person: watch, a UI, an interactive runner', () => {
    for (const c of ['vitest --watch', 'vitest watch', 'vitest --ui', 'jest --watch', 'playwright test --ui', 'cypress open']) expect(runnerOf(c).interactive, c).toBe(true);
    for (const c of ['vitest run', 'jest --ci', 'playwright test', 'cypress run']) expect(runnerOf(c).interactive, c).toBe(false);
  });
});

describe('testCommands: the scripts fwos runs, with a JUnit reporter on the command line', () => {
  it('runs test, test:*, e2e and e2e:* scripts, and leaves the rest alone', () => {
    const p = app({ dev: 'next dev', build: 'next build', lint: 'next lint', test: 'vitest run', 'test:watch': 'vitest', 'test:ui': 'vitest --ui', e2e: 'playwright test', 'e2e:open': 'cypress open' });
    const { commands, skipped } = testCommands(p);
    expect(commands.map((c) => c.script)).toEqual(['test', 'e2e']);
    expect(skipped).toEqual([
      { script: 'test:watch', dir: '.', why: 'it watches for changes and never ends' },
      { script: 'test:ui', dir: '.', why: 'it waits for a person (a UI or an interactive runner)' },
      { script: 'e2e:open', dir: '.', why: 'it waits for a person (a UI or an interactive runner)' },
    ]);
  });

  it('adds Vitest and Playwright JUnit reporters as arguments and environment, never in their config', () => {
    const p = app({ test: 'vitest run', e2e: 'playwright test' });
    const [vitest, playwright] = testCommands(p).commands;
    expect(vitest).toEqual({
      script: 'test',
      dir: '.',
      command: 'vitest run',
      display: 'pnpm test',
      runner: 'Vitest',
      browser: false,
      argv: ['pnpm', 'run', 'test', '--reporter=default', '--reporter=junit', `--outputFile.junit=${p.abs('.fwos/local/results/test.xml')}`],
      env: {},
      results: '.fwos/local/results/test.xml',
      format: 'junit',
    });
    expect(playwright).toMatchObject({
      display: 'pnpm e2e',
      runner: 'Playwright',
      browser: true,
      argv: ['pnpm', 'run', 'e2e', '--reporter=list,junit'],
      env: { PLAYWRIGHT_JUNIT_OUTPUT_FILE: p.abs('.fwos/local/results/e2e.xml') },
      results: '.fwos/local/results/e2e.xml',
    });
  });

  it("reads Jest's own JSON, and Cypress's and Mocha's built-in JUnit reporters", () => {
    const p = app({ test: 'jest --ci', 'e2e:cypress': 'cypress run', 'test:legacy': 'mocha test/' });
    const byScript = Object.fromEntries(testCommands(p).commands.map((c) => [c.script, c]));
    expect(byScript.test).toMatchObject({
      runner: 'Jest',
      argv: ['pnpm', 'run', 'test', '--json', `--outputFile=${p.abs('.fwos/local/raw/test.jest.json')}`],
      results: '.fwos/local/results/test.xml',
      format: 'jest-json',
    });
    expect(byScript['e2e:cypress']).toMatchObject({
      runner: 'Cypress',
      browser: true,
      argv: ['pnpm', 'run', 'e2e:cypress', '--reporter', 'junit', '--reporter-options', `mochaFile=${p.abs('.fwos/local/results/e2e-cypress-[hash].xml')}`],
      results: '.fwos/local/results/e2e-cypress-*.xml',
    });
    expect(byScript['test:legacy']).toMatchObject({
      runner: 'Mocha',
      argv: ['pnpm', 'run', 'test:legacy', '--reporter', 'xunit', '--reporter-option', `output=${p.abs('.fwos/local/results/test-legacy.xml')}`],
      results: '.fwos/local/results/test-legacy.xml',
    });
  });

  it("runs what it can't add a reporter to as it is, and says why its results can't count", () => {
    const p = app({ test: 'ava', 'test:links': 'node scripts/check-links.mjs', 'test:all': 'vitest run && playwright test' });
    const byScript = Object.fromEntries(testCommands(p).commands.map((c) => [c.script, c]));
    expect(byScript.test).toMatchObject({ runner: 'AVA', argv: ['pnpm', 'run', 'test'], results: null, unmapped: "fwos can't add a JUnit reporter to AVA on the command line" });
    expect(byScript['test:links']).toMatchObject({ runner: null, argv: ['pnpm', 'run', 'test:links'], results: null, unmapped: "fwos doesn't know how to read results from `node scripts/check-links.mjs`" });
    expect(byScript['test:all']).toMatchObject({ runner: null, results: null, unmapped: 'it runs more than one command, so fwos can\'t add a reporter to it; run each with a script of its own' });
  });

  it('runs the scripts an aggregate script calls, each on its own, instead of the aggregate', () => {
    const p = app({ test: 'pnpm run test:unit && pnpm run e2e', 'test:unit': 'vitest run', e2e: 'playwright test' });
    const { commands, skipped } = testCommands(p);
    expect(commands.map((c) => c.script)).toEqual(['test:unit', 'e2e']);
    expect(skipped).toEqual([{ script: 'test', dir: '.', why: 'it runs test:unit and e2e, which run here on their own' }]);
  });

  it("runs a monorepo app's scripts in its folder, and skips the root's that only reach into it", () => {
    const root = tempProject({
      '.fwos/state.json': adopted({ apps: { web: 'apps/site' }, source: ['apps/site/**'] }),
      'package.json': { private: true, scripts: { test: 'pnpm --filter site test' } },
      'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
      'apps/site/package.json': { name: 'site', scripts: { test: 'vitest run' }, dependencies: { next: '15.3.0' } },
    });
    const p = loadProject(root);
    const { commands, skipped } = testCommands(p);
    expect(commands).toEqual([expect.objectContaining({ script: 'test', dir: 'apps/site', display: 'pnpm test in apps/site', results: '.fwos/local/results/apps-site-test.xml' })]);
    expect(skipped).toEqual([{ script: 'test', dir: '.', why: 'it runs scripts in another package (pnpm --filter site test); fwos runs those where they are' }]);
  });

  it("calls each package manager the way it passes arguments to a script", () => {
    const npm = loadProject(tempProject({ '.fwos/state.json': adopted(), 'package.json': { scripts: { test: 'vitest run', e2e: 'playwright test' } }, 'package-lock.json': '{}' }));
    expect(testCommands(npm).commands.map((c) => [c.display, c.argv.slice(0, 4)])).toEqual([
      ['npm test', ['npm', 'run', 'test', '--']],
      ['npm run e2e', ['npm', 'run', 'e2e', '--']],
    ]);
    const yarn = loadProject(tempProject({ '.fwos/state.json': adopted(), 'package.json': { scripts: { test: 'vitest run' } }, 'yarn.lock': '' }));
    expect(testCommands(yarn).commands[0]).toMatchObject({ display: 'yarn test', argv: ['yarn', 'run', 'test', '--reporter=default', '--reporter=junit', expect.any(String)] });
    const bun = loadProject(tempProject({ '.fwos/state.json': adopted(), 'package.json': { scripts: { test: 'vitest run' } }, 'bun.lock': '' }));
    expect(testCommands(bun).commands[0]).toMatchObject({ display: 'bun run test', argv: ['bun', 'run', 'test', '--reporter=default', '--reporter=junit', expect.any(String)] });
  });

  it('runs a script it was asked for by name, test-named or not, and nothing else', () => {
    const p = app({ test: 'vitest run', unit: 'vitest run --project unit', e2e: 'playwright test' });
    expect(testCommands(p, ['unit', 'e2e']).commands.map((c) => c.script)).toEqual(['unit', 'e2e']);
    expect(() => testCommands(p, ['smoke'])).toThrow(/No script "smoke" in package\.json/);
  });
});
