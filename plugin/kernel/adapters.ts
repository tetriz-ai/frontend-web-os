// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The 4 adapter interfaces every platform implements. Step modules depend only on these
// interfaces; platforms implement them and the shells plug them in. Adding a platform
// never touches a step module.

import type { Check, Platform } from './check.ts';
import type { GalleryAdapter } from './gallery.ts';
import type { Inventory } from './inventory.ts';
import type { Project, ProjectPaths } from './project.ts';

/** Registry ID -> the platform's component, and which registered components are installed. */
export interface ComponentAdapter {
  platform: Platform;
  importFor(id: string): string;
  listInstalled(project: Project): { id: string; file: string }[];
  /** The folder listInstalled reads, for messages that say where nothing was found. */
  folder?(project: Project): string;
}

export interface ScreenRef {
  /** A route on web (`/items/[]`), or a window/scene/menu ID on desktop. */
  route: string;
  file: string;
  /** Dev-only screens (the Screens step's state switcher) are excluded from the IA diff. */
  devOnly: boolean;
  /** The stable page ID the route declares: `guardPage('<id>')` in its page on web. */
  id?: string;
  /**
   * How the route's code limits who sees it: `ia` through fwos's access guard, which applies
   * ia.json's roles and flag; `none` when nothing in it, its layouts or what they import could turn
   * a visitor away; `unknown` when something might (a check fwos can't read, a proxy). Absent when
   * the adapter doesn't read it.
   */
  access?: 'ia' | 'none' | 'unknown';
  /** Where the route's own code redirects: a literal path, or `?` for one fwos can't read. */
  redirectTo?: string;
}

/** An internal link in the app's code: a link or nav entry, a router call, or a redirect. */
export interface AppLink {
  /** Where it goes, with no query or hash. A `${...}` in a template literal is a dynamic segment, `[]`. */
  to: string;
  file: string;
  line: number;
}

/** A redirect the app's config declares, as literal paths. */
export interface AppRedirect {
  from: string;
  to: string;
  file: string;
}

/** The real app, as a screen adapter reads it. */
export interface AppScreens {
  screens: ScreenRef[];
  inputs: string[];
  /**
   * The internal links in the code the app's screens render: their own files and every file they
   * import. Absent when the adapter doesn't read links, and then screens/ia can't ask for one.
   */
  links?: AppLink[];
  /** Files among those that build their links from ia.json itself, as the scaffold's nav does: they link every nav page. */
  iaNav?: string[];
  /** Redirects the app's config declares. */
  redirects?: AppRedirect[];
  /**
   * Files that can refuse or redirect any request in ways fwos can't read: a proxy or middleware,
   * or redirects config it can't read. While there is one, no route's access is `none`.
   */
  gatekeepers?: string[];
}

/**
 * Walks the real app's code and returns every screen it exposes, the links between them, the page
 * IDs routes declare, how each limits access, and redirects. `null` means no app was found. Code
 * says what a route can do, not what it does for a role and flag setting: that is what a run of the
 * app's IA harness shows (IaRun).
 */
export interface ScreenAdapter {
  platform: Platform;
  listScreens(project: Project): AppScreens | null;
}

/** One route as one role, with one flag setting, saw it in a run of the app. */
export interface IaVisit {
  /** The ia.json page it opened. */
  page: string;
  /** The path it opened. */
  path: string;
  /** The HTTP status it ended on, after redirects. */
  status: number;
  /** The path it ended on. */
  finalPath: string;
  /** The app rendered its not-found page. */
  notFound: boolean;
  /** The actual route rendered a visible denial state and no other visible page state. */
  denied?: boolean;
  /** Where the first redirect sent it, when one did. */
  redirectedTo?: string;
  /** What went wrong opening it, when it didn't open at all. */
  error?: string;
}

/** What a run of the app showed one role with one flag setting: every route it opened and every nav link it saw. */
export interface IaRun {
  role: string;
  /** The flags on; every other flag ia.json lists was off. */
  flags: string[];
  /** The app confirmed it took this role and flag setting. When false, the run proves nothing about them. */
  applied: boolean;
  visits: IaVisit[];
  /** The paths the nav links to, on every page that opened. */
  nav: string[];
}

