// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos adopt`: what fwos would set up in an app it didn't create, shown before anything is
// written, and done on a yes. The platform reads the repo (each finding with its file); this turns
// that into a proposal for a level, stops on what only the user can decide, and lists the
// capabilities each level turns on, which `fwos status` and `fwos doctor` show as well.

import { join, posix, relative } from 'node:path';
import {
  ADOPT_LEVELS,
  ADOPT_STAGES,
  type AdoptLevel,
  type AdoptStage,
  DEFAULT_PATHS,
  FwosError,
  type Inventory,
  type Project,
  type ProjectPaths,
  type RepoFinding,
  isFile,
  loadProject,
  branchFor,
  pluginVersion,
  readJson,
  readText,
  readWorkflow,
} from '../../kernel/index.ts';
import { fromShadcn, mapDesignSystem, tokenSummary } from '../../modules/design-system/index.ts';
import {
  type Change,
  type FwosState,
  STATE_SCHEMA_VERSION,
  baselineTotal,
  currentChange,
  initProject,
  isAdoptionRecord,
  type KeptStage,
  keptStages,
  listChanges,
  logEvent,
  readBaseline,
  setAdoptLevel,
  setKeptStages,
  today,
  writeBaseline,
  writeYours,
} from '../../modules/state/index.ts';
import { lockedFiles } from '../../modules/tests/index.ts';
import { normalizeDir } from '../../platforms/web/index.ts';
import { CODEX_AGENTS_DIR, cliOnlyDistribution, inCodex, writeCodexAgents } from './codex.ts';
import { green, yellow } from './format.ts';
import { PROFILES, adaptersFor, allChecks, checksFor } from './registry.ts';
import { commitCheckInstalled, commitHookPath, fwosLines, workflows } from './repo.ts';
import { runChecks, unbaselined } from './runner.ts';
import { type StageRow, formatStages, stageNames, stageRows } from './stages.ts';
import { runLabel } from './testrun.ts';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const atLeast = (level: AdoptLevel, than: AdoptLevel) => ADOPT_LEVELS.indexOf(level) >= ADOPT_LEVELS.indexOf(than);
/** `a`, `a or b`, `a, b or c`. */
const orList = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);
/** `a`, `a and b`, `a, b and c`. */
const andList = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** Files fwos keeps in its docs folder: a team's own file with one of these names would be read as fwos's. */
const DOC_RECORDS = ['brief.md', 'research.md', 'spec.md', 'test-plan.md', 'decisions.md', 'ia.json', 'modules.json', 'reports/acceptance.md'];

// ---- capabilities -------------------------------------------------------------------------------

export type CapabilityId = 'checks' | 'baseline' | 'commit-hook' | 'ci' | 'design-system' | 'components' | 'changes' | 'spec-gate' | 'test-results' | 'test-locks';

export interface Capability {
  id: CapabilityId;
  level: AdoptLevel;
  label: string;
  what: string;
  optional: boolean;
  /** The level includes it. */
  enabled: boolean;
  /** It works: enabled, and what it needs is there. In a proposal, once the proposal is applied. */
  on: boolean;
  /** Why it's on or off, and what turns it on. */
  status: string;
}

const CAPABILITIES: Pick<Capability, 'id' | 'level' | 'label' | 'what' | 'optional'>[] = [
  { id: 'checks', level: 'checks', label: 'checks', what: 'fwos check runs on your app, with no model', optional: false },
  { id: 'baseline', level: 'checks', label: 'baseline', what: "today's findings are debt, so fwos check fails only on new ones", optional: false },
  { id: 'commit-hook', level: 'checks', label: 'commit hook', what: 'fwos check --staged runs before each commit', optional: true },
  { id: 'ci', level: 'checks', label: 'CI', what: 'your CI runs fwos check after the tests', optional: true },
  { id: 'design-system', level: 'design', label: 'design system', what: 'your own theme as DTCG tokens, so contrast, the component registry and the token build are checked too', optional: false },
  { id: 'components', level: 'design', label: 'components', what: 'your UI components in the registry, so a superseded one is flagged where it is used', optional: false },
  { id: 'changes', level: 'delivery', label: 'changes', what: '/fwos:change delivers a request in place: a spec and test delta, the build, an acceptance report', optional: false },
  { id: 'spec-gate', level: 'delivery', label: 'spec gate', what: "while a change is open, edits to your app wait for that change's approved spec", optional: false },
  { id: 'test-results', level: 'delivery', label: 'test results', what: 'your runners write JUnit XML, so a passing test proves each criterion', optional: false },
  { id: 'test-locks', level: 'delivery', label: 'test locks', what: "the tests a change adds are locked by hash; your existing suite isn't", optional: false },
];

/** How the repo runs a package's binary and its scripts, from its lockfile (pnpm when it has none). */
function runner(inv: Inventory | null): { exec: string; run: (script: string) => string } {
  switch (inv?.findings.find((f) => f.area === 'package-manager')?.what) {
    case 'npm':
      return { exec: 'npx', run: (s) => (s === 'test' ? 'npm test' : `npm run ${s}`) };
    case 'yarn':
      return { exec: 'yarn', run: (s) => `yarn ${s}` };
    case 'bun':
      return { exec: 'bunx', run: (s) => `bun run ${s}` };
    default:
      return { exec: 'pnpm exec', run: (s) => `pnpm ${s}` };
  }
}

