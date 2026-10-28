// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Prototype bundles: one feature's handoff, committed in docs/app/prototypes/<id>/. A bundle links
// its visual artifact from any tool (an HTML file, an image, a Figma frame, a Storybook story, an app
// route), its real-component companion, its state inventory, the build spec, the decision record
// when there is one, and the intended ia.json. Promotion pins each input by hash. A bundle that
// leans on a working/ draft, uses a role or flag the pack lacks, repeats an ID, leaves an app route
// unclassified, or changed since it was promoted can't be promoted as it is. The intended IA is then
// compared with the real app: its routes, and what runs of fwos's IA harness showed each role.

import { posix } from 'node:path';
import { type AppScreens, type IaRun, type IaVisit, type Project, type ScreenRef, hashPath, hashText, validateWith } from '../../kernel/index.ts';
import { iaPath, loadIa } from './checks/screens.ts';
import { pageFlags } from './harness.ts';
import { type Flags, type Ia, type IaPage, cover, normRoute, parseIa, reaches, settings, visibleUnder } from './ia.ts';
import schema from './schema/bundle.schema.json' with { type: 'json' };

/** The bundle schema this fwos reads. */
export const BUNDLE_SCHEMA = 1;
/** Where promotions are recorded: the CLI writes it, the edit tools can't. */
export const PROMOTIONS = '.fwos/prototypes.json';

export interface BundleLink {
  kind: string;
  ref: string;
  /** For a companion: the page it renders. */
  page?: string;
}

export interface Bundle {
  schema: 1;
  id: string;
  title: string;
  pages: string[];
  visual: BundleLink[];
  companion: BundleLink[];
  states: string;
  spec: string;
  decision?: string;
  ia: string;
}

export interface BundleFile {
  /** Its bundle.json, from the project root. */
  path: string;
  /** The name of its folder. */
  folder: string;
  bundle: Bundle | null;
  /** Why it isn't a bundle this fwos reads, when it isn't. */
  errors: string[];
}

/** A bundle as it was promoted: who, when, and the hash of each input it rests on. */
export interface Promotion {
  bundle: string;
  at: string;
  by: string;
  /** Path, or path#anchor for a section of a shared doc, to the hash of what it held. */
  inputs: Record<string, string>;
}

export interface BundleCheck {
  id: string;
  path: string;
  /** What stops it being promoted. */
  problems: string[];
  /** What it couldn't look at, and why. */
  notes: string[];
  /** What a promotion pins: each input and the hash of what it holds now. */
  inputs: Record<string, string>;
  promotion: Promotion | null;
  /** The inputs that changed since it was promoted. */
  stale: string[];
}

const VISUAL_KINDS = ['html', 'image', 'figma', 'storybook', 'route', 'url'];
const COMPANION_KINDS = ['route', 'storybook'];
const LOCAL = new Set(['html', 'image']);
const LINKED = new Set(['figma', 'storybook', 'url']);
const DRAFT = "a promoted bundle can't rest on a draft";

export const prototypesDir = (project: Project) => posix.join(project.paths.docs, 'prototypes');

function readBundle(project: Project, path: string): BundleFile {
  const folder = posix.basename(posix.dirname(path));
  let data: unknown;
  try {
    data = JSON.parse(project.read(path) ?? '');
  } catch (e) {
    return { path, folder, bundle: null, errors: [`${path} isn't valid JSON (${(e as Error).message})`] };
  }
  const version = (data as { schema?: unknown } | null)?.schema;
  if (typeof version === 'number' && version !== BUNDLE_SCHEMA) {
    return { path, folder, bundle: null, errors: [`${path} is bundle schema ${version}, and this fwos reads schema ${BUNDLE_SCHEMA}: update fwos`] };
  }
  const errors = validateWith(schema, data);
  if (errors.length > 0) return { path, folder, bundle: null, errors: errors.map((e) => `${path}: ${e}`) };
  return { path, folder, bundle: data as Bundle, errors: [] };
}

/** Every bundle in the project: docs/app/prototypes/<id>/bundle.json. */
export function listBundles(project: Project): BundleFile[] {
  return project.files([`${prototypesDir(project)}/*/bundle.json`]).sort().map((path) => readBundle(project, path));
}

