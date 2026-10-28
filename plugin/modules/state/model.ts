// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The file formats this module owns: `.fwos/state.json` and `.fwos/changes/<id>.json`.

import type { AdoptLevel, AdoptStage, ChangeMap, Platform, ProjectMode, ProjectPaths } from '../../kernel/index.ts';

export const STATE_SCHEMA_VERSION = 1;

/** The steps of a change, in order. Step 0 (start) is `fwos init` itself. */
export const STEPS = [
  'discovery',
  'research',
  'architecture',
  'design-system',
  'screens',
  'spec',
  'build',
  'accept',
  'done',
] as const;
export type Step = (typeof STEPS)[number];

export const ROUTES = [
  'initial',
  'code-only',
  'touches-ac',
  'new-feature',
  'data-change',
  'design-system',
  'add-platform',
  'architecture',
] as const;
export type Route = (typeof ROUTES)[number];

export interface FwosState {
  schema: number;
  pluginVersion: string;
  name?: string;
  mode: ProjectMode;
  platforms: Platform[];
  createdAt?: string;
  channels?: string[];
  /**
   * An adopted app's level, and each level it was set to, with the day. `keep` holds the stages its
   * team keeps its own practice for, each with why and since when: fwos adds nothing there.
   */
  adopt?: { level: AdoptLevel; history?: { level: AdoptLevel; at: string }[]; keep?: Partial<Record<AdoptStage, KeptStage>> };
  paths?: Partial<ProjectPaths>;
}

/** Why a team keeps its own practice for a stage, and since when. */
export interface KeptStage {
  reason: string;
  at: string;
}

export type ApprovalVia = 'chat' | 'pr' | 'autopilot';

export interface ApprovalRecord {
  sha: string;
  files: Record<string, string>;
  by: string;
  at: string;
  via: ApprovalVia;
  /** Where the person said yes, when it wasn't in chat: a pull request review or comment. */
  ref?: string;
}

export interface Skip {
  target: string;
  reason: string;
  by: string;
  at: string;
}

export interface ReviewException {
  target: string;
  finding: string;
  by: string;
  at: string;
}

export interface LockedTest {
  sha: string;
  at: string;
  slice?: string;
  evidence?: 'red' | 'existing';
}

export interface Unlock {
  path: string;
  reason: string;
  reviewer: string;
  at: string;
  relockedAt?: string;
}

export interface RedRun {
  slice?: string;
  at: string;
  failing: string[];
}

/**
 * What a change came from or builds on: a URL, or a project file with its hash when linked. With a
 * stage, it is the team's own artifact for that stage of the change: its design, its test plan, the
 * sign-off its acceptance got.
 */
export interface Link {
  ref: string;
  sha?: string;
  stage?: AdoptStage;
}

export interface Signoff {
  item: string;
  by: string;
  at: string;
  note?: string;
}

export interface Change {
  schema: number;
  id: string;
  title: string;
  route: Route;
  step: Step;
  status: 'open' | 'done';
  createdAt: string;
  branch?: string;
  head?: string;
  links?: Link[];
  /** An adopted app's change: the spec's criteria when it began, by id, each with a hash of its text. */
  base?: { acs: Record<string, string> };
  /** An adopted app's change: what it touches, read from the code by `fwos change map`. */
  map?: ChangeMap & { at: string };
  cursor?: { section?: string; pending?: string[]; note?: string };
  approvals: Record<string, ApprovalRecord>;
  skips?: Skip[];
  exceptions?: ReviewException[];
  lockedTests?: Record<string, LockedTest>;
  unlocks?: Unlock[];
  redRuns?: RedRun[];
  signoffs?: Signoff[];
  spend?: Record<string, number>;
}

export function now(): string {
  return new Date().toISOString();
}

export function today(): string {
  return now().slice(0, 10);
}
