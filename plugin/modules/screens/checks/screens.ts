// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// screens/ia: ia.json is valid and matches the real app, through the platform's screen adapter:
// routes in both directions, the page IDs routes declare, redirects, a nav link to every nav page,
// and a guard on every page ia.json limits. Who sees what is compared in a run of the app: fwos's IA
// harness opens every static route as every role and flag setting and reads the nav, and its runs
// count while they ran on the code as it is. Without one, a limited page is off, named, unless its
// route can't turn anyone away, which fails. screens/states: every state a page promises has a
// passing tagged test, and renders under fwos's state harness as its contract says (kernel/proofs).

import { posix } from 'node:path';
import {
  type Check,
  type CheckContext,
  type Finding,
  type Platform,
  type Project,
  checkStates,
  harnessStatus,
  loadResults,
  currentTestResults,
  off,
  readRuns,
  result,
  revisionOf,
  runFreshness,
  runPath,
} from '../../../kernel/index.ts';
import { strictCoverage } from '../../state/index.ts';
import { type IaRunPlan, iaRunPlan, isIaRun, judgeIaRun, runName } from '../harness.ts';
import { type Ia, type IaPage, normRoute, parseIa, reaches } from '../ia.ts';

export const iaPath = (project: Project) => posix.join(project.paths.docs, 'ia.json');

/** `1 app route`, `2 app routes`. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

export function loadIa(project: Project): { path: string; ia: Ia | null; errors: string[] } | null {
  const path = iaPath(project);
  const text = project.read(path);
  if (text === null) return null;
  return { path, ...parseIa(text) };
}

/** What screens/ia couldn't compare on one platform, and why. */
interface Unchecked {
  platform: string;
  why: string;
  what: string;
  pages: string[];
}

/** `members (admin, flag members-enabled)`: who ia.json lets see a page it limits. */
const gate = (ia: Ia, p: IaPage) => {
  const roles = p.visibleTo && !ia.roles.every((r) => p.visibleTo!.includes(r)) ? p.visibleTo.join(' or ') || 'no role' : '';
  return `${p.id} (${[roles, p.flag ? `flag ${p.flag}` : ''].filter(Boolean).join(', ')})`;
};

/** `admin with members-enabled on`: who ia.json lets see a page. */
const audience = (ia: Ia, p: IaPage) => {
  const roles = p.visibleTo ?? ia.roles;
  const who = ia.roles.every((r) => roles.includes(r)) ? 'every role' : roles.join(' or ') || 'no role';
  return `${who}${p.flag ? ` with ${p.flag} on` : ''}`;
};

const isGated = (ia: Ia, p: IaPage) => !!p.flag || (!!p.visibleTo && !ia.roles.every((r) => p.visibleTo!.includes(r)));

/** What the last runs of fwos's IA harness on one platform show, if they still count. */
interface Runtime {
  /** The app holds the harness (fwos's, or an edited one). */
  installed: boolean;
  /** Every role and flag setting ran on the code as it is now. */
  covered: boolean;
  /** Why not, when not. */
  why?: string;
  findings: Finding[];
  inputs: string[];
  /** When covered: what ran. */
  summary?: string;
  plan?: IaRunPlan;
}