/**
 * Whether the app's test results count yet, and if not, what makes them: `fwos tests run` runs the
 * team's own scripts with a JUnit reporter on the command line, so their configs stay as they are.
 */
function testResults(p: Project): { on: boolean; status: string } {
  const results = p.files(p.paths.results).length;
  if (results > 0) return { on: true, status: `${count(results, 'result file')} in .fwos/local/results/` };
  const commands = PROFILES.find((x) => x.tests)?.tests?.commands(p).commands ?? [];
  if (commands.length === 0) return { on: false, status: 'no test script in package.json (test, test:*, e2e or e2e:*): `fwos tests run` runs your own once you add one' };
  const mapped = commands.filter((c) => c.results);
  if (mapped.length > 0) return { on: false, status: `\`fwos tests run\` runs ${andList(mapped.map(runLabel))}, with a JUnit reporter added on the command line` };
  const one = commands.length === 1;
  return {
    on: false,
    status: `${andList(commands.map((c) => c.display))} ${one ? 'runs as it is' : 'run as they are'}, but fwos can't read ${one ? 'its' : 'their'} results (${commands[0]!.unmapped}); to count, a run has to write JUnit XML to .fwos/local/results/`,
  };
}

/**
 * The capabilities of an adopted app's level, each on or off with why. `applying` reads them as a
 * proposal would leave them: the theme imported and the baseline recorded (`findings` of it).
 */
export function capabilities(p: Project, ctx: { inv: Inventory | null; applying?: { findings: number } }): Capability[] {
  const level = p.level ?? 'checks';
  const { exec } = runner(ctx.inv);
  const applying = ctx.applying;
  const ds = p.paths.designSystem;
  const theme = ctx.inv?.theme ?? null;
  const dsThere = p.exists(`${ds}/design-system.json`) || (!!applying && !!theme && atLeast(level, 'design'));
  const baseline = readBaseline(p.root);
  const hook = applying ? null : commitCheckInstalled(p);
  const flows = workflows(p);
  const ci = flows.filter((w) => fwosLines((p.read(w) ?? '').split('\n')).length > 0);
  const testsFlow = ctx.inv?.findings.find((f) => f.area === 'ci' && f.what.includes('runs the tests'))?.from ?? flows[0];
  const change = applying ? null : currentChange(p.root);
  const open = change && !isAdoptionRecord(p, change) ? change : null;
  const ui = p.paths.ui.web;
  const installed = ui ? (PROFILES.find((x) => x.platform === 'web')?.components?.listInstalled(p).length ?? 0) : 0;
  const status: Record<CapabilityId, { on: boolean; status: string }> = {
    checks: { on: true, status: `fwos check reads ${p.paths.source.join(', ')}` },
    baseline: baseline
      ? { on: true, status: `${count(baselineTotal(baseline), 'pre-existing finding')}, recorded ${baseline.createdAt.slice(0, 10)}` }
      : applying
        ? { on: true, status: `records ${count(applying.findings, 'finding')} from today as debt` }
        : { on: false, status: 'needs `fwos baseline --init`' },
    'commit-hook': hook ? { on: true, status: `runs fwos check --staged (${hook})` } : { on: false, status: `optional: ${commitAdvice(p.root, exec, false)}` },
    ci:
      ci.length > 0
        ? { on: true, status: `${ci.join(', ')} runs fwos` }
        : { on: false, status: testsFlow ? `optional: add \`- run: ${exec} fwos check\` after the tests in ${testsFlow}` : `optional: no CI found; run \`${exec} fwos check\` after the tests wherever they run` },
    'design-system': dsThere
      ? { on: true, status: p.exists(`${ds}/design-system.json`) ? `tokens in ${ds}/` : `imports ${theme} into ${ds}/` }
      : !atLeast(level, 'design')
        ? { on: false, status: `at level design: ${theme ? `imports ${theme} into ${ds}/` : 'needs your theme (a shadcn CSS file) or DTCG tokens'}` }
        : theme
          ? { on: false, status: `needs \`fwos adopt --level ${level} --yes\` to import ${theme}` }
          : { on: false, status: `needs your theme: no shadcn CSS or ${ds}/ found, so nothing is imported` },
    components: !ui
      ? { on: false, status: `needs a UI components folder: set paths.ui in .fwos/state.json` }
      : !atLeast(level, 'design')
        ? { on: false, status: `at level design: registers the components in ${ui}` }
        : !dsThere
          ? { on: false, status: `needs ${ds}/ first` }
          : { on: installed > 0, status: installed > 0 ? `${count(installed, 'component')} in ${ui}` : `none in ${ui} yet` },
    changes: { on: true, status: open ? `change ${open.id} is open (step ${open.step})` : 'no change open: /fwos:change "<request>" starts one' },
    'spec-gate': { on: true, status: `covers ${p.paths.gated.join(', ')} while a change is open` },
    'test-results': testResults(p),
    'test-locks': { on: true, status: `${count(lockedFiles(p).length, 'locked test')}; the existing suite stays unlocked` },
  };
  return CAPABILITIES.map((c) => {
    const enabled = atLeast(level, c.level);
    const s = status[c.id];
    // A row for a later level says which level brings it, unless it already says.
    const off = s.status.startsWith('at level') || s.status.startsWith('needs a UI') ? s.status : `at level ${c.level}: \`fwos adopt --level ${c.level}\``;
    return { ...c, enabled, on: enabled && s.on, status: enabled ? s.status : off };
  });
}

