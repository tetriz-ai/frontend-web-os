// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Adopt mode on web: reads an existing Next.js app before fwos writes anything. The layout says
// where the checks look; the inventory is what `fwos adopt` shows, area by area. Read-only, and
// every value names the file it came from. What it can't find, it says, and the checks that need
// it stay OFF rather than guess.

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AppCandidate, InferredLayout, Inventory, InventoryArea, LayoutFinding, RepoFinding, RepoUnknown } from '../../kernel/index.ts';
import { DEFAULT_PATHS, branchConvention, isDir, isFile, readJson, readText, readWorkflow, walkFiles } from '../../kernel/index.ts';

type Deps = Record<string, string>;
type Pkg = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Deps;
  devDependencies?: Deps;
  workspaces?: string[] | { packages?: string[] };
  packageManager?: string;
  [key: string]: unknown;
};

/** Folders that hold app source in common Next.js layouts. */
const SOURCE_DIRS = ['app', 'pages', 'src', 'components', 'lib', 'hooks', 'utils', 'features', 'styles'];
/** Files at the app root that are app source too. */
const SOURCE_FILES = ['middleware.ts', 'middleware.js', 'instrumentation.ts'];
/** Where UI components usually live when components.json doesn't say. */
const UI_GUESSES = ['components/ui', 'src/components/ui', 'src/shared/ui'];

/** A path under `dir`, which is `.` for the root. */
const at = (dir: string, rel: string) => (dir === '.' ? rel : posix.join(dir, rel));
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
/** Up to three paths, for a finding that counts files. */
const some = (paths: string[]) => (paths.length > 3 ? `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more` : paths.join(', '));

function readPkg(root: string, dir: string): Pkg | null {
  try {
    return readJson<Pkg>(join(root, dir, 'package.json'));
  } catch {
    return null; // a package.json that doesn't parse adopts nothing
  }
}

function walkDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** A folder named on the command line, as the inventory names it: `apps/site`, or `.` for the root. */
export function normalizeDir(dir: string): string {
  const clean = posix.normalize(dir.replace(/\\/g, '/')).replace(/^\.\/|\/$/g, '');
  return clean === '' ? '.' : clean;
}

// ---- the workspace ------------------------------------------------------------------------------

interface Workspace {
  label: string;
  globs: string[];
  from: string;
}

/** The workspace the repo declares: pnpm-workspace.yaml, or package.json `workspaces`. */
function workspace(root: string): Workspace | null {
  const yaml = readText(join(root, 'pnpm-workspace.yaml'));
  if (yaml !== null) {
    try {
      const packages = (parseYaml(yaml) as { packages?: unknown } | null)?.packages;
      const globs = Array.isArray(packages) ? packages.filter((g): g is string => typeof g === 'string') : [];
      if (globs.length > 0) return { label: 'pnpm workspace', globs, from: 'pnpm-workspace.yaml' };
    } catch {
      // unreadable: fall through to package.json
    }
  }
  const ws = readPkg(root, '.')?.workspaces;
  const globs = (Array.isArray(ws) ? ws : ws?.packages ?? []).filter((g): g is string => typeof g === 'string');
  return globs.length > 0 ? { label: 'workspace', globs, from: 'package.json workspaces' } : null;
}

