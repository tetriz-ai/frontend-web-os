// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Change routing: any later request becomes a change, and its route decides where it re-enters.
// The model classifies the request; this table is the one place that says what each route means.

import type { Route, Step } from '../../modules/state/index.ts';

export interface RouteDef {
  route: Route;
  entry: Step;
  example: string;
  what: string;
}

export const ROUTE_TABLE: RouteDef[] = [
  { route: 'initial', entry: 'discovery', example: 'the first change', what: 'Creates the app: every step from discovery.' },
  { route: 'code-only', entry: 'build', example: 'copy, spacing', what: 'Fix, update the affected tests, check. No spec change.' },
  { route: 'touches-ac', entry: 'spec', example: 'a new filter on a list', what: 'Spec delta, test-plan delta, then build.' },
  { route: 'new-feature', entry: 'discovery', example: '"add sharing"', what: 'Short discovery, research if needed, screens, spec, tests, build.' },
  { route: 'data-change', entry: 'spec', example: 'a new field on a saved item', what: 'As touches-ac, plus a versioned migration and a test that opens data from the previous version.' },
  { route: 'design-system', entry: 'design-system', example: 'brand colour, a renamed token', what: 'Token diff (value, add, rename, remove); contrast and screenshots re-run.' },
  { route: 'add-platform', entry: 'architecture', example: '"now a Mac app too"', what: 'Architecture update, parity table, tokens for the target, every AC re-triaged.' },
  { route: 'architecture', entry: 'architecture', example: '"switch to micro-frontends"', what: 'Back to the architect, with the trade-off shown.' },
];

export const ROUTE_ENTRY = Object.fromEntries(ROUTE_TABLE.map((r) => [r.route, r.entry])) as Record<Route, Step>;

/**
 * The routes a change in an adopted app can take, and where each enters. The app's brief, research,
 * architecture, design system and screens are its own, so a change starts at its own spec delta, or
 * at the build when it has none. The design-system, add-platform and architecture routes would take
 * over what the team owns, so they aren't delivered through fwos in an adopted app.
 */
export const ADOPTED_ROUTE_ENTRY: Partial<Record<Route, Step>> = {
  'code-only': 'build',
  'touches-ac': 'spec',
  'new-feature': 'spec',
  'data-change': 'spec',
};