/** One line per capability: ON, OFF (the level has it, its inputs don't exist), or -- (a later level). */
export function formatCapabilities(caps: Capability[]): string[] {
  const w = Math.max(...caps.map((c) => c.label.length));
  return caps.map((c) => `  ${(c.on ? 'ON' : c.enabled ? 'OFF' : '--').padEnd(4)} ${c.label.padEnd(w)}  ${c.status}`);
}

/** An adopted app's level, since when, and its capabilities, for `fwos status` and `fwos doctor`. */
export interface AdoptionStatus {
  level: AdoptLevel;
  app: string;
  since: string;
  history: { level: AdoptLevel; at: string }[];
  capabilities: Capability[];
  /** Each stage, fwos's or kept by the team, with what the team does there today. */
  stages: StageRow[];
}

export function adoptionStatus(p: Project): AdoptionStatus {
  const state = readJson<FwosState>(p.abs('.fwos/state.json'));
  const history = state?.adopt?.history ?? [];
  const level = p.level ?? 'checks';
  const app = p.paths.apps.web ?? '.';
  const since = history.at(-1)?.level === level ? history.at(-1)!.at : (state?.createdAt ?? '');
  const inv = PROFILES.find((x) => x.inventory)?.inventory?.(p.root, { app }) ?? null;
  return { level, app, since, history, capabilities: capabilities(p, { inv }), stages: stageRows(p, inv, state?.adopt?.keep ?? {}) };
}

/**
 * How a change in an adopted app fits the team's workflow: the branch named as theirs are (by the
 * kind of work: a fix for code-only, a feature otherwise), their pull request template and their
 * CODEOWNERS.
 */
export function changeWorkflow(p: Project, change: Pick<Change, 'id' | 'route'>, w = readWorkflow(p.root)): { branch: string | null; template: string | null; codeowners: string | null } {
  return { branch: branchFor(w, change.route === 'code-only' ? 'fix' : 'feat', change.id.replace(/^\d{4}-/, '')), template: w.template, codeowners: w.codeowners };
}

// ---- the proposal -------------------------------------------------------------------------------

export interface AdoptOptions {
  app?: string;
  level?: AdoptLevel;
  docs?: string;
  designSystem?: string;
  name?: string;
  /** Stages the team keeps its own practice for, from now on, and why. */
  keep?: AdoptStage[];
  reason?: string;
  /** Kept stages that go back to fwos. */
  use?: AdoptStage[];
}

export interface Proposal {
  reuse: { what: string; from: string }[];
  add: { path: string; what: string }[];
  change: { path: string; what: string }[];
  untouched: string[];
  /** Exactly what `.fwos/state.json` would hold. */
  state: FwosState;
  hooks: { agent: string; commit: string; ci: string };
  /** The checks that would run today, and the findings that would become debt. */
  checks: { on: string[]; off: { id: string; reason: string }[]; findings: number };
}

export interface AdoptionPlan {
  root: string;
  support: Inventory['support'];
  limits: string[];
  apps: Inventory['apps'];
  app: string | null;
  /** The app is adopted already: the plan changes its level. */
  adopted: boolean;
  current: AdoptLevel | null;
  level: AdoptLevel;
  /** For an adopted app, what changing the level does. */
  change?: string;
  /** What only the user can decide; nothing is written until they do. */
  decisions: string[];
  theme: string | null;
  findings: RepoFinding[];
  unknowns: Inventory['unknowns'];
  proposal: Proposal | null;
  capabilities: Capability[];
  /** Each stage as the plan leaves it: what the team does there today, the gap, what fwos adds and the evidence. */
  stages: StageRow[];
  /** The stages the team keeps, as the plan leaves them, and which of them the plan changes. */
  keep: Partial<Record<AdoptStage, KeptStage>>;
  keepChanges: { kept: AdoptStage[]; used: AdoptStage[] };
  written: boolean;
}

/** What a commit check would take here, said without installing anything. */
function commitAdvice(root: string, exec: string, proposal: boolean): string {
  const hook = commitHookPath(root);
  const lead = proposal ? 'not installed by adopt; ' : '';
  if (!hook) return `${lead}needs a git repository, then \`fwos git-hook install\``;
  for (const [file, label] of [['.husky', '.husky/pre-commit'], ['lefthook.yml', 'lefthook.yml'], ['lefthook.yaml', 'lefthook.yaml']] as const) {
    if (isFile(join(root, file)) || (file === '.husky' && isFile(join(root, '.husky/pre-commit')))) {
      return `${lead}add \`${exec} fwos check --staged\` to ${label} yourself (fwos never edits your hooks)`;
    }
  }
  const at = relative(root, hook.path).split('\\').join('/');
  const existing = readText(hook.path);
  if (existing && !existing.includes('fwos commit check')) return `${lead}${at} is yours, so add \`fwos check --staged\` to it yourself`;
  return proposal ? `${lead}\`fwos git-hook install\` would write ${at} to run \`fwos check --staged\`` : '`fwos git-hook install`';
}