/** A path and its anchor: `docs/app/spec.md#members` as both. */
const split = (ref: string) => {
  const at = ref.indexOf('#');
  return at < 0 ? { file: ref, anchor: null } : { file: ref.slice(0, at), anchor: ref.slice(at + 1) };
};
const isUrl = (ref: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(ref);
/** Whether a path, or a URL's path, goes through a working/ folder. */
const inWorking = (ref: string) => (isUrl(ref) ? safePath(ref) : split(ref).file).split('/').includes('working');
const safePath = (url: string) => {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
};

/** A heading's anchor, as GitHub writes it: `## Members and reports` is `members-and-reports`. */
export const slugOf = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** The section under the heading `anchor` names, or the table row that starts with it (a decision's ID). Null when neither is there. */
export function excerpt(text: string, anchor: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  for (const [i, line] of lines.entries()) {
    const m = heading.exec(line);
    if (!m || slugOf(m[2]!) !== anchor.toLowerCase()) continue;
    const level = m[1]!.length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const n = heading.exec(lines[j]!);
      if (n && n[1]!.length <= level) {
        end = j;
        break;
      }
    }
    return `${lines.slice(i, end).join('\n').replace(/\n+$/, '')}\n`;
  }
  const row = lines.find((l) => new RegExp(`^\\|\\s*${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\|`, 'i').test(l));
  return row === undefined ? null : `${row}\n`;
}

/** The links in a Markdown or HTML file: Markdown links and images, and href and src attributes. */
function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push(m[1]!);
  for (const m of text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) out.push(m[1]!);
  return out;
}

export interface StateSection {
  page: string;
  states: { state: string; shows: string }[];
}