function runtimeOf(ctx: CheckContext, platform: Platform, ia: Ia, iaFile: string): Runtime {
  const { project } = ctx;
  const harness = ctx.adapters.get(platform)?.verify?.harness?.(project).find((h) => h.kind === 'ia');
  if (!harness) return { installed: false, covered: false, why: `the ${platform} platform has no harness that opens the app as each role`, findings: [], inputs: [] };
  const status = harnessStatus(project, harness);
  if (status === 'absent') {
    return { installed: false, covered: false, why: `fwos's IA harness isn't in the app (${harness.file}; \`fwos harness\` writes it)`, findings: [], inputs: [] };
  }
  // The app holds a harness, but not this fwos version's: no run of it counts, old or new.
  if (status === 'edited') {
    const why = `the harness in the app (${harness.file}) isn't this fwos version's: run \`fwos harness\` to restore it, then the end-to-end tests`;
    return { installed: true, covered: false, why, findings: [], inputs: [harness.file] };
  }
  const plan = iaRunPlan(ia);
  const read = readRuns(project, 'ia');
  const findings: Finding[] = read.errors.map((e) => ({ file: e.file, rule: 'run-record', message: e.message }));
  const byKey = new Map(read.records.map((r) => [r.target, r]));
  let why: string | undefined;
  let fresh = 0;
  for (const target of plan.runs) {
    const r = byKey.get(target.key);
    if (!r) {
      why ??= `no run of fwos's IA harness has recorded ${runName(ia, target)} yet (run the end-to-end tests)`;
      continue;
    }
    const f = runFreshness(project, r, harness);
    if (!f.fresh) {
      why ??= `the last run of fwos's IA harness doesn't count (${f.why}; run the end-to-end tests)`;
      continue;
    }
    if (!isIaRun(r.observations)) {
      findings.push({ file: runPath('ia', target.key), rule: 'run-record', message: 'its observations are not an IA run' });
      why ??= `a run record of fwos's IA harness isn't one it wrote (${runPath('ia', target.key)})`;
      continue;
    }
    fresh++;
    for (const p of judgeIaRun(ia, r.observations)) findings.push({ file: iaFile, rule: p.rule, message: `${platform}: ${p.message}` });
  }
  const covered = plan.runs.length > 0 && fresh === plan.runs.length;
  const summary = covered
    ? `${count(plan.runs.length, 'role and flag setting')} opened ${count(plan.visits.length, 'route')} and read the nav (fwos's IA harness at revision ${revisionOf(project)})`
    : undefined;
  return { installed: true, covered, ...(why ? { why } : {}), findings, inputs: [harness.file, '.fwos/local/runs/ia/*.json'], ...(summary ? { summary } : {}), plan };
}