/** What the plugin's hooks do in Claude Code and Codex at a level, once .fwos/state.json exists. */
function agentHooks(level: AdoptLevel, gated: string[]): string {
  const base = "Claude Code and Codex hooks: after an edit they point out raw design values and anything else that trips a rule `fwos check` runs, and they refuse edits to fwos's own records in .fwos/.";
  return atLeast(level, 'delivery')
    ? `${base} And while an fwos change is open, they block edits to ${gated.join(', ')} until that change's spec and test plan are approved, and edits to the tests it locked.`
    : `${base} They never block an edit to your code.`;
}

/**
 * Reads the repo and proposes what fwos would set up at a level, writing nothing. For an app
 * already adopted, it proposes the level change instead. Throws on what can't be a proposal at all:
 * a project fwos started, or an --app that isn't a Next.js app here.
 */
export async function planAdoption(root: string, opts: AdoptOptions): Promise<AdoptionPlan> {
  const existing = loadProject(root);
  if (existing.initialized && existing.mode !== 'adopt') {
    throw new FwosError(`fwos started this project (mode ${existing.mode}), so there is nothing to adopt.`, '`fwos status` shows where it stands.');
  }
  const adopted = existing.initialized;
  const appNow = existing.paths.apps.web ?? '.';
  if (adopted && opts.app !== undefined && normalizeDir(opts.app) !== appNow) {
    throw new FwosError(`This adoption covers the app at ${appNow}. To adopt another, remove fwos (\`fwos eject\`) and adopt again, or adopt that app in its own folder with --dir.`);
  }
  const profile = PROFILES.find((x) => x.inventory)!;
  const inv = profile.inventory!(root, adopted ? { app: appNow } : opts.app !== undefined ? { app: opts.app } : {});
  const next = inv.apps.filter((a) => a.supported).map((a) => a.dir);
  if (!adopted && opts.app !== undefined && inv.app === null) {
    throw new FwosError(`${normalizeDir(opts.app)} isn't a Next.js app here.${next.length > 0 ? ` Next.js apps: ${next.join(', ')}.` : ''}`, 'Run `fwos adopt` with no --app to see every app it found.');
  }
  const level = opts.level ?? existing.level ?? 'checks';
  const keeping = plannedKeep(adopted ? keptStages(root) : {}, opts);
  const base = { root, support: inv.support, limits: inv.limits, apps: inv.apps, app: adopted ? appNow : inv.app, level, theme: inv.theme, findings: inv.findings, unknowns: inv.unknowns, written: false, ...keeping };
  return adopted ? planLevelChange(existing, inv, level, base) : planNew(root, inv, opts, level, next, base);
}

/**
 * The stages kept once the plan is done: `current`, plus what --keep adds (each with --reason and
 * today's date), less what --use gives back, in the stages' order.
 */
function plannedKeep(current: Partial<Record<AdoptStage, KeptStage>>, opts: AdoptOptions): Pick<AdoptionPlan, 'keep' | 'keepChanges'> {
  const keep = opts.keep ?? [];
  const use = opts.use ?? [];
  const both = keep.filter((s) => use.includes(s));
  if (both.length > 0) throw new FwosError(`${both.join(', ')} ${both.length === 1 ? 'is' : 'are'} in both --keep and --use: pick one.`);
  if (keep.length > 0 && !opts.reason?.trim()) throw new FwosError('Missing --reason.', 'Why does your team keep its own practice there? --reason "<why>"');
  const next: Partial<Record<AdoptStage, KeptStage>> = {};
  for (const s of ADOPT_STAGES) {
    if (keep.includes(s)) next[s] = { reason: opts.reason!.trim(), at: today() };
    else if (current[s] && !use.includes(s)) next[s] = current[s];
  }
  const kept = keep.filter((s) => current[s]?.reason !== next[s]!.reason);
  const used = use.filter((s) => current[s]);
  return { keep: next, keepChanges: { kept, used } };
}

/** What changing the kept stages does, in a sentence per change. */
function keepSentences(plan: Pick<AdoptionPlan, 'keep' | 'keepChanges'>): string[] {
  const cap = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}`;
  const { kept, used } = plan.keepChanges;
  return [
    ...(kept.length > 0 ? [`${cap(stageNames(kept))} ${kept.length === 1 ? 'stays' : 'stay'} your team's (${plan.keep[kept[0]!]!.reason}).`] : []),
    ...(used.length > 0 ? [`${cap(stageNames(used))} ${used.length === 1 ? 'goes' : 'go'} back to fwos.`] : []),
  ];
}

type PlanBase = Omit<AdoptionPlan, 'adopted' | 'current' | 'decisions' | 'proposal' | 'capabilities' | 'change' | 'stages'>;

