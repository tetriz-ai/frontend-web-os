// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// tests/plan: the test plan covers every AC, with valid cases and the default rows.
// tests/traceability: every first-release AC has a passing test that ran.
// tests/locked: no locked test changed without a recorded, reviewer-approved unlock.
// tests/regression: in an adopted app, the existing tests a change names as its regression scope
// ran and passed.

import { type AdapterSet, type Check, type Finding, type Project, isTestFile, loadResults, off, readJson, result, validateWith } from '../../../kernel/index.ts';
import { acDelta, parseAcs, specPath } from '../../spec/index.ts';
import { currentChange, isAdoptionRecord, keptStages, strictCoverage } from '../../state/index.ts';
import { lockedFiles, locksLostSinceCommit } from '../locked.ts';
import { BROWSER_LEVELS, DEFAULT_ROWS, LEVELS, type TestCaseSpec, parseRegressionScope, parseTestPlan, runnersOf, testPlanPath } from '../plan.ts';
import { expired, readQuarantine } from '../quarantine.ts';
import { regressionResults, tally } from '../regression.ts';
import { browserResults, readTestRuns } from '../runs.ts';
import quarantineSchema from '../schema/quarantine.schema.json' with { type: 'json' };
import { traceAcs } from '../trace.ts';

const ALL = ['web', 'electron', 'mac'] as const;
/** `1 case`, `2 cases`. */
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
/** `a`, `one of a or b`, `one of a, b or c`. */
const oneOf = (items: string[]) => (items.length < 2 ? items.join('') : `one of ${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);

/** `a`, `a and b`, `a, b and c`. */
const andList = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** What a team that keeps its own test planning sees in place of fwos's plan checks. */
function keptPlan(project: Project, what: string): string | null {
  if (project.mode !== 'adopt' || !project.kept.includes('test-plan')) return null;
  const why = keptStages(project.root)['test-plan']?.reason;
  return `kept: your team's own practice${why ? ` (${why})` : ''}; ${what}`;
}

/**
 * The open change of an adopted app, on a route with a spec delta. Its own criteria (added or
 * changed) are seen working in a real browser: at least one has a case at a browser level, or a
 * GAP-browser says what's missing for a person to sign off. A criterion it changes gets a case that
 * fails first, since its existing tests prove what it said before. Its regression scope names the
 * existing tests around it, by path, and every test `fwos change map` found among them. And while
 * the plan is written, it says which of its cases none of the app's test scripts can run yet.
 */
function adoptedPlan(project: Project, adapters: AdapterSet, path: string, text: string, cases: TestCaseSpec[]): { findings: Finding[]; info: string[] } {
  const none = { findings: [], info: [] };
  if (project.mode !== 'adopt' || !project.initialized) return none;
  const change = currentChange(project.root);
  if (!change || isAdoptionRecord(project, change) || change.route === 'code-only') return none;
  const findings: Finding[] = [];
  const info: string[] = [];
  const spec = project.read(specPath(project));
  const delta = spec === null ? null : acDelta(change, spec);
  const own = delta ? [...delta.added, ...delta.changed] : [];
  for (const ac of delta?.changed ?? []) {
    const covering = cases.filter((c) => c.acs.includes(ac));
    if (covering.length > 0 && covering.every((c) => c.status === 'existing')) {
      findings.push({
        file: path,
        line: covering[0]!.line,
        rule: 'changed-ac',
        message: `${ac} changes in this change, but its only cases are existing ones (${covering.map((c) => c.id).join(', ')}): they prove what it said before, so give it a new case that fails first`,
      });
    }
  }
  // While the plan is written: once the build starts, tests/traceability says what ran and what didn't.
  const runners = change.step === 'spec' ? runnersOf(project, adapters) : null;
  if (runners) {
    const mine = cases.filter((c) => c.acs.some((a) => own.includes(a)) && c.level && c.level !== 'manual');
    const browser = mine.filter((c) => BROWSER_LEVELS.includes(c.level!) && !runners.browser);
    const other = mine.filter((c) => !BROWSER_LEVELS.includes(c.level!) && !runners.any);
    const named = (cs: TestCaseSpec[]) => andList(cs.map((c) => `${c.id} (${c.level})`));
    if (browser.length > 0) info.push(`no test script in package.json can run ${named(browser)} yet: add a browser runner, or name GAP-browser with what is missing`);
    if (other.length > 0) info.push(`no test script in package.json can run ${named(other)} yet: add a runner fwos reads results from (Vitest, Jest, Playwright, Cypress or Mocha)`);
  }
  const inBrowser = cases.some((c) => BROWSER_LEVELS.includes(c.level ?? '') && c.acs.some((a) => own.includes(a)));
  if (own.length > 0 && !inBrowser && !parseTestPlan(text).gaps.some((g) => g.id === 'GAP-browser')) {
    findings.push({
      file: path,
      rule: 'browser',
      message: `no case runs in a browser: give ${oneOf(own)} a case at level ${BROWSER_LEVELS.join(' or ')}, so the change is seen working in a real browser, or name GAP-browser with what's missing (- Missing: ...) for a person to sign off`,
    });
  }
  const scope = parseRegressionScope(text);
  const found = change.map?.tests ?? [];
  if (!scope.present) {
    const map = found.length > 0 ? ` (the map found ${found.map((t) => t.file).join(', ')})` : '';
    findings.push({ file: path, rule: 'regression', message: `no "## Regression scope": name the existing tests around the change by path${map}, or write "None" and why` });
    return { findings, info };
  }
  for (const e of scope.entries) {
    if (!project.exists(e.path) || !isTestFile(project, e.path)) findings.push({ file: path, line: e.line, rule: 'regression', message: `the regression scope names ${e.path}, which is not a test file in the project` });
  }
  for (const t of found) {
    if (!scope.entries.some((e) => e.path === t.file)) findings.push({ file: path, rule: 'regression', message: `the change's map found ${t.file} (${t.via}): name it in ## Regression scope, so it runs as regression evidence` });
  }
  return { findings, info };
}

