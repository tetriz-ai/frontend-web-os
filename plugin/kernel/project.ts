// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The user's project as checks see it: its root, its platforms and where things live.
// Paths come from `.fwos/state.json` `paths`, merged over these defaults. The state module
// owns and validates that file; the kernel only reads the few fields every check needs.

import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Platform } from './check.ts';
import { PLATFORMS } from './check.ts';
import { fileExists, inTestDir, readJson, readText, walkFiles } from './files.ts';
import { matchAny } from './glob.ts';

export interface ProjectPaths {
  docs: string;
  designSystem: string;
  contract: string;
  tokensOut: string;
  apps: Partial<Record<Platform, string>>;
  /**
   * Where each platform's UI components live, when not the platform's own default (web:
   * `<app>/src/shared/ui`). Adopt mode sets it from the app, for example `components/ui`.
   */
  ui: Partial<Record<Platform, string>>;
  /** App source globs: the tokens and rule-pack checks scan these. */
  source: string[];
  /**
   * Test file globs, excluded from the design-system scans. `tests/` and `e2e/` folders at a
   * package root are tests as well (see isTestFile).
   */
  tests: string[];
  /** JUnit XML result files, read by traceability. */
  results: string[];
  /** Extra globs every check skips. */
  ignore: string[];
  /** Paths the edit hook blocks until the spec and test plan are approved. */
  gated: string[];
  /** Exceptions to `gated` that the Screens step may write before the spec is approved. */
  allowedBeforeSpec: string[];
}

export const DEFAULT_PATHS: ProjectPaths = {
  docs: 'docs/app',
  designSystem: 'design-system',
  contract: 'packages/api-contract',
  tokensOut: 'packages/tokens/generated',
  apps: { web: 'apps/web' },
  ui: {},
  source: ['apps/*/src/**', 'apps/*/app/**', 'packages/*/src/**'],
  tests: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
  results: ['.fwos/local/results/**/*.xml'],
  // .fwos/cli is the vendored CLI: its templates look like app source, and none of it is yours.
  ignore: ['spikes/**', '.fwos/cli/**'],
  gated: ['apps/**', 'packages/**'],
  allowedBeforeSpec: [
    'packages/api-contract/**',
    'packages/tokens/**',
    // The dev-only screens at /fwos-screens, not any page in the route group.
    'apps/*/app/(fwos-screens)/fwos-screens/**',
    'apps/*/src/screens/**',
    'apps/*/src/shared/ui/**',
  ],
};

/**
 * What every check skips, whatever `paths.ignore` says: the comparison gallery that
 * `fwos design-system gallery` writes into the app is fwos's dev-only tooling, not your code.
 */
export const ALWAYS_SKIPPED = ['**/(fwos-screens)/fwos-screens/fwos-gallery/**'];

export type ProjectMode = 'new' | 'adopt' | 'spike';

/**
 * How much of fwos an adopted app has turned on. Each level includes the ones before it: checks
 * (fwos check with a baseline), design (the app's own theme as tokens) and delivery (changes with a
 * spec and test delta, the spec gate and locked tests).
 */
export const ADOPT_LEVELS = ['checks', 'design', 'delivery'] as const;
export type AdoptLevel = (typeof ADOPT_LEVELS)[number];

/**
 * The stages a change goes through in an adopted app, from the idea to its acceptance. A team that
 * already serves a stage well keeps its own practice there (`adopt.keep` in .fwos/state.json):
 * fwos then adds nothing to that stage, and a change links the team's own artifact for it.
 */
export const ADOPT_STAGES = ['idea', 'design', 'spec', 'test-plan', 'build', 'acceptance'] as const;
export type AdoptStage = (typeof ADOPT_STAGES)[number];

export const STAGE_LABELS: Record<AdoptStage, string> = {
  idea: 'Idea and discovery',
  design: 'Design and exploration',
  spec: 'Specification',
  'test-plan': 'Test planning',
  build: 'Implementation',
  acceptance: 'Review, testing and acceptance',
};

export interface Project {
  root: string;
  /** True when `.fwos/state.json` exists. */
  initialized: boolean;
  platforms: Platform[];
  mode: ProjectMode;
  /** An adopted app's level (`adopt.level` in .fwos/state.json, `checks` when unset). Null for any other project. */
  level: AdoptLevel | null;
  /** The stages an adopted app's team keeps its own practice for (`adopt.keep`). Empty for any other project. */
  kept: AdoptStage[];
  paths: ProjectPaths;
  /**
   * Whether the disk holding the root ignores case, as a default macOS or Windows disk does, so
   * `Apps/x.ts` is `apps/x.ts`. Asked of the disk when first read; a test can set it.
   */
  caseInsensitive: boolean;
  abs(rel: string): string;
  read(rel: string): string | null;
  exists(rel: string): boolean;
  /** Files matching `include`, minus `exclude` and `paths.ignore`. Walks once, then filters. */
  files(include: readonly string[], exclude?: readonly string[]): string[];
}

/** The fields of `.fwos/state.json` the kernel reads. */
export interface RawState {
  platforms?: unknown;
  mode?: unknown;
  adopt?: { level?: unknown; keep?: unknown };
  paths?: Partial<ProjectPaths>;
}