async function planNew(root: string, inv: Inventory, opts: AdoptOptions, level: AdoptLevel, next: string[], base: PlanBase): Promise<AdoptionPlan> {
  const decisions: string[] = [];
  if (inv.app === null && next.length > 1) decisions.push(`Pick the app to adopt: ${orList(next.map((d) => `--app ${d}`))}.`);
  const plan: AdoptionPlan = { ...base, adopted: false, current: null, decisions, proposal: null, capabilities: [], stages: [] };
  if (inv.app === null) return plan;

  const paths: Partial<ProjectPaths> = {
    ...inv.layout.paths,
    ...(opts.docs !== undefined ? { docs: normalizeDir(opts.docs) } : {}),
    ...(opts.designSystem !== undefined ? { designSystem: normalizeDir(opts.designSystem) } : {}),
  };
  const docs = paths.docs ?? DEFAULT_PATHS.docs;
  const ds = paths.designSystem ?? DEFAULT_PATHS.designSystem;
  const theirs = DOC_RECORDS.map((f) => posix.join(docs, f)).filter((f) => isFile(join(root, f)));
  if (theirs.length > 0) {
    decisions.push(`${theirs.join(', ')} ${theirs.length === 1 ? 'is' : 'are'} yours, and fwos keeps its records in ${docs}/: pass --docs <folder> to keep them apart (for example --docs docs/fwos).`);
  }
  const state: FwosState = {
    schema: STATE_SCHEMA_VERSION,
    pluginVersion: pluginVersion(),
    ...(opts.name ? { name: opts.name } : {}),
    mode: 'adopt',
    platforms: ['web'],
    createdAt: today(),
    adopt: { level, history: [{ level, at: today() }], ...(Object.keys(base.keep).length > 0 ? { keep: base.keep } : {}) },
    ...(Object.keys(paths).length > 0 ? { paths } : {}),
  };

  // The checks as they would run once adopted: fwos's own records aside, which don't exist yet.
  const preview = loadProject(root, { state });
  const results = (await runChecks(preview, { baseline: false })).filter((r) => !r.id.startsWith('state/'));
  const exempt = unbaselined(checksFor(preview));
  const findings = results.filter((r) => !exempt.has(r.id)).reduce((n, r) => n + r.findings.length, 0);
  if (results.some((r) => r.id === 'design-system/schema' && r.status === 'fail')) {
    decisions.push(`${ds}/design-system.json is yours and not in fwos's format, which would stop every check: pass --design-system <folder> for fwos's copy (for example --design-system design/fwos).`);
  }

  const { exec, run } = runner(inv);
  const importing = atLeast(level, 'design') && !!inv.theme && !isFile(join(root, ds, 'design-system.json'));
  const app = inv.apps.find((a) => a.dir === inv.app)!;
  const ui = inv.layout.found.find((f) => f.what === 'UI components');
  const reuse: Proposal['reuse'] = [{ what: `your Next.js app at ${inv.app}`, from: app.from }];
  if (ui) reuse.push({ what: `your UI components in ${ui.value}`, from: ui.from === 'the folder exists' ? `${ui.value}/` : ui.from });
  if (importing) reuse.push({ what: 'your theme, as the source of the design tokens', from: inv.theme! });
  for (const f of inv.findings) {
    const [name, ...command] = f.what.split(': ');
    if (f.area === 'scripts' && /^(?:test|e2e|typecheck)(?::|$)/.test(name!)) {
      reuse.push({ what: `your ${name === 'typecheck' ? 'typecheck' : 'test'} command \`${run(name!)}\` (${command.join(': ')})`, from: f.from });
    }
    if (f.area === 'ci') reuse.push({ what: 'your CI, unchanged', from: f.from });
    if (f.area === 'hooks') reuse.push({ what: 'your git hooks, unchanged', from: f.from });
    if (f.area === 'guidance') reuse.push({ what: `your ${f.what}, unchanged`, from: f.from });
    if (f.area === 'docs' && f.what === 'product or design doc' && atLeast(level, 'delivery')) reuse.push({ what: 'your product and design docs, linked from a change and never copied', from: f.from });
  }
  const review = [inv.workflow?.template, inv.workflow?.codeowners].filter((f): f is string => !!f);
  if (review.length > 0 && atLeast(level, 'delivery')) {
    reuse.push({ what: "your review, for each change's approvals: a reviewer's yes in a pull request is recorded with its link (--via pr --ref <review URL>)", from: review.join(', ') });
  }

  const add: Proposal['add'] = [
    { path: '.fwos/state.json', what: "your app's paths and the level" },
    { path: '.fwos/manifest.json', what: 'files fwos generates (none yet)' },
    { path: '.fwos/provenance.json', what: 'files fwos wrote that became yours' },
    { path: '.fwos/changes/0001-initial.json', what: 'the adoption record: the app as it is, not work to finish' },
    { path: '.fwos/baseline.json', what: `${count(findings, 'finding')} from today, recorded as debt` },
    ...(importing ? [{ path: `${ds}/`, what: `your theme from ${inv.theme}, as DTCG tokens that are yours to edit, and a copy of the theme they came from` }] : []),
  ];
  const ignored = /^\/?\.fwos\/local\/?\s*$/m.test(readText(join(root, '.gitignore')) ?? '');
  const change = ignored ? [] : [{ path: '.gitignore', what: 'adds .fwos/local/, where fwos keeps local evidence' }];
  const fileOf = (f: RepoFinding) => f.from.split(' ')[0]!;
  const untouched = [
    ...new Set([
      ...['package.json', posix.join(inv.app, 'package.json')].filter((f) => isFile(join(root, f))),
      ...(['package-manager', 'ci', 'hooks', 'lint', 'guidance'] as const).flatMap((area) => inv.findings.filter((f) => f.area === area).map(fileOf)),
    ]),
    'app code, tests and configs',
  ];
  const ciFlow = inv.findings.find((f) => f.area === 'ci' && f.what.includes('runs the tests')) ?? inv.findings.find((f) => f.area === 'ci');
  const hooks = {
    agent: agentHooks(level, preview.paths.gated),
    commit: commitAdvice(root, exec, true),
    ci: ciFlow ? `unchanged; to gate pull requests, add \`- run: ${exec} fwos check\` after the tests in ${ciFlow.from}` : `none found; to gate pull requests, run \`${exec} fwos check\` after the tests in your pipeline`,
  };
  plan.proposal = {
    reuse,
    add,
    change,
    untouched,
    state,
    hooks,
    checks: { on: results.filter((r) => r.status !== 'off').map((r) => r.id), off: results.filter((r) => r.status === 'off').map((r) => ({ id: r.id, reason: r.reason ?? '' })), findings },
  };
  plan.capabilities = capabilities(preview, { inv, applying: { findings } });
  plan.stages = stageRows(preview, inv, base.keep);
  return plan;
}