export interface FixtureRef {
  operationId: string;
  variant: string;
  /** Relative to the project root. */
  file: string;
  status: number;
}

export interface ContractOperation {
  operationId: string;
  method: string;
  /** OpenAPI path template, e.g. `/items/{id}`. */
  path: string;
  statuses: string[];
}

/** The API contract as every platform sees it: operations from openapi.yaml plus JSON fixtures. */
export interface ContractModel {
  /** The contract folder, relative to the project root. */
  dir: string;
  source: string;
  operations: ContractOperation[];
  fixtures: FixtureRef[];
}

export interface GeneratedFile {
  path: string;
  content: string;
  /** What it's generated from, recorded in the manifest. */
  source: string;
}

/** Turns the contract's JSON fixtures into the platform's fakes (a fail-closed mock fetch on web). */
export interface StateFixturesAdapter {
  platform: Platform;
  generate(project: Project, contract: ContractModel): GeneratedFile[];
}

export interface Probe {
  ready: boolean;
  reason?: string;
  detail?: string;
}

/**
 * One of fwos's own test files in the app, which the app's end-to-end runner runs: `states` renders
 * every page and component state fixture, `ia` opens every route as every role and flag setting.
 * Each hands what it saw to `fwos harness record`, which keeps it as a run record.
 */
export interface Harness {
  kind: 'states' | 'ia';
  /** Where it goes in the project, relative to the root. */
  file: string;
  /** What fwos ships: a harness that holds anything else isn't fwos's. */
  content: string;
}

/** One state fixture: a page's or a component's state, as the screens browser renders it. */
export interface FixtureTarget {
  kind: 'page' | 'component';
  id: string;
  state: string;
}

/** What `fwos doctor --start` asks the verify driver to show. */
export interface RenderRequest {
  /** The state fixture to render, and the path in the app that renders it (VerifyDriver.fixture). */
  fixture: FixtureTarget;
  path: string;
  /** Then open the app as this role through the IA harness's test identity, when ia.json lists a role. */
  as?: { cookie: string; role: string };
  /** An app already running there, to use instead of starting one. */
  url?: string;
}

/** What starting the app and rendering one state fixture in a real browser showed. */
export interface RenderProbe {
  /** The app started and the fixture rendered. */
  ok: boolean;
  /** What rendered, where and how, when it did. */
  detail?: string;
  /** Why it didn't, when it didn't. */
  reason?: string;
  /** Whether the app took the test identity it was opened as; absent when it wasn't asked to. */
  access?: boolean;
}

/** Drives the real app for the verify loop (screenshots, console, accessibility queries). */
export interface VerifyDriver {
  platform: Platform;
  name: string;
  /** What the loop needs installed. It starts nothing, so it never shows the loop runs. */
  probe(project: Project): Probe;
  /** fwos's harness files for this app, which `fwos harness` writes. */
  harness?(project: Project): Harness[];
  /**
   * The path in the running app that renders a state fixture, or null when nothing in the app does:
   * the screens browser in an app fwos scaffolded, else the comparison gallery for a component.
   */
  fixture?(project: Project, target: FixtureTarget): string | null;
  /**
   * Starts the app (or uses one at `url`), renders a state fixture in a real browser, opens the app
   * as a role when asked, and stops what it started: what `fwos doctor --start` runs before it
   * calls the driver active.
   */
  render?(project: Project, request: RenderRequest): Promise<RenderProbe>;
}

/**
 * What a change touches in an adopted app, read from its code by `fwos change map`: the ground
 * its spec delta stands on, the files its build may edit, and the tests around it.
 */
export interface ChangeMap {
  /** Each route (`/dashboard`) or file the change names, and the file it resolves to. */
  targets: { target: string; file: string }[];
  /** The route files around each target page: layouts, templates, loading and error files. */
  wrappers: string[];
  /** Every project file the targets render or import, and the data handlers they call. Sorted. */
  files: string[];
  /** The app's UI components among them. */
  components: string[];
  /** The API routes the targets call (`GET /api/team`) and the server actions they import. */
  data: { kind: 'api' | 'action'; what: string; file: string }[];
  /** Existing tests that import a target's file or visit a target route, and which. */
  tests: { file: string; via: string }[];
  /** The targets' code owners, from CODEOWNERS. */
  owners: string[];
}

