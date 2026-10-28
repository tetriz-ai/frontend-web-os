// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Every `fwos` command. Each is thin: parse, call the owning module, print. No step logic here.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import {
  ADOPT_LEVELS,
  type AdoptLevel,
  FwosError,
  STAGE_LABELS,
  type InferredLayout,
  type Platform,
  PLATFORMS,
  type IaRun,
  type Project,
  type ProjectPaths,
  type StateObservation,
  findProjectRoot,
  harnessStatus,
  hashPath,
  hashText,
  isDir,
  judgeStates,
  loadProject,
  normalizeRel,
  pluginPath,
  pluginVersion,
  readJson,
  readRuns,
  readText,
  readWorkflow,
  revisionOf,
  runFreshness,
  writeJson,
  writeRun,
  writeText,
} from '../../kernel/index.ts';
import { buildReport, handoffName, openItems, openLines, openSummary, reportPath, traceChange, traceText } from '../../modules/accept/index.ts';
import { loadContract } from '../../modules/architecture/index.ts';
import { changeDrift, changedFiles, loadSlices, sliceDrift } from '../../modules/build/index.ts';
import {
  DECISIONS,
  type Decision,
  adoptionReport,
  assertNoDesignSystem,
  decide,
  fromShadcn,
  galleryModel,
  loadDesignSystem,
  mapDesignSystem,
  starterFiles,
  tokenOutputs,
  tokenSummary,
} from '../../modules/design-system/index.ts';
import {
  PROMOTIONS,
  TEST_ACCESS_COOKIE,
  diffIa,
  formatAppDiff,
  formatIaDiff,
  iaPath,
  iaRunPlan,
  judgeIaRun,
  loadIa,
  parseIa,
  prototypesDir,
  renderTemplate,
} from '../../modules/screens/index.ts';
import {
  type Change,
  type Link,
  ROUTES,
  type Route,
  type Step,
  APPROVAL_TARGETS,
  allApprovals,
  approvalState,
  approve,
  changeApprovalState,
  createChange,
  currentChange,
  docStaleness,
  initProject,
  addLinks,
  isAdoptionRecord,
  keptStages,
  latestChange,
  listChanges,
  logEvent,
  now,
  readChange,
  requireChange,
  skip,
  slugify,
  stampBasedOn,
  updateChange,
  updateLatestChange,
  writeBaseline,
  writeOwned,
  writeOwnedAll,
  writeYours,
} from '../../modules/state/index.ts';
import { acHashes, parseAcs, parseQuestions, specPath } from '../../modules/spec/index.ts';
import { lockTests, lockedFiles, parseTestPlan, runnersOf, testPlanPath, unlockTest } from '../../modules/tests/index.ts';
import { ADOPTED_ROUTE_ENTRY, ROUTE_ENTRY, ROUTE_TABLE, nextStep, setStep } from '../flow/index.ts';
import { dispatch, type HookEvent, readStdin } from '../hooks/index.ts';
import { type AdoptOptions, adoptionStatus, applyAdoption, changeWorkflow, formatCapabilities, formatPlan, planAdoption } from './adopt.ts';
import { assertFidelityReady, galleryNext, outcomeLines, writeDesignReport } from './design.ts';
import { doctor, formatDoctor } from './doctor.ts';
import { checkBundles, promote, prototypeDiff } from './prototype.ts';
import { stateName, stateTargets } from './targets.ts';
import { applyUpdate, formatDone, formatUpdate, planUpdate, upToDate, updateRefusal } from './update.ts';
import { VENDORED_CLI, VENDORED_PIN, vendorCli } from './vendor.ts';
import { WORKFLOWS, commitHookPath, fromRoot, fwosLines, runsFwos, workflows } from './repo.ts';
import { bold, dim, formatResults, green, red, yellow } from './format.ts';
import { CODEX_AGENTS_DIR, cliOnlyDistribution, inCodex, writeCodexAgents } from './codex.ts';
import { PROFILES, adaptersFor, allChecks, profilesFor } from './registry.ts';
import { exitCode, runChecks, unbaselined } from './runner.ts';
import { formatStages, stagesOf } from './stages.ts';
import { runTests } from './testrun.ts';

