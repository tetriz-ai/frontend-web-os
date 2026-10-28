// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// What fwos's IA harness does in a run of the app, and how screens/ia reads what it saw: it opens
// every static route as every role ia.json lists, with every setting of the flags its pages use,
// and reads the nav each time. A page a role should see must open, a nav page must have a link in
// the nav, and a page a role shouldn't see must neither open nor show in the nav.

import type { IaRun, IaVisit } from '../../kernel/index.ts';
import { type Flags, type Ia, type IaPage, normRoute, reaches, settings, visibleTo, visibleUnder } from './ia.ts';

/** The cookie the IA harness sets to open the app as a role and flag setting; the app reads it only while FWOS_TEST_ACCESS=1. */
export const TEST_ACCESS_COOKIE = 'fwos-test-access';

/** One role and flag setting the harness runs as: `admin+members-enabled` is admin with that flag on and every other off. */
export interface IaRunTarget {
  key: string;
  role: string;
  flags: string[];
}

export interface IaRunPlan {
  runs: IaRunTarget[];
  /** The routes each run opens: every page's static route, redirects included. */
  visits: { page: string; path: string }[];
  /** Pages it can't open, and why. */
  skipped: { page: string; why: string }[];
}

/** The flags ia.json lists that a page uses: only they change who sees what. */
export function pageFlags(ia: Ia): string[] {
  return (ia.flags ?? []).filter((f) => ia.pages.some((p) => p.flag === f));
}

/** Up to four flags, every setting of them; past that, all on, all off, and each one on alone. */
function flagSettings(flags: string[]): Flags[] {
  if (flags.length <= 4) return settings(flags);
  const all = (on: boolean) => Object.fromEntries(flags.map((f) => [f, on]));
  return [all(true), all(false), ...flags.map((f) => ({ ...all(false), [f]: true }))];
}

const isRoute = (p: IaPage) => (p.surface ?? 'route') === 'route' && !!p.route;
const isDynamic = (route: string) => route.includes('[');

export function iaRunPlan(ia: Ia): IaRunPlan {
  const flags = pageFlags(ia);
  const runs = ia.roles.flatMap((role) =>
    flagSettings(flags).map((s) => {
      const on = flags.filter((f) => s[f]);
      return { key: [role, ...on].join('+'), role, flags: on };
    }),
  );
  const visits: IaRunPlan['visits'] = [];
  const skipped: IaRunPlan['skipped'] = [];
  for (const p of ia.pages.filter(isRoute)) {
    if (isDynamic(p.route!)) skipped.push({ page: p.id, why: `a dynamic route (${p.route})` });
    else visits.push({ page: p.id, path: p.route! });
  }
  return { runs, visits, skipped };
}

/** Whether a run record's observations are an IA run: role, flags, applied, visits and nav. */
export const isIaRun = (o: unknown): o is IaRun => {
  const r = o as Partial<IaRun> | null;
  return !!r && typeof r.role === 'string' && Array.isArray(r.flags) && typeof r.applied === 'boolean' && Array.isArray(r.visits) && Array.isArray(r.nav);
};

/** `admin (members-enabled on)`: who a run was, for its messages. */
export function runName(ia: Ia, run: { role: string; flags: string[] }): string {
  const flags = pageFlags(ia);
  return flags.length === 0 ? run.role : `${run.role} (${flags.map((f) => `${f} ${run.flags.includes(f) ? 'on' : 'off'}`).join(', ')})`;
}

/** `admin with members-enabled on`: who ia.json lets see a page. */
function audience(ia: Ia, p: IaPage): string {
  const roles = visibleTo(ia, p);
  const who = ia.roles.every((r) => roles.includes(r)) ? 'every role' : roles.join(' or ') || 'no role';
  return `${who}${p.flag ? ` with ${p.flag} on` : ''}`;
}

const label = (p: IaPage) => `"${p.id}" (${p.route})`;