/** Maps a change onto the app's code. Throws when a target matches no route or file. */
export interface ChangeMapAdapter {
  platform: Platform;
  map(project: Project, targets: string[]): ChangeMap;
}

/**
 * One of the app's own test commands, as `fwos tests run` runs it: the team's script through its
 * package manager, with a JUnit reporter added on the command line for a runner fwos knows, so the
 * team's config stays as it is. A command fwos can't add a reporter to still runs, with `unmapped`
 * saying why its results can't count.
 */
export interface TestCommand {
  /** The package.json script, and the folder of that package.json (`.` for the root). */
  script: string;
  dir: string;
  /** The script's command, as package.json has it. */
  command: string;
  /** How the team runs it: `pnpm test`, `npm run e2e in apps/site`. */
  display: string;
  /** The runner fwos recognised (`Vitest`, `Playwright`), or null. */
  runner: string | null;
  /** The runner drives a real browser. */
  browser: boolean;
  /** What fwos spawns in `dir`, and the environment it adds. */
  argv: string[];
  env: Record<string, string>;
  /** Where its results land, a glob relative to the root. Null when fwos can't read them. */
  results: string | null;
  /** JUnit XML, or Jest's own JSON, which fwos turns into JUnit at `results`. */
  format?: 'junit' | 'jest-json';
  /** For jest-json: where the runner writes its JSON, relative to the root. */
  raw?: string;
  /** Why fwos can't read its results, when it can't. */
  unmapped?: string;
}

/** Finds the app's test scripts and how to run each with a JUnit reporter. */
export interface TestCommandAdapter {
  platform: Platform;
  /**
   * The scripts `fwos tests run` runs: the named ones, or every test script the app has. A script
   * left out (one that never ends, or only runs others) is in `skipped` with why.
   */
  commands(project: Project, names?: string[]): { commands: TestCommand[]; skipped: { script: string; dir: string; why: string }[] };
}

export interface ToolRequirement {
  name: string;
  neededFor: string;
  installedBy: 'user' | 'plugin';
  probe(): { ok: boolean; version?: string; fix?: string };
}

/** One thing adopt mode found in an existing app, and what it read to find it. */
export interface LayoutFinding {
  what: string;
  value: string;
  from: string;
}

/** An existing app's layout, read by adopt mode: the paths to record, with a citation for each. */
export interface InferredLayout {
  paths: Partial<ProjectPaths>;
  found: LayoutFinding[];
  /** What it looked for and didn't find; the checks that need it stay OFF. */
  missing: string[];
}

export type PlatformStatus = 'supported' | 'preview' | 'experimental' | 'unavailable';

export interface PlatformProfile {
  platform: Platform;
  status: PlatformStatus;
  /** Shown by doctor when the platform isn't usable in this release. */
  statusReason?: string;
  components?: ComponentAdapter;
  screens?: ScreenAdapter;
  fixtures?: StateFixturesAdapter;
  verify?: VerifyDriver;
  /** The app's own test commands, for `fwos tests run`. */
  tests?: TestCommandAdapter;
  /** What a change touches in the app, for `fwos change map`. */
  changeMap?: ChangeMapAdapter;
  /** Adopt mode: read an existing app's layout from `root`, for the app at `opts.app` when named. Read-only. */
  inferLayout?(root: string, opts?: { app?: string }): InferredLayout;
  /** Adopt mode: everything `fwos adopt` shows before it writes, each finding with its source. Read-only. */
  inventory?(root: string, opts?: { app?: string }): Inventory;
  /** The comparison gallery: renders original and adopted components side by side in the real app. */
  gallery?: GalleryAdapter;
  checks: Check[];
  tools: ToolRequirement[];
}

export interface AdapterSet {
  profiles: PlatformProfile[];
  get(platform: Platform): PlatformProfile | undefined;
}

export function adapterSet(profiles: PlatformProfile[]): AdapterSet {
  return { profiles, get: (p) => profiles.find((x) => x.platform === p) };
}
