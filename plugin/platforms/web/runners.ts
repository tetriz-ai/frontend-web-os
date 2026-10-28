// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The app's own test commands, for `fwos tests run`: its package.json test scripts, run through
// its package manager as the team runs them, with a JUnit reporter added on the command line for
// the runners fwos knows. The team's runner configs stay as they are. A script fwos can't add a
// reporter to still runs, and says why its results can't prove anything.

import { posix } from 'node:path';
import { FwosError, type Project, type TestCommand, type TestCommandAdapter, isFile, readJson } from '../../kernel/index.ts';

type Scripts = Record<string, string>;
type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/** Where fwos's own runs put their JUnit XML, read by traceability like any other results. */
const RESULTS = '.fwos/local/results';
/** Raw output a runner writes before fwos turns it into JUnit (Jest's JSON). */
const RAW = '.fwos/local/raw';

/** Script names `fwos tests run` runs by default: test, test:*, e2e and e2e:*. */
const TEST_NAME = /^(?:test|e2e)(?:[:_-][\w:.-]*)?$/i;
const WATCH_NAME = /(?:^|[:_-])(?:watch|dev)$/i;
const PERSON_NAME = /(?:^|[:_-])(?:ui|open|debug)$/i;

// ---- reading a command --------------------------------------------------------------------------

/** Splits a shell command into words, keeping quoted text whole, and says whether it chains commands. */
function words(command: string): { words: string[]; chained: boolean; segments: string[][] } {
  const segments: string[][] = [[]];
  let word = '';
  let quote = '';
  let quoted = false;
  let chained = false;
  const flush = () => {
    if (word || quoted) segments.at(-1)!.push(word);
    word = '';
    quoted = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === quote) quote = '';
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      quoted = true;
    } else if (/\s/.test(c)) flush();
    else if (c === '&' || c === '|' || c === ';') {
      flush();
      chained = true;
      if (command[i + 1] === c) i++;
      segments.push([]);
    } else word += c;
  }
  flush();
  const nonEmpty = segments.filter((s) => s.length > 0);
  return { words: nonEmpty.flat(), chained, segments: nonEmpty };
}

/** The words after what only sets up the command: `FOO=1`, `cross-env`, `dotenv -e x --`, `npx`, `pnpm exec`. */
function program(ws: string[]): string[] {
  let rest = [...ws];
  for (;;) {
    const [w, ...more] = rest;
    if (w === undefined) return rest;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || w === 'env') rest = more;
    else if (w === 'cross-env') rest = more;
    else if (w === 'dotenv' || w === 'dotenv-cli') {
      const end = more.indexOf('--');
      rest = end === -1 ? more.filter((x, i) => !x.startsWith('-') && !more[i - 1]?.startsWith('-')) : more.slice(end + 1);
    } else if (w === 'npx' || w === 'bunx' || w === 'pnpx') rest = more.filter((x, i) => i > 0 || !x.startsWith('-'));
    else if ((w === 'pnpm' || w === 'npm' || w === 'yarn' || w === 'bun') && (more[0] === 'exec' || more[0] === 'dlx' || more[0] === 'x')) rest = more.slice(1);
    else if (w === 'yarn' && more[0] && !['run', 'test', 'workspace', 'workspaces'].includes(more[0]) && !more[0].startsWith('-')) rest = more;
    else return rest;
  }
}

export interface RunnerInfo {
  /** `Vitest`, `Playwright`, `Jest`, `Cypress`, `Mocha`, or a runner fwos knows but can't map (`AVA`); null for anything else. */
  runner: string | null;
  /** The command chains several (`a && b`, `a | b`). */
  chained: boolean;
  /** It waits for a person or never ends: watch mode, a UI, `cypress open`. */
  interactive: boolean;
  /** Of those, the ones that watch for changes. */
  watch: boolean;
  /** It drives a real browser. */
  browser: boolean;
}