/** The state inventory: a `## <page>` section per page, and a `- <state>: what it shows` line per state. */
export function parseStates(text: string): { sections: StateSection[] } {
  const sections: StateSection[] = [];
  let current: StateSection | null = null;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      current = { page: h[1]!.replace(/`/g, '').trim(), states: [] };
      sections.push(current);
      continue;
    }
    if (/^#\s/.test(line) || /^#{3,}\s/.test(line)) continue;
    const item = /^\s*[-*]\s+`?([^`:]+?)`?\s*:\s*(.*)$/.exec(line);
    if (item && current) current.states.push({ state: item[1]!.trim(), shows: item[2]!.trim() });
  }
  return { sections };
}

/** What `ref` holds now, hashed: a file, a folder, or the section `#anchor` names. Null when it isn't there. */
function pin(project: Project, ref: string): string | null {
  const { file, anchor } = split(ref);
  if (!anchor) return hashPath(project.abs(file));
  const text = project.read(file);
  const part = text === null ? null : excerpt(text, anchor);
  return part === null ? null : hashText(part);
}

/** The app route a page of the intended IA is at: the one that declares its ID, else the one at its route that declares no other. */
function appRouteOf(p: IaPage, routes: ScreenRef[]): ScreenRef | undefined {
  return routes.find((r) => r.id === p.id) ?? routes.find((r) => (!r.id || r.id === p.id) && normRoute(r.route) === normRoute(p.route!));
}

const routed = (ia: Ia) => ia.pages.filter((p) => (p.surface ?? 'route') === 'route' && !!p.route);

/**
 * What stops a bundle being promoted, and what a promotion of it would pin. `app` is the real app as
 * the platform's screen adapter reads it (null before there is one), `bundles` every bundle in the
 * project, and `promotions` the promotions on record, by bundle ID.
 */
export function checkBundle(project: Project, file: BundleFile, ctx: { app: AppScreens | null; bundles: BundleFile[]; promotions: Record<string, Promotion> }): BundleCheck {
  const out: BundleCheck = { id: file.bundle?.id ?? file.folder, path: file.path, problems: [], notes: [], inputs: {}, promotion: null, stale: [] };
  const b = file.bundle;
  if (!b) return { ...out, problems: file.errors };
  const problems = out.problems;
  const exists = (ref: string) => project.exists(split(ref).file);
  out.inputs[file.path] = hashText(project.read(file.path) ?? '');
  if (b.id !== file.folder) problems.push(`bundle id "${b.id}" isn't its folder's name (${file.folder}): one folder per feature`);
  if (ctx.bundles.some((o) => o.path !== file.path && o.bundle?.id === b.id)) problems.push(`bundle id "${b.id}" is used by another bundle too`);

  // A local file a link names: missing, or in a draft folder, is a problem; else it is pinned and its own links are read.
  const scan: string[] = [];
  const local = (what: string, ref: string, read = false) => {
    if (inWorking(ref)) return problems.push(`${what} ${ref} is in working/: ${DRAFT}`);
    if (!exists(ref)) return problems.push(`${what} ${ref} doesn't exist`);
    out.inputs[ref] = pin(project, ref) ?? '';
    if (read) scan.push(split(ref).file);
  };

  if (b.visual.length === 0) problems.push('no visual artifact: link the prototype it came from (html, image, figma, storybook, route or url)');
  for (const v of b.visual) {
    if (!VISUAL_KINDS.includes(v.kind)) problems.push(`visual kind "${v.kind}" isn't one fwos knows: ${VISUAL_KINDS.slice(0, -1).join(', ')} or ${VISUAL_KINDS.at(-1)}`);
    else if (LOCAL.has(v.kind)) local('visual', v.ref, v.kind === 'html');
    else if (inWorking(v.ref)) problems.push(`visual ${v.ref} is in working/: ${DRAFT}`);
    else if (LINKED.has(v.kind) && !/^https:\/\//.test(v.ref)) problems.push(`visual ${v.kind} ${v.ref} isn't an https link`);
    else if (v.kind === 'route' && !v.ref.startsWith('/')) problems.push(`visual route ${v.ref} isn't a path in the app (it starts with /)`);
  }
  for (const c of b.companion) {
    if (!COMPANION_KINDS.includes(c.kind)) problems.push(`companion kind "${c.kind}" isn't one fwos knows: route or storybook`);
    else if (inWorking(c.ref)) problems.push(`companion ${c.ref} is in working/: ${DRAFT}`);
    else if (c.kind === 'route' && !c.ref.startsWith('/')) problems.push(`companion route ${c.ref} isn't a path in the app (it starts with /)`);
    if (!c.page) problems.push(`companion ${c.ref} doesn't name the page it renders`);
    else if (!b.pages.includes(c.page)) problems.push(`companion ${c.ref} renders "${c.page}", which isn't one of the bundle's pages (${b.pages.join(', ')})`);
  }
  for (const page of b.pages) {
    if (!b.companion.some((c) => c.page === page && COMPANION_KINDS.includes(c.kind))) {
      problems.push(`${page} has no real-component companion: a route in the app (the screens browser's /fwos-screens/${page}) or a Storybook story that renders it from registered components`);
    }
  }

  // The intended IA: valid, with the pack's roles and flags, holding every page the bundle covers.
  let ia: Ia | null = null;
  const iaName = posix.basename(split(b.ia).file);
  if (inWorking(b.ia)) problems.push(`ia ${b.ia} is in working/: ${DRAFT}`);
  else if (!exists(b.ia)) problems.push(`ia ${b.ia} doesn't exist`);
  else {
    out.inputs[b.ia] = pin(project, b.ia) ?? '';
    const parsed = parseIa(project.read(split(b.ia).file) ?? '');
    for (const e of parsed.errors) problems.push(`${iaName}: ${e}`);
    ia = parsed.ia;
    const pack = loadIa(project);
    if (ia && pack?.ia && pack.path !== split(b.ia).file) {
      for (const role of ia.roles.filter((r) => !pack.ia!.roles.includes(r))) {
        problems.push(`${iaName} declares role "${role}", which ${iaPath(project)} doesn't: add it there first, or use one it has`);
      }
      for (const flag of (ia.flags ?? []).filter((f) => !(pack.ia!.flags ?? []).includes(f))) {
        problems.push(`${iaName} declares flag "${flag}", which ${iaPath(project)} doesn't: add it there first, or use one it has`);
      }
    } else if (ia && !pack?.ia) out.notes.push(`no valid ${iaPath(project)}, so the roles and flags aren't checked against the pack`);
    if (ia) for (const page of b.pages.filter((x) => !ia!.pages.some((p) => p.id === x))) problems.push(`page "${page}" isn't in the bundle's ${iaName}`);
  }

  // The state inventory: a section per page the bundle covers, each listing exactly that page's states.
  const statesName = posix.basename(split(b.states).file);
  if (inWorking(b.states)) problems.push(`states ${b.states} is in working/: ${DRAFT}`);
  else if (!exists(b.states)) problems.push(`states ${b.states} doesn't exist`);
  else {
    out.inputs[b.states] = pin(project, b.states) ?? '';
    scan.push(split(b.states).file);
    const { sections } = parseStates(project.read(split(b.states).file) ?? '');
    const seen = new Set<string>();
    for (const s of sections) {
      if (seen.has(s.page)) problems.push(`${statesName}: ${s.page} has two sections`);
      seen.add(s.page);
      if (!b.pages.includes(s.page)) {
        problems.push(`${statesName}: ${s.page} isn't one of the bundle's pages (${b.pages.join(', ')})`);
        continue;
      }
      const names = s.states.map((x) => x.state);
      for (const [i, n] of names.entries()) if (names.indexOf(n) !== i) problems.push(`${statesName}: ${s.page} lists "${n}" twice`);
      const want = ia?.pages.find((p) => p.id === s.page)?.states;
      if (want) {
        for (const n of [...new Set(names)].filter((x) => !want.includes(x))) problems.push(`${statesName}: ${s.page} lists "${n}", which the bundle's ${iaName} doesn't give it`);
        for (const n of want.filter((x) => !names.includes(x))) problems.push(`${statesName}: ${s.page} doesn't list "${n}", which the bundle's ${iaName} gives it`);
      }
      for (const x of s.states.filter((y) => y.shows === '')) problems.push(`${statesName}: ${s.page} "${x.state}" says nothing about what it shows`);
    }
    for (const page of b.pages.filter((x) => !seen.has(x))) problems.push(`${statesName}: ${page} has no section (## ${page}, then a line per state: - <state>: what it shows)`);
  }

  // The build spec and the decision record: each file there, and the section or row its anchor names.
  for (const [what, ref] of [['spec', b.spec], ['decision', b.decision]] as const) {
    if (!ref) continue;
    if (inWorking(ref)) {
      problems.push(`${what} ${ref} is in working/: ${DRAFT}`);
      continue;
    }
    if (!exists(ref)) {
      problems.push(`${what} ${ref} doesn't exist`);
      continue;
    }
    const value = pin(project, ref);
    const { anchor } = split(ref);
    if (value === null) problems.push(`${what} ${ref}: no heading there is "${anchor}"${what === 'decision' ? ', and no decision row either' : ''}`);
    else out.inputs[ref] = value;
  }

  // The bundle's own pages may not lean on a draft either.
  for (const f of scan) {
    for (const link of linksIn(project.read(f) ?? '')) {
      if (isUrl(link) ? !inWorking(link) : !posix.normalize(posix.join(posix.dirname(f), link)).split('/').includes('working')) continue;
      problems.push(`${posix.basename(f)} links into working/ (${link}): ${DRAFT}`);
    }
  }

  // Every route the app has is in the intended IA: reachable, a redirect, or unlinked on purpose.
  if (!ctx.app) out.notes.push('no app yet, so no route of it is classified');
  else if (ia) {
    const pages = routed(ia);
    for (const r of ctx.app.screens.filter((s) => !s.devOnly)) {
      if (!pages.some((p) => p.id === r.id || normRoute(p.route!) === normRoute(r.route))) {
        problems.push(`the app's route ${r.route} (${r.file}) isn't in the bundle's ${iaName}: list it as a nav, drill-down or redirect page, or mark it unlinked with a reason`);
      }
    }
  }

  const promotion = ctx.promotions[b.id] ?? null;
  out.promotion = promotion;
  if (promotion) {
    const when = `${promotion.by} promoted it on ${promotion.at.slice(0, 10)}`;
    for (const [ref, was] of Object.entries(promotion.inputs)) if (pin(project, ref) !== was) out.stale.push(`${ref} changed since ${when}`);
    for (const ref of Object.keys(out.inputs).filter((r) => !(r in promotion.inputs))) out.stale.push(`${ref} wasn't an input when ${when}`);
  }
  return out;
}

// ---- the intended IA against the real app ------------------------------------------------------

/** The real app: its routes as the screen adapter reads them, and fresh runs of fwos's IA harness. */
export interface AppIa {
  routes: ScreenRef[];
  runs: IaRun[];
}

export type AppChangeKind = 'added' | 'moved' | 'hidden' | 'exposed' | 'nav' | 'unclassified';

export interface AppChange {
  kind: AppChangeKind;
  /** The page, for every kind but unclassified. */
  id?: string;
  /** The app's route, for unclassified. */
  route?: string;
  /** The role it happens to, when it isn't every role. */
  role?: string;
  /** The flag settings it happens under, when it isn't all of them. */
  when?: Flags;
  detail: string;
}

export interface AppDiff {
  changes: AppChange[];
  /** What no run covered, and so isn't compared. */
  notCompared: string[];
}

const ORDER: AppChangeKind[] = ['added', 'moved', 'hidden', 'exposed', 'nav', 'unclassified'];

const opened = (v: IaVisit) => !v.error && v.status > 0 && v.status < 400 && !v.notFound;

/** `admin (members-enabled on)`: a role with the flags the intent varies. */
const named = (role: string, s: Flags, flags: string[]) => (flags.length === 0 ? role : `${role} (${flags.map((f) => `${f} ${s[f] ? 'on' : 'off'}`).join(', ')})`);

/** What a difference says, for whom: each kind of difference a run can show, from the bundle's side. */
const SAYS: Record<string, { kind: AppChangeKind; text: (who: string) => string }> = {
  hidden: { kind: 'hidden', text: (who) => `the bundle hides it from ${who}; the app lets ${who} open it` },
  exposed: { kind: 'exposed', text: (who) => `the bundle shows it to ${who}; the app doesn't let ${who} open it` },
  'nav-missing': { kind: 'nav', text: (who) => `the bundle puts it in the nav for ${who}; the app's nav doesn't link it` },
  'nav-extra': { kind: 'nav', text: (who) => `the app's nav links it for ${who}; the bundle doesn't put it in the nav` },
  'nav-dead': { kind: 'nav', text: (who) => `the app's nav shows ${who} a link to it, though neither the bundle nor the app lets ${who} open it` },
};

/**
 * The intended IA against the real app, by stable page ID: a page the app lacks (added), at another
 * route (moved), shown to a role the intent hides it from (hidden) or hidden from one it shows it to
 * (exposed), a nav that differs, and an app route the intent doesn't classify. Who sees what comes
 * from runs of the IA harness, so a role and flag setting no run covered is named as not compared.
 */
export function compareWithApp(intended: Ia, app: AppIa): AppDiff {
  const routes = app.routes.filter((r) => !r.devOnly);
  const pages = routed(intended);
  const changes: AppChange[] = [];
  const notCompared: string[] = [];
  const at = new Map<string, ScreenRef>();
  for (const p of pages.filter((x) => x.kind !== 'redirect')) {
    const r = appRouteOf(p, routes);
    if (!r) {
      changes.push({ kind: 'added', id: p.id, detail: `${p.title} at ${p.route} (${p.kind}); the app has no route for it` });
      continue;
    }
    at.set(p.id, r);
    if (normRoute(r.route) !== normRoute(p.route!)) changes.push({ kind: 'moved', id: p.id, detail: `the bundle puts it at ${p.route}; the app has it at ${r.route}` });
  }
  for (const r of routes) {
    if (!pages.some((p) => p.id === r.id || normRoute(p.route!) === normRoute(r.route))) {
      changes.push({ kind: 'unclassified', route: r.route, detail: `the app exposes it (${r.file}); the bundle's ia.json neither lists it nor marks it unlinked` });
    }
  }

  const runs = app.runs.filter((r) => r.applied && intended.roles.includes(r.role));
  if (runs.length === 0) {
    notCompared.push("no fresh run of fwos's IA harness, so only routes are compared, not who sees what (run the end-to-end tests)");
  } else {
    // The flags the intent's pages use, and with them every flag the runs turned on: the app may hang a page on one the intent doesn't.
    const intent = pageFlags(intended);
    const flags = [...new Set([...intent, ...runs.flatMap((r) => r.flags)])];
    const settingOf = (run: IaRun): Flags => Object.fromEntries(flags.map((f) => [f, run.flags.includes(f)]));
    const same = (a: Flags, b: Flags) => flags.every((f) => a[f] === b[f]);
    const missing = intended.roles.flatMap((role) =>
      settings(intent)
        .filter((s) => !runs.some((r) => r.role === role && intent.every((f) => r.flags.includes(f) === s[f])))
        .map((s) => named(role, s, intent)),
    );
    if (missing.length > 0) notCompared.push(`${missing.join(', ')}: no fresh run of fwos's IA harness opened the app that way, so who sees what isn't compared there`);
    const covered = new Map<string, Flags[]>();
    for (const r of runs) {
      const list = covered.get(r.role) ?? [];
      if (!list.some((s) => same(s, settingOf(r)))) list.push(settingOf(r));
      covered.set(r.role, list);
    }
    // Per page and kind of difference, the role and flag settings each happened under.
    const hits = new Map<string, Map<string, Flags[]>>();
    const hit = (what: string, page: string, role: string, s: Flags) => {
      const key = `${what}\0${page}`;
      const byRole = hits.get(key) ?? new Map<string, Flags[]>();
      const list = byRole.get(role) ?? [];
      // cover() tells settings apart by identity: keep the one `covered` holds.
      const setting = (covered.get(role) ?? []).find((x) => same(x, s)) ?? s;
      if (!list.includes(setting)) list.push(setting);
      byRole.set(role, list);
      hits.set(key, byRole);
    };
    const unvisited = new Set<string>();
    const dynamic = new Set<string>();
    for (const run of runs) {
      const s = settingOf(run);
      for (const p of pages.filter((x) => x.kind !== 'redirect')) {
        const r = at.get(p.id);
        if (!r) continue;
        if (r.route.includes('[')) {
          dynamic.add(p.id);
          continue;
        }
        const visit = run.visits.find((v) => normRoute(v.path) === normRoute(r.route));
        if (!visit) {
          unvisited.add(r.route);
          continue;
        }
        const shows = visibleUnder(intended, p, run.role, { ...s });
        const opens = opened(visit) && visit.denied !== true && reaches(normRoute(visit.finalPath), normRoute(r.route));
        const linked = run.nav.some((l) => reaches(normRoute(l), normRoute(r.route)));
        const inNav = p.kind === 'nav' && normRoute(r.route) !== '/';
        if (!shows && opens && visit.denied !== true) hit('hidden', p.id, run.role, s);
        else if (shows && !opens) hit('exposed', p.id, run.role, s);
        else if (shows && opens && inNav && !linked) hit('nav-missing', p.id, run.role, s);
        else if (shows && opens && !inNav && linked && normRoute(r.route) !== '/') hit('nav-extra', p.id, run.role, s);
        else if (!shows && !opens && linked) hit('nav-dead', p.id, run.role, s);
      }
    }
    for (const [key, byRole] of hits) {
      const [what, page] = key.split('\0') as [string, string];
      const says = SAYS[what]!;
      const everyone = intended.roles.every((role) => (covered.get(role) ?? []).length > 0 && (covered.get(role) ?? []).every((s) => (byRole.get(role) ?? []).some((x) => same(x, s))));
      if (everyone) {
        changes.push({ kind: says.kind, id: page, detail: says.text('every role') });
        continue;
      }
      for (const [role, hit] of byRole) {
        for (const when of cover(hit, covered.get(role) ?? hit, flags)) {
          const terms = Object.entries(when);
          const suffix = terms.length === 0 ? '' : ` (while ${terms.map(([f, on]) => `${f} is ${on ? 'on' : 'off'}`).join(' and ')})`;
          changes.push({ kind: says.kind, id: page, role, ...(terms.length > 0 ? { when } : {}), detail: `${says.text(role)}${suffix}` });
        }
      }
    }
    if (unvisited.size > 0) {
      const it = unvisited.size === 1 ? 'it' : 'them';
      notCompared.push(`${[...unvisited].join(', ')}: no run of fwos's IA harness opened ${it} (it opens the routes the project's ia.json lists), so who sees ${it} isn't compared`);
    }
    if (dynamic.size > 0) notCompared.push(`${[...dynamic].join(', ')}: at dynamic routes, which fwos's IA harness doesn't open`);
  }
  const page = new Map(intended.pages.map((p, i) => [p.id, i]));
  changes.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (page.get(a.id ?? '') ?? 0) - (page.get(b.id ?? '') ?? 0));
  return { changes, notCompared };
}

export function formatAppDiff(d: AppDiff): string {
  const mark: Record<AppChangeKind, string> = { added: '+', moved: '~', hidden: '!', exposed: '!', nav: '!', unclassified: '?' };
  const lines = d.changes.map((c) => `${mark[c.kind]} ${c.kind.padEnd(12)} ${c.id ?? c.route}: ${c.detail}`);
  if (lines.length === 0) lines.push(d.notCompared.length > 0 ? 'No differences in what was compared.' : "The app matches the bundle's IA.");
  return [...lines, ...d.notCompared.map((n) => `  not compared: ${n}`)].join('\n');
}