export const planCheck: Check = {
  id: 'tests/plan',
  title: 'Test plan covers the spec',
  catches: "an AC with no test case, a case for an AC that does not exist, a bad level or status, a missing default row; in an adopted app's change, a changed criterion with only existing cases, no case in a browser, a regression scope missing a test around it",
  platforms: ALL,
  run({ project, adapters }) {
    const id = 'tests/plan';
    const kept = keptPlan(project, '`fwos tests run` still runs your tests');
    if (kept) return off(id, kept);
    const path = testPlanPath(project);
    const text = project.read(path);
    if (text === null) {
      // An adopted app is checked as it is: nothing runs it through the steps that write the plan.
      const writer = project.mode === 'adopt' ? "a change delivered through fwos writes its test delta there" : 'the test-planner writes it in the spec step';
      return off(id, `no ${path} yet; ${writer}`);
    }
    const spec = project.read(specPath(project));
    const findings: Finding[] = [];
    if (spec === null) findings.push({ file: path, rule: 'spec', message: `there's a test plan but no ${specPath(project)}` });
    const acs = spec ? parseAcs(spec) : [];
    const { cases } = parseTestPlan(text);
    const seen = new Set<string>();
    for (const c of cases) {
      if (seen.has(c.id)) findings.push({ file: path, line: c.line, rule: 'duplicate', message: `${c.id} is defined twice` });
      seen.add(c.id);
      const isDefault = c.id.startsWith('TC-default-');
      if (!isDefault && c.acs.length === 0) findings.push({ file: path, line: c.line, rule: 'case-ac', message: `${c.id} names no AC (- AC: AC-<feature>-<n>)` });
      for (const ac of c.acs) {
        if (spec && !acs.some((a) => a.id === ac)) findings.push({ file: path, line: c.line, rule: 'case-ac', message: `${c.id} covers ${ac}, which the spec doesn't define` });
      }
      if (!c.level || !(LEVELS as readonly string[]).includes(c.level)) {
        findings.push({ file: path, line: c.line, rule: 'level', message: `${c.id} needs "- Level: ${LEVELS.join(' | ')}"` });
      }
      if (!isDefault && c.status !== 'new' && c.status !== 'existing') {
        findings.push({ file: path, line: c.line, rule: 'status', message: `${c.id} needs "- Status: new | existing" (new tests must fail once before the code exists)` });
      }
    }
    for (const ac of acs.filter((a) => a.release === 'first')) {
      const covering = cases.filter((c) => c.acs.includes(ac.id));
      if (covering.length === 0) findings.push({ file: path, rule: 'coverage', message: `${ac.id} has no test case` });
      else if (!ac.manual && covering.every((c) => c.level === 'manual')) {
        findings.push({ file: path, rule: 'coverage', message: `${ac.id} is only covered by manual cases, but the spec doesn't mark it manual` });
      }
    }
    // The default rows check a whole app fwos built. An adopted app's own suite covers the rest of it.
    if (project.platforms.includes('web') && project.mode !== 'adopt') {
      for (const row of DEFAULT_ROWS) {
        if (!seen.has(`TC-default-${row}`)) findings.push({ file: path, rule: 'default-row', message: `missing default row TC-default-${row}` });
      }
    }
    const adopted = adoptedPlan(project, adapters, path, text, cases);
    findings.push(...adopted.findings);
    return result(id, findings, [path, specPath(project)], undefined, [`${count(cases.length, 'case')} for ${count(acs.length, 'AC')}`, ...adopted.info]);
  },
};