/** The test runner a script's command calls, read from its words. */
export function runnerOf(command: string): RunnerInfo {
  const { words: ws, chained } = words(command);
  const [cmd = '', sub = '', ...args] = program(ws);
  const all = [sub, ...args];
  const has = (...flags: string[]) => all.some((a) => flags.some((f) => a === f || a.startsWith(`${f}=`) || a.startsWith(`${f}.`)));
  const out = (runner: string | null, o: Partial<RunnerInfo> = {}): RunnerInfo => {
    const watch = o.watch ?? false;
    return { runner, chained, interactive: watch || (o.interactive ?? false), watch, browser: o.browser ?? false };
  };
  if (chained) return out(null);
  switch (cmd) {
    case 'vitest':
      return out('Vitest', { watch: sub === 'watch' || sub === 'dev' || has('--watch', '-w'), interactive: has('--ui'), browser: has('--browser') });
    case 'jest':
      return out('Jest', { watch: has('--watch', '--watchAll') });
    case 'playwright':
      return sub === 'test' ? out('Playwright', { interactive: has('--ui', '--debug'), browser: true }) : out(null);
    case 'cypress':
      return sub === 'run' ? out('Cypress', { browser: true }) : sub === 'open' || sub === '' ? out('Cypress', { interactive: true, browser: true }) : out(null);
    case 'mocha':
      return out('Mocha', { watch: has('--watch', '-w') });
    case 'ava':
      return out('AVA', { watch: has('--watch', '-w') });
    case 'jasmine':
      return out('Jasmine');
    case 'tap':
      return out('node-tap');
    case 'uvu':
      return out('uvu');
    case 'node':
      return ws.includes('--test') ? out('node:test', { watch: ws.includes('--watch') }) : out(null);
    case 'bun':
      return sub === 'test' ? out('bun test', { watch: has('--watch') }) : out(null);
    default:
      return out(null);
  }
}

// ---- the reporters fwos adds --------------------------------------------------------------------

interface Reporter {
  args: string[];
  env: Record<string, string>;
  results: string;
  format: 'junit' | 'jest-json';
  raw?: string;
}

/** The JUnit reporter for each runner fwos can map, given where results go (relative) and the project. */
const REPORTERS: Record<string, (p: Project, slug: string) => Reporter> = {
  Vitest: (p, slug) => {
    const file = `${RESULTS}/${slug}.xml`;
    return { args: ['--reporter=default', '--reporter=junit', `--outputFile.junit=${p.abs(file)}`], env: {}, results: file, format: 'junit' };
  },
  Playwright: (p, slug) => {
    const file = `${RESULTS}/${slug}.xml`;
    return { args: ['--reporter=list,junit'], env: { PLAYWRIGHT_JUNIT_OUTPUT_FILE: p.abs(file) }, results: file, format: 'junit' };
  },
  Jest: (p, slug) => {
    const raw = `${RAW}/${slug}.jest.json`;
    return { args: ['--json', `--outputFile=${p.abs(raw)}`], env: {}, results: `${RESULTS}/${slug}.xml`, format: 'jest-json', raw };
  },
  Cypress: (p, slug) => ({
    args: ['--reporter', 'junit', '--reporter-options', `mochaFile=${p.abs(`${RESULTS}/${slug}-[hash].xml`)}`],
    env: {},
    results: `${RESULTS}/${slug}-*.xml`,
    format: 'junit',
  }),
  Mocha: (p, slug) => {
    const file = `${RESULTS}/${slug}.xml`;
    return { args: ['--reporter', 'xunit', '--reporter-option', `output=${p.abs(file)}`], env: {}, results: file, format: 'junit' };
  },
};

const slugOf = (dir: string, script: string) => `${dir === '.' ? '' : `${dir}-`}${script}`.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- the package manager ------------------------------------------------------------------------

function packageManager(p: Project): PackageManager {
  for (const [file, pm] of [['pnpm-lock.yaml', 'pnpm'], ['package-lock.json', 'npm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun']] as const) {
    if (isFile(p.abs(file))) return pm;
  }
  const declared = readPkg(p, '.')?.packageManager;
  const name = typeof declared === 'string' ? declared.split('@')[0] : '';
  return name === 'npm' || name === 'yarn' || name === 'bun' ? name : 'pnpm';
}

/** How the package manager runs a script with extra arguments, and how the team types it. */
function invocation(pm: PackageManager, script: string, args: string[]): { argv: string[]; display: string } {
  switch (pm) {
    case 'npm':
      return { argv: ['npm', 'run', script, ...(args.length > 0 ? ['--', ...args] : [])], display: script === 'test' ? 'npm test' : `npm run ${script}` };
    case 'yarn':
      return { argv: ['yarn', 'run', script, ...args], display: `yarn ${script}` };
    case 'bun':
      return { argv: ['bun', 'run', script, ...args], display: `bun run ${script}` };
    default:
      return { argv: ['pnpm', 'run', script, ...args], display: `pnpm ${script}` };
  }
}

// ---- the scripts --------------------------------------------------------------------------------

function readPkg(p: Project, dir: string): { scripts?: Scripts; packageManager?: unknown } | null {
  try {
    return readJson(p.abs(posix.join(dir, 'package.json')));
  } catch {
    return null;
  }
}