export const iaCheck: Check = {
  id: 'screens/ia',
  title: 'IA matches the app: routes, page IDs, redirects, nav, roles and flags',
  catches:
    "a page in ia.json the app lacks, a route the app exposes that ia.json lacks, a route that declares another page ID, a redirect that goes nowhere or elsewhere, a page ia.json limits that nothing in its route guards, an unreachable page, an unknown role; and, in a run of the app as each role and flag setting, a page that role can't open, a page shown to a role ia.json hides it from, a nav page missing from the nav",
  platforms: ['web', 'electron', 'mac'],
  run(ctx) {
    const id = 'screens/ia';
    const { project } = ctx;
    const loaded = loadIa(project);
    if (!loaded) {
      const writer = project.mode === 'adopt' ? "write it, listing your app's pages, to compare them with the routes" : 'the screens step writes it';
      return off(id, `no ${iaPath(project)} yet; ${writer}`);
    }
    const findings: Finding[] = loaded.errors.map((message) => ({ file: loaded.path, rule: 'ia', message }));
    const inputs = [loaded.path];
    const info: string[] = [];
    // Each platform's statement of what it compared, and what it couldn't.
    const matched = new Map<string, string>();
    const unchecked: Unchecked[] = [];
    const strict = project.initialized && strictCoverage(project.root);
    let compared = 0;
    if (loaded.ia) {
      const ia = loaded.ia;
      const byId = new Map(ia.pages.map((p) => [p.id, p]));
      const routed = ia.pages.filter((p) => (p.surface ?? 'route') === 'route' && !!p.route);
      for (const platform of project.platforms) {
        const adapter = ctx.adapters.get(platform)?.screens;
        if (!adapter) {
          info.push(`${platform}: no screen adapter, so ia.json isn't compared with the app`);
          continue;
        }
        const found = adapter.listScreens(project);
        if (!found) {
          info.push(`${platform}: no app found yet, so ia.json isn't compared with it`);
          continue;
        }
        compared++;
        inputs.push(...found.inputs);
        const appScreens = found.screens.filter((s) => !s.devOnly);
        const byRoute = new Map(appScreens.map((s) => [normRoute(s.route), s]));
        const iaRoutes = new Set(routed.map((p) => normRoute(p.route!)));
        for (const p of routed) {
          if (p.kind !== 'redirect' && !byRoute.has(normRoute(p.route!))) {
            findings.push({ file: loaded.path, rule: 'missing', message: `${platform}: page "${p.id}" (${p.route}) isn't in the app` });
          }
        }
        for (const [r, s] of byRoute) {
          if (!iaRoutes.has(r)) {
            findings.push({ file: s.file, rule: 'unexpected', message: `${platform}: the app exposes ${r}, which ia.json doesn't list; add it (or mark it unlinked) or remove it` });
          }
        }
        // The page ID a route declares is the one ia.json has there.
        for (const s of appScreens) {
          const p = s.id ? routed.find((x) => x.kind !== 'redirect' && normRoute(x.route!) === normRoute(s.route)) : undefined;
          if (p && p.id !== s.id) findings.push({ file: s.file, rule: 'page-id', message: `${platform}: ${s.file} declares page "${s.id}", but ia.json has "${p.id}" at ${p.route}` });
        }
        // What the last runs of the app showed, when they still count.
        const runtime = runtimeOf(ctx, platform, ia, loaded.path);
        inputs.push(...runtime.inputs);
        findings.push(...runtime.findings);
        if (strict && runtime.installed && !runtime.covered) {
          findings.push({ file: loaded.path, rule: 'no-run', message: `${platform}: no fresh run of fwos's IA harness shows the app to each role and flag setting: ${runtime.why}` });
        }
        // A redirect page redirects where ia.json says, as far as the code shows. A run, which opened each one, shows it instead.
        if (found.redirects && !runtime.covered) {
          const gatekept = (found.gatekeepers ?? []).length > 0;
          for (const p of routed.filter((x) => x.kind === 'redirect')) {
            const target = p.redirectTo ? byId.get(p.redirectTo) : undefined;
            if (!target?.route) continue;
            const from = normRoute(p.route!);
            const goes = (to: string) => reaches(normRoute(to), normRoute(target.route!));
            const wanted = `ia.json sends "${p.id}" to "${target.id}" (${target.route})`;
            const config = found.redirects.find((r) => reaches(normRoute(r.from), from) || normRoute(r.from) === from);
            const screen = byRoute.get(from);
            if (config) {
              if (!goes(config.to)) findings.push({ file: config.file, rule: 'redirect', message: `${platform}: ${config.file} redirects ${p.route} to ${config.to}, but ${wanted}` });
            } else if (screen) {
              if (screen.redirectTo && screen.redirectTo !== '?' && !goes(screen.redirectTo)) {
                findings.push({ file: screen.file, rule: 'redirect', message: `${platform}: ${screen.file} redirects ${p.route} to ${screen.redirectTo}, but ${wanted}` });
              } else if (!screen.redirectTo && screen.access === 'none') {
                findings.push({ file: screen.file, rule: 'redirect', message: `${platform}: ${screen.file} renders a page at ${p.route}, but ${wanted}` });
              }
            } else if (!gatekept) {
              findings.push({ file: loaded.path, rule: 'redirect', message: `${platform}: nothing in the app redirects ${p.route} (no route there, no redirect in its config), but ${wanted}` });
            }
          }
        }
        // Pages the app has: a missing one is a finding already.
        const inApp = routed.filter((p) => p.kind !== 'redirect' && byRoute.has(normRoute(p.route!)));
        // Every nav page needs a link in the app's code, except the one at /, where the app opens. A run reads the rendered nav instead.
        const needLink = runtime.covered ? [] : inApp.filter((p) => p.kind === 'nav' && normRoute(p.route!) !== '/');
        const iaNav = found.iaNav ?? [];
        let linked = 0;
        if (needLink.length > 0 && !found.links) {
          unchecked.push({ platform, why: `the ${platform} screen adapter doesn't read links`, what: "these nav pages aren't checked for a link", pages: needLink.map((p) => p.id) });
        } else {
          for (const p of needLink) {
            if (iaNav.length > 0 || found.links!.some((l) => reaches(normRoute(l.to), normRoute(p.route!)))) linked++;
            else {
              findings.push({
                file: loaded.path,
                rule: 'no-link',
                message: `${platform}: nav page "${p.id}" (${p.route}) has no link to it in the app; link it from the nav, or make it a drilldown or unlinked page in ia.json`,
              });
            }
          }
        }
        // Who sees a limited page: a run of the app shows it; without one, a route that can't turn anyone away is proof enough of the miss.
        const gated = inApp.filter((p) => isGated(ia, p));
        // A run opens static routes only: at a dynamic one, the code is all there is to go on.
        const unrun = (p: IaPage) => !runtime.covered || p.route!.includes('[');
        const open = gated.filter((p) => unrun(p) && byRoute.get(normRoute(p.route!))?.access === 'none');
        for (const p of open) {
          const s = byRoute.get(normRoute(p.route!))!;
          findings.push({
            file: s.file,
            rule: 'ungated',
            message: `${platform}: "${p.id}" (${p.route}) is for ${audience(ia, p)}, but nothing in its route can turn anyone away, so it renders for every role and flag setting; call guardPage('${p.id}') in it`,
          });
        }
        const unseen = gated.filter((p) => !open.includes(p) && unrun(p));
        if (unseen.length > 0) {
          const why = runtime.covered ? 'the harness opens static routes only' : runtime.why!;
          unchecked.push({ platform, why, what: "who sees these isn't compared with the app", pages: unseen.map((p) => gate(ia, p)) });
        }
        const checkedLinks = found.links && needLink.length > 0;
        const via = checkedLinks && iaNav.length > 0 ? ` (${iaNav.join(', ')} ${iaNav.length === 1 ? 'renders' : 'render'} the nav from ia.json)` : '';
        info.push(`${platform}: ${count(byRoute.size, 'app route')}, ${count(ia.pages.length, 'ia page')}${checkedLinks ? `, ${count(linked, 'nav page')} linked` : ''}${via}`);
        if (runtime.summary) info.push(`${platform}: ${runtime.summary}`);
        const isAre = linked === 1 ? 'is' : 'are';
        matched.set(platform, `${count(byRoute.size, 'app route')} match ${count(ia.pages.length, 'ia page')}${checkedLinks ? ` and ${count(linked, 'nav page')} ${isAre} linked` : ''}`);
      }
      // A valid ia.json compared with nothing proves nothing: off, with the reason, not a pass.
      if (compared === 0 && findings.length === 0) {
        return off(id, info.length > 0 ? info.join('; ') : "no platform chosen, so ia.json isn't compared with an app", inputs);
      }
      // Nor does it prove what it couldn't compare: with nothing failing, that is off too, naming it.
      if (findings.length === 0 && unchecked.length > 0) {
        const parts = [...matched].flatMap(([pl, summary]) => {
          const why = unchecked.filter((u) => u.platform === pl).map((u) => `${u.why}, so ${u.what}: ${u.pages.join(', ')}`);
          return why.length > 0 ? [`${pl}: ${summary}, but ${why.join('; and ')}`] : [];
        });
        return off(id, parts.join('; '), inputs);
      }
      for (const u of unchecked) info.push(`${u.platform}: ${u.what} (${u.why}): ${u.pages.join(', ')}`);
    }
    return result(id, findings, inputs, undefined, info);
  },
};