export interface LoadOptions {
  /**
   * Don't read `.fwos/state.json`: take the default platforms, mode and paths. For a state file
   * that doesn't parse, so the checks can still run and state/schema can fail on it (fail closed).
   */
  defaults?: boolean;
  /** Read this instead of `.fwos/state.json`: a state `fwos adopt` proposes and hasn't written yet. */
  state?: RawState;
}

export function loadProject(root: string, opts: LoadOptions = {}): Project {
  const absRoot = resolve(root);
  const statePath = join(absRoot, '.fwos', 'state.json');
  const initialized = fileExists(statePath);
  const raw = opts.state ?? (initialized && !opts.defaults ? readJson<RawState>(statePath) : null) ?? {};
  const platforms = Array.isArray(raw.platforms)
    ? (raw.platforms.filter((p) => PLATFORMS.includes(p as Platform)) as Platform[])
    : ['web' as Platform];
  const mode: ProjectMode = raw.mode === 'adopt' || raw.mode === 'spike' ? raw.mode : 'new';
  const level = mode !== 'adopt' ? null : ADOPT_LEVELS.find((l) => l === raw.adopt?.level) ?? 'checks';
  const keep = raw.adopt?.keep;
  const kept = mode === 'adopt' && typeof keep === 'object' && keep !== null ? ADOPT_STAGES.filter((s) => s in keep) : [];
  const paths: ProjectPaths = { ...DEFAULT_PATHS, ...(raw.paths ?? {}) };
  paths.apps = { ...DEFAULT_PATHS.apps, ...(raw.paths?.apps ?? {}) };
  paths.ui = { ...DEFAULT_PATHS.ui, ...(raw.paths?.ui ?? {}) };
  if (mode === 'adopt') {
    // An adopted app's spec gate covers that app alone, never the defaults' apps/** and packages/**,
    // which in a monorepo are other teams' apps. A path state.json sets wins.
    if (raw.paths?.gated === undefined) paths.gated = adoptedGate(paths);
    if (raw.paths?.allowedBeforeSpec === undefined) paths.allowedBeforeSpec = [];
  }

  let all: string[] | null = null;
  let foldsCase: boolean | undefined;
  return {
    root: absRoot,
    initialized,
    platforms,
    mode,
    level,
    kept,
    paths,
    get caseInsensitive() {
      return (foldsCase ??= diskIgnoresCase(absRoot));
    },
    set caseInsensitive(value: boolean) {
      foldsCase = value;
    },
    abs: (rel) => join(absRoot, rel),
    read: (rel) => readText(join(absRoot, rel)),
    exists: (rel) => fileExists(join(absRoot, rel)),
    files(include, exclude = []) {
      all ??= walkFiles(absRoot);
      const skip = [...exclude, ...paths.ignore, ...ALWAYS_SKIPPED];
      return all.filter((f) => matchAny(f, include) && !matchAny(f, skip));
    },
  };
}

/**
 * What the spec gate covers in an adopted app: its source when the app is the root of the project,
 * else its folder, plus the workspace packages it uses (its other source globs).
 */
function adoptedGate(paths: ProjectPaths): string[] {
  const app = paths.apps.web ?? '.';
  if (app === '.') return [...paths.source];
  return [`${app}/**`, ...paths.source.filter((s) => !s.startsWith(`${app}/`))];
}

/**
 * Whether `rel` is a test file: it matches `paths.tests`, or it sits in a `tests/` or `e2e/` folder
 * at a package root (the root, `apps/<name>`, `packages/<name>` or a folder with a package.json).
 * A folder with the same name deeper in app source, such as `src/features/tests/`, is not a test.
 */
export function isTestFile(project: Project, rel: string): boolean {
  return matchAny(rel, project.paths.tests) || inTestDir(rel, (dir) => project.exists(`${dir}/package.json`));
}

const caseInsensitiveDirs = new Map<string, boolean>();

/**
 * Whether the disk holding `dir` ignores case: a name in the other case finds the same file. The
 * folder's own name is asked when it has letters to swap, and its `.fwos` folder when it has none
 * (`1234`, `_42_`). Asked once per folder.
 */
function diskIgnoresCase(dir: string): boolean {
  let real = dir;
  try {
    real = realpathSync.native(dir);
  } catch {
    // not there yet: ask about the path as given
  }
  let known = caseInsensitiveDirs.get(real);
  if (known === undefined) {
    const probe = /[a-z]/i.test(basename(real)) ? real : join(real, '.fwos');
    const swapped = basename(probe).replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
    known = false;
    try {
      const a = statSync(probe);
      const b = statSync(join(dirname(probe), swapped));
      known = a.ino === b.ino && a.dev === b.dev;
    } catch {
      // no file by the other spelling: the disk is case sensitive
    }
    caseInsensitiveDirs.set(real, known);
  }
  return known;
}

/** Walks up from `start` to the nearest folder holding `.fwos/state.json`. */
export function findProjectRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (fileExists(join(dir, '.fwos', 'state.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