export interface Args {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

export interface Io {
  /** Prints each argument on its own line. */
  out(...lines: string[]): void;
  err(...lines: string[]): void;
  cwd: string;
}

type Command = (args: Args, io: Io) => Promise<number> | number;

const str = (a: Args, k: string): string | undefined => {
  const v = a.flags[k];
  return typeof v === 'string' ? v : Array.isArray(v) ? v[v.length - 1] : undefined;
};
const bool = (a: Args, k: string) => a.flags[k] === true || a.flags[k] === 'true';
const need = (a: Args, k: string, hint: string): string => {
  const v = str(a, k);
  if (!v || !v.trim()) throw new FwosError(`Missing --${k}.`, hint);
  return v;
};

/** The project root: --dir, else the nearest folder with .fwos/state.json, else the working directory. */
/** `--dir`, checked: a bare `--dir` or one that isn't a folder is a usage error, never a quiet fallback to the cwd. */
function dirFlag(args: Args): string | undefined {
  if (args.flags.dir === undefined) return undefined;
  const dir = str(args, 'dir');
  if (dir === undefined || dir === '') throw new FwosError('--dir needs a folder: --dir <path>.');
  if (!isDir(dir)) throw new FwosError(`--dir ${dir} isn't a folder.`);
  return dir;
}

export function projectFor(args: Args, io: Io): Project {
  const dir = dirFlag(args);
  return loadProject(dir ?? findProjectRoot(io.cwd) ?? io.cwd);
}

/**
 * The project for `check` and `report`. When .fwos/state.json doesn't parse it takes the default
 * paths instead of stopping, so state/schema fails on the file and every other check is off.
 */
function projectToCheck(args: Args, io: Io): Project {
  const root = dirFlag(args) ?? findProjectRoot(io.cwd) ?? io.cwd;
  try {
    return loadProject(root);
  } catch (e) {
    if (!(e instanceof FwosError)) throw e;
    return loadProject(root, { defaults: true });
  }
}

function requireInit(p: Project): void {
  if (!p.initialized) throw new FwosError('Not an fwos project (no .fwos/state.json).', 'Run /fwos:start in Claude Code, or `fwos init` to set it up.');
}

const json = (io: Io, v: unknown) => io.out(JSON.stringify(v, null, 2));

// ---------------------------------------------------------------------------------------------

const adopt: Command = async (a, io) => {
  const root = dirFlag(a) ?? findProjectRoot(io.cwd) ?? io.cwd;
  const level = str(a, 'level');
  if (level !== undefined && !(ADOPT_LEVELS as readonly string[]).includes(level)) {
    throw new FwosError(`Unknown level "${level}".`, `One of: ${ADOPT_LEVELS.join(', ')}. Each level includes the ones before it.`);
  }
  const opts: AdoptOptions = {};
  for (const [flag, key] of [['app', 'app'], ['docs', 'docs'], ['design-system', 'designSystem'], ['name', 'name']] as const) {
    const v = str(a, flag);
    if (v !== undefined) opts[key] = v;
  }
  if (level !== undefined) opts.level = level as AdoptLevel;
  const keep = stagesOf(a.flags.keep as string | string[] | undefined);
  const use = stagesOf(a.flags.use as string | string[] | undefined);
  if (keep.length > 0) opts.keep = keep;
  if (use.length > 0) opts.use = use;
  const reason = str(a, 'reason');
  if (reason !== undefined) opts.reason = reason;
  const plan = await planAdoption(root, opts);
  if (!bool(a, 'yes')) {
    if (bool(a, 'json')) json(io, plan);
    else io.out(...formatPlan(plan, opts));
    return !plan.adopted && plan.support === 'unsupported' ? 1 : 0;
  }
  const lines: string[] = [];
  await applyAdoption(plan, opts, (...l) => lines.push(...l));
  const p = loadProject(root);
  const s = adoptionStatus(p);
  if (bool(a, 'json')) return json(io, { ...plan, written: true, output: lines, adoption: s }), 0;
  io.out(...lines, '', `Capabilities at level ${s.level}`, ...formatCapabilities(s.capabilities));
  io.out(
    '',
    'Next:',
    '  - `fwos status` and `fwos doctor` show what is on, and what turns the rest on.',
    '  - CI and the commit hook need the CLI in the project: `fwos vendor`, then add it with your package manager (pnpm add -D file:.fwos/cli). That changes package.json and the lockfile, so it is your call.',
    s.level === 'delivery' ? '  - To deliver a request in place, use /fwos:change "<request>" (text, or --link an issue or spec).' : `  - More of fwos: \`fwos adopt --level ${s.level === 'checks' ? 'design' : 'delivery'}\` shows what the next level adds.`,
  );
  return 0;
};

const init: Command = (a, io) => {
  const root = dirFlag(a) ?? io.cwd;
  const platforms = (str(a, 'platforms') ?? 'web').split(',').map((p) => p.trim()) as Platform[];
  const bad = platforms.filter((p) => !PLATFORMS.includes(p));
  if (bad.length > 0) throw new FwosError(`Unknown platform: ${bad.join(', ')}.`, `One of: ${PLATFORMS.join(', ')}. Phone apps aren't supported; responsive web or a PWA is.`);
  const mode = (str(a, 'mode') ?? 'new') as 'new' | 'adopt' | 'spike';
  if (!['new', 'adopt', 'spike'].includes(mode)) throw new FwosError(`Unknown mode "${mode}".`, 'One of: new, adopt, spike.');
  const name = str(a, 'name');
  // Adopt mode reads the existing app's layout first, so the checks look where its code is.
  const layouts = mode === 'adopt' ? PROFILES.filter((p) => platforms.includes(p.platform) && p.inferLayout).map((p) => p.inferLayout!(root)) : [];
  const paths = mergeLayouts(layouts);
  const { change } = initProject(root, { mode, platforms, ...(name ? { name } : {}), ...(paths ? { paths } : {}) });
  logEvent(root, 'init', { mode, platforms });
  // An adopted app is checked as it is; the steps and their changes are for apps fwos starts.
  io.out(mode === 'adopt' ? `${green('Created')} .fwos/ to check this app.` : `${green('Created')} .fwos/ and change ${change.id} (step ${change.step}).`);
  if (layouts.length > 0) {
    const found = layouts.flatMap((l) => l.found);
    if (found.length > 0) io.out('Found in your app (written to .fwos/state.json paths; edit it if any is wrong):');
    for (const f of found) io.out(`  ${f.what}: ${f.value}  ${dim(`(${f.from})`)}`);
    for (const m of layouts.flatMap((l) => l.missing)) io.out(yellow(`  Not found: ${m}. The checks that need it stay OFF; set it in .fwos/state.json paths.`));
    io.out(`Next: ${bold('fwos baseline --init')} records today's findings, so only new ones fail.`);
  }
  if (inCodex() && !cliOnlyDistribution()) {
    // The project is set up either way; a sandbox that blocks .codex/ only defers the agents.
    try {
      const { written, unchanged } = writeCodexAgents(root);
      io.out(`Codex: ${written.length + unchanged.length} fwos agents in ${CODEX_AGENTS_DIR}/ (git-ignored, each machine writes its own).`);
    } catch (e) {
      if (!(e instanceof FwosError)) throw e;
      io.out(yellow(`Codex: ${e.message} ${e.hint ?? ''}`.trim()));
    }
  }
  const off = platforms.filter((p) => profilesFor(loadProject(root)).find((x) => x.platform === p)?.status === 'unavailable');
  if (off.length > 0) io.out(yellow(`Note: ${off.join(', ')} can be planned now but not built in fwos ${pluginVersion()}. \`fwos doctor\` says why.`));
  return 0;
};

/** The paths several platforms' layouts found, merged: per-platform maps join, source globs add up. */
function mergeLayouts(layouts: InferredLayout[]): Partial<ProjectPaths> | null {
  if (layouts.length === 0) return null;
  const out: Partial<ProjectPaths> = {};
  for (const { paths } of layouts) {
    if (paths.apps) out.apps = { ...out.apps, ...paths.apps };
    if (paths.ui) out.ui = { ...out.ui, ...paths.ui };
    if (paths.source) out.source = [...new Set([...(out.source ?? []), ...paths.source])];
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Each link of a change, and whether a linked file changed since it was linked. */
const linkLines = (p: Project, c: Change) =>
  (c.links ?? []).map((l) => `${l.ref}${l.sha ? (hashPath(p.abs(l.ref)) === l.sha ? '' : ' (changed since it was linked)') : ''}`);

const status: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const current = currentChange(p.root);
  // An adopted app's adoption record is the app as it was, not a change to show.
  const change = current && !isAdoptionRecord(p, current) ? current : null;
  const adoption = p.mode === 'adopt' ? adoptionStatus(p) : null;
  // A change in an adopted app answers only for the approvals it records; the app itself has none.
  // An on-demand approval (fidelity) is listed once it has been decided, since most projects have none to give.
  const onDemand = new Set(APPROVAL_TARGETS.filter((t) => t.onDemand).map((t) => t.name));
  // The fidelity of fwos's import of the team's design system is approved in an adopted app too.
  const adopted = () => [...(change && change.route !== 'code-only' ? (['spec', 'acceptance'] as const).map((t) => changeApprovalState(p, change, t)) : []), approvalState(p, 'fidelity')];
  const approvals = (!adoption ? allApprovals(p) : adopted()).filter((s) => !onDemand.has(s.target) || ['approved', 'stale', 'skipped'].includes(s.status));
  const locked = lockedFiles(p);
  const staleDocs = docStaleness(p);
  const data = {
    ...(adoption ? { adoption } : {}),
    change: change
      ? { id: change.id, title: change.title, route: change.route, step: change.step, cursor: change.cursor ?? {}, spend: change.spend ?? {}, ...(change.links ? { links: change.links } : {}) }
      : null,
    approvals: approvals.map((s) => ({ target: s.target, status: s.status, required: s.required, ...(s.record ? { by: s.record.by, at: s.record.at, via: s.record.via, ...(s.record.ref ? { ref: s.record.ref } : {}) } : {}), ...(s.changed ? { changed: s.changed } : {}), ...(s.reason ? { reason: s.reason } : {}) })),
    staleDocs,
    lockedTests: { total: locked.length, changed: locked.filter((l) => l.status === 'changed').map((l) => l.path), unlocked: locked.filter((l) => l.status === 'unlocked').map((l) => l.path) },
    changes: listChanges(p.root).map((c) => ({ id: c.id, step: c.step, status: c.status })),
  };
  if (bool(a, 'json')) return json(io, data), 0;
  if (adoption) io.out(bold(`Adopted app at ${adoption.app} (level ${adoption.level} since ${adoption.since})`));
  io.out(bold(change ? `Change ${change.id}: ${change.title}` : 'No open change'));
  if (change) {
    io.out(`  route ${change.route}, step ${bold(change.step)}${change.cursor?.section ? `, section ${change.cursor.section}` : ''}`);
    if (change.cursor?.pending?.length) io.out(`  pending questions: ${change.cursor.pending.join(', ')}`);
    for (const l of linkLines(p, change)) io.out(`  linked: ${l}`);
  }
  if (approvals.length > 0) io.out('', 'Approvals');
  for (const s of approvals) {
    const label = s.status === 'approved' ? green('approved') : s.status === 'stale' ? red('STALE') : s.status === 'skipped' ? yellow('skipped') : dim(s.status);
    const where = s.record?.ref ? ` in ${s.record.ref}` : s.record && s.record.via !== 'chat' ? ` via ${s.record.via}` : '';
    const detail = s.record ? ` by ${s.record.by}${where}` : s.reason ? ` (${s.reason})` : '';
    io.out(`  ${s.target.padEnd(14)} ${label}${detail}${s.changed?.length ? `; changed: ${s.changed.join(', ')}` : ''}${s.required ? '' : dim(' (optional)')}`);
  }
  if (staleDocs.length > 0) {
    io.out('', red('Stale docs'));
    for (const d of staleDocs) io.out(`  ${d.doc}: built from an older ${d.stale.map((s) => s.ref).join(', ')}`);
  }
  if (adoption) io.out('', `Capabilities at level ${adoption.level}`, ...formatCapabilities(adoption.capabilities), '', ...formatStages(adoption.stages, adoption.level, false));
  io.out('', `Locked tests: ${locked.length}${data.lockedTests.changed.length ? red(`, ${data.lockedTests.changed.length} changed without an unlock`) : ''}${data.lockedTests.unlocked.length ? yellow(`, ${data.lockedTests.unlocked.length} unlocked`) : ''}`);
  if (change?.spend && Object.keys(change.spend).length > 0) {
    io.out(`Spend: ${Object.entries(change.spend).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(', ')}`);
  }
  io.out(dim('Checks that are off, and why: `fwos doctor`.'));
  return 0;
};

const next: Command = (a, io) => {
  const p = projectFor(a, io);
  const n = nextStep(p);
  // An adopted app's change fits the team's workflow: the branch named as theirs are, their review.
  const open = p.mode === 'adopt' && p.initialized ? currentChange(p.root) : null;
  if (bool(a, 'json')) return json(io, open && !isAdoptionRecord(p, open) ? { ...n, workflow: changeWorkflow(p, open) } : n), 0;
  io.out(n.action);
  if (n.skill) io.out(dim(`skill: ${n.skill}`));
  return 0;
};

const check: Command = async (a, io) => {
  const p = projectToCheck(a, io);
  const known = allChecks();
  const unknown = a.positionals.filter((o) => !known.some((c) => c.id === o || c.id.startsWith(`${o}/`) || c.id.endsWith(`/${o}`)));
  if (unknown.length > 0) throw new FwosError(`No check matches ${unknown.map((u) => `"${u}"`).join(', ')}.`, 'Name a check (design-system/tokens), a group (design-system) or nothing for all. `fwos doctor` lists every check.');
  let staged: string[] | undefined;
  if (bool(a, 'staged')) {
    // -z and quotePath=false: exact file names, accents included. --no-renames: a rename is a
    // delete plus an add, so moving a locked test away still counts as deleting it.
    // --relative: paths relative to the project, which can sit in a subfolder of the repo.
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'core.quotePath=false', 'diff', '-z', '--name-only', '--relative', '--no-renames', ...args], { cwd: p.root, stdio: ['ignore', 'pipe', 'pipe'] })
        .toString()
        .split('\0')
        .filter(Boolean);
    let unstaged: string[];
    let deleted: string[];
    try {
      staged = git('--cached', '--diff-filter=ACM');
      deleted = git('--cached', '--diff-filter=D');
      unstaged = git();
    } catch (e) {
      throw new FwosError(`Can't read the staged files: ${(e as Error).message.split('\n')[0]}`, 'The commit check fails closed when git state is unreadable.');
    }
    // The checks read files from disk, so disk must match what gets committed: no staged file with
    // unstaged edits, and no file the commit deletes still sitting on disk.
    const both = [...staged.filter((f) => unstaged.includes(f)), ...deleted.filter((f) => existsSync(p.abs(f)))];
    if (both.length > 0) {
      throw new FwosError(
        `${both.join(', ')} ${both.length === 1 ? 'differs' : 'differ'} on disk from what you're committing, so the commit check can't see the commit.`,
        'Stage the whole change (or delete the file you removed from the index), or set the rest aside with `git stash push --keep-index`, then commit again.',
      );
    }
  }
  if (p.mode === 'spike') {
    // A spike runs no checks, so nothing in it is verified: CI and the commit check must not pass it.
    const reason = 'NOT VERIFIED (spike mode): a spike runs no checks and records no approvals. To check this project, set "mode" to "new" in .fwos/state.json.';
    if (bool(a, 'json')) json(io, { results: [], exit: 1, mode: 'spike', reason });
    else io.out(red(reason));
    return 1;
  }
  const results = await runChecks(p, { only: a.positionals, ...(staged ? { staged } : {}) });
  if (bool(a, 'report')) {
    requireInit(p);
    if (results.some((r) => r.id === 'state/schema' && r.status === 'fail')) {
      // The report quotes the change files (approvals, sign-offs, unlocks), so it waits for them.
      const reason = "The report isn't written while state/schema fails: it is built from the .fwos/ records. Fix what it names, then run fwos report again.";
      if (bool(a, 'json')) json(io, { results, exit: 1, reason });
      else io.out(formatResults(results), '', red(reason));
      return 1;
    }
    const statusByPlatform = Object.fromEntries(profilesFor(p).map((x) => [x.platform, x.status]));
    const report = buildReport(p, results, statusByPlatform);
    const w = writeOwned(p.root, reportPath(p), report.markdown, 'generated', 'fwos report');
    logEvent(p.root, 'report', { done: report.done, blockers: report.blockers.length });
    if (!bool(a, 'json')) {
      io.out(formatResults(results));
      io.out('', `${w.status === 'written' ? 'Wrote' : 'Unchanged:'} ${w.path}: ${report.done ? green('Done') : red(`not done yet (${report.blockers.length} blocker${report.blockers.length === 1 ? '' : 's'})`)}`);
      for (const b of report.blockers.slice(0, 10)) io.out(`  - ${b}`);
    } else json(io, { results, report: { path: w.path, done: report.done, blockers: report.blockers } });
    return report.done ? 0 : 1;
  }
  if (p.initialized) logEvent(p.root, 'check', { results: results.map((r) => `${r.id}:${r.status}`) });
  if (bool(a, 'json')) json(io, { results, exit: exitCode(results) });
  else io.out(formatResults(results));
  return exitCode(results);
};

const report: Command = (a, io) => check({ ...a, flags: { ...a.flags, report: true } }, io);

const doctorCmd: Command = async (a, io) => {
  let project: Project;
  try {
    project = projectFor(a, io);
  } catch (e) {
    // The hooks send people here when the state is unreadable, so say what's wrong instead of failing.
    if (e instanceof FwosError && /\.fwos/.test(e.message)) {
      io.out(`${red('State')}  ${e.message}`, 'Fix that file, or restore it from git (`git checkout -- .fwos/`), then run `fwos doctor` again.');
      return 1;
    }
    throw e;
  }
  const url = str(a, 'url');
  const d = await doctor(project, { start: bool(a, 'start') || !!url, ...(url ? { url } : {}) });
  if (bool(a, 'json')) json(io, d);
  else io.out(formatDoctor(d));
  return 0;
};

const approveCmd: Command = async (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const target = a.positionals[0];
  if (!target) throw new FwosError('Name what to approve.', 'fwos approve <brief|research|architecture|design-system|fidelity|screens|spec|acceptance> --by "<name>"');
  const via = (str(a, 'via') ?? 'chat') as 'chat' | 'pr' | 'autopilot';
  if (!['chat', 'pr', 'autopilot'].includes(via)) throw new FwosError(`--via must be chat, pr or autopilot.`);
  const by = need(a, 'by', 'Who approved it? --by "<name>"');
  if (target === 'fidelity') await assertFidelityReady(p);
  if (target === 'spec') assertQuestionsAnswered(p);
  const rec = approve(p, target, by, via, str(a, 'ref'));
  logEvent(p.root, 'approve', { target, sha: rec.sha, by: rec.by, via, ...(rec.ref ? { ref: rec.ref } : {}) });
  io.out(`${green('Approved')} ${target} (${rec.sha}) by ${rec.by}${rec.ref ? ` in ${rec.ref}` : ''}. Any later edit makes it stale.`);
  if (target === 'spec') io.out(...carried(p, 'the build'));
  // An adopted design system: the outcomes beside the approval, so a difference nobody decided stays in view.
  if (target === 'design-system' || target === 'fidelity') {
    let adopted = false;
    try {
      adopted = (mapDesignSystem(p, adaptersFor(p))?.input ?? 'starter') !== 'starter';
    } catch (e) {
      if (!(e instanceof FwosError)) throw e;
      io.out(yellow(`The adoption outcomes can't be shown: ${e.message}`));
    }
    if (adopted) {
      const report = await adoptionReport(p, adaptersFor(p));
      if (target === 'design-system') io.out("This approves the design system as it is. It is not a fidelity approval: that one needs the rendered comparison (`fwos design-system report`).");
      io.out('', ...outcomeLines(p, report.outcomes));
    }
  }
  return 0;
};

const skipCmd: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const target = a.positionals[0];
  if (!target) throw new FwosError('Name what to skip.', 'fwos skip <research|architecture|design-system|screens> --reason "<why>" --by "<name>"');
  skip(p, target, need(a, 'reason', 'Why is it skipped? --reason "..."'), need(a, 'by', 'Who decided? --by "<name>"'));
  logEvent(p.root, 'skip', { target });
  io.out(`${yellow('Skipped')} ${target}. It's logged and listed in the acceptance report; defaults apply.`);
  return 0;
};

const stepCmd: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const step = a.positionals[0] as Step | undefined;
  if (!step) throw new FwosError('Name the step.', 'fwos step <discovery|research|architecture|design-system|screens|spec|build|accept>');
  const c = setStep(p, step);
  io.out(`Change ${c.id} is at step ${bold(c.step)}.`);
  if (step === 'build' || step === 'accept') io.out(...carried(p, handoffName(step)));
  return 0;
};

