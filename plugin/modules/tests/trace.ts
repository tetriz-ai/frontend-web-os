// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Traceability: each AC's verdict from the JUnit results. A test proves an AC only if it carries
// the AC's tag, actually ran, passed, and isn't flaky or quarantined. Shared by the
// traceability check and the acceptance report.

import { type Project, type TestCase, caseKey, flakyKeys, hasTag, loadResults } from '../../kernel/index.ts';
import { type Ac, parseAcs, specPath } from '../spec/index.ts';
import { strictCoverage } from '../state/index.ts';
import { currentResultFiles } from './runs.ts';
import { isQuarantined, readQuarantine } from './quarantine.ts';

export type AcVerdict = 'proven' | 'failing' | 'not-run' | 'quarantined-only' | 'manual';

export interface AcTrace {
  ac: Ac;
  verdict: AcVerdict;
  tests: TestCase[];
  /** First failure line, verbatim, when failing. */
  failure?: string;
}

export function traceAcs(project: Project): { acs: AcTrace[]; resultFiles: string[]; cases: TestCase[]; unknownTags: { tag: string; test: TestCase }[] } | null {
  const spec = project.read(specPath(project));
  if (spec === null) return null;
  const acs = parseAcs(spec);
  const { files, cases } = loadResults(project, project.initialized && strictCoverage(project.root) ? currentResultFiles(project) : undefined);
  const flaky = flakyKeys(cases);
  const quarantine = readQuarantine(project.root);
  const traces = acs.map((ac): AcTrace => {
    const tests = cases.filter((t) => hasTag(t, `@${ac.id}`));
    if (ac.manual) return { ac, verdict: 'manual', tests };
    const counts = (t: TestCase) => t.status === 'passed' && !flaky.has(caseKey(t)) && !isQuarantined(quarantine, t);
    const failed = tests.find((t) => t.status === 'failed' && !isQuarantined(quarantine, t));
    if (failed) {
      const out: AcTrace = { ac, verdict: 'failing', tests };
      if (failed.failure) out.failure = failed.failure;
      return out;
    }
    if (tests.some(counts)) return { ac, verdict: 'proven', tests };
    // A test ran but none counts (all quarantined): never "not-run", which the build step lets wait.
    if (tests.some((t) => t.status === 'passed' || t.status === 'failed')) return { ac, verdict: 'quarantined-only', tests };
    return { ac, verdict: 'not-run', tests };
  });
  const known = new Set(acs.map((a) => a.id));
  const unknownTags: { tag: string; test: TestCase }[] = [];
  for (const t of cases) {
    // The whole id, as hasTag reads it: `@AC-list-1.5` is an id of its own, not AC-list-1.
    for (const m of `${t.name} ${t.classname}`.matchAll(/@(AC-[a-z0-9]+(?:-[a-z0-9]+)*-\d+(?:\.[\w-]+)*)(?![\w-]|\.\w)/g)) {
      if (!known.has(m[1]!)) unknownTags.push({ tag: m[1]!, test: t });
    }
  }
  return { acs: traces, resultFiles: files, cases, unknownTags };
}