/** The workspace's packages: folders with a package.json its globs match (apps/* and packages/* without one). */
function members(root: string, ws: Workspace | null): string[] {
  const out = new Set<string>();
  for (const glob of ws?.globs ?? ['apps/*', 'packages/*']) {
    if (glob.startsWith('!')) continue;
    const clean = glob.replace(/^\.\//, '').replace(/\/$/, '');
    const parent = /^(.*?)\/\*\*?$/.exec(clean)?.[1];
    if (parent !== undefined) {
      for (const d of walkDirs(join(root, parent))) if (isFile(join(root, parent, d, 'package.json'))) out.add(posix.join(parent, d));
    } else if (!/[*?{[]/.test(clean) && isFile(join(root, clean, 'package.json'))) out.add(clean);
  }
  return [...out].sort();
}

/** Frameworks an app's package.json can depend on, first match wins: Remix before the Vite it uses. */
const FRAMEWORKS: [RegExp, string][] = [
  [/^next$/, 'Next.js'],
  [/^@remix-run\/(?:react|node|dev)$/, 'Remix'],
  [/^@react-router\/dev$/, 'React Router'],
  [/^astro$/, 'Astro'],
  [/^nuxt$/, 'Nuxt'],
  [/^@sveltejs\/kit$/, 'SvelteKit'],
  [/^@angular\/core$/, 'Angular'],
  [/^gatsby$/, 'Gatsby'],
  [/^expo$/, 'Expo'],
  [/^react-native$/, 'React Native'],
  [/^@docusaurus\/core$/, 'Docusaurus'],
  [/^react-scripts$/, 'Create React App'],
  [/^electron$/, 'Electron'],
  [/^vite$/, 'Vite'],
];

function frameworkOf(root: string, dir: string): AppCandidate | null {
  const pkg = readPkg(root, dir);
  if (!pkg) return null;
  for (const [re, framework] of FRAMEWORKS) {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const dep = Object.keys(pkg[field] ?? {}).find((d) => re.test(d));
      if (dep) return { dir, framework, from: `${at(dir, 'package.json')} ${field}.${dep}`, supported: framework === 'Next.js' };
    }
  }
  return null;
}

/** Every app in the repo: the root package and each workspace package that depends on a framework. */
function appsIn(root: string, ws: Workspace | null): AppCandidate[] {
  return ['.', ...members(root, ws)].map((d) => frameworkOf(root, d)).filter((a): a is AppCandidate => a !== null);
}

/** The workspace packages `app` uses, directly or through another, each with the dependency that pulls it in. */
function usedPackages(root: string, app: string, ws: Workspace | null): { dir: string; via: string }[] {
  const byName = new Map<string, string>();
  for (const m of members(root, ws)) {
    const name = readPkg(root, m)?.name;
    if (name) byName.set(name, m);
  }
  const out: { dir: string; via: string }[] = [];
  const seen = new Set([app]);
  const queue = [app];
  while (queue.length > 0) {
    const from = queue.shift()!;
    const pkg = readPkg(root, from);
    for (const dep of Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }).sort()) {
      const dir = byName.get(dep);
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      queue.push(dir);
      out.push({ dir, via: `${at(from, 'package.json')} depends on ${dep}` });
    }
  }
  return out;
}

// ---- the layout ---------------------------------------------------------------------------------