/** An adopted app's open change, if there is one (never its adoption record). */
function openAdopted(p: Project): Change | null {
  if (p.mode !== 'adopt' || !p.initialized) return null;
  const c = currentChange(p.root);
  return c && !isAdoptionRecord(p, c) ? c : null;
}

/**
 * What an adopted app's open change carries into `into`: open questions, assumptions, dropped asks
 * and criteria, kept stages with nothing linked. A code-only change has no spec delta of its own.
 */
function carried(p: Project, into: string, change = openAdopted(p)): string[] {
  if (!change || change.route === 'code-only') return [];
  const open = openItems(p, change);
  const summary = openSummary(open);
  return summary ? [`Carried into ${into}: ${summary}.`, ...openLines(open).map((l) => `  - ${l}`)] : [`Nothing open carried into ${into}.`];
}

/**
 * An adopted app's change settles its questions before its spec is approved: an ambiguity answered
 * then is one the build doesn't settle by guessing. A team that keeps its own spec settles them there.
 */
function assertQuestionsAnswered(p: Project): void {
  const change = openAdopted(p);
  if (!change || change.route === 'code-only' || p.kept.includes('spec')) return;
  const open = parseQuestions(p.read(specPath(p)) ?? '').questions.filter((q) => !q.answer);
  if (open.length === 0) return;
  const named = open.map((q) => `${q.id} ("${q.text}")`);
  const which = open.length === 1 ? `${open[0]!.id} is still open ("${open[0]!.text}")` : `${named.slice(0, -1).join(', ')} and ${named.at(-1)} are still open`;
  const them = open.length === 1 ? 'it' : 'them';
  throw new FwosError(`${which}: answer ${them} in the spec delta (- Answer: <answer>) before the approval, so the build doesn't settle ${them} by guessing.`);
}

/**
 * Where a new change enters. In an adopted app change delivery needs the delivery level, and only
 * the routes that build on the team's own product exist: the others would take over what it owns.
 */
function entryFor(p: Project, route: Route): Step {
  if (p.mode !== 'adopt') return ROUTE_ENTRY[route];
  if (p.level !== 'delivery') {
    throw new FwosError(`Change delivery is off at level ${p.level}. Turn it on with \`fwos adopt --level delivery --yes\`.`, 'At this level fwos checks the app as it is: `fwos check`.');
  }
  const entry = ADOPTED_ROUTE_ENTRY[route];
  if (!entry) {
    const owned = route === 'design-system' ? 'your design system' : route === 'add-platform' ? 'the platforms you ship' : 'your architecture';
    throw new FwosError(`A ${route} change isn't delivered through fwos in an adopted app: it would take over ${owned}, which stays your team's.`, `Routes here: ${Object.keys(ADOPTED_ROUTE_ENTRY).join(', ')}.`);
  }
  return entry;
}

