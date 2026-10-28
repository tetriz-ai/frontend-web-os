// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The state checks' shared verdict: a page or component state is proven when a passing test is
// tagged with it AND fwos's harness, run on the code as it is now, saw its fixture render as its
// contract says. A tag alone is trusted, not proof: with nothing failing and a render proof
// missing, the check is off and names what's unproven; from the accept step on, a missing or stale
// proof fails wherever the app has the harness.

import type { CheckContext, CheckResult, Finding } from './check.ts';
import { off, result } from './check.ts';
import { contractFor, hitContract, judgeStates, type StateObservation } from './rendered.ts';
import { type ResultSet, caseKey, flakyKeys, hasTag } from './results.ts';
import { type RunRecord, harnessStatus, readRuns, revisionOf, runFreshness } from './runs.ts';

/** Shown wherever a count rests on tags alone: the state checks read tags on test results. */
export const TAG_TRUST = 'fwos trusts the tag, not what the test renders';

export interface StateSubject {
  /** Its run record is `<kind>.<id>`. */
  kind: 'page' | 'component';
  id: string;
  states: string[];
}

export interface StateCheckOptions {
  id: string;
  subjects: StateSubject[];
  results: ResultSet;
  /** How a finding names a state: `list "empty"`, `button "loading" state`. */
  name(id: string, state: string): string;
  /** What it counts: `page state`, `required state`. */
  noun: string;
  /** Pages wait for acceptance before a state with no tagged test fails; components fail at once. */
  pendingTags: boolean;
  /** From the accept step on: nothing waits, and a missing render proof fails. */
  strict: boolean;
  /** Where a missing fixture goes, for the message. */
  fixtureHint: string;
  inputs: string[];
}

type Tag = { status: 'passed' } | { status: 'failed'; failure: string } | { status: 'pending' } | { status: 'missing'; message: string };
type Render = { status: 'ok' } | { status: 'violation'; problems: string[]; dead: string[] } | { status: 'none'; why: string };

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const has = (n: number) => (n === 1 ? 'has' : 'have');
const renders = (n: number) => (n === 1 ? 'renders' : 'render');

function tagOf(o: StateCheckOptions, flaky: Set<string>, id: string, state: string): Tag {
  const tag = `@state:${id}:${state}`;
  const tests = o.results.cases.filter((t) => hasTag(t, tag));
  if (tests.some((t) => t.status === 'passed' && !flaky.has(caseKey(t)))) return { status: 'passed' };
  const failed = tests.find((t) => t.status === 'failed');
  if (failed) return { status: 'failed', failure: failed.failure ?? 'no message' };
  if (tests.length === 0 && o.pendingTags && !o.strict) return { status: 'pending' };
  return { status: 'missing', message: tests.length > 0 ? 'only skipped or flaky tests' : `no passing test is tagged ${tag} (tag the test that renders it)` };
}

/** What a state does wrong, each part followed by the rule it breaks: its name's contract, and the one for what looks clickable. */
function violation(state: string, problems: string[], dead: string[]): string {
  const parts = [];
  if (problems.length > 0) parts.push(`${problems.join('; ')}. ${/^[aeiou]/i.test(state) ? 'An' : 'A'} "${state}" state ${contractFor(state)}`);
  if (dead.length > 0) parts.push(`${dead.join('; ')}. In any state, ${hitContract()}`);
  return parts.join('. ');
}