function planLevelChange(p: Project, inv: Inventory, level: AdoptLevel, base: PlanBase): AdoptionPlan {
  const from = p.level ?? 'checks';
  const ds = p.paths.designSystem;
  const decisions: string[] = [];
  const open = listChanges(p.root).find((c) => c.status === 'open' && !isAdoptionRecord(p, c));
  if (from === 'delivery' && level !== 'delivery' && open) {
    decisions.push(`Change ${open.id} is open, so the level stays delivery. Close it first (\`fwos change done\`), or keep delivery.`);
  }
  const keep = Object.keys(base.keep).length > 0 ? { keep: base.keep } : {};
  const target = loadProject(p.root, { state: { ...readJson<FwosState>(p.abs('.fwos/state.json')), adopt: { level, ...keep } } });
  const importing = atLeast(level, 'design') && !!inv.theme && !p.exists(`${ds}/design-system.json`);
  const steps = [
    ...(importing ? [`imports ${inv.theme} into ${ds}/, then takes in the findings of the checks it turns on`] : []),
    ...(atLeast(level, 'delivery') && from !== 'delivery' ? ['turns on change delivery: /fwos:change, the spec gate while a change is open, and test locks'] : []),
    ...(!atLeast(level, from) ? [`turns off what level ${from} added to fwos's flow; the files it wrote stay`] : []),
  ];
  const kept = readBaseline(p.root)
    ? `Keeps ${count(listChanges(p.root).length, 'change record')} and the baseline.`
    : `Keeps ${count(listChanges(p.root).length, 'change record')}, and records today's findings as the baseline.`;
  const stages = keepSentences(base);
  const levelChange = level === from ? [] : [`Level ${from} -> ${level}: ${steps.join('; ') || 'nothing else changes'}.`];
  return {
    ...base,
    adopted: true,
    current: from,
    change: levelChange.length + stages.length === 0 ? `Already at level ${level}.` : [...levelChange, ...stages, kept].join(' '),
    decisions,
    proposal: null,
    capabilities: capabilities(target, { inv, applying: { findings: 0 } }),
    stages: stageRows(target, inv, base.keep),
  };
}

// ---- applying it --------------------------------------------------------------------------------

/**
 * Imports the app's own shadcn theme as fwos's design system. Never the starter: no theme, no
 * import. The component registry lists the app's own components, with no required states until the
 * team names some, so fwos's starter components never become the app's requirements.
 */
function importTheme(p: Project, theme: string, name: string, out: (...lines: string[]) => void): void {
  const css = readText(p.abs(theme));
  if (css === null) return;
  const own = PROFILES.find((x) => x.platform === 'web')?.components?.listInstalled(p) ?? [];
  const source = p.exists(posix.join(p.paths.apps.web ?? '.', 'components.json')) ? 'shadcn' : 'local';
  const registry = { schema: 1, components: own.map((c) => ({ id: c.id, status: 'stable', source, requiredStates: [], description: `Yours: ${c.file}.` })) };
  const files = fromShadcn(css, name, theme).map((f) => (f.path === 'components.json' ? { ...f, content: `${JSON.stringify(registry, null, 2)}\n` } : f));
  for (const f of files) writeYours(p.root, posix.join(p.paths.designSystem, f.path), f.content, 'design-system');
  out(`Wrote ${p.paths.designSystem}/ from ${theme} (${count(files.length, 'file')}). They are yours.`);
  const tokens = mapDesignSystem(p, adaptersFor(p))!.tokens;
  out(`  Mapped from the copy of your theme in ${p.paths.designSystem}/source/: ${tokenSummary(tokens)}. \`fwos design-system report\` writes where each token came from, and \`fwos design-system gallery\` renders your components with your theme and with these tokens, side by side.`);
  out(`  components.json lists your ${count(own.length, 'component')}${p.paths.ui.web ? ` in ${p.paths.ui.web}` : ''}, with no required states until you name some.`);
  const assumed = (JSON.parse(files.find((f) => f.path === 'design-system.json')!.content) as { assumed?: string[] }).assumed ?? [];
  if (assumed.length > 0) out(yellow(`  ${count(assumed.length, '[ASSUMED] default')} to confirm, listed in ${p.paths.designSystem}/design-system.json.`));
}