/** A link: a URL as it is, or a file or folder in the project with its hash now. `flag` names where it was given (`--link `). */
function linkOf(p: Project, ref: unknown, flag: string): Link {
  if (typeof ref !== 'string' || !ref.trim()) throw new FwosError(`${flag.trim() || 'A link'} needs a URL or a file: ${flag}<url|path>.`);
  if (/^https?:\/\//.test(ref)) return { ref };
  const rel = normalizeRel(ref);
  const sha = rel.startsWith('../') || isAbsolute(rel) ? null : hashPath(p.abs(rel));
  if (sha === null) throw new FwosError(`${flag}${ref} isn't a URL or a file in the project.`, 'Link an issue or doc by its URL, or a file in the repo by its path.');
  return { ref: rel, sha };
}

/** --link values. */
function linksOf(p: Project, a: Args): Link[] {
  const raw = a.flags.link;
  return (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).map((ref) => linkOf(p, ref, '--link '));
}

const change: Command = async (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const sub = a.positionals[0] ?? 'show';
  if (sub === 'new') {
    const links = linksOf(p, a);
    // A request can be only a link: an issue or spec says what the change is.
    const title = a.positionals.slice(1).join(' ').trim() || links[0]?.ref || '';
    if (!title) throw new FwosError('Describe the change, or link the issue or spec it comes from.', 'fwos change new "<request>" --route <route> [--link <url|path>]');
    const route = need(a, 'route', `Which route? One of: ${ROUTES.filter((r) => r !== 'initial').join(', ')}`) as Route;
    if (!ROUTES.includes(route) || route === 'initial') throw new FwosError(`Unknown route "${route}".`, ROUTE_TABLE.filter((r) => r.route !== 'initial').map((r) => `${r.route}: ${r.what}`).join('\n'));
    // An adopted app's change answers for its own criteria: the spec's, as they stand now, are the base.
    const base = p.mode === 'adopt' ? { base: { acs: acHashes(p.read(specPath(p)) ?? '') } } : {};
    const c = createChange(p.root, { title, route, step: entryFor(p, route), ...(links.length > 0 ? { links } : {}), ...base });
    logEvent(p.root, 'change', { id: c.id, route });
    io.out(`${green('Created')} change ${c.id} (route ${route}, enters at ${c.step}).`);
    for (const l of links) io.out(`Linked: ${l.ref}${l.sha ? ` (at ${l.sha})` : ''}`);
    if (p.mode === 'adopt') {
      // The team's own workflow: its branch names, its review, its owners.
      const team = readWorkflow(p.root);
      const w = changeWorkflow(p, c, team);
      const how = 'fwos approve spec --by "<name>"';
      io.out(
        'Your workflow:',
        `  branch   ${w.branch ? `your branches are named ${team.branchPrefixes.length > 1 ? '<type>' : w.branch.split('/')[0]}/<name>: git switch -c ${w.branch}` : 'fwos found no naming convention in your branches: name it as your team does'} (ask before you create it)`,
        w.template
          ? `  review   your pull request template is ${w.template}: the spec delta and the acceptance report go up for review there, and each yes is recorded as it is given (${how} --via pr --ref <review URL>)`
          : `  review   each yes is recorded as it is given, in chat or in a review (${how} [--via pr --ref <review URL>])`,
        ...(w.codeowners ? [`  owners   ${w.codeowners} says who reviews; \`fwos change map\` names the owners of what the change touches`] : []),
      );
    }
    // The newest open change is the current one, so an earlier open change goes quiet: say so.
    // An adopted app's adoption record stays open by design, so it isn't one.
    const open = listChanges(p.root).filter((x) => x.status === 'open' && x.id !== c.id && !isAdoptionRecord(p, x));
    if (open.length > 0) {
      const names = open.map((x) => `${x.id} (step ${x.step})`);
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
      io.out(yellow(`Note: ${list} ${open.length === 1 ? 'is' : 'are'} still open. fwos works on ${c.id} now, and comes back to ${open.length === 1 ? 'it' : 'them'} once ${c.id} is done (\`fwos change done\`).`));
    }
    return 0;
  }
  if (sub === 'map') return mapCmd(p, a, io);
  if (sub === 'drift') return driftCmd(p, a, io);
  if (sub === 'link') return linkCmd(p, a, io);
  if (sub === 'trace') return traceCmd(p, a, io);
  if (sub === 'list') {
    const all = listChanges(p.root);
    if (bool(a, 'json')) return json(io, all.map((c) => ({ id: c.id, title: c.title, route: c.route, step: c.step, status: c.status, branch: c.branch }))), 0;
    for (const c of all) io.out(`${c.id.padEnd(32)} ${c.status.padEnd(5)} ${c.step.padEnd(14)} ${c.route}${c.branch ? dim(` (${c.branch})`) : ''}`);
    return 0;
  }
  if (sub === 'show') {
    const id = a.positionals[1];
    const c = id ? readChange(p.root, id) : currentChange(p.root);
    if (!c) throw new FwosError(id ? `No change ${id}.` : 'No open change.');
    return json(io, c), 0;
  }
  if (sub === 'cursor') {
    const c = updateChange(p.root, (ch) => {
      ch.cursor ??= { pending: [] };
      const section = str(a, 'section');
      if (section !== undefined) ch.cursor.section = section;
      const pending = str(a, 'pending');
      if (pending !== undefined) ch.cursor.pending = pending.split(',').map((x) => x.trim()).filter(Boolean);
      const note = str(a, 'note');
      if (note !== undefined) ch.cursor.note = note;
    });
    io.out(`Cursor for ${c.id}: ${JSON.stringify(c.cursor)}`);
    return 0;
  }
  if (sub === 'spend') {
    const step = need(a, 'step', '--step <name> --usd <amount>');
    const raw = need(a, 'usd', '--usd <amount>');
    const usd = /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : Number.NaN;
    if (!(usd > 0)) throw new FwosError('--usd must be a positive number of dollars, such as 0.25.');
    updateChange(p.root, (c) => {
      c.spend = { ...(c.spend ?? {}), [step]: (c.spend?.[step] ?? 0) + usd };
    });
    return 0;
  }
  if (sub === 'done') {
    const c = requireChange(p.root);
    if (isAdoptionRecord(p, c)) throw new FwosError('No change is open. The adoption record stays open: it stands for the app as it was.', 'Start a change with /fwos:change "<request>".');
    // A team that keeps its own practice for the implementation isn't held to the map.
    const outside = p.mode === 'adopt' && !p.kept.includes('build') ? (changeDrift(p, c)?.outside ?? []) : [];
    if (outside.length > 0) {
      throw new FwosError(`Change ${c.id} can't close: it edited outside what it maps: ${outside.join(', ')}.`, `${mapAgain(c, outside)}, or move those edits into a change of their own.`);
    }
    const results = await runChecks(p);
    if (exitCode(results) !== 0) {
      io.out(formatResults(results.filter((r) => r.status === 'fail')));
      throw new FwosError(`Change ${c.id} can't close while checks fail.`);
    }
    if (c.route !== 'code-only' && p.mode === 'adopt' && p.kept.includes('acceptance')) {
      // The team accepts the change in its own tool, and the change links where.
      if (!(c.links ?? []).some((l) => l.stage === 'acceptance')) {
        const why = keptStages(p.root).acceptance?.reason;
        throw new FwosError(`Change ${c.id} can't close yet: acceptance is your team's here${why ? ` (${why})` : ''}: link its sign-off first, with \`fwos change link <url|path> --stage acceptance\`.`);
      }
    } else if (c.route !== 'code-only') {
      const acc = p.mode === 'adopt' ? changeApprovalState(p, c, 'acceptance') : allApprovals(p).find((s) => s.target === 'acceptance')!;
      if (acc.status !== 'approved') throw new FwosError(`Change ${c.id} needs the acceptance report approved first (it's ${acc.status}).`, 'Run `fwos report`, review it with the user, then `fwos approve acceptance --by "<name>"`.');
    }
    const left = carried(p, 'the next change', p.mode === 'adopt' ? c : null);
    updateChange(p.root, (ch) => {
      ch.status = 'done';
      ch.step = 'done';
    });
    logEvent(p.root, 'change-done', { id: c.id });
    io.out(`${green('Done:')} change ${c.id}. New requests go through /fwos:change.`, ...left);
    return 0;
  }
  throw new FwosError(`Unknown subcommand "change ${sub}".`, 'fwos change new|map|drift|link|trace|list|show|cursor|spend|done');
};

/**
 * `fwos change map <route|file>...`: what the open change touches, read from the app's code by the
 * platform, recorded on the change and shown. The spec delta's Context and the test plan's
 * regression scope are checked against it, and so are the files the build edits.
 */
function mapCmd(p: Project, a: Args, io: Io): number {
  if (p.mode !== 'adopt') throw new FwosError('`fwos change map` grounds a change in an adopted app, where the code it changes was there before fwos.');
  const c = currentChange(p.root);
  if (!c || isAdoptionRecord(p, c)) throw new FwosError('No change is open to map.', 'Start one with /fwos:change "<request>".');
  const targets = a.positionals.slice(1);
  if (targets.length === 0) throw new FwosError('Name what the change touches: a route by its URL (/dashboard), or a file by its path.', 'fwos change map <route|file>...');
  const mapper = profilesFor(p).find((x) => x.changeMap)?.changeMap;
  if (!mapper) throw new FwosError(`fwos can't map a change on ${p.platforms.join(', ')} yet.`);
  const map = { ...mapper.map(p, targets), at: now() };
  updateChange(p.root, (ch) => {
    ch.map = map;
  });
  logEvent(p.root, 'change-map', { id: c.id, targets });
  if (bool(a, 'json')) return json(io, map), 0;
  const row = (label: string, value: string) => `  ${label.padEnd(12)} ${value}`;
  io.out(
    `Mapped change ${c.id} onto the code it touches:`,
    ...map.targets.map((t) => row(t.target, t.file === t.target ? '(the file itself)' : t.file)),
    ...(map.wrappers.length > 0 ? [row('wrapped by', map.wrappers.join(', '))] : []),
    row('components', map.components.join(', ') || 'none of yours'),
    row('data', map.data.map((d) => `${d.what} (${d.file})`).join(', ') || 'none found'),
    row('tests', map.tests.map((t) => `${t.file} (${t.via})`).join(', ') || 'none yet'),
    row('owners', map.owners.join(', ') || 'none named (no CODEOWNERS entry)'),
    row('in all', `${map.files.length} file${map.files.length === 1 ? '' : 's'} it renders or imports (\`fwos change show\` lists them)`),
    "Its spec delta's Context names what it touches, and its test plan names these tests as its regression scope.",
  );
  return 0;
}

/** The command that maps a change onto `more` files as well, and what follows it. */
const mapAgain = (c: Change, more: string[]) => `Map ${more.length === 1 ? 'it' : 'them'} as well (\`fwos change map ${[...(c.map?.targets.map((t) => t.target) ?? []), ...more].join(' ')}\`) and have the spec approved again`;

/** `fwos change drift`: the open change's edits since it began, against what it maps. Exit 1 on an edit outside it. */
function driftCmd(p: Project, a: Args, io: Io): number {
  if (p.mode !== 'adopt') throw new FwosError("`fwos change drift` is for an adopted app's change. A slice of an app fwos started has `fwos slice drift`.");
  const c = currentChange(p.root);
  if (!c || isAdoptionRecord(p, c)) throw new FwosError('No change is open.', 'Start one with /fwos:change "<request>".');
  if (!c.map) throw new FwosError(`Change ${c.id} isn't mapped yet, so there's nothing to hold its edits against.`, 'Map it first: `fwos change map <route or file>`.');
  if (!c.head) throw new FwosError(`Change ${c.id} began outside git, so fwos can't tell what it edited.`);
  const d = changeDrift(p, c);
  if (!d) throw new FwosError(`git can't say what change ${c.id} edited since ${c.head}.`);
  if (bool(a, 'json')) return json(io, d), d.outside.length > 0 ? 1 : 0;
  const targets = c.map.targets.map((t) => t.target).join(', ');
  if (d.outside.length === 0) {
    io.out(`Change ${c.id} stayed inside what it maps (${targets}): ${d.edited.length} file${d.edited.length === 1 ? '' : 's'} of yours edited, ${d.added.length} added.`);
    return 0;
  }
  for (const f of d.outside) io.out(`${f}: edited outside what change ${c.id} maps (${targets})`);
  io.out(`${mapAgain(c, d.outside)}, or make ${d.outside.length === 1 ? 'it a change of its own' : 'them a change of their own'}.`);
  return 1;
}

/**
 * `fwos change link <url|path>... [--stage <stage>]`: what the open change builds on, linked in
 * place, never copied. With a stage, it is the team's own artifact for that stage of the change:
 * the design it was reviewed in, its test plan, the sign-off its acceptance got.
 */
function linkCmd(p: Project, a: Args, io: Io): number {
  const refs = a.positionals.slice(1);
  if (refs.length === 0) throw new FwosError('Name what to link: a URL, or a file in the project.', 'fwos change link <url|path>... [--stage <stage>]');
  const stages = stagesOf(a.flags.stage as string | string[] | undefined);
  if (stages.length > 1) throw new FwosError('--stage takes one stage: link each stage\'s artifact on its own.');
  const c = currentChange(p.root);
  if (!c || isAdoptionRecord(p, c)) throw new FwosError('No change is open to link it to.', 'Start one with /fwos:change "<request>".');
  const links = refs.map((ref) => ({ ...linkOf(p, ref, ''), ...(stages[0] ? { stage: stages[0] } : {}) }));
  const { change: changed, added } = addLinks(p.root, links);
  logEvent(p.root, 'change-link', { id: changed.id, refs: added.map((l) => l.ref), ...(stages[0] ? { stage: stages[0] } : {}) });
  for (const l of links) {
    const what = `${l.ref}${l.sha ? ` (at ${l.sha})` : ''}${l.stage ? `, for ${STAGE_LABELS[l.stage].toLowerCase()}` : ''}`;
    io.out(added.includes(l) ? `Linked to change ${changed.id}: ${what}.` : `Already linked to change ${changed.id}: ${what}.`);
  }
  return 0;
}

/** `fwos change trace [<id>] [--json]`: an adopted app's change, from its request to its evidence, and what is open. */
function traceCmd(p: Project, a: Args, io: Io): number {
  if (p.mode !== 'adopt') throw new FwosError("`fwos change trace` traces an adopted app's change, from its request to its evidence.");
  const id = a.positionals[1];
  const c = id ? readChange(p.root, id) : latestChange(p.root);
  if (!c || isAdoptionRecord(p, c)) throw new FwosError(id ? `No change ${id}.` : 'No change has been delivered through fwos yet.', 'Start one with /fwos:change "<request>".');
  const t = traceChange(p, c, runnersOf(p, adaptersFor(p)));
  if (bool(a, 'json')) return json(io, t), 0;
  const summary = openSummary(t.open);
  const into = handoffName(c.step);
  io.out(...traceText(t), summary ? `Open at ${into}: ${summary}.` : `Nothing open at ${into}.`, ...openLines(t.open).map((l) => `  - ${l}`));
  return 0;
}

const stamp: Command = (a, io) => {
  const p = projectFor(a, io);
  const doc = a.positionals[0];
  if (!doc) throw new FwosError('Name the doc to stamp.', 'fwos stamp docs/app/spec.md --from brief.md,ia.json,modules.json');
  const refs = stampBasedOn(p, doc, need(a, 'from', '--from <doc>[,<doc>] (relative to the docs folder)').split(',').map((s) => s.trim()));
  io.out(`${doc}: based_on ${refs.join(', ')}`);
  return 0;
};

const hash: Command = (a, io) => {
  if (a.positionals.length === 0) throw new FwosError('Name at least one file or directory to hash.', 'fwos hash <path...>');
  const p = projectFor(a, io);
  for (const f of a.positionals) io.out(`${hashPath(p.abs(f)) ?? 'missing'}  ${f}`);
  return 0;
};

const tokens: Command = (a, io) => {
  const p = projectFor(a, io);
  const sub = a.positionals[0] ?? 'build';
  if (sub !== 'build') throw new FwosError(`Unknown subcommand "tokens ${sub}".`, 'fwos tokens build [--check]');
  const ds = loadDesignSystem(p);
  if (!ds) throw new FwosError('No design-system/design-system.json.', 'Run the design-system step first (`fwos design-system init`).');
  if (ds.errors.length + ds.missing.length > 0) {
    throw new FwosError('The design system has problems, so tokens were not built.', [...ds.errors.map((e) => e.message), ...ds.missing.map((m) => `required slot ${m} is blank`)].join('\n'));
  }
  const outputs = tokenOutputs(p, ds);
  if (bool(a, 'check')) {
    const stale = outputs.filter((o) => (readText(p.abs(o.path)) ?? '').replace(/\r\n/g, '\n') !== o.content);
    for (const s of stale) io.out(`${red('stale')} ${s.path}`);
    return stale.length > 0 ? 1 : 0;
  }
  // All or none, so the CSS variables and the theme never come from two different builds.
  for (const w of writeOwnedAll(p.root, outputs, 'generated')) io.out(`${w.status === 'written' ? green('wrote') : dim('unchanged')} ${w.path}`);
  return 0;
};

/** A theme path as design-system.json records it: relative to the project, never a path from this machine. */
function recordedPath(p: Project, cwd: string, from: string): string {
  const rel = normalizeRel(relative(p.root, isAbsolute(from) ? from : join(cwd, from)).split(sep).join('/'));
  return isAbsolute(from) && rel.startsWith('../') ? posix.basename(rel) : rel;
}

const designSystem: Command = async (a, io) => {
  const p = projectFor(a, io);
  const sub = a.positionals[0] ?? 'init';
  if (sub === 'report') return designReport(a, io, p);
  if (sub === 'gallery') return designGallery(io, p);
  if (sub === 'decide') return designDecide(a, io, p);
  if (sub !== 'init') throw new FwosError(`Unknown subcommand "design-system ${sub}".`, 'fwos design-system init|report|gallery|decide');
  assertNoDesignSystem(p);
  const from = str(a, 'from-shadcn');
  const name = str(a, 'name');
  let files = starterFiles();
  if (from) {
    const css = readText(join(io.cwd, from)) ?? readText(from);
    if (css === null) throw new FwosError(`Can't read ${from}.`);
    files = fromShadcn(css, name ?? 'Imported shadcn theme', recordedPath(p, io.cwd, from));
  } else if (name) {
    files = files.map((f) => (f.path === 'design-system.json' ? { ...f, content: f.content.replace('"Neutral starter"', JSON.stringify(name)) } : f));
  }
  for (const f of files) writeYours(p.root, posix.join(p.paths.designSystem, f.path), f.content, 'design-system');
  io.out(`${green('Wrote')} ${p.paths.designSystem}/ (${files.length} file${files.length === 1 ? '' : 's'}${from ? `, from ${from}` : ', neutral starter'}). These files are yours.`);
  if (from) {
    const { report, write } = await writeDesignReport(p);
    io.out(
      `Mapping report in ${write.path}: ${tokenSummary(report.mapping.tokens)}. A PASS from the design-system checks means valid and readable, not a match with your theme: \`fwos design-system report\` keeps the outcomes apart.`,
    );
  }
  const assumed = JSON.parse(files.find((f) => f.path === 'design-system.json')!.content).assumed as string[] | undefined;
  if (assumed?.length) {
    io.out(yellow(`${assumed.length} [ASSUMED] default${assumed.length === 1 ? '' : 's'} to confirm:`));
    for (const x of assumed) io.out(`  - ${x}`);
  }
  return 0;
};

const requireDesignSystem = (p: Project) => {
  if (!loadDesignSystem(p)) throw new FwosError(`No ${p.paths.designSystem}/design-system.json.`, 'Run `fwos design-system init` first (add `--from-shadcn <globals.css>` to start from your theme).');
};

/** `fwos design-system report`: the outcomes kept apart, and the mapping report written. */
async function designReport(a: Args, io: Io, p: Project): Promise<number> {
  requireDesignSystem(p);
  const { report, write } = await writeDesignReport(p);
  if (bool(a, 'json')) {
    json(io, { outcomes: report.outcomes, report: write.path, unresolved: report.unresolved.map((i) => ({ item: i.item, kind: i.kind, needs: i.needs, what: i.what })) });
    return 0;
  }
  io.out(...outcomeLines(p, report.outcomes), '', `${write.status === 'written' ? 'Wrote' : 'Unchanged:'} ${write.path}`);
  return 0;
}

/** `fwos design-system gallery`: the dev-only route and its runner, written into the app. */
function designGallery(io: Io, p: Project): number {
  requireDesignSystem(p);
  const adapters = adaptersFor(p);
  const model = galleryModel(p, adapters);
  const platform = profilesFor(p).find((x) => x.gallery);
  if (!platform?.gallery) throw new FwosError(`No comparison gallery for ${p.platforms.join(', ')} in this version of fwos.`);
  const out = platform.gallery.files(p, model);
  if ('reason' in out) throw new FwosError(`Can't write the gallery: ${out.reason}.`);
  // All or none: a refused file never leaves a new gallery.json beside an old page.
  const writes = writeOwnedAll(p.root, out.files, 'generated');
  out.files.forEach((f, i) => io.out(`${writes[i]!.status === 'written' ? green('wrote') : dim('unchanged')} ${f.path}`));
  io.out('', ...galleryNext(p, p.paths.apps.web ?? 'apps/web', platform.gallery.command(p)));
  return 0;
}

/** `fwos design-system decide`: a decision about a row, a component or a difference, recorded with a reason. */
function designDecide(a: Args, io: Io, p: Project): number {
  requireDesignSystem(p);
  const as = need(a, 'as', '--as replace|omit|intentional');
  if (!(DECISIONS as string[]).includes(as)) throw new FwosError(`--as must be replace, omit or intentional, not "${as}".`);
  const reason = str(a, 'reason') ?? '';
  const by = str(a, 'by') ?? '';
  const made = decide(p, adaptersFor(p), a.positionals.slice(1), as as Decision, reason, by);
  const items = made.map((d) => d.item);
  io.out(`Decided ${items.length === 1 ? items[0] : `${items.length} items (${items.slice(0, 3).join(', ')}${items.length > 3 ? ', ...' : ''})`}: ${as}, by ${by.trim()}.`);
  logEvent(p.root, 'decide', { items, decision: as, by: by.trim() });
  return 0;
}

const contract: Command = (a, io) => {
  const p = projectFor(a, io);
  const sub = a.positionals[0] ?? 'mocks';
  if (sub !== 'mocks') throw new FwosError(`Unknown subcommand "contract ${sub}".`, 'fwos contract mocks [--check]');
  const loaded = loadContract(p);
  if (!loaded) throw new FwosError(`No ${p.paths.contract}/openapi.yaml.`);
  const outputs = profilesFor(p).flatMap((x) => x.fixtures?.generate(p, loaded.model) ?? []);
  if (bool(a, 'check')) {
    const stale = outputs.filter((o) => (readText(p.abs(o.path)) ?? '').replace(/\r\n/g, '\n') !== o.content);
    for (const s of stale) io.out(`${red('stale')} ${s.path}`);
    return stale.length > 0 ? 1 : 0;
  }
  // All or none, so the CSS variables and the theme never come from two different builds.
  for (const w of writeOwnedAll(p.root, outputs, 'generated')) io.out(`${w.status === 'written' ? green('wrote') : dim('unchanged')} ${w.path}`);
  return 0;
};

const ia: Command = (a, io) => {
  const p = projectFor(a, io);
  const sub = a.positionals[0] ?? 'diff';
  if (sub !== 'diff') throw new FwosError(`Unknown subcommand "ia ${sub}".`, 'fwos ia diff [--base <git-ref> | --from <file>]');
  const path = iaPath(p);
  const after = parseIa(p.read(path) ?? 'null');
  if (!after.ia) throw new FwosError(`${path} is missing or invalid.`, after.errors.join('\n'));
  let beforeText: string;
  const from = str(a, 'from');
  if (from) beforeText = readText(join(io.cwd, from)) ?? readText(from) ?? 'null';
  else {
    const base = str(a, 'base') ?? 'HEAD';
    try {
      beforeText = execFileSync('git', ['show', `${base}:${path}`], { cwd: p.root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {
      beforeText = JSON.stringify({ schema: 1, roles: after.ia.roles, pages: [] });
    }
  }
  const before = parseIa(beforeText);
  if (!before.ia) throw new FwosError('The base ia.json is invalid.', before.errors.join('\n'));
  const changes = diffIa(before.ia, after.ia);
  if (bool(a, 'json')) json(io, changes);
  else io.out(formatIaDiff(changes));
  return 0;
};

const prototype: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const sub = a.positionals[0] ?? 'check';
  if (sub === 'check') {
    const id = a.positionals[1];
    const all = checkBundles(p).filter((c) => !id || c.id === id);
    if (bool(a, 'json')) {
      json(io, { bundles: all.map((c) => ({ id: c.id, path: c.path, problems: c.problems, notes: c.notes, stale: c.stale, promoted: c.promotion ? { by: c.promotion.by, at: c.promotion.at } : null })) });
    } else if (all.length === 0) {
      io.out(id ? `No prototype bundle "${id}".` : `No prototype bundles yet: each is ${prototypesDir(p)}/<id>/bundle.json.`);
    } else {
      for (const c of all) {
        io.out(`${c.id}  ${c.path}`);
        for (const x of c.problems) io.out(`  ${red('problem:')} ${x}`);
        for (const x of c.stale) io.out(`  ${red('stale:')} ${x}`);
        for (const x of c.notes) io.out(`  ${dim(`note: ${x}`)}`);
        const promote = `fwos prototype promote ${c.id} --by "<who>"`;
        if (c.problems.length > 0) continue;
        if (!c.promotion) io.out(`  ready to promote: ${promote}`);
        else if (c.stale.length > 0) io.out(`  promote it again once it's right: ${promote}`);
        else io.out(`  promoted by ${c.promotion.by} on ${c.promotion.at.slice(0, 10)}, and current`);
      }
    }
    return all.some((c) => c.problems.length + c.stale.length > 0) ? 1 : 0;
  }
  if (sub === 'promote') {
    const id = a.positionals[1];
    if (!id) throw new FwosError('Name the bundle to promote.', 'fwos prototype promote <id> --by "<who>"');
    const r = promote(p, id, need(a, 'by', 'Who promotes it: --by "<who>".'));
    io.out(`Promoted ${r.id}: ${r.inputs} inputs pinned in ${PROMOTIONS}.`, `Compare it with the app: fwos prototype diff ${r.id}`);
    return 0;
  }
  if (sub === 'diff') {
    const id = a.positionals[1];
    if (!id) throw new FwosError('Name the bundle to compare with the app.', 'fwos prototype diff <id>');
    const d = prototypeDiff(p, id);
    if (bool(a, 'json')) json(io, d);
    else io.out(formatAppDiff(d));
    return 0;
  }
  throw new FwosError(`Unknown subcommand "prototype ${sub}".`, 'fwos prototype check [<id>] [--json] | prototype promote <id> --by "<who>" | prototype diff <id> [--json]');
};

/** The files git says changed since `head`, staged or not, and the untracked ones. Null when git can't say. */
function touchedSince(root: string, head: string): Set<string> | null {
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .split('\0')
      .filter(Boolean);
  try {
    return new Set([...git('diff', '-z', '--name-only', '--relative', '--no-renames', head), ...git('ls-files', '-z', '--others', '--exclude-standard')]);
  } catch {
    return null;
  }
}

/**
 * In an adopted app, fwos locks only the tests a change adds or changes, never the suite it
 * inherited: that stays the team's, and runs as regression evidence. Refuses outside a change, and
 * any file git says is unchanged since the change began. When git can't say, it locks.
 */
function refuseInherited(p: Project, files: string[]): void {
  if (p.level !== 'delivery') throw new FwosError(`Locking tests is part of change delivery, which is off at level ${p.level}.`, 'Turn it on with `fwos adopt --level delivery --yes`.');
  const c = currentChange(p.root);
  if (!c || isAdoptionRecord(p, c)) throw new FwosError('Lock tests inside a change: none is open.', 'Start one with /fwos:change "<request>".');
  const touched = c.head ? touchedSince(p.root, c.head) : null;
  if (!touched) return;
  const inherited = files.map((f) => normalizeRel(isAbsolute(f) ? relative(p.root, f) : f)).filter((f) => !touched.has(f));
  if (inherited.length === 0) return;
  const one = inherited.length === 1;
  throw new FwosError(
    `${inherited.join(', ')} ${one ? 'is' : 'are'} part of your existing suite (unchanged since this change began), so ${one ? "it isn't" : "they aren't"} locked. fwos locks only the tests a change adds or changes.`,
    'Run the existing suite as regression evidence for the change, or change the test as part of it first.',
  );
}

const testsCmd: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const sub = a.positionals[0] ?? 'status';
  if (sub === 'lock') {
    const files = a.positionals.slice(1);
    const red_ = bool(a, 'red');
    const existing = bool(a, 'existing');
    if (red_ === existing) throw new FwosError('Say what proves these tests: --red (new behaviour, a failing run exists) or --existing (behaviour that already works).');
    if (p.mode === 'adopt') refuseInherited(p, files);
    const slice = str(a, 'slice');
    const r = lockTests(p, files, { evidence: red_ ? 'red' : 'existing', ...(slice ? { slice } : {}) });
    logEvent(p.root, 'lock', { files, evidence: red_ ? 'red' : 'existing' });
    io.out(`${green('Locked')} ${r.locked.length} test file${r.locked.length === 1 ? '' : 's'}${r.failing.length ? ` (red run kept: ${r.failing.length} failing tests)` : ''}.`);
    return 0;
  }
  if (sub === 'unlock') {
    const file = a.positionals[1];
    if (!file) throw new FwosError('Name the test file to unlock.');
    unlockTest(p, file, need(a, 'reason', 'Why is the test itself wrong? --reason "..."'), need(a, 'reviewer', 'Who agreed? --reviewer "<name>"'));
    logEvent(p.root, 'unlock', { file });
    io.out(`${yellow('Unlocked')} ${file}. Edit it, then lock it again; the report lists the unlock.`);
    return 0;
  }
  if (sub === 'run') {
    const adapter = profilesFor(p).find((x) => x.tests)?.tests;
    if (!adapter) throw new FwosError(`fwos can't run tests for ${p.platforms.join(', ')} yet.`);
    const r = runTests(p, adapter, a.positionals.slice(1));
    logEvent(p.root, 'tests-run', { runs: r.runs.map((x) => `${x.display}:${x.exit}`) });
    if (bool(a, 'json')) json(io, { runs: r.runs, skipped: r.skipped, exit: r.exit });
    else io.out(...r.lines);
    return r.exit;
  }
  if (sub === 'status') {
    const files = lockedFiles(p);
    if (bool(a, 'json')) return json(io, files), 0;
    for (const f of files) io.out(`${f.status.padEnd(9)} ${f.path}${f.unlock ? dim(` (unlocked by ${f.unlock.reviewer}: ${f.unlock.reason})`) : ''}`);
    if (files.length === 0) io.out('No locked tests yet.');
    return 0;
  }
  throw new FwosError(`Unknown subcommand "tests ${sub}".`, 'fwos tests run|lock|unlock|status');
};

const signoff: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const item = a.positionals[0];
  if (!item) throw new FwosError('Name the item to sign off.', 'fwos signoff <AC-x-n|GAP-n> --by "<name>" [--note "..."]');
  // A sign-off closes an item the report lists for one: a manual AC or a gap. Anything else, a typo
  // or an AC its tests prove, would close nothing.
  const acs = parseAcs(p.read(specPath(p)) ?? '');
  const manual = acs.filter((ac) => ac.manual).map((ac) => ac.id);
  const gaps = parseTestPlan(p.read(testPlanPath(p)) ?? '').gaps.map((g) => g.id);
  const known = [...manual, ...gaps];
  const hint = known.length > 0 ? `Sign off one of: ${known.slice(0, 20).join(', ')}${known.length > 20 ? ', ...' : ''}.` : 'Neither file has one yet.';
  if (acs.some((ac) => ac.id === item && !ac.manual)) {
    throw new FwosError(`${item} is proven by its tests, so a sign-off wouldn't count for it. Only an AC with a "Manual:" line, or a gap, takes one.`, hint);
  }
  if (!known.includes(item)) throw new FwosError(`"${item}" isn't a manual AC in ${specPath(p)} or a gap in ${testPlanPath(p)}.`, hint);
  const by = need(a, 'by', 'Who signs it off? --by "<name>"');
  const note = str(a, 'note');
  updateLatestChange(p.root, (c) => {
    c.signoffs = [...(c.signoffs ?? []).filter((s) => s.item !== item), { item, by, at: now(), ...(note ? { note } : {}) }];
  });
  logEvent(p.root, 'signoff', { item, by });
  io.out(`${green('Signed off')} ${item} by ${by}.`);
  return 0;
};

const baseline: Command = async (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  if (p.mode !== 'adopt') throw new FwosError('A baseline is for an existing app (adopt mode); a new app starts with nothing to forgive.', 'For an existing app, start with `fwos init --mode adopt`.');
  const raw = await runChecks(p, { baseline: false });
  // With a gate failing every other check is off, so its findings would vanish from the baseline.
  const gate = raw.find((r) => r.status === 'fail' && allChecks().some((c) => c.gate && c.id === r.id));
  if (gate) throw new FwosError(`${gate.id} fails, so the baseline can't be written yet.`, 'Fix what it reports (`fwos check`), then run this again.');
  const r = writeBaseline(p.root, raw, { init: bool(a, 'init'), exempt: unbaselined(allChecks()) });
  io.out(`Baseline: ${r.total} finding${r.total === 1 ? '' : 's'} recorded${r.removed ? `, ${r.removed} fixed and dropped` : ''}. It can only shrink.`);
  const taken = (r.added ?? []).filter((x) => x.count > 0);
  if (taken.length > 0) io.out(`Took in ${taken.map((x) => `${x.id} (${x.count})`).join(', ')}: ${taken.length === 1 ? 'it' : 'they'} weren't on when the baseline was recorded.`);
  return 0;
};

/** Adds the template's fields to an existing package.json. Objects (scripts, dependencies) merge one level deep; the project's values always win. */
export function mergePackageJson(have: Record<string, unknown>, template: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...have };
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  for (const [k, v] of Object.entries(template)) {
    if (!(k in out)) out[k] = v;
    else if (isObject(out[k]) && isObject(v)) out[k] = { ...v, ...out[k] };
  }
  return out;
}