/** shadcn's components.json names the UI alias (`@/components/ui`); map it to a folder that exists. */
function uiFromShadcn(root: string, app: string): LayoutFinding | null {
  let cfg: { aliases?: { ui?: string; components?: string } } | null = null;
  try {
    cfg = readJson(join(root, app, 'components.json'));
  } catch {
    return null;
  }
  const alias = cfg?.aliases?.ui ?? (cfg?.aliases?.components ? `${cfg.aliases.components}/ui` : undefined);
  if (!alias) return null;
  const rest = alias.replace(/^[@~#]\/?/, '');
  for (const dir of [posix.join(app, rest), posix.join(app, 'src', rest)]) {
    if (isDir(join(root, dir))) return { what: 'UI components', value: dir, from: `${at(app, 'components.json')} aliases.ui (${alias})` };
  }
  return null;
}

const NOT_FOUND = 'a Next.js app (no package.json that depends on next, at the root or in apps/*)';

/**
 * The paths to record for the Next.js app at `opts.app`, or the first one found (the root, then the
 * workspace). Source is the app's own folders plus the workspace packages it uses; every other
 * workspace package is skipped by every check, so another team's app is never checked or gated.
 */
export function inferLayout(root: string, opts: { app?: string } = {}): InferredLayout {
  const ws = workspace(root);
  const app = opts.app !== undefined ? normalizeDir(opts.app) : (appsIn(root, ws).find((a) => a.supported)?.dir ?? null);
  if (app === null || frameworkOf(root, app)?.framework !== 'Next.js') return { paths: {}, found: [], missing: [NOT_FOUND] };
  const found: LayoutFinding[] = [{ what: 'web app', value: app, from: `${at(app, 'package.json')} depends on next` }];
  const missing: string[] = [];

  const own = [...SOURCE_DIRS.filter((d) => isDir(join(root, at(app, d)))).map((d) => `${at(app, d)}/**`), ...SOURCE_FILES.filter((f) => isFile(join(root, at(app, f)))).map((f) => at(app, f))];
  if (own.length > 0) found.push({ what: 'app source', value: own.join(', '), from: 'the folders that exist' });
  else missing.push(`app source (none of ${SOURCE_DIRS.join(', ')} in ${app})`);

  const used = usedPackages(root, app, ws);
  const packages = used.map((u) => {
    const glob = isDir(join(root, u.dir, 'src')) ? `${u.dir}/src/**` : `${u.dir}/**`;
    found.push({ what: 'workspace package', value: glob, from: u.via });
    return glob;
  });
  const source = [...own, ...packages];

  // Every other workspace package, unless it sits inside the app's own folder.
  const others = members(root, ws).filter((m) => m !== app && !used.some((u) => u.dir === m) && (app === '.' || !m.startsWith(`${app}/`)));
  const skipped = others.map((m) => `${m}/**`);
  if (skipped.length > 0) found.push({ what: 'skipped', value: skipped.join(', '), from: `${ws ? `${ws.from} members` : 'the folders in apps/ and packages/'} ${app === '.' ? 'the app' : app} does not use` });

  const ui =
    uiFromShadcn(root, app) ??
    UI_GUESSES.map((d) => at(app, d))
      .filter((d) => isDir(join(root, d)))
      .map((d): LayoutFinding => ({ what: 'UI components', value: d, from: 'the folder exists' }))[0] ??
    null;
  if (ui) found.push(ui);
  else missing.push(`a UI components folder (none of ${UI_GUESSES.join(', ')})`);

  return {
    paths: {
      apps: { web: app },
      ...(source.length > 0 ? { source } : {}),
      ...(ui ? { ui: { web: ui.value } } : {}),
      ...(skipped.length > 0 ? { ignore: [...DEFAULT_PATHS.ignore, ...skipped] } : {}),
    },
    found,
    missing,
  };
}

// ---- the inventory ------------------------------------------------------------------------------

/** Dependencies that say something about an area, each with the label it's shown under. */
const SIGNALS: [InventoryArea, RegExp, string][] = [
  ['components', /^(?:@radix-ui\/|radix-ui$)/, 'Radix UI'],
  ['components', /^@mui\/material$/, 'Material UI'],
  ['components', /^@chakra-ui\/react$/, 'Chakra UI'],
  ['components', /^antd$/, 'Ant Design'],
  ['components', /^@mantine\/core$/, 'Mantine'],
  ['components', /^@headlessui\/react$/, 'Headless UI'],
  ['components', /^react-aria-components$/, 'React Aria Components'],
  ['components', /^(?:@heroui\/react|@nextui-org\/react)$/, 'HeroUI'],
  ['components', /^daisyui$/, 'daisyUI'],
  ['theme', /^next-themes$/, 'next-themes (theme switching)'],
  ['theme', /^(?:styled-components|@emotion\/react|@emotion\/styled)$/, 'CSS-in-JS'],
  ['data', /^drizzle-orm$/, 'Drizzle ORM'],
  ['data', /^@prisma\/client$/, 'Prisma'],
  ['data', /^@tanstack\/react-query$/, 'TanStack Query'],
  ['data', /^swr$/, 'SWR'],
  ['data', /^@apollo\/client$/, 'Apollo Client'],
  ['data', /^@trpc\//, 'tRPC'],
  ['data', /^@supabase\/supabase-js$/, 'Supabase'],
  ['data', /^firebase$/, 'Firebase'],
  ['data', /^mongoose$/, 'Mongoose'],
  ['data', /^kysely$/, 'Kysely'],
  ['auth', /^(?:next-auth|@auth\/core)$/, 'Auth.js (NextAuth)'],
  ['auth', /^@clerk\/nextjs$/, 'Clerk'],
  ['auth', /^@supabase\/(?:ssr|auth-helpers-nextjs)$/, 'Supabase Auth'],
  ['auth', /^better-auth$/, 'Better Auth'],
  ['auth', /^lucia$/, 'Lucia'],
  ['auth', /^iron-session$/, 'iron-session'],
  ['auth', /^@kinde-oss\/kinde-auth-nextjs$/, 'Kinde'],
  ['auth', /^@workos-inc\/authkit-nextjs$/, 'WorkOS AuthKit'],
  ['auth', /^(?:jose|jsonwebtoken)$/, 'signed session tokens (JWT)'],
  ['flags', /^(?:@vercel\/flags|flags)$/, 'Vercel Flags'],
  ['flags', /^(?:launchdarkly-react-client-sdk|@launchdarkly\/)/, 'LaunchDarkly'],
  ['flags', /^(?:flagsmith|@flagsmith\/)/, 'Flagsmith'],
  ['flags', /^@growthbook\//, 'GrowthBook'],
  ['flags', /^posthog-js$/, 'PostHog (feature flags)'],
  ['flags', /^(?:@statsig\/|statsig-)/, 'Statsig'],
  ['flags', /^(?:@unleash\/|unleash-)/, 'Unleash'],
  ['flags', /^@openfeature\//, 'OpenFeature'],
  ['flags', /^configcat-/, 'ConfigCat'],
  ['tests', /^@testing-library\//, 'Testing Library'],
  ['tests', /^mocha$/, 'Mocha'],
  ['tests', /^ava$/, 'AVA'],
  ['tests', /^jasmine$/, 'Jasmine'],
  ['tests', /^@storybook\//, 'Storybook'],
];

/** Test runners by their config file, and the dependency that stands in when there's no config. */
const RUNNERS: [string, string, string][] = [
  ['Vitest', 'vitest.config.{ts,mts,js,mjs,cjs}', 'vitest'],
  ['Jest', 'jest.config.{ts,js,mjs,cjs,json}', 'jest'],
  ['Playwright', 'playwright.config.{ts,js,mjs}', '@playwright/test'],
  ['Cypress', 'cypress.config.{ts,js,mjs}', 'cypress'],
];

/** Repo files that say something about an area, each with its label. */
const FILES: [InventoryArea, string, string][] = [
  ['ci', '.gitlab-ci.yml', 'GitLab CI'],
  ['ci', '.circleci/config.yml', 'CircleCI'],
  ['ci', 'azure-pipelines.yml', 'Azure Pipelines'],
  ['ci', 'Jenkinsfile', 'Jenkins'],
  ['ci', 'bitbucket-pipelines.yml', 'Bitbucket Pipelines'],
  ['ci', '.buildkite/pipeline.yml', 'Buildkite'],
  ['hooks', 'lefthook.{yml,yaml}', 'lefthook'],
  ['hooks', '.pre-commit-config.yaml', 'pre-commit'],
  ['hooks', '.lintstagedrc{,.json,.js,.cjs,.mjs,.yml,.yaml}', 'lint-staged'],
  ['lint', 'eslint.config.{js,mjs,cjs,ts,mts}', 'ESLint'],
  ['lint', '.eslintrc{,.js,.cjs,.json,.yml,.yaml}', 'ESLint'],
  ['lint', '.prettierrc{,.json,.yml,.yaml,.js,.cjs,.mjs}', 'Prettier'],
  ['lint', 'prettier.config.{js,cjs,mjs,ts}', 'Prettier'],
  ['lint', 'biome.{json,jsonc}', 'Biome'],
  ['lint', '.stylelintrc{,.json,.js,.cjs,.yml,.yaml}', 'Stylelint'],
  ['lint', '.oxlintrc.json', 'oxlint'],
  ['lint', '.editorconfig', 'EditorConfig'],
  ['guidance', 'AGENTS.md', 'agent instructions'],
  ['guidance', 'CLAUDE.md', 'agent instructions'],
  ['guidance', '.claude/CLAUDE.md', 'agent instructions'],
  ['guidance', 'GEMINI.md', 'agent instructions'],
  ['guidance', '.cursorrules', 'Cursor rules'],
  ['guidance', '.cursor/rules/*', 'Cursor rules'],
  ['guidance', '.github/copilot-instructions.md', 'Copilot instructions'],
  ['guidance', '.windsurfrules', 'Windsurf rules'],
  ['guidance', 'CONTRIBUTING.md', 'contributing guide'],
  ['docs', 'README.md', 'README'],
  ['docs', 'CHANGELOG.md', 'changelog'],
  ['docs', '.github/ISSUE_TEMPLATE/*', 'issue template'],
  ['review', '{.github/,docs/,}{pull_request_template,PULL_REQUEST_TEMPLATE}.md', 'pull request template'],
  ['review', '{.github/,docs/,}CODEOWNERS', 'code owners'],
];

const LOCKFILES: [string, string][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['package-lock.json', 'npm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

/** What each area looked for, said when it found nothing. */
const LOOKED: Partial<Record<InventoryArea, [string, string]>> = {
  routes: ['routes', 'an app/ or pages/ folder'],
  components: ['UI components', 'components.json, components/ui, src/components/ui, src/shared/ui, and libraries such as Radix UI, MUI and Chakra'],
  theme: ['theme', 'CSS variables in globals.css, a Tailwind config and next-themes'],
  data: ['data layer', 'Drizzle, Prisma, SWR, TanStack Query, Apollo, tRPC, server actions and OpenAPI files'],
  auth: ['auth', 'Auth.js, Clerk, Supabase Auth, Better Auth, Lucia, iron-session, JWT libraries, auth code and role fields'],
  flags: ['feature flags', 'Vercel Flags, LaunchDarkly, Flagsmith, GrowthBook, PostHog, Statsig, Unleash, OpenFeature, ConfigCat and FEATURE_ variables in .env.example'],
  tests: ['tests', 'Vitest, Jest, Playwright, Cypress, Mocha, Testing Library and *.test.* or *.spec.* files'],
  ci: ['CI', 'GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Jenkins, Bitbucket Pipelines and Buildkite'],
  hooks: ['git hooks', 'husky, lefthook, pre-commit, simple-git-hooks, lint-staged and .git/hooks/pre-commit'],
  guidance: ['agent guidance', 'AGENTS.md, CLAUDE.md, GEMINI.md, Cursor, Copilot and Windsurf rules and CONTRIBUTING.md'],
  docs: ['docs', 'README.md, docs/, decision records and product or design docs'],
  review: ['review workflow', 'a pull request template, CODEOWNERS and how git branches are named'],
};
const APP_AREAS: InventoryArea[] = ['routes', 'components', 'theme', 'data', 'auth', 'flags', 'tests'];
const REPO_AREAS: InventoryArea[] = ['ci', 'hooks', 'guidance', 'docs', 'review'];

/** A dependency's declared version and where it's declared: the app's package.json first, then the root's. */
function depOf(pkgs: [string, Pkg][], name: RegExp | string): { dep: string; version: string; from: string } | null {
  for (const [dir, pkg] of pkgs) {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      const dep = Object.keys(pkg[field] ?? {}).find((d) => (typeof name === 'string' ? d === name : name.test(d)));
      if (dep) return { dep, version: pkg[field]![dep]!, from: `${at(dir, 'package.json')} ${field}.${dep}` };
    }
  }
  return null;
}

/** The repository's pre-commit hook in git's own hooks folder, when one is there that isn't a sample. */
function gitPreCommit(root: string): string | null {
  try {
    const dir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const hook = join(resolve(root, dir), 'pre-commit');
    if (!isFile(hook)) return null;
    const rel = relative(root, hook);
    return rel.startsWith('..') || isAbsolute(rel) ? hook : rel.split('\\').join('/');
  } catch {
    return null;
  }
}

/**
 * Everything `fwos adopt` shows before it proposes anything: the apps in the repo, the one it would
 * adopt (`opts.app`, else the only Next.js app), and that app's stack, routes, components, theme,
 * data, auth, flags and tests, then the repo's scripts, CI, hooks, lint, agent guidance and docs.
 * Each finding cites its file; an area with nothing is listed as unknown, with what was looked for.
 */
export function inventory(root: string, opts: { app?: string } = {}): Inventory {
  const ws = workspace(root);
  const apps = appsIn(root, ws);
  const next = apps.filter((a) => a.supported);
  const wanted = opts.app === undefined ? undefined : normalizeDir(opts.app);
  const app = wanted !== undefined ? (next.some((a) => a.dir === wanted) ? wanted : null) : next.length === 1 ? next[0]!.dir : null;
  const findings: RepoFinding[] = [];
  const add = (area: InventoryArea, what: string, from: string) => findings.push({ area, what, from });
  const has = (glob: string, dir = '.') => walkFiles(join(root, dir), { include: [glob] }).map((f) => at(dir, f));

  if (ws) add('workspace', `${ws.label}: ${ws.globs.join(', ')}`, ws.from);
  if (apps.length > 1) for (const a of apps) add('workspace', `${a.framework} app at ${a.dir}`, a.from);

  const limits: string[] = [];
  let theme: string | null = null;
  let layout: InferredLayout = { paths: {}, found: [], missing: [NOT_FOUND] };
  if (next.length === 0) {
    const what = apps.length > 0 ? `found ${apps.map((a) => `${a.framework} at ${a.dir} (${a.from})`).join(', ')}` : 'no package.json depends on next, at the root or in the workspace';
    limits.push(`No Next.js app: ${what}. fwos reads Next.js App Router apps, so it sets nothing up here. Start a new Next.js app in a subfolder with /fwos:start, or stop.`);
  }

  if (app !== null) {
    layout = inferLayout(root, { app });
    const pkgs: [string, Pkg][] = [[app, readPkg(root, app) ?? {}], ...(app === '.' ? [] : ([['.', readPkg(root, '.') ?? {}]] as [string, Pkg][]))];
    // The app's own files: its folder, or the whole repo less the packages skipped for it.
    const skipped = layout.paths.ignore ?? [];
    const files = walkFiles(join(root, app)).map((f) => at(app, f)).filter((f) => !skipped.some((s) => f.startsWith(s.replace(/\*\*$/, ''))));

    // framework
    for (const [dep, label] of [['next', 'Next.js'], ['react', 'React'], ['typescript', 'TypeScript'], ['tailwindcss', 'Tailwind CSS']]) {
      const d = depOf(pkgs, dep!);
      if (d) add('framework', `${label} ${d.version}`, d.from);
    }

    // routes
    const appDir = ['app', 'src/app'].map((d) => at(app, d)).find((d) => isDir(join(root, d)));
    const pagesDir = ['pages', 'src/pages'].map((d) => at(app, d)).find((d) => isDir(join(root, d)));
    if (appDir) {
      const routes = files.filter((f) => f.startsWith(`${appDir}/`));
      const pages = routes.filter((f) => /(?:^|\/)page\.(?:tsx|ts|jsx|js|mdx)$/.test(f)).length;
      const layouts = routes.filter((f) => /(?:^|\/)layout\.(?:tsx|ts|jsx|js)$/.test(f)).length;
      add('routes', `App Router: ${count(pages, 'page')}, ${count(layouts, 'layout')}`, `${appDir}/`);
      const handlers = routes.filter((f) => /(?:^|\/)route\.(?:ts|js)$/.test(f));
      if (handlers.length > 0) add('routes', count(handlers.length, 'API route handler'), some(handlers));
    }
    if (pagesDir) add('routes', 'Pages Router', `${pagesDir}/`);
    for (const f of ['middleware.ts', 'middleware.js', 'proxy.ts', 'proxy.js', 'src/middleware.ts', 'src/proxy.ts']) {
      if (isFile(join(root, at(app, f)))) add('routes', f.includes('proxy') ? 'proxy' : 'middleware', at(app, f));
    }

    // components
    let shadcn: { style?: string; tailwind?: { css?: string } } | null = null;
    try {
      shadcn = readJson(join(root, app, 'components.json'));
    } catch {
      // unreadable: reported as no shadcn config
    }
    if (shadcn) add('components', `shadcn/ui${shadcn.style ? ` (${shadcn.style})` : ''}`, at(app, 'components.json'));
    const ui = layout.found.find((f) => f.what === 'UI components');
    if (ui) {
      const n = walkFiles(join(root, ui.value), { include: ['*.{tsx,ts,jsx,js}', '*/*'] })
        .filter((f) => !/(?:^|\/)index\.|\.(?:test|spec|stories)\.|\.d\.ts$/.test(f))
        .map((f) => f.split('/')[0])
        .filter((v, i, all) => all.indexOf(v) === i).length;
      add('components', `${count(n, 'UI component')} in ${ui.value}`, ui.from === 'the folder exists' ? `${ui.value}/` : ui.from);
    }

    // theme
    const css = [shadcn?.tailwind?.css, 'app/globals.css', 'src/app/globals.css', 'styles/globals.css', 'src/styles/globals.css']
      .filter((f): f is string => !!f)
      .map((f) => at(app, f))
      .find((f) => isFile(join(root, f)));
    if (css) {
      const text = readText(join(root, css)) ?? '';
      if (/:root\s*\{[^}]*--[\w-]+\s*:/.test(text)) {
        theme = css;
        add('theme', `CSS variables${/\.dark\s*\{|prefers-color-scheme:\s*dark/.test(text) ? ', with a dark theme' : ''}`, css);
      } else if (/@theme\b/.test(text)) add('theme', 'Tailwind @theme', css);
    }
    for (const f of has('tailwind.config.{js,ts,cjs,mjs}', app)) add('theme', 'Tailwind config', f);

    // data
    for (const [glob, label] of [['drizzle.config.{ts,js,mjs}', 'Drizzle ORM'], ['prisma/schema.prisma', 'Prisma']] as const) {
      for (const f of [...has(glob, app), ...(app === '.' ? [] : has(glob))].slice(0, 1)) add('data', label, f);
    }
    const actions = files.filter((f) => /\.[cm]?[jt]sx?$/.test(f) && /^\s*['"]use server['"]/m.test(readText(join(root, f)) ?? ''));
    if (actions.length > 0) add('data', `${count(actions.length, 'file')} of server actions`, some(actions));
    for (const f of files.filter((f) => /(?:^|\/)(?:openapi|swagger)\.(?:ya?ml|json)$/.test(f))) add('data', 'OpenAPI spec', f);

    // auth
    for (const f of [...has('{auth,auth.config}.{ts,js}', app), ...has('{lib,src/lib}/auth/*', app).slice(0, 1)]) add('auth', 'auth code', f);
    const roles = files.find((f) => /(?:schema|models?)\.(?:ts|js)$|\.prisma$|(?:^|\/)auth\/[^/]+\.(?:ts|js)$/.test(f) && /\brole\b/i.test(readText(join(root, f)) ?? ''));
    if (roles) add('auth', 'a role field', roles);

    // flags
    const env = readText(join(root, '.env.example')) ?? '';
    if (/^(?:NEXT_PUBLIC_)?(?:FEATURE|FF|FLAG)_\w+\s*=/m.test(env)) add('flags', 'FEATURE_ variables', '.env.example');

    // tests
    for (const [label, glob, dep] of RUNNERS) {
      const config = [...has(glob, app), ...(app === '.' ? [] : has(glob))][0];
      const d = depOf(pkgs, dep);
      if (config) {
        add('tests', label, config);
        if (/junit/i.test(readText(join(root, config)) ?? '')) add('tests', `${label} writes JUnit XML`, config);
      } else if (d) add('tests', label, d.from);
    }
    const tests = files.filter((f) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f));
    if (tests.length > 0) add('tests', count(tests.length, 'test file'), some(tests));

    // dependencies that speak for an area, one finding per label
    const shown = new Set(findings.map((f) => `${f.area}:${f.what}`));
    for (const [area, re, label] of SIGNALS) {
      const d = depOf(pkgs, re);
      if (!d || shown.has(`${area}:${label}`)) continue;
      shown.add(`${area}:${label}`);
      add(area, label === 'CSS-in-JS' ? `CSS-in-JS (${d.dep})` : label, d.from);
    }

    // what fwos can only partly do here
    if (!appDir && pagesDir) limits.push(`Pages Router only (${pagesDir}/): screens/ia reads the App Router, so it stays OFF. The other checks run.`);
    const tw = depOf(pkgs, 'tailwindcss');
    if (tw && /^\D*3\./.test(tw.version)) {
      limits.push(`Tailwind CSS 3 (${tw.from}): the token checks read your classes, but \`fwos tokens build\` writes Tailwind 4 CSS, so keep your own theme build.`);
    }
  }

  // the repo: scripts, CI, hooks, lint, guidance, docs, package manager
  for (const [dir, pkg] of [['.', readPkg(root, '.')], ...(app && app !== '.' ? [[app, readPkg(root, app)]] : [])] as [string, Pkg | null][]) {
    for (const [name, command] of Object.entries(pkg?.scripts ?? {})) add('scripts', `${name}: ${command}`, `${at(dir, 'package.json')} scripts.${name}`);
  }
  for (const f of walkFiles(join(root, '.github/workflows'), { include: ['*.{yml,yaml}'] })) {
    const text = readText(join(root, '.github/workflows', f)) ?? '';
    const runsTests = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|e2e)\b|\b(?:vitest|jest|playwright|cypress)\b/.test(text);
    add('ci', `GitHub Actions workflow${runsTests ? ' (runs the tests)' : ''}`, `.github/workflows/${f}`);
  }
  for (const f of walkFiles(join(root, '.husky'), { exclude: ['_/**'] })) add('hooks', `husky ${f} hook`, `.husky/${f}`);
  const rootPkg = readPkg(root, '.');
  for (const key of ['simple-git-hooks', 'lint-staged']) if (rootPkg?.[key] !== undefined) add('hooks', key, `package.json ${key}`);
  const hook = gitPreCommit(root);
  if (hook) add('hooks', 'a pre-commit hook', hook);
  for (const [area, glob, label] of FILES) for (const f of [...has(glob), ...(app && app !== '.' && area === 'guidance' ? has(glob, app) : [])]) add(area, label, f);
  const branches = branchConvention(root);
  if (branches.prefixes.length > 0) {
    const what = branches.prefixes.length === 1 ? `branches named ${branches.prefixes[0]}/<name>` : `branches named <type>/<name> (${branches.prefixes.join(', ')})`;
    add('review', what, `git branches ${some(branches.names)}`);
  }
  const workflow = readWorkflow(root);
  if (rootPkg?.prettier !== undefined) add('lint', 'Prettier', 'package.json prettier');
  for (const dir of ['docs/adr', 'docs/adrs', 'docs/decisions', 'adr', 'decisions']) {
    const n = walkFiles(join(root, dir), { include: ['**/*.{md,mdx}'] }).length;
    if (n > 0) add('docs', count(n, 'decision record'), `${dir}/`);
  }
  for (const f of walkFiles(join(root, 'docs'), { include: ['**/*.{md,mdx}'] }).filter((f) => !/^(?:adrs?|decisions)\//.test(f) && /prd|spec|requirement|design|rfc|product/i.test(f)).slice(0, 5)) {
    add('docs', 'product or design doc', `docs/${f}`);
  }
  const lock = LOCKFILES.find(([f]) => isFile(join(root, f)));
  if (lock) add('package-manager', lock[1], lock[0]);
  else if (typeof rootPkg?.packageManager === 'string') add('package-manager', rootPkg.packageManager.split('@')[0]!, 'package.json packageManager');

  // the order areas print in, then what each area that found nothing looked for
  const order: InventoryArea[] = ['workspace', 'framework', 'routes', 'components', 'theme', 'data', 'auth', 'flags', 'tests', 'scripts', 'ci', 'hooks', 'lint', 'guidance', 'docs', 'review', 'package-manager'];
  findings.sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
  const unknowns: RepoUnknown[] = [...(app !== null ? APP_AREAS : []), ...REPO_AREAS]
    .filter((area) => !findings.some((f) => f.area === area))
    .map((area) => ({ area, what: `no ${LOOKED[area]![0]} found (looked for ${LOOKED[area]![1]})` }));

  return { support: next.length === 0 ? 'unsupported' : limits.length > 0 ? 'partial' : 'supported', limits, apps, app, layout, theme, findings, unknowns, workflow };
}
