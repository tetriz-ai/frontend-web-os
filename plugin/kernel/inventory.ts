// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// What `fwos adopt` reads in an existing repo before it proposes anything. A platform fills it in
// (web reads Next.js apps); the CLI turns it into a proposal. Every finding names the file it came
// from, and what wasn't found is listed as unknown rather than guessed.

import type { InferredLayout } from './adapters.ts';

export type InventoryArea =
  | 'workspace'
  | 'framework'
  | 'routes'
  | 'components'
  | 'theme'
  | 'data'
  | 'auth'
  | 'flags'
  | 'tests'
  | 'scripts'
  | 'ci'
  | 'hooks'
  | 'lint'
  | 'guidance'
  | 'docs'
  | 'review'
  | 'package-manager';

/** One thing found in the repo, and the file (with the key, when it's one) it came from. */
export interface RepoFinding {
  area: InventoryArea;
  what: string;
  from: string;
}

/** An area where nothing was found, saying what was looked for. */
export interface RepoUnknown {
  area: InventoryArea;
  what: string;
}

/** A package in the repo that is an app, and whether fwos can adopt it. */
export interface AppCandidate {
  /** Relative to the root, `.` for the root itself. */
  dir: string;
  framework: string;
  from: string;
  supported: boolean;
}

export type AdoptSupport = 'supported' | 'partial' | 'unsupported';

export interface Inventory {
  /** Unsupported: no app fwos can adopt. Partial: one it can, with limits (each in `limits`). */
  support: AdoptSupport;
  /** What fwos can't do here, each saying what it means and what to do. */
  limits: string[];
  apps: AppCandidate[];
  /** The app fwos would adopt: the one named, else the only one it can. Null when there's none, or several and none named. */
  app: string | null;
  /** The app's paths for `.fwos/state.json`, each with its citation. Empty when `app` is null. */
  layout: InferredLayout;
  /** The CSS file holding the app's theme variables (shadcn style), which the design level imports. */
  theme: string | null;
  findings: RepoFinding[];
  unknowns: RepoUnknown[];
  /** How the team reviews and ships a change: its branch prefixes (`feat`, `fix`), pull request template and CODEOWNERS. */
  workflow?: Workflow;
}

export interface Workflow {
  /** The prefixes its branches are named with, most used first (`feat/<name>`). Empty when it has no such convention. */
  branchPrefixes: string[];
  template: string | null;
  codeowners: string | null;
}