export const traceabilityCheck: Check = {
  id: 'tests/traceability',
  title: 'Every AC proven by a test that ran',
  catches: 'a first-release AC with no passing test, a failing or only-quarantined test, a test tagged with an unknown AC, an expired quarantine',
  platforms: ALL,
  run({ project }) {
    const id = 'tests/traceability';
    const findings: Finding[] = [];
    const quarantinePath = '.fwos/quarantine.json';
    try {
      const q = readJson(project.abs(quarantinePath));
      if (q !== null) for (const err of validateWith(quarantineSchema, q)) findings.push({ file: quarantinePath, rule: 'quarantine', message: err });
    } catch (e) {
      // The finding names the file, so the message drops the absolute path readJson puts first.
      return result(id, [{ file: quarantinePath, rule: 'quarantine', message: (e as Error).message.replace(project.abs(quarantinePath), '').trim() }], [quarantinePath]);
    }
    const trace = traceAcs(project);
    if (!trace) return off(id, `no ${specPath(project)} yet`);
    const strict = project.initialized && strictCoverage(project.root);
    if (strict) for (const run of readTestRuns(project).filter((run) => run.fresh && run.exit !== 0)) findings.push({ rule: 'test-command', message: `${run.display} exited ${run.exit}; the test command must pass before acceptance` });
    if (trace.cases.length === 0) {
      const owed = trace.acs.filter((t) => t.ac.release === 'first' && !t.ac.manual).map((t) => t.ac.id);
      // At acceptance, no results means nothing is proven: that fails, it isn't off.
      if (strict && owed.length > 0) {
        findings.push({ rule: 'no-results', message: `no test results in ${project.paths.results.join(', ')}, so no first-release AC is proven (${owed.join(', ')}); run the tests first` });
        return result(id, findings, [specPath(project)]);
      }
      // A malformed quarantine file is still a finding, even before any test has run.
      if (findings.length > 0) return result(id, findings, ['.fwos/quarantine.json']);
      return off(id, `no test results in ${project.paths.results.join(', ')}; run the tests first`, [specPath(project)]);
    }
    const counts: Record<string, number> = {};
    const pending: string[] = [];
    for (const t of trace.acs) {
      counts[t.verdict] = (counts[t.verdict] ?? 0) + 1;
      if (t.ac.release !== 'first' || t.verdict === 'proven' || t.verdict === 'manual') continue;
      if (t.verdict === 'not-run' && !strict) {
        pending.push(t.ac.id);
        continue;
      }
      const msg =
        t.verdict === 'failing'
          ? `${t.ac.id}: failing (${t.failure ?? 'no message'})`
          : t.verdict === 'quarantined-only'
            ? `${t.ac.id}: only quarantined tests ran, so it's not proven`
            : `${t.ac.id}: no test ran (tag a test @${t.ac.id})`;
      findings.push({ rule: t.ac.id, message: msg });
    }
    for (const u of trace.unknownTags) findings.push({ rule: 'unknown-ac', message: `"${u.test.name}" is tagged @${u.tag}, which the spec doesn't define` });
    // In an adopted app, a criterion the plan checks in a browser is proven by a test that ran in one.
    const notSeen: string[] = [];
    const plan = project.mode === 'adopt' ? project.read(testPlanPath(project)) : null;
    if (plan !== null) {
      const browserCases = parseTestPlan(plan).cases.filter((c) => BROWSER_LEVELS.includes(c.level ?? ''));
      const browser = browserResults(project);
      for (const t of trace.acs) {
        const tc = browserCases.find((c) => c.acs.includes(t.ac.id));
        if (!tc || t.verdict !== 'proven' || t.ac.release !== 'first' || t.tests.some((x) => x.status === 'passed' && browser.has(x.source))) continue;
        if (strict) findings.push({ rule: t.ac.id, message: `${t.ac.id}: ${tc.id} checks it in a browser (${tc.level}), but no passing test from a browser run proves it; run your browser tests with \`fwos tests run\`` });
        else notSeen.push(t.ac.id);
      }
    }
    for (const q of expired(readQuarantine(project.root))) {
      findings.push({ file: '.fwos/quarantine.json', rule: 'quarantine', message: typeof q.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q.until)
          ? `quarantine of "${q.match}" expired on ${q.until}; fix the test (no fixed sleeps) or remove it`
          : `quarantine of "${q.match}" has no readable expiry date (YYYY-MM-DD), so it counts as expired` });
    }
    const info = [Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')];
    if (pending.length > 0) info.push(`not built yet (pending until acceptance): ${pending.join(', ')}`);
    if (notSeen.length > 0) info.push(`not seen in a browser yet: ${notSeen.join(', ')}`);
    return result(id, findings, [specPath(project), ...trace.resultFiles], undefined, info);
  },
};