/** A script that only runs other scripts: of its own package (`pnpm run a && pnpm run b`), or of others (`pnpm --filter x test`). */
function delegates(command: string, scripts: Scripts): { same: string[] } | { other: true } | null {
  const { segments } = words(command);
  const same: string[] = [];
  for (const seg of segments) {
    const [pm, ...rest] = seg;
    if (!pm || !['pnpm', 'npm', 'yarn', 'bun'].includes(pm)) return null;
    if (rest.some((w) => /^(?:--filter|-F|-r|--recursive|-C|--dir|--prefix|-w|--workspace|--workspaces|--cwd)(?:=|$)/.test(w)) || rest[0] === 'workspace' || rest[0] === 'workspaces') return { other: true };
    const names = rest.filter((w) => !w.startsWith('-'));
    const name = names[0] === 'run' || names[0] === 'run-script' ? names[1] : names[0];
    if (!name || !(name in scripts)) return null;
    same.push(name);
  }
  return same.length > 0 ? { same } : null;
}

const list = (names: string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/** One script, as fwos runs it: with the runner's reporter when fwos knows one, else as it is. */
function commandFor(p: Project, pm: PackageManager, dir: string, script: string, command: string): TestCommand {
  const r = runnerOf(command);
  const slug = slugOf(dir, script);
  const where = dir === '.' ? '' : ` in ${dir}`;
  const reporter = r.runner ? REPORTERS[r.runner] : undefined;
  if (reporter && !r.chained) {
    const rep = reporter(p, slug);
    const { argv, display } = invocation(pm, script, rep.args);
    return { script, dir, command, display: `${display}${where}`, runner: r.runner, browser: r.browser, argv, env: rep.env, results: rep.results, format: rep.format, ...(rep.raw ? { raw: rep.raw } : {}) };
  }
  const { argv, display } = invocation(pm, script, []);
  const unmapped = r.chained
    ? "it runs more than one command, so fwos can't add a reporter to it; run each with a script of its own"
    : r.runner
      ? `fwos can't add a JUnit reporter to ${r.runner} on the command line`
      : `fwos doesn't know how to read results from \`${command}\``;
  return { script, dir, command, display: `${display}${where}`, runner: r.runner, browser: r.browser, argv, env: {}, results: null, unmapped };
}

/**
 * The app's test scripts as fwos runs them. By default every test, test:*, e2e and e2e:* script in
 * the app's package.json (and the root's, for an app in a subfolder), less those that never end or
 * wait for a person. A script that only runs others of its package runs as those others, one by
 * one, so each gets its reporter; one that reaches into another package is left to that package.
 * Named scripts run whatever their name.
 */
export function testCommands(p: Project, names?: string[]): ReturnType<TestCommandAdapter['commands']> {
  const app = p.paths.apps.web ?? '.';
  const pm = packageManager(p);
  const packages = [...new Set(['.', app])].map((dir) => ({ dir, scripts: readPkg(p, dir)?.scripts ?? {} }));
  const commands: TestCommand[] = [];
  const skipped: { script: string; dir: string; why: string }[] = [];
  const seen = new Set<string>();

  const add = (dir: string, scripts: Scripts, script: string, named: boolean, depth = 0): void => {
    const key = `${dir}\0${script}`;
    if (seen.has(key) || depth > 5) return;
    seen.add(key);
    const command = scripts[script]!;
    const d = delegates(command, scripts);
    if (d && 'other' in d) return void skipped.push({ script, dir, why: `it runs scripts in another package (${command}); fwos runs those where they are` });
    if (d) {
      skipped.push({ script, dir, why: `it runs ${list(d.same)}, which run here on their own` });
      for (const s of d.same) add(dir, scripts, s, named, depth + 1);
      return;
    }
    const r = runnerOf(command);
    if (!named && (r.watch || WATCH_NAME.test(script))) return void skipped.push({ script, dir, why: 'it watches for changes and never ends' });
    if (!named && (r.interactive || PERSON_NAME.test(script))) return void skipped.push({ script, dir, why: 'it waits for a person (a UI or an interactive runner)' });
    commands.push(commandFor(p, pm, dir, script, command));
  };

  if (names && names.length > 0) {
    for (const name of names) {
      // The app's own script first: in a monorepo the root's is usually a way into it.
      const pkg = [...packages].reverse().find((x) => name in x.scripts);
      if (!pkg) {
        const files = packages.map((x) => posix.join(x.dir, 'package.json')).join(' or ');
        throw new FwosError(`No script "${name}" in ${files}.`, `fwos tests run runs your own scripts: ${packages.flatMap((x) => Object.keys(x.scripts).filter((s) => TEST_NAME.test(s))).join(', ') || 'none is a test script yet'}.`);
      }
      add(pkg.dir, pkg.scripts, name, true);
    }
  } else {
    for (const { dir, scripts } of packages) for (const script of Object.keys(scripts)) if (TEST_NAME.test(script)) add(dir, scripts, script, false);
  }
  return { commands, skipped };
}

export const tests: TestCommandAdapter = { platform: 'web', commands: testCommands };