/** Records or updates the baseline after the level's checks ran: new findings in a covered check are never taken in. */
async function recordBaseline(p: Project, out: (...lines: string[]) => void): Promise<void> {
  const results = await runChecks(p, { baseline: false });
  const gate = results.find((r) => r.status === 'fail' && allChecks().some((c) => c.gate && c.id === r.id));
  if (gate) {
    out(yellow(`Baseline not recorded: ${gate.id} fails, so every other check is off. Fix what \`fwos check\` reports, then run \`fwos baseline --init\`.`));
    return;
  }
  const init = !readBaseline(p.root);
  try {
    const r = writeBaseline(p.root, results, { init, exempt: unbaselined(allChecks()) });
    const taken = (r.added ?? []).filter((x) => x.count > 0);
    if (init) out(`Baseline: ${count(r.total, 'finding')} recorded as debt. \`fwos check\` fails only on new ones.`);
    else if (taken.length > 0) out(`Baseline: took in ${count(taken.reduce((n, x) => n + x.count, 0), 'finding')} of ${taken.map((x) => x.id).join(', ')}, which ${taken.length === 1 ? "wasn't" : "weren't"} on before.`);
    else out('Baseline: kept as it was; the checks this level turns on found nothing to take in.');
  } catch (e) {
    if (!(e instanceof FwosError)) throw e;
    out(yellow(`Baseline not updated: ${e.message} Fix them, then run \`fwos baseline\`.`));
  }
}

/** Does what `plan` proposes. Refuses while the app can't be adopted or a decision is open. */
export async function applyAdoption(plan: AdoptionPlan, opts: AdoptOptions, out: (...lines: string[]) => void): Promise<void> {
  if (!plan.adopted && plan.support === 'unsupported') throw new FwosError(`Not adopted: ${plan.limits.join(' ')}`);
  if (plan.decisions.length > 0) {
    throw new FwosError(`${plan.adopted ? 'Level not changed.' : 'Not adopted yet.'} ${plan.decisions.join(' ')}`, 'Run `fwos adopt` to see the whole proposal.');
  }
  const keepLines = () => {
    const { kept, used } = plan.keepChanges;
    if (kept.length > 0) {
      const flag = kept.length === 1 ? kept[0] : '<stage>';
      out(`Kept as your team's: ${stageNames(kept)} (${plan.keep[kept[0]!]!.reason}). fwos adds nothing there; link your own artifact to a change with \`fwos change link <url|path> --stage ${flag}\`.`);
    }
    if (used.length > 0) out(`Back to fwos: ${stageNames(used)}.`);
  };
  if (!plan.adopted) {
    const state = plan.proposal!.state;
    initProject(plan.root, { mode: 'adopt', platforms: ['web'], ...(opts.name ? { name: opts.name } : {}), ...(state.paths ? { paths: state.paths } : {}), level: plan.level, keep: plan.keep, title: 'Adopted app' });
    logEvent(plan.root, 'adopt', { level: plan.level, app: plan.app, ...(Object.keys(plan.keep).length > 0 ? { keep: Object.keys(plan.keep) } : {}) });
    out(`${green('Adopted')} the app at ${plan.app} at level ${plan.level}.`);
    keepLines();
    if (inCodex() && !cliOnlyDistribution()) {
      try {
        const { written, unchanged } = writeCodexAgents(plan.root);
        out(`Codex: ${written.length + unchanged.length} fwos agents in ${CODEX_AGENTS_DIR}/ (git-ignored, each machine writes its own).`);
      } catch (e) {
        if (!(e instanceof FwosError)) throw e;
        out(yellow(`Codex: ${e.message} ${e.hint ?? ''}`.trim()));
      }
    }
  } else {
    const keepChanged = plan.keepChanges.kept.length + plan.keepChanges.used.length > 0;
    if (keepChanged) {
      setKeptStages(plan.root, plan.keep);
      logEvent(plan.root, 'adopt-keep', { kept: plan.keepChanges.kept, used: plan.keepChanges.used });
    }
    if (plan.level === plan.current) {
      // Keeping a stage, or giving one back, turns no check on or off: the records stay as they are.
      if (keepChanged) keepLines();
      else out(plan.change!);
      return;
    }
    setAdoptLevel(plan.root, plan.level);
    logEvent(plan.root, 'adopt-level', { from: plan.current, to: plan.level });
    out(`${green('Level')} ${plan.current} -> ${plan.level}.`);
    keepLines();
  }
  const p = loadProject(plan.root);
  if (atLeast(plan.level, 'design') && plan.theme && !p.exists(`${p.paths.designSystem}/design-system.json`)) {
    importTheme(p, plan.theme, opts.name ?? readJson<FwosState>(p.abs('.fwos/state.json'))?.name ?? 'Your theme', out);
  }
  await recordBaseline(loadProject(plan.root), out);
}