const scaffold: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const platform = a.positionals[0] ?? 'web';
  const state = readJson<{ name?: string }>(p.abs('.fwos/state.json'));
  const name = str(a, 'name') ?? state?.name ?? 'My app';
  const files = renderTemplate(platform, { APP_NAME: name, APP_SLUG: slugify(name) });
  const pin = str(a, 'fwos-check') ?? VENDORED_PIN;
  let wrote = 0;
  const merged: string[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const content = f.path === 'package.json' ? f.content.replace('"fwos-check": "^0.0.0"', `"fwos-check": ${JSON.stringify(pin)}`) : f.content;
    if (f.path === '.gitignore' && existsSync(p.abs('.gitignore'))) {
      // Merge: add the lines the project doesn't have yet, keep everything it does.
      const have = readText(p.abs('.gitignore')) ?? '';
      const missing = content.split('\n').filter((l) => l.trim() && !l.startsWith('#') && !have.split('\n').includes(l));
      if (missing.length > 0) writeText(p.abs('.gitignore'), `${have}${have.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`);
      continue;
    }
    if (f.path === 'package.json' && existsSync(p.abs('package.json'))) {
      // Merge: add the scripts, dependencies and fields the project doesn't have, keep every one it does.
      const have = readJson<Record<string, unknown>>(p.abs('package.json'));
      if (have) {
        writeJson(p.abs('package.json'), mergePackageJson(have, JSON.parse(content) as Record<string, unknown>));
        merged.push(f.path);
        continue;
      }
    }
    if (writeYours(p.root, f.path, content, 'scaffold')) wrote++;
    else skipped.push(f.path);
  }
  // fwos's own tests for the app (the harness): fwos's files, which `fwos harness` refreshes later.
  for (const h of PROFILES.find((x) => x.platform === platform)?.verify?.harness?.(p) ?? []) {
    try {
      if (writeOwned(p.root, h.file, h.content, 'fwos', 'fwos harness').status === 'written') wrote++;
    } catch (e) {
      if (!(e instanceof FwosError)) throw e;
      skipped.push(h.file);
    }
  }
  // Vendor the CLI only when the project ends up pinned to the vendored copy; a pin the project
  // already had, or one passed with --fwos-check, wins.
  const pkg = readJson<{ devDependencies?: Record<string, string>; dependencies?: Record<string, string> }>(p.abs('package.json'));
  const vendored = ({ ...pkg?.dependencies, ...pkg?.devDependencies })['fwos-check'] === VENDORED_PIN;
  if (vendored) vendorCli(p.root);
  logEvent(p.root, 'scaffold', { platform, wrote, merged: merged.length, skipped: skipped.length, vendored });
  io.out(
    `${green('Scaffolded')} ${platform}: ${wrote} file${wrote === 1 ? '' : 's'} written${merged.length ? `, ${merged.join(', ')} merged` : ''}${skipped.length ? `, ${skipped.length} kept as they were (${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? '...' : ''})` : ''}.`,
  );
  io.out(dim('Next: fwos tokens build, fwos contract mocks, then pnpm install (fwos asks first).'));
  return 0;
};