export function checkStates(ctx: CheckContext, o: StateCheckOptions): CheckResult {
  const { project } = ctx;
  const harness = project.platforms.flatMap((p) => ctx.adapters.get(p)?.verify?.harness?.(project) ?? []).find((h) => h.kind === 'states');
  const status = harness ? harnessStatus(project, harness) : null;
  const findings: Finding[] = [];
  const inputs = [...o.inputs];
  // Why no state renders under the harness at all, when that's so.
  let unsupported: string | null = null;
  const records = new Map<string, RunRecord>();
  // The app holds a harness, but not this fwos version's: no run of it counts, old or new.
  const foreign = harness && status === 'edited' ? `the harness in the app (${harness.file}) isn't this fwos version's: run \`fwos harness\` to restore it, then the end-to-end tests` : null;
  if (!harness) unsupported = 'no platform here has a harness that renders state fixtures';
  else if (status === 'absent') unsupported = `fwos's state harness isn't in the app (${harness.file}; \`fwos harness\` writes it)`;
  else if (!foreign) {
    inputs.push(harness.file, '.fwos/local/runs/states/*.json');
    const read = readRuns(project, 'states');
    for (const e of read.errors) findings.push({ file: e.file, rule: 'run-record', message: e.message });
    for (const r of read.records) records.set(r.target, r);
  }

  const verdicts = new Map<string, Map<string, Render>>();
  const renderOf = (s: StateSubject, state: string): Render => {
    if (unsupported) return { status: 'none', why: unsupported };
    if (foreign) return { status: 'none', why: foreign };
    if (!verdicts.has(s.id)) {
      const byState = new Map<string, Render>();
      const r = records.get(`${s.kind}.${s.id}`);
      const fresh = r ? runFreshness(project, r, harness!) : null;
      if (!r) for (const st of s.states) byState.set(st, { status: 'none', why: 'no run of the harness has recorded it; run the end-to-end tests' });
      else if (!fresh!.fresh) for (const st of s.states) byState.set(st, { status: 'none', why: `${fresh!.why}; run the end-to-end tests` });
      else if (!Array.isArray(r.observations)) findings.push({ file: `.fwos/local/runs/states/${s.kind}.${s.id}.json`, rule: 'run-record', message: 'its observations are not a list' });
      else {
        for (const v of judgeStates(r.observations as StateObservation[])) {
          byState.set(
            v.state,
            v.verdict === 'ok'
              ? { status: 'ok' }
              : v.verdict === 'violation'
                ? { status: 'violation', problems: v.problems, dead: v.dead }
                : { status: 'none', why: `no state fixture renders it yet: ${o.fixtureHint}` },
          );
        }
      }
      verdicts.set(s.id, byState);
    }
    return verdicts.get(s.id)!.get(state) ?? { status: 'none', why: "the harness's last run didn't render it; run the end-to-end tests" };
  };

  const flaky = flakyKeys(o.results.cases);
  let tagged = 0;
  let proven = 0;
  let total = 0;
  const pending: string[] = [];
  const unproven = new Map<string, string[]>();
  for (const s of o.subjects) {
    for (const state of s.states) {
      total++;
      const name = o.name(s.id, state);
      const tag = tagOf(o, flaky, s.id, state);
      const render = renderOf(s, state);
      if (tag.status === 'passed') tagged++;
      if (tag.status === 'failed') findings.push({ rule: s.id, message: `${name}: its test fails (${tag.failure})` });
      if (tag.status === 'missing') findings.push({ rule: s.id, message: `${name}: ${tag.message}` });
      if (render.status === 'violation') findings.push({ rule: s.id, message: `${name}: ${violation(state, render.problems, render.dead)}` });
      if (render.status === 'none' && o.strict && !unsupported) findings.push({ rule: s.id, message: `${name}: no fresh render proof (${render.why})` });
      if (tag.status === 'passed' && render.status === 'ok') {
        proven++;
        continue;
      }
      if (tag.status === 'pending') pending.push(`${s.id}:${state}`);
      const why = [tag.status === 'pending' ? 'no passing tagged test yet' : '', render.status === 'none' && !unsupported ? render.why : ''].filter(Boolean).join('; ');
      if (why) unproven.set(why, [...(unproven.get(why) ?? []), name]);
    }
  }

  const tagLine = `${plural(tagged, o.noun)} with a passing tagged test (${TAG_TRUST})`;
  const fresh = foreign ? undefined : [...records.values()].find((r) => runFreshness(project, r, harness!).fresh);
  const how = fresh ? [fresh.config.server, fresh.config.browser].filter(Boolean).join(', ') : '';
  const runLine = fresh ? `rendered by fwos's harness at revision ${revisionOf(project)}${how ? ` (${how})` : ''}` : null;
  if (findings.length > 0) {
    const info = [tagLine, unsupported ? `rendered states aren't checked: ${unsupported}` : `${proven} of ${plural(total, o.noun)} ${renders(total)} as ${total === 1 ? 'its' : 'their'} contract says, with a passing tagged test`];
    if (pending.length > 0) info.push(`no test yet (pending until acceptance): ${pending.join(', ')}`);
    return result(o.id, findings, inputs, undefined, info);
  }
  if (total > 0 && proven === total) {
    return result(o.id, [], inputs, undefined, [`${plural(proven, o.noun)} ${renders(proven)} as ${proven === 1 ? 'its' : 'their'} contract says, with a passing tagged test`, ...(runLine ? [runLine] : [])]);
  }
  if (unsupported) {
    const waiting = pending.length > 0 ? `; no test yet (pending until acceptance): ${pending.join(', ')}` : '';
    return off(o.id, `${plural(tagged, o.noun)} ${has(tagged)} a passing tagged test (${TAG_TRUST}), but nothing shows them rendering: ${unsupported}${waiting}`, inputs);
  }
  const list = [...unproven].map(([why, names]) => `${names.join(', ')} (${why})`).join('; ');
  return off(o.id, `${proven} of ${plural(total, o.noun)} ${renders(total)} as ${total === 1 ? 'its' : 'their'} contract says, with a passing tagged test; not proven yet: ${list}`, inputs);
}