/** The proposal as text: what was found, what fwos would do, and the command that does it. */
export function formatPlan(plan: AdoptionPlan, opts: AdoptOptions): string[] {
  const out: string[] = [];
  const stages = plan.stages.length > 0 ? ['', ...formatStages(plan.stages, plan.level, true)] : [];
  const caps = ['', `Capabilities at level ${plan.level}`, ...formatCapabilities(plan.capabilities), ...stages];
  const decide = plan.decisions.length > 0 ? ['', 'Decide first', ...plan.decisions.map((d) => `  - ${d}`)] : [];
  const keepFlags = [
    opts.keep?.length ? ` --keep ${opts.keep.join(',')} --reason "${opts.reason ?? ''}"` : '',
    opts.use?.length ? ` --use ${opts.use.join(',')}` : '',
  ].join('');
  const flags = [opts.app !== undefined ? ` --app ${opts.app}` : '', plan.level !== 'checks' ? ` --level ${plan.level}` : '', opts.docs !== undefined ? ` --docs ${opts.docs}` : '', opts.designSystem !== undefined ? ` --design-system ${opts.designSystem}` : '', keepFlags].join('');
  if (plan.adopted) {
    out.push(`Adopted app at ${plan.app} (level ${plan.current}).`, plan.change!, ...decide, ...caps);
    const changes = plan.level !== plan.current || plan.keepChanges.kept.length + plan.keepChanges.used.length > 0;
    if (changes && plan.decisions.length === 0) out.push('', `Run \`fwos adopt${flags} --yes\` to do it.`);
    return out;
  }
  out.push(`Adoption proposal for ${plan.root}. ${plan.support === 'unsupported' ? 'Nothing was written.' : 'Nothing is written until you run it with --yes.'}`, '');
  const app = plan.apps.find((a) => a.dir === plan.app);
  if (plan.support === 'unsupported') out.push(`Unsupported: ${plan.limits.join(' ')}`);
  else if (!app) out.push(`Supported: ${count(plan.apps.filter((a) => a.supported).length, 'Next.js app')} found; pick one below.`);
  else if (plan.support === 'partial') out.push(`Partly supported: the Next.js app at ${app.dir} (${app.from}). What fwos can't do here:`, ...plan.limits.map((l) => `  - ${l}`));
  else out.push(`Supported: the Next.js app at ${app.dir} (${app.from}).`);
  const w = 16;
  if (plan.findings.length > 0) out.push('', 'Found', ...plan.findings.map((f) => `  ${f.area.padEnd(w)} ${f.what}  (${f.from})`));
  if (plan.unknowns.length > 0) out.push('', 'Not found', ...plan.unknowns.map((u) => `  ${u.area.padEnd(w)} ${u.what}`));
  out.push(...decide);
  const pr = plan.proposal;
  if (pr) {
    const rows = (label: string, items: string[]) => items.map((item, i) => `  ${(i === 0 ? label : '').padEnd(8)} ${item}`);
    const designNote = pr.add.some((a) => a.path.endsWith('/') && !a.path.startsWith('.fwos')) ? '; the design checks turn on once your theme is imported, and their findings are recorded then' : '';
    out.push(
      '',
      `At level ${plan.level}, fwos would`,
      ...rows('reuse', pr.reuse.map((r) => `${r.what}  (${r.from})`)),
      ...rows('add', pr.add.map((a) => `${a.path}  ${a.what}`)),
      ...rows('change', pr.change.length > 0 ? pr.change.map((c) => `${c.path}  ${c.what}`) : ['nothing of yours']),
      ...rows('leave', [pr.untouched.join(', ')]),
      ...rows('checks', [`${pr.checks.on.length} would run today (${pr.checks.on.join(', ')}); ${pr.checks.off.length} stay off until their inputs exist${designNote}`]),
      ...rows('hooks', [pr.hooks.agent]),
      ...rows('commit', [pr.hooks.commit]),
      ...rows('CI', [pr.hooks.ci]),
      '',
      '.fwos/state.json would be:',
      ...JSON.stringify(pr.state, null, 2).split('\n').map((l) => `  ${l}`),
    );
  }
  if (plan.capabilities.length > 0) out.push(...caps);
  if (plan.support === 'unsupported') return out;
  const others = ADOPT_LEVELS.filter((l) => l !== plan.level).map((l) => `--level ${l}`);
  out.push(
    '',
    plan.decisions.length > 0
      ? 'Decide the points above, then run `fwos adopt` again with your answers.'
      : `Run \`fwos adopt${flags} --yes\` to adopt at level ${plan.level}, or choose another level with ${orList(others)}. Each level includes the ones before it.`,
  );
  return out;
}
