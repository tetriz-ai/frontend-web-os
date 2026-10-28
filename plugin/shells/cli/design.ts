// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The design-system adoption commands' shared work: writing the mapping report, putting the
// fidelity approval beside the outcomes it never contains, and the checks the fidelity approval
// waits on. `fwos design-system report|gallery|decide`, `fwos design-system init`, `fwos adopt`
// and `fwos approve` use them.

import { FwosError, GALLERY_ROUTE, type Project, readJson } from '../../kernel/index.ts';
import { type AdoptionReport, type Outcomes, adoptionReport, designSystemReportPath, formatOutcomes } from '../../modules/design-system/index.ts';
import { type OwnedWrite, approvalState, writeOwned } from '../../modules/state/index.ts';
import { adaptersFor } from './registry.ts';

/** Builds the mapping report and writes it: generated, so a hand edit stops the next write. */
export async function writeDesignReport(p: Project): Promise<{ report: AdoptionReport; write: OwnedWrite }> {
  const report = await adoptionReport(p, adaptersFor(p));
  const write = writeOwned(p.root, designSystemReportPath(p), report.markdown, 'generated', 'design-system/');
  return { report, write };
}

/** The outcomes with the fidelity approval in them: the report can't hold it, since the approval is a hash of the report. */
export function withApproval(p: Project, o: Outcomes): Outcomes {
  const s = approvalState(p, 'fidelity');
  if (s.status === 'approved') return { ...o, fidelity: { ...o.fidelity, status: 'approved', detail: `by ${s.record!.by} on ${s.record!.at.slice(0, 10)}: ${o.fidelity.detail}` } };
  if (s.status === 'stale') return { ...o, fidelity: { ...o.fidelity, status: 'approval stale', detail: `${s.record!.by} approved it, and ${(s.changed ?? []).join(', ')} changed since. ${o.fidelity.detail}` } };
  return o;
}

export const outcomeLines = (p: Project, o: Outcomes) => formatOutcomes(withApproval(p, o));

/**
 * Refuses the fidelity approval, saying why, unless a current comparison ran, every item that isn't
 * preserved is decided, and the report on disk is the one the evidence gives now.
 */
export async function assertFidelityReady(p: Project): Promise<void> {
  const report = await adoptionReport(p, adaptersFor(p));
  const f = report.outcomes.fidelity;
  const no = (why: string, hint?: string) => new FwosError(`Can't approve fidelity: ${why}`, hint);
  if (f.status === 'not applicable') throw no('nothing was adopted, so there is no source to compare with.');
  if (f.status === 'not compared' || f.status === 'out of date') throw no(`${f.detail}`);
  if (report.unresolved.length > 0) {
    const shown = report.unresolved.slice(0, 3).map((i) => i.item).join(', ');
    throw no(`${report.unresolved.length === 1 ? '1 item needs' : `${report.unresolved.length} items need`} a decision (${shown}${report.unresolved.length > 3 ? ', ...' : ''}).`, '`fwos design-system report` lists them, and `fwos design-system decide` records each.');
  }
  const path = designSystemReportPath(p);
  const disk = p.read(path);
  if (disk === null || disk.replace(/\r\n/g, '\n') !== report.markdown) {
    throw no(`${path} is out of date: run \`fwos design-system report\`, read it, then approve.`);
  }
}

/** How to look at the gallery and run its comparison, after `fwos design-system gallery` wrote it. */
export function galleryNext(p: Project, app: string, command: string): string[] {
  const pkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(p.abs(`${app}/package.json`));
  const playwright = !!{ ...pkg?.dependencies, ...pkg?.devDependencies }['@playwright/test'];
  return [
    `Open http://localhost:3000${GALLERY_ROUTE} with \`pnpm dev\` to look at it.`,
    `Compare both sides in a browser: ${command}`,
    ...(playwright ? [] : [`It needs Playwright in ${app === '.' ? 'the app' : app}: \`pnpm add -D @playwright/test\`, then \`pnpm exec playwright install chromium\`.`]),
    'Then `fwos design-system report` shows what differs, and what accounts for it.',
  ];
}