/** Refreshes the vendored CLI in .fwos/cli to this plugin's version. Touches nothing else. */
const vendor: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const pkg = readJson<{ devDependencies?: Record<string, string>; dependencies?: Record<string, string> }>(p.abs('package.json'));
  const pin = ({ ...pkg?.dependencies, ...pkg?.devDependencies })['fwos-check'];
  if (pin && pin !== VENDORED_PIN) {
    throw new FwosError(`This project pins fwos-check to ${pin}, so there's no vendored copy to refresh.`, `Update that pin instead, or set it to "${VENDORED_PIN}" and run fwos vendor.`);
  }
  const done = vendorCli(p.root);
  logEvent(p.root, 'vendor', { version: pluginVersion() });
  if (done.backup) io.out(`Backed up what it replaced to ${done.backup}/.`);
  io.out(`${green('Refreshed')} .fwos/cli to fwos ${pluginVersion()}. Run pnpm install so node_modules picks it up.`);
  return 0;
};

/**
 * After a plugin update: every pack file and record at a schema this fwos reads (migrated when it
 * can be), and .fwos/cli refreshed. Previews without --yes, and writes nothing while anything is in
 * the way.
 */
const update: Command = (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const plan = planUpdate(p);
  if (plan.blocked.length > 0) throw updateRefusal(plan);
  if (!bool(a, 'yes') || upToDate(plan)) {
    io.out(formatUpdate(plan));
    return 0;
  }
  io.out(formatDone(plan, applyUpdate(p, plan)));
  return 0;
};

/** Writes fwos's agents for Codex into .codex/agents/, from the plugin's own agent files. */
const codex: Command = (a, io) => {
  const p = projectFor(a, io);
  const sub = a.positionals[0];
  if (sub !== 'agents') throw new FwosError(`Unknown subcommand "codex ${sub ?? ''}".`, 'fwos codex agents');
  const { written, unchanged } = writeCodexAgents(p.root);
  if (p.initialized) logEvent(p.root, 'codex-agents', { written: written.length, version: pluginVersion() });
  io.out(`${green(written.length > 0 ? 'Wrote' : 'Unchanged:')} ${written.length + unchanged.length} fwos agents in ${CODEX_AGENTS_DIR}/ for fwos ${pluginVersion()}. They're git-ignored: each machine writes its own.`);
  return 0;
};

const slice: Command = (a, io) => {
  const p = projectFor(a, io);
  const sub = a.positionals[0];
  if (sub !== 'drift') throw new FwosError(`Unknown subcommand "slice ${sub ?? ''}".`, 'fwos slice drift <manifest> [--base <git-ref>]');
  const file = a.positionals[1];
  const s = loadSlices(p).find((x) => x.path === file || x.path.endsWith(`/${file}`) || x.manifest?.slice === file);
  if (!s?.manifest) throw new FwosError(`No valid slice manifest "${file}".`, s?.errors.join('\n'));
  const base = str(a, 'base') ?? 'HEAD';
  const d = sliceDrift(p, s.manifest, changedFiles(p.root, base), base);
  if (bool(a, 'json')) return json(io, d), d.outside.length + d.undecided.length > 0 ? 1 : 0;
  for (const o of d.outside) io.out(`${red('outside')} ${o.file}${o.module ? ` (module ${o.module})` : ' (no module)'}`);
  for (const u of d.undecided) io.out(`${red('new dependency without a decision row')} ${u}`);
  if (d.outside.length + d.undecided.length === 0) io.out(green(`${s.manifest.slice} stayed inside ${s.manifest.modules.join(', ')}.`));
  return d.outside.length + d.undecided.length > 0 ? 1 : 0;
};

const spike: Command = (a, io) => {
  const p = projectFor(a, io);
  const name = a.positionals[1] ?? a.positionals[0];
  if (a.positionals[0] !== 'new' || !a.positionals[1]) throw new FwosError('fwos spike new <name>');
  const dir = posix.join('spikes', slugify(name!));
  writeYours(p.root, posix.join(dir, 'README.md'), `# Spike: ${name}\n\nThrowaway code: no approvals and no checks. App code can't import from spikes/.\nTo keep any of it, start a change (/fwos:change) and rebuild it properly.\n`, 'spike');
  io.out(`${green('Created')} ${dir}/. Throwaway; app code can't import it.`);
  return 0;
};

/**
 * The commit hook. It prefers the project's own CLI, then one on PATH, then the plugin's copy, so it
 * works before the scaffold installs anything. Git runs it at the top of the working tree, so for a
 * project in a subfolder (`projectDir`, relative to the top) it changes into the project first.
 */
export function preCommitHook(pluginCli: string, projectDir = ''): string {
  const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  const quoted = quote(pluginCli);
  return `#!/bin/sh
# fwos commit check. Installed by \`fwos git-hook install\`; \`fwos eject\` removes it.
${projectDir ? `cd ${quote(projectDir)} || exit 1\n` : ''}if [ -x node_modules/.bin/fwos ]; then exec node_modules/.bin/fwos check --staged; fi
if command -v fwos >/dev/null 2>&1; then exec fwos check --staged; fi
if [ -f ${quoted} ]; then exec node ${quoted} check --staged; fi
echo "fwos: can't find the fwos CLI, so the commit check can't run. Run pnpm install, or reinstall the fwos plugin." >&2
exit 1
`;
}

const gitHook: Command = (a, io) => {
  const p = projectFor(a, io);
  if (a.positionals[0] !== 'install') throw new FwosError('fwos git-hook install');
  const hook = commitHookPath(p.root);
  if (!hook) throw new FwosError('Not a git repository.', 'Run `git init` first (fwos asks before doing it).');
  if (hook.shared) {
    throw new FwosError(
      `core.hooksPath is set in your ${hook.shared} git config, so every repository on this machine runs the hooks in ${dirname(hook.path)}. fwos won't write its commit check there.`,
      'Give this repository its own hooks folder, then install again: git config core.hooksPath .githooks',
    );
  }
  if (isDir(p.abs('.husky')) || isDir(join(hook.top, '.husky'))) {
    io.out('This repo uses husky. Add this line to .husky/pre-commit:\n\n  pnpm exec fwos check --staged\n');
    return 0;
  }
  if ([p.root, hook.top].some((d) => existsSync(join(d, 'lefthook.yml')) || existsSync(join(d, 'lefthook.yaml')))) {
    io.out('This repo uses lefthook. Add to lefthook.yml:\n\npre-commit:\n  commands:\n    fwos:\n      run: pnpm exec fwos check --staged\n');
    return 0;
  }
  const shown = fromRoot(p, hook.path);
  const existing = readText(hook.path);
  if (existing && !existing.includes('fwos commit check')) throw new FwosError(`${shown} already exists and isn't fwos's.`, 'Add `fwos check --staged` to it yourself.');
  const projectDir = relative(realpathSync(hook.top), realpathSync(p.root)).split(sep).join('/');
  writeText(hook.path, preCommitHook(pluginPath('dist', 'fwos.mjs'), projectDir));
  chmodSync(hook.path, 0o755);
  io.out(`${green('Installed')} ${shown} (runs fwos check --staged).`);
  return 0;
};

interface EjectItem {
  path: string;
  what: string;
  apply: () => void;
}