export const lockedCheck: Check = {
  id: 'tests/locked',
  title: 'Locked tests unchanged',
  catches: 'a locked test edited or deleted without a recorded unlock, by any tool, the shell included, or a lock the last commit holds dropped or re-hashed',
  platforms: ALL,
  run({ project }) {
    const id = 'tests/locked';
    if (!project.initialized) return off(id, 'not an fwos project');
    const files = lockedFiles(project);
    // A lock the last commit holds can't quietly leave the change files (null: no git to ask).
    const lost = locksLostSinceCommit(project) ?? [];
    if (files.length === 0 && lost.length === 0) {
      const how = project.mode === 'adopt' ? 'at level delivery, a change locks the tests it adds or changes, never the suite you have' : "the build step locks each slice's tests";
      return off(id, `no locked tests yet; ${how}`, ['.fwos/changes/*.json']);
    }
    const findings: Finding[] = lost.map((l) => ({
      file: l.path,
      rule: l.how,
      message:
        l.how === 'vanished'
          ? `the last commit locks it (in ${l.changeId}), but no change file does now and no unlock was recorded; restore the lock (\`git checkout -- .fwos/changes/\`)`
          : `locked again at another hash since the last commit (locked in ${l.changeId}), with no unlock recorded; restore the lock (\`git checkout -- .fwos/changes/\`), or unlock it with a reason and a reviewer first`,
    }));
    const info: string[] = [];
    for (const f of files) {
      if (lost.some((l) => l.path === f.path)) continue;
      if (f.status === 'changed') findings.push({ file: f.path, rule: 'changed', message: `locked test changed without a recorded unlock (locked in ${f.changeId}); revert it, or unlock it with a reason and a reviewer` });
      if (f.status === 'missing') findings.push({ file: f.path, rule: 'missing', message: `locked test deleted (locked in ${f.changeId})` });
      if (f.status === 'unlocked') info.push(`${f.path} unlocked by ${f.unlock!.reviewer}: ${f.unlock!.reason}`);
    }
    info.unshift(count(files.length, 'locked file'));
    const tests = [...new Set([...files.map((f) => f.path), ...lost.map((l) => l.path)])];
    return result(id, findings, ['.fwos/changes/*.json', ...tests], undefined, info);
  },
};

export const regressionCheck: Check = {
  id: 'tests/regression',
  title: 'The tests around a change still pass',
  catches: "an existing test an adopted app's change names as its regression scope that fails, or that never ran by acceptance",
  platforms: ALL,
  run({ project }) {
    const id = 'tests/regression';
    if (project.mode !== 'adopt' || !project.initialized) return off(id, "only an adopted app's changes name a regression scope");
    const kept = keptPlan(project, 'fwos names no regression scope of its own');
    if (kept) return off(id, kept);
    // The plan outlives its change: closing the change leaves this result, and the report, as they were.
    const path = testPlanPath(project);
    const text = project.read(path);
    if (text === null) return off(id, `no ${path} yet; a change delivered through fwos names the existing tests around it there`);
    const scope = parseRegressionScope(text);
    if (scope.entries.length === 0) return off(id, `${path} names no existing test as the change's regression scope`, [path]);
    const strict = strictCoverage(project.root);
    const { files } = loadResults(project);
    if (files.length === 0 && !strict) return off(id, `no test results in ${project.paths.results.join(', ')} yet; run your tests with \`fwos tests run\``, [path]);
    const findings: Finding[] = [];
    const pending: string[] = [];
    const results = regressionResults(project, scope.entries);
    for (const r of results) {
      for (const f of r.failures) findings.push({ file: r.path, rule: 'failed', message: `${f.name}: failed${f.failure ? ` (${f.failure})` : ''}` });
      if (r.ran) continue;
      if (strict) findings.push({ file: r.path, rule: 'not-run', message: 'no result names it, so it never ran: run your tests with `fwos tests run`' });
      else pending.push(r.path);
    }
    const ran = results.filter((r) => r.ran);
    const sum = ran.reduce((n, r) => ({ passed: n.passed + r.passed, failed: n.failed + r.failed, skipped: n.skipped + r.skipped }), { passed: 0, failed: 0, skipped: 0 });
    const info = [`${ran.length} of ${results.length} ran: ${tally(sum)}`, ...(pending.length > 0 ? [`not run yet: ${pending.join(', ')}`] : [])];
    return result(id, findings, [path, ...files], undefined, info);
  },
};

export const checks = [planCheck, traceabilityCheck, lockedCheck, regressionCheck];
