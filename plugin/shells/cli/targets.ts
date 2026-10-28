// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// What fwos's state harness renders, which `fwos harness targets` lists and `fwos doctor --start`
// renders the first of.

import type { Project } from '../../kernel/index.ts';
import { loadComponents } from '../../modules/design-system/index.ts';
import { loadIa } from '../../modules/screens/index.ts';
import { profilesFor } from './registry.ts';

export interface StateTarget {
  key: string;
  kind: 'page' | 'component';
  id: string;
  states: string[];
  /** Per state, the path in the app that renders its fixture, or null when nothing does. Absent with no driver to ask. */
  paths?: Record<string, string | null>;
}

/** Every page state in ia.json, then every required state in components.json, each with where the app renders it. */
export function stateTargets(p: Project): StateTarget[] {
  const ia = loadIa(p)?.ia;
  const comps = loadComponents(p);
  const driver = profilesFor(p).find((x) => x.verify?.fixture)?.verify;
  const at = (kind: 'page' | 'component', id: string, states: string[]) =>
    driver?.fixture ? { paths: Object.fromEntries(states.map((state) => [state, driver.fixture!(p, { kind, id, state })])) } : {};
  return [
    ...(ia?.pages ?? []).filter((x) => x.kind !== 'redirect' && x.states.length > 0).map((x) => ({ key: `page.${x.id}`, kind: 'page' as const, id: x.id, states: x.states, ...at('page', x.id, x.states) })),
    ...(comps?.components ?? [])
      .filter((c) => c.status !== 'removed' && c.requiredStates.length > 0)
      .map((c) => ({ key: `component.${c.id}`, kind: 'component' as const, id: c.id, states: c.requiredStates, ...at('component', c.id, c.requiredStates) })),
  ];
}

/** How a violation names a state: `list "empty"`, `button "loading" state`. */
export const stateName = (kind: 'page' | 'component', id: string, state: string) => (kind === 'page' ? `${id} "${state}"` : `${id} "${state}" state`);