/** Why a visit didn't land on its page. */
function landing(v: IaVisit): string {
  if (v.error) return `it didn't load (${v.error})`;
  if (v.notFound) return v.status === 404 ? 'not found (404)' : `not found (HTTP ${v.status})`;
  if (v.status >= 400 || v.status === 0) return `HTTP ${v.status}`;
  return `it redirects to ${v.finalPath}`;
}

const opened = (v: IaVisit) => !v.error && v.status > 0 && v.status < 400 && !v.notFound;

export interface IaProblem {
  rule: 'identity' | 'exposed' | 'inaccessible' | 'no-link' | 'redirect' | 'linked' | 'unlisted-link';
  page?: string;
  message: string;
}

/** What one run shows that ia.json doesn't say: in both directions, for that role and flag setting. */
export function judgeIaRun(ia: Ia, run: IaRun): IaProblem[] {
  const who = runName(ia, run);
  if (!run.applied) {
    return [
      {
        rule: 'identity',
        message: `the app didn't confirm it took ${who}, so this run proves nothing about who sees what; read the test identity in currentAccess() and render <meta name="fwos-access"> (the scaffold's src/shared/access does both)`,
      },
    ];
  }
  const flags: Flags = Object.fromEntries((ia.flags ?? []).map((f) => [f, run.flags.includes(f)]));
  const sees = (p: IaPage) => visibleUnder(ia, p, run.role, flags);
  const byId = new Map(ia.pages.map((p) => [p.id, p]));
  const routed = ia.pages.filter(isRoute);
  const problems: IaProblem[] = [];
  for (const v of run.visits) {
    const p = byId.get(v.page);
    if (!p?.route) continue;
    const here = reaches(normRoute(v.finalPath), normRoute(p.route));
    if (p.kind === 'redirect') {
      const target = p.redirectTo ? byId.get(p.redirectTo) : undefined;
      if (!target?.route || !sees(p)) continue;
      const went = v.redirectedTo ?? v.finalPath;
      if (reaches(normRoute(went), normRoute(target.route))) continue;
      const what = v.error ? landing(v) : here ? `it stays at ${v.finalPath}` : `it goes to ${went}`;
      problems.push({ rule: 'redirect', page: p.id, message: `${label(p)} should send ${who} to ${label(target)}, but ${what}` });
      continue;
    }
    if (sees(p) && !(opened(v) && here && v.denied !== true)) {
      problems.push({ rule: 'inaccessible', page: p.id, message: `${who} can't open ${label(p)}: ${landing(v)}` });
    }
    // Only a denial observed at this actual route visit can excuse a successful response.
    if (!sees(p) && opened(v) && here && v.denied !== true) {
      problems.push({ rule: 'exposed', page: p.id, message: `${who} can open ${label(p)}, which ia.json shows only to ${audience(ia, p)}` });
    }
  }
  /** The ia.json page a nav link goes to: a static route it equals, else one it reaches. */
  const pageAt = (path: string) => {
    const to = normRoute(path);
    return routed.find((p) => normRoute(p.route!) === to) ?? routed.find((p) => reaches(to, normRoute(p.route!)));
  };
  for (const link of run.nav) {
    const p = pageAt(link);
    if (!p) problems.push({ rule: 'unlisted-link', message: `the nav ${who} sees links ${link}, which ia.json doesn't list` });
    else if (!sees(p)) problems.push({ rule: 'exposed', page: p.id, message: `the nav shows ${label(p)} to ${who}, which ia.json shows only to ${audience(ia, p)}` });
    else if (p.kind === 'unlinked') problems.push({ rule: 'linked', page: p.id, message: `the nav ${who} sees links ${label(p)}, which ia.json marks unlinked (${p.unlinkedReason})` });
  }
  // Every nav page this run sees needs a link in the nav, except the one at /, where the app opens.
  for (const p of routed.filter((x) => x.kind === 'nav' && normRoute(x.route!) !== '/' && sees(x))) {
    if (!run.nav.some((link) => reaches(normRoute(link), normRoute(p.route!)))) {
      problems.push({ rule: 'no-link', page: p.id, message: `${who} sees no link to ${label(p)} in the nav` });
    }
  }
  return problems;
}