export const statesCheck: Check = {
  id: 'screens/states',
  title: 'Every page state renders as its contract says, with a passing tagged test',
  catches:
    "a page state from ia.json (empty, error, offline...) with no passing test tagged @state:<page-id>:<state>, or whose fixture fwos's harness saw render wrong: a loading state not busy, an error with no alert or with the ready state's stale content, an empty state with no status, a fixture that ignores its state, a row that paints on hover while a click only reaches its title",
  platforms: ['web', 'electron', 'mac'],
  run(ctx) {
    const id = 'screens/states';
    const { project } = ctx;
    const loaded = loadIa(project);
    if (!loaded?.ia) return off(id, loaded ? 'ia.json has errors (see screens/ia)' : `no ${iaPath(project)} yet`);
    const results = loadResults(project, project.initialized && strictCoverage(project.root) ? currentTestResults(project) : undefined);
    if (results.cases.length === 0 && !(project.initialized && strictCoverage(project.root))) {
      return off(id, `no test results in ${project.paths.results.join(', ')}; run the tests first`, [loaded.path]);
    }
    return checkStates(ctx, {
      id,
      subjects: loaded.ia.pages.filter((p) => p.kind !== 'redirect').map((p) => ({ kind: 'page', id: p.id, states: p.states })),
      results,
      name: (page, state) => `${page} "${state}"`,
      noun: 'page state',
      pendingTags: true,
      strict: strictCoverage(project.root),
      fixtureHint: 'register the screen in src/screens/registry.tsx',
      inputs: [loaded.path, ...results.files],
    });
  },
};
