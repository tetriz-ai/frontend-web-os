// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Wires every module's checks and every platform profile together. Shells are the only place
// this happens; no module imports a platform.

import { type Check, type PlatformProfile, type Project, adapterSet } from '../../kernel/index.ts';
import { checks as architecture } from '../../modules/architecture/index.ts';
import { checks as build } from '../../modules/build/index.ts';
import { checks as designSystem } from '../../modules/design-system/index.ts';
import { checks as rules } from '../../modules/rules/index.ts';
import { checks as screens } from '../../modules/screens/index.ts';
import { checks as spec } from '../../modules/spec/index.ts';
import { checks as state } from '../../modules/state/index.ts';
import { checks as tests } from '../../modules/tests/index.ts';
import { profile as electron } from '../../platforms/electron/index.ts';
import { profile as mac } from '../../platforms/mac/index.ts';
import { profile as web } from '../../platforms/web/index.ts';

export const PROFILES: PlatformProfile[] = [web, electron, mac];

/** Step-module checks, in the order they print. Gates first. */
export const MODULE_CHECKS: Check[] = [...state, ...designSystem, ...architecture, ...screens, ...spec, ...tests, ...build, ...rules];

export function profilesFor(project: Project): PlatformProfile[] {
  return PROFILES.filter((p) => project.platforms.includes(p.platform));
}

export function adaptersFor(project: Project) {
  return adapterSet(profilesFor(project));
}

/** Every check that applies to the project: module checks for its platforms, plus each enabled profile's own. */
export function checksFor(project: Project): Check[] {
  const platformChecks = profilesFor(project).flatMap((p) => p.checks);
  const seen = new Set<string>();
  return [...MODULE_CHECKS, ...platformChecks].filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    // state/schema always runs: with no platform it knows (`[]`, a typo), nothing else would, and
    // `fwos check` would pass on zero checks.
    return c.id === 'state/schema' || c.platforms.some((p) => project.platforms.includes(p));
  });
}

export function allChecks(): Check[] {
  const seen = new Set<string>();
  return [...MODULE_CHECKS, ...PROFILES.flatMap((p) => p.checks)].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}