type PackageJson = { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

// The lines `fwos scaffold web` writes outside .fwos/ that run fwos, exactly as it writes them.
const SCAFFOLD_SCRIPTS: Record<string, string> = { check: 'fwos check', tokens: 'fwos tokens build' };
const SCAFFOLD_WORKFLOW = `${WORKFLOWS}/fwos.yml`;
const SCAFFOLD_STEP = '- run: pnpm exec fwos check';
const SCAFFOLD_STEP_COMMENT = ['# fwos check in CI: tests produce JUnit results, then fwos check decides "verified".', "# It never calls a model. Generated by fwos; edit freely, it's yours."];
// The JUnit reporters that send test results to .fwos/local/results/ for fwos check. Each line
// becomes the one beside it once the JUnit part is out (null: it goes), and the comment goes too.
const SCAFFOLD_REPORTERS: { path: string; lines: [string, string | null][]; comment?: string }[] = [
  {
    path: 'apps/web/vitest.config.ts',
    lines: [
      ["reporters: ['default', 'junit'],", "reporters: ['default'],"],
      ["outputFile: { junit: '../../.fwos/local/results/vitest.xml' },", null],
    ],
    comment: '// JUnit results go to .fwos/local/results/, where `fwos check` reads them (traceability, states).',
  },
  {
    path: 'apps/web/playwright.config.ts',
    lines: [["reporter: [['list'], ['junit', { outputFile: '../../.fwos/local/results/playwright.xml' }]],", "reporter: 'list',"]],
  },
];
/** Where a project tells its test runners where results go: their configs and package.json scripts. */
const TEST_CONFIGS = ['**/*.config.{js,cjs,mjs,ts,cts,mts}', '**/package.json'];

/**
 * What eject takes out of package.json, the CI workflow and the test configs: the pin to the
 * vendored CLI, which leaves with .fwos/, the scripts and CI step that run fwos, and the JUnit
 * reporters that write into .fwos/local/. Each goes only while it's as fwos wrote it. A pin you
 * chose, a line you changed that still runs fwos, and a line that still sends test results to
 * .fwos/local/ (yours, or one you changed) stay and are listed in `left`. `results` says such a
 * line is left, so .fwos/local/ has to stay ignored. `relock` says the pin goes from a project
 * with a lockfile, which then needs a fresh one.
 */
function scaffoldLines(p: Project): { items: EjectItem[]; left: Omit<EjectItem, 'apply'>[]; results: boolean; relock: boolean } {
  const items: EjectItem[] = [];
  const left: Omit<EjectItem, 'apply'>[] = [];
  let relock = false;
  const pkg = readJson<PackageJson>(p.abs('package.json'));
  const edit = (field: keyof PackageJson, key: string) => () => {
    const now = readJson<PackageJson>(p.abs('package.json'))!;
    delete now[field]![key];
    if (Object.keys(now[field]!).length === 0) delete now[field];
    writeJson(p.abs('package.json'), now);
  };
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const pin = pkg?.[field]?.['fwos-check'];
    if (pin === VENDORED_PIN) {
      items.push({ path: 'package.json', what: `the fwos-check pin to ${VENDORED_CLI}`, apply: edit(field, 'fwos-check') });
      relock = existsSync(p.abs('pnpm-lock.yaml'));
    } else if (pin !== undefined) left.push({ path: 'package.json', what: `the fwos-check pin (${pin})` });
  }
  for (const [name, command] of Object.entries(pkg?.scripts ?? {})) {
    if (SCAFFOLD_SCRIPTS[name] === command) items.push({ path: 'package.json', what: `the ${name} script (${command})`, apply: edit('scripts', name) });
    else if (runsFwos(command)) left.push({ path: 'package.json', what: `the ${name} script (${command})` });
  }
  const ci = readText(p.abs(SCAFFOLD_WORKFLOW));
  if (ci !== null) {
    // The step goes with the comment that describes it, and only while it's fwos's own line.
    const lines = ci.split('\n');
    const ours = lines.some((l) => l.trim() === SCAFFOLD_STEP) ? [SCAFFOLD_STEP, ...SCAFFOLD_STEP_COMMENT] : [];
    const rest = lines.filter((l) => !ours.includes(l.trim())).flatMap((line) => line.trim() === '- run: pnpm exec fwos tests run' ? [line.replace('pnpm exec fwos tests run', 'pnpm test'), line.replace('pnpm exec fwos tests run', 'pnpm e2e')] : [line]);
    const restoresTests = lines.some((line) => line.trim() === '- run: pnpm exec fwos tests run');
    if (rest.length < lines.length || restoresTests) {
      const what = `the fwos check step${lines.length - rest.length > 1 ? ' and its comment' : ''}; the rest of your CI stays`;
      items.push({ path: SCAFFOLD_WORKFLOW, what, apply: () => writeText(p.abs(SCAFFOLD_WORKFLOW), rest.join('\n')) });
    }
    for (const what of fwosLines(rest)) left.push({ path: SCAFFOLD_WORKFLOW, what });
  }
  // A config's reporter lines go together, and only while each is fwos's own line: a JUnit
  // reporter left without its output file would print its XML into the test output instead.
  const edited = new Map<string, string>();
  for (const r of SCAFFOLD_REPORTERS) {
    const lines = readText(p.abs(r.path))?.split('\n') ?? [];
    if (!r.lines.every(([was]) => lines.some((l) => l.trim() === was))) continue;
    const now = new Map(r.lines);
    const next = lines.flatMap((l) => {
      const to = now.get(l.trim());
      if (l.trim() === r.comment || to === null) return [];
      return to === undefined ? [l] : [l.replace(l.trim(), to)];
    });
    const text = next.join('\n');
    const what = `the JUnit reporter that writes to .fwos/local/results/${lines.some((l) => l.trim() === r.comment) ? ' and its comment' : ''}`;
    items.push({ path: r.path, what, apply: () => writeText(p.abs(r.path), text) });
    edited.set(r.path, text);
  }
  // A line that still sends results to .fwos/local/ once those are out is yours, or one you changed.
  // It stays, so the results it sends there have to stay ignored.
  let results = false;
  for (const path of p.files(TEST_CONFIGS, ['.fwos/**'])) {
    for (const l of (edited.get(path) ?? p.read(path) ?? '').split('\n')) {
      if (!l.includes('.fwos/local') || /^\s*(\/\/|\/\*|\*)/.test(l)) continue;
      left.push({ path, what: l.trim() });
      results = true;
    }
  }
  return { items, left, results, relock };
}

/**
 * The lines in the project's other workflows that run fwos, such as the `pnpm exec fwos check`
 * step an adopted app adds to its own CI. Those workflows are yours, so eject lists the lines and
 * never edits them: with the pin to the vendored CLI gone, they fail until you change them.
 */
function workflowLines(p: Project): Omit<EjectItem, 'apply'>[] {
  return workflows(p)
    .filter((path) => path !== SCAFFOLD_WORKFLOW)
    .flatMap((path) => fwosLines((readText(p.abs(path)) ?? '').split('\n')).map((what) => ({ path, what })));
}

type Settings = { permissions?: { allow?: string[] } };

// The fwos entry step 0 of /fwos:start writes: the plugin's CLI by its absolute path. A plugin
// update moves that path, so any absolute path counts. An older step 0 wrote the pattern instead.
const STEP0_ENTRY = /^Bash\(node "([^"]+)\/dist\/fwos\.mjs":\*\)$/;
const STEP0_PATTERN = 'Bash(node:*fwos.mjs*)';
const step0Entry = (rule: string) => rule === STEP0_PATTERN || isAbsolute(STEP0_ENTRY.exec(rule)?.[1] ?? '');

/**
 * What eject takes out of the permission allowlist: step 0's fwos entries, each named. Any other
 * entry that names fwos is the user's, so it stays and is listed in `left`. Step 0's pnpm and git
 * entries stay unlisted, since they work without fwos.
 */
function allowlistEntries(p: Project): { items: EjectItem[]; left: Omit<EjectItem, 'apply'>[] } {
  const path = '.claude/settings.json';
  const items: EjectItem[] = [];
  const left: Omit<EjectItem, 'apply'>[] = [];
  const remove = (rule: string) => () => {
    const now = readJson<Settings>(p.abs(path))!;
    now.permissions!.allow = now.permissions!.allow!.filter((r) => r !== rule);
    writeJson(p.abs(path), now);
  };
  for (const rule of readJson<Settings>(p.abs(path))?.permissions?.allow ?? []) {
    if (step0Entry(rule)) items.push({ path, what: `the permission entry ${rule}`, apply: remove(rule) });
    else if (/\bfwos\b/.test(rule)) left.push({ path, what: `the permission entry ${rule}` });
  }
  return { items, left };
}

