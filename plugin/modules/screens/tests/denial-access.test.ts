// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import type { IaRun } from '../../../kernel/index.ts';
import { type Ia, compareWithApp, judgeIaRun } from '../index.ts';
const ia: Ia = { schema: 1, roles: ['admin', 'member'], pages: [{ id: 'members', title: 'Members', route: '/members', kind: 'nav', visibleTo: ['admin'], states: ['ready', 'no-permission'] }] };
const route = { id: 'members', route: '/members', file: 'app/members/page.tsx', devOnly: false };
function visit(role: string, status: number, denied?: boolean): IaRun {
  return { role, flags: [], applied: true, nav: role === 'admin' ? ['/members'] : [], visits: [{ page: 'members', path: '/members', status, finalPath: '/members', notFound: false, ...(denied === undefined ? {} : { denied }) }] };
}
it.each([
  ['admin', 200, true, true],
  ['admin', 403, undefined, true],
  ['admin', 200, false, false],
  ['member', 200, true, false],
  ['member', 403, undefined, false],
  ['member', 200, false, true],
] as const)('route access for %s HTTP%s denied=%s has a problem=%s', (role, status, denied, problem) => {
  const run = visit(role, status, denied);
  expect(judgeIaRun(ia, run).some((finding) => ['inaccessible', 'exposed'].includes(finding.rule))).toBe(problem);
});
it.each([
  ['admin', true, 'exposed'],
  ['admin', false, undefined],
  ['member', true, undefined],
  ['member', false, 'hidden'],
] as const)('prototype access for %s denied=%s reports %s', (role, denied, kind) => {
  const runs = [visit('admin', 200, false), visit('member', 200, true)].map((run) => run.role === role ? visit(role, 200, denied) : run);
  expect(compareWithApp(ia, { routes: [route], runs }).changes.find((change) => ['hidden', 'exposed'].includes(change.kind))?.kind).toBe(kind);
});