const eject: Command = (a, io) => {
  const p = projectFor(a, io);
  const scaffolded = scaffoldLines(p);
  const allowlist = allowlistEntries(p);
  const left = [...allowlist.left, ...scaffolded.left, ...workflowLines(p)];
  const items: EjectItem[] = [];
  if (isDir(p.abs('.fwos'))) {
    const what = `fwos state, change files, approvals, local evidence${isDir(p.abs(VENDORED_CLI)) ? ', the vendored CLI' : ''}`;
    items.push({ path: '.fwos/', what, apply: () => rmSync(p.abs('.fwos'), { recursive: true, force: true }) });
  }
  const hookPath = commitHookPath(p.root)?.path;
  if (hookPath && readText(hookPath)?.includes('fwos commit check')) items.push({ path: fromRoot(p, hookPath), what: 'the fwos commit check', apply: () => rmSync(hookPath) });
  const gi = readText(p.abs('.gitignore'));
  if (gi?.includes('.fwos/local/')) {
    // While a line eject leaves still sends test results there, they have to stay out of git.
    if (scaffolded.results) left.push({ path: '.gitignore', what: 'the .fwos/local/ lines, while a line above still sends test results there' });
    else {
      items.push({
        path: '.gitignore',
        what: 'the .fwos/local/ lines',
        apply: () => writeText(p.abs('.gitignore'), gi.replace(/# fwos: evidence, run logs and test results \(local only\)\n\.fwos\/local\/\n?/, '')),
      });
    }
  }
  items.push(...allowlist.items, ...scaffolded.items);
  const leftAlone = left.length > 0 ? [yellow('Left alone, since you changed or chose them (they still use fwos):'), ...left.map((l) => `  ${l.path}  ${dim(l.what)}`)] : [];
  if (items.length === 0) {
    io.out('Nothing to eject: no fwos state, hooks or settings here.', ...leftAlone);
    return 0;
  }
  io.out(
    bold(bool(a, 'yes') ? 'Removing:' : 'Eject would remove (nothing else; your docs, design system, code and tests stay):'),
    ...items.map((i) => `  ${i.path}  ${dim(i.what)}`),
    ...leftAlone,
  );
  if (!bool(a, 'yes')) {
    io.out('', 'Run `fwos eject --yes` to do it.');
    return 0;
  }
  for (const i of items) i.apply();
  io.out(green('Ejected.'));
  if (scaffolded.relock) io.out("Next: run pnpm install and commit pnpm-lock.yaml. CI's frozen install fails until the lockfile drops fwos-check.");
  return 0;
};

const harnessCmd: Command = async (a, io) => {
  const p = projectFor(a, io);
  requireInit(p);
  const sub = a.positionals[0] ?? 'write';
  const files = profilesFor(p).flatMap((x) => x.verify?.harness?.(p) ?? []);
  const ofKind = (kind: string | undefined) => {
    if (kind !== 'states' && kind !== 'ia') throw new FwosError(`Unknown harness "${kind ?? ''}".`, 'It is states or ia.');
    const h = files.find((f) => f.kind === kind);
    if (!h) throw new FwosError(`No platform of this project (${p.platforms.join(', ')}) has a ${kind} harness.`);
    return h;
  };
  const iaOf = () => {
    const loaded = loadIa(p);
    if (!loaded?.ia) throw new FwosError(loaded ? `${loaded.path} has errors, so there's no IA to run.` : `No ${iaPath(p)} yet, so there's no IA to run.`, 'Run fwos check ia.');
    return loaded.ia;
  };
  if (sub === 'write') {
    if (files.length === 0) throw new FwosError(`No platform of this project (${p.platforms.join(', ')}) has a harness.`);
    if (bool(a, 'check')) {
      const wrong = files.filter((h) => harnessStatus(p, h) !== 'current');
      for (const h of wrong) io.out(`${harnessStatus(p, h) === 'absent' ? red('missing') : red('edited')} ${h.file}`);
      return wrong.length > 0 ? 1 : 0;
    }
    for (const h of files) {
      const app = posix.dirname(posix.dirname(h.file));
      if (!isDir(p.abs(app))) throw new FwosError(`No app at ${app} yet, so there's nowhere to put ${h.file}.`, 'Run fwos scaffold web first.');
    }
    for (const h of files) {
      const w = writeOwned(p.root, h.file, h.content, 'fwos', 'fwos harness');
      io.out(`${w.status === 'written' ? green('wrote') : dim('unchanged')} ${h.file}`);
    }
    return 0;
  }
  if (sub === 'targets') {
    const kind = a.positionals[1];
    ofKind(kind);
    if (kind === 'states') return json(io, { revision: revisionOf(p), targets: stateTargets(p) }), 0;
    // No ia.json (an adopted app may have none): nothing to run, so the IA harness defines no test.
    if (!loadIa(p)) return json(io, { revision: revisionOf(p), cookie: TEST_ACCESS_COOKIE, runs: [], visits: [], skipped: [] }), 0;
    return json(io, { revision: revisionOf(p), cookie: TEST_ACCESS_COOKIE, ...iaRunPlan(iaOf()) }), 0;
  }
  if (sub === 'record') {
    const kind = a.positionals[1];
    const h = ofKind(kind);
    const target = a.positionals[2];
    const given = need(a, 'revision', 'The harness passes the revision `fwos harness targets` gave it when the run started.');
    let input: { config?: Record<string, unknown>; observations?: unknown };
    try {
      input = JSON.parse(await readStdin()) as typeof input;
    } catch (e) {
      throw new FwosError(`What the harness saw isn't JSON on stdin: ${(e as Error).message}`);
    }
    const config = Object.fromEntries(Object.entries(input.config ?? {}).map(([k, v]) => [k, String(v)]));
    let violations: string[];
    if (kind === 'states') {
      const t = stateTargets(p).find((x) => x.key === target);
      if (!t) throw new FwosError(`${target ?? '(none)'} isn't a state harness target.`, 'fwos harness targets states lists them.');
      if (!Array.isArray(input.observations)) throw new FwosError('The observations of a state run are a list, one per state.');
      violations = judgeStates(input.observations as StateObservation[])
        .filter((v) => v.verdict === 'violation')
        .map((v) => `${stateName(t.kind, t.id, v.state)}: ${[...v.problems, ...v.dead].join('; ')}`);
    } else {
      const ia = iaOf();
      if (!iaRunPlan(ia).runs.some((r) => r.key === target)) throw new FwosError(`${target ?? '(none)'} isn't a role and flag setting the IA harness runs.`, 'fwos harness targets ia lists them.');
      const o = input.observations as Partial<IaRun> | null;
      if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.role !== 'string' || !Array.isArray(o.visits) || !Array.isArray(o.nav) || typeof o.applied !== 'boolean') {
        throw new FwosError('The observations of an IA run are an IA run: role, flags, applied, visits and nav.');
      }
      violations = judgeIaRun(ia, o as IaRun).map((x) => x.message);
    }
    const revision = revisionOf(p);
    const file = writeRun(p, {
      schema: 1,
      kind: h.kind,
      target: target!,
      fwos: pluginVersion(),
      harness: { file: h.file, sha: hashText(p.read(h.file) ?? '') },
      revision: revision === given ? revision : null,
      config,
      at: now(),
      observations: input.observations,
    });
    json(io, { file, violations });
    return violations.length > 0 ? 1 : 0;
  }
  if (sub === 'status') {
    const rows = files.map((h) => ({ kind: h.kind, file: h.file, status: harnessStatus(p, h) }));
    const runs = files.flatMap((h) =>
      readRuns(p, h.kind).records.map((r) => {
        const f = runFreshness(p, r, h);
        return { kind: h.kind, target: r.target, counts: f.fresh, ...(f.fresh ? {} : { why: f.why }) };
      }),
    );
    if (bool(a, 'json')) return json(io, { harness: rows, runs }), 0;
    const label = { current: "fwos's own", edited: 'edited (runs of it never count)', absent: 'missing (`fwos harness` writes it)' };
    for (const row of rows) {
      io.out(`${row.kind.padEnd(7)} ${row.file}  ${label[row.status]}`);
      const mine = runs.filter((r) => r.kind === row.kind);
      if (mine.length === 0) io.out('  (no runs yet)');
      const w = Math.max(0, ...mine.map((r) => r.target.length));
      for (const r of mine) io.out(`  ${r.target.padEnd(w)}  ${r.counts ? 'counts' : `doesn't count: ${r.why}`}`);
    }
    return 0;
  }
  throw new FwosError(`Unknown subcommand "harness ${sub}".`, 'fwos harness [--check] | harness targets <states|ia> | harness record <states|ia> <target> --revision <rev> | harness status [--json]');
};

const hook: Command = async (a, io) => {
  const event = a.positionals[0] as HookEvent;
  if (!['pre-tool-use', 'post-tool-use', 'session-start'].includes(event)) throw new FwosError(`Unknown hook event "${event}".`);
  let input = {};
  try {
    const raw = await readStdin();
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return 0; // malformed input: stay out of the way
  }
  // JSON that isn't an object (null, a list, a string) is malformed too; dispatch stays out of the way.
  const r = dispatch(event, input, io.cwd);
  if (r.stdout) io.out(r.stdout);
  return r.code;
};

const version: Command = (_a, io) => {
  io.out(pluginVersion());
  return 0;
};

export const HELP = `fwos ${'{version}'}: Frontend Web OS. From an idea to a tested web app, with checks that never call a model.

Usage: fwos <command> [options]        (--dir <path> runs against another folder)

Every day
  check [ids...] [--staged] [--json]    run every check: PASS, FAIL or OFF with the reason
  report [--json]                       write docs/app/reports/acceptance.md from the evidence
  doctor [--json]                       tools, platforms, adapters, and every check on or off
  doctor --start [--url <url>]          also start the app (or use the one at <url>) and render a
                                        state fixture in Chromium: the verify driver is active only then
  status [--json]                       the current change, its approvals and locked tests
  next [--json]                         what to do now (the /fwos:start skill reads this)

The flow
  init [--platforms web] [--mode new|adopt|spike] [--name "<app>"]
  approve <target> --by "<name>" [--via chat|pr|autopilot] [--ref <review URL>]
  skip <target> --reason "<why>" --by "<name>"     (research, architecture, design-system, screens)
  step <step>                           move the current change (forward needs every earlier approval)
  change new "<request>" --route <route> [--link <url|path>]
                                        a later request, at its route's entry step; --link records the
                                        issue or spec it comes from
  change map <route|file>... [--json]   an adopted app: what the open change touches, read from the code
                                        (page, components, data calls, tests, owners), recorded on it
  change drift [--json]                 an adopted app: the open change's edits against what it maps
  change link <url|path>... [--stage <stage>]
                                        link what the open change builds on, in place; with a stage, your
                                        team's own artifact for it (a design, a test plan, a sign-off)
  change trace [<id>] [--json]          an adopted app: a change from its request to its evidence (asks,
                                        questions, states, criteria, cases, results) and what is open
  change list [--json]                  every change, with its step and status
  change show [<id>]                    one change as JSON (the current one by default)
  change cursor [--section <s>] [--pending <Q-1,Q-2>] [--note "<text>"]
                                        where you stopped, for resuming
  change spend --step <step> --usd <n>  add spend to the current change
  change done                           close the current change (checks pass, acceptance approved)
  signoff <AC-x-n|GAP-n> --by "<name>" [--note "..."]

Files fwos generates or writes
  design-system init [--from-shadcn <globals.css>] [--name "<name>"]
  design-system report [--json]         where every token and component came from, and four outcomes
                                        kept apart: token validity, generated CSS, coverage, fidelity
  design-system gallery                 a dev-only page and a browser run that compare your original
                                        and adopted components, in both modes at two widths
  design-system decide <item...> --as replace|omit|intentional --reason "<why>" --by "<name>"
  tokens build [--check]                CSS variables and the Tailwind theme from your tokens
  contract mocks [--check]              the fail-closed mock fetch from openapi.yaml + fixtures
  scaffold web [--name "<app>"] [--fwos-check <spec>]
                                        the walking skeleton (never overwrites your files). It vendors this
                                        CLI into .fwos/cli and pins file:.fwos/cli; --fwos-check pins
                                        something else instead (e.g. link:../fwos)
  vendor                                refresh .fwos/cli to this plugin's version (touches nothing else)
  update [--yes]                        after a plugin update: migrate pack files and records from an older
                                        schema, refresh .fwos/cli, back up what it replaces. Previews
                                        first, and writes nothing while a file in .fwos/cli is patched
  harness [--check]                     write fwos's own Playwright tests into the app's e2e folder: they
                                        render every state fixture and open every route as each role and
                                        flag setting (scaffold writes them too; --check names a changed one)
  harness targets <states|ia>           what those tests render or open, as JSON (they run it)
  harness record <states|ia> <target> --revision <rev>
                                        keep what one test saw (JSON on stdin) as a run record, tied to the
                                        code, and answer with what breaks its contract (they run it)
  harness status [--json]               each run record, and whether it still counts
  codex agents                          write fwos's agents for Codex to .codex/agents/ (init does it in Codex)
  stamp <doc> --from <doc,...>          record what a doc was built from (based_on hashes)
  spike new <name>                      throwaway code in spikes/

Tests and slices
  tests run [<script>...] [--json]      an adopted app: run your own test scripts as you do, with a JUnit
                                        reporter added on the command line, so their results count
  tests lock <files...> (--red | --existing) [--slice S1]
  tests unlock <file> --reason "<why>" --reviewer "<name>"
  tests status [--json]
  slice drift <manifest> [--base <ref>] [--json]
  ia diff [--base <ref> | --from <file>] [--json]
  prototype check [<id>] [--json]       each bundle in docs/app/prototypes/: what stops it being promoted,
                                        and whether its promotion still holds
  prototype promote <id> --by "<who>"   pin a bundle's committed inputs by hash, once nothing stops it
  prototype diff <id> [--json]          its intended IA against the app: routes, and who sees what in
                                        fresh runs of fwos's IA harness
  baseline [--init]                     adopt mode: record existing findings; it can only shrink

Existing apps
  adopt [--app <dir>] [--level checks|design|delivery] [--docs <dir>] [--design-system <dir>] [--name "<app>"] [--yes] [--json]
                                        read the app and propose what fwos would set up, stage by stage,
                                        writing nothing; --yes does it. On an adopted app, --level changes
                                        the level and keeps every record
  adopt --keep <stage>[,<stage>] --reason "<why>" | --use <stage>[,<stage>]
                                        keep your own practice for a stage (idea, design, spec, test-plan,
                                        build, acceptance): fwos adds nothing there. --use gives it back

Setup
  git-hook install                      run fwos check --staged before each commit
  eject [--yes]                         preview, then remove .fwos/, the hook, fwos settings, and the
                                        fwos-check pin, scripts, CI step and JUnit reporters for fwos
  hash <path...>                        the content hash fwos records for each path
  version                               this version (same as --version)
  help [<command>]                      this help, or one command's (same as <command> --help)

Exit codes: 0 ok, 1 a check failed (NOT VERIFIED), 2 usage or input error.`;

/**
 * The flags each command takes, beyond --dir and --help. A command with subcommands lists each as
 * "<command> <sub>", and its bare name holds its default subcommand's. Any other flag is a usage
 * error, so a typo such as --jsn never runs as if it weren't there. `fwos hook` takes none and
 * refuses none: it runs inside the host's tool call, where exit 2 would block the call.
 */
export const FLAGS: Record<string, string[]> = {
  adopt: ['app', 'level', 'docs', 'design-system', 'name', 'keep', 'use', 'reason', 'yes', 'json'],
  init: ['platforms', 'mode', 'name'],
  status: ['json'],
  next: ['json'],
  check: ['staged', 'json'],
  report: ['json'],
  doctor: ['json', 'start', 'url'],
  approve: ['by', 'via', 'ref'],
  skip: ['reason', 'by'],
  step: [],
  change: [],
  'change new': ['route', 'link'],
  'change map': ['json'],
  'change drift': ['json'],
  'change link': ['stage'],
  'change trace': ['json'],
  'change list': ['json'],
  'change show': [],
  'change cursor': ['section', 'pending', 'note'],
  'change spend': ['step', 'usd'],
  'change done': [],
  signoff: ['by', 'note'],
  'design-system': ['from-shadcn', 'name'],
  'design-system init': ['from-shadcn', 'name'],
  'design-system report': ['json'],
  'design-system gallery': [],
  'design-system decide': ['as', 'reason', 'by'],
  tokens: ['check'],
  contract: ['check'],
  scaffold: ['name', 'fwos-check'],
  vendor: [],
  update: ['yes'],
  codex: [],
  stamp: ['from'],
  spike: [],
  tests: ['json'],
  'tests run': ['json'],
  'tests lock': ['red', 'existing', 'slice'],
  'tests unlock': ['reason', 'reviewer'],
  'tests status': ['json'],
  slice: ['base', 'json'],
  ia: ['base', 'from', 'json'],
  prototype: ['json'],
  'prototype check': ['json'],
  'prototype promote': ['by'],
  'prototype diff': ['json'],
  baseline: ['init'],
  harness: ['check'],
  'harness write': ['check'],
  'harness targets': [],
  'harness record': ['revision'],
  'harness status': ['json'],
  'git-hook': [],
  eject: ['yes'],
  hash: [],
  version: [],
};

/** Which FLAGS entry `fwos <command> <first positional>` uses: the subcommand's, else the command's. */
export function flagsKey(command: string, sub: string | undefined): string {
  return sub !== undefined && `${command} ${sub}` in FLAGS ? `${command} ${sub}` : command;
}

/**
 * One command's lines from HELP, for `fwos <command> --help`: a subcommand's alone when HELP has
 * lines for it, else every line of the command. Null for a command HELP doesn't list.
 */
export function commandHelp(command: string, sub?: string): string | null {
  const lines = HELP.split('\n');
  const linesOf = (name: string) =>
    lines.flatMap((l, i) => {
      if (l !== `  ${name}` && !l.startsWith(`  ${name} `)) return [];
      const more: string[] = [];
      for (let j = i + 1; j < lines.length && /^ {10,}\S/.test(lines[j]!); j++) more.push(lines[j]!);
      return [l, ...more];
    });
  const own = sub !== undefined && linesOf(`${command} ${sub}`).length > 0 ? linesOf(`${command} ${sub}`) : linesOf(command);
  if (own.length === 0) return null;
  return [
    'Usage:',
    ...own.map((l) => (/^ {10,}/.test(l) ? `     ${l}` : `  fwos ${l.slice(2)}`)),
    '',
    '--dir <path> runs it against another folder. `fwos help` lists every command.',
    'Exit codes: 0 ok, 1 a check failed (NOT VERIFIED), 2 usage or input error.',
  ].join('\n');
}

export const COMMANDS: Record<string, Command> = {
  adopt,
  init,
  status,
  next,
  check,
  report,
  doctor: doctorCmd,
  approve: approveCmd,
  skip: skipCmd,
  step: stepCmd,
  change,
  stamp,
  hash,
  tokens,
  'design-system': designSystem,
  contract,
  ia,
  prototype,
  tests: testsCmd,
  signoff,
  baseline,
  scaffold,
  vendor,
  update,
  codex,
  slice,
  spike,
  'git-hook': gitHook,
  eject,
  harness: harnessCmd,
  hook,
  version,
};

