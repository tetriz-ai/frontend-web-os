// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// ia.json: the information architecture as data. Validation, reachability, and the IA diff
// (between two versions, per role) that shows added, removed, moved, hidden and exposed pages.

import { validateWith } from '../../kernel/index.ts';
import schema from './schema/ia.schema.json' with { type: 'json' };

export type PageKind = 'nav' | 'drilldown' | 'redirect' | 'unlinked';

export interface IaPage {
  id: string;
  title: string;
  surface?: 'route' | 'window' | 'scene' | 'menu-item' | 'menu-bar-extra' | 'settings';
  route?: string;
  kind: PageKind;
  parent?: string | null;
  order?: number;
  visibleTo?: string[];
  flag?: string;
  states: string[];
  deepLink?: string;
  redirectTo?: string;
  unlinkedReason?: string;
}

export interface Ia {
  schema: 1;
  roles: string[];
  flags?: string[];
  pages: IaPage[];
}

export function parseIa(text: string): { ia: Ia | null; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ia: null, errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  const errors = validateWith(schema, data);
  if (errors.length > 0) return { ia: null, errors };
  return { ia: data as Ia, errors: validateIa(data as Ia) };
}

/** Normalises a route so `/items/[id]`, `/items/:id` and `/items/{id}` compare equal. */
export function normRoute(route: string): string {
  const r = route
    .split('?')[0]!
    .split('/')
    .map((seg) => {
      if (/^\[\[\.\.\..+\]\]$/.test(seg)) return '[[...]]';
      if (/^\[\.\.\..+\]$/.test(seg)) return '[...]';
      if (/^\[.+\]$/.test(seg) || /^:.+/.test(seg) || /^\{.+\}$/.test(seg)) return '[]';
      return seg;
    })
    .join('/');
  return r.length > 1 ? r.replace(/\/$/, '') : r;
}

export const visibleTo = (ia: Ia, p: IaPage) => p.visibleTo ?? ia.roles;

/** Whether a link to `to` opens `route` (both normalised): a literal or dynamic segment fills a dynamic one, and a catch-all takes the rest. */
export function reaches(to: string, route: string): boolean {
  const link = to.split('/').filter(Boolean);
  const segs = route.split('/').filter(Boolean);
  for (const [i, seg] of segs.entries()) {
    if (seg === '[[...]]') return true;
    if (seg === '[...]') return link.length > i;
    if (i >= link.length || (seg !== '[]' && link[i] !== seg)) return false;
  }
  return link.length === segs.length;
}

export function validateIa(ia: Ia): string[] {
  const errors: string[] = [];
  const byId = new Map<string, IaPage>();
  for (const p of ia.pages) {
    if (byId.has(p.id)) errors.push(`page id "${p.id}" is used twice`);
    byId.set(p.id, p);
  }
  const routes = new Map<string, string>();
  for (const p of ia.pages) {
    const where = `page "${p.id}"`;
    if ((p.surface ?? 'route') === 'route' && !p.route) errors.push(`${where} has no route`);
    if (p.route && p.kind !== 'redirect') {
      const r = normRoute(p.route);
      const other = routes.get(r);
      if (other) errors.push(`${where} and page "${other}" share the route ${p.route}`);
      else routes.set(r, p.id);
    }
    for (const role of p.visibleTo ?? []) {
      if (!ia.roles.includes(role)) errors.push(`${where} is visible to unknown role "${role}"`);
    }
    if (p.flag && !(ia.flags ?? []).includes(p.flag)) errors.push(`${where} uses unknown flag "${p.flag}"`);
    if (p.parent && !byId.has(p.parent)) errors.push(`${where} has unknown parent "${p.parent}"`);
    if (p.kind === 'drilldown' && !p.parent) errors.push(`${where} is a drill-down with no parent`);
    if (p.kind === 'redirect' && (!p.redirectTo || !byId.has(p.redirectTo))) {
      errors.push(`${where} is a redirect to ${p.redirectTo ? `unknown page "${p.redirectTo}"` : 'nothing'}`);
    }
    if (p.kind === 'unlinked' && !p.unlinkedReason) errors.push(`${where} is unlinked with no unlinkedReason`);
    if (p.states.length === 0) errors.push(`${where} lists no states`);
    const parent = p.parent ? byId.get(p.parent) : undefined;
    if (parent) {
      const lost = visibleTo(ia, p).filter((r) => !visibleTo(ia, parent).includes(r));
      if (lost.length > 0) errors.push(`${where} is visible to ${lost.join(', ')}, but its parent "${parent.id}" isn't`);
    }
  }
  // Parent cycles
  for (const p of ia.pages) {
    const seen = new Set<string>();
    let cur: IaPage | undefined = p;
    while (cur?.parent) {
      if (seen.has(cur.id)) {
        errors.push(`page "${p.id}" is in a parent cycle`);
        break;
      }
      seen.add(cur.id);
      cur = byId.get(cur.parent);
    }
  }
  // Reachability: nav pages are reachable; drill-downs through a reachable parent.
  const reachable = (p: IaPage, depth = 0): boolean => {
    if (depth > ia.pages.length) return false;
    if (p.kind === 'nav') return true;
    if (p.kind === 'drilldown' && p.parent) {
      const parent = byId.get(p.parent);
      return !!parent && reachable(parent, depth + 1);
    }
    return false;
  };
  for (const p of ia.pages) {
    if (p.kind === 'drilldown' && p.parent && byId.has(p.parent) && !reachable(p)) {
      errors.push(`page "${p.id}" is neither reachable nor marked unlinked (its parent chain never reaches a nav page)`);
    }
  }
  return [...new Set(errors)];
}

export type IaChangeKind = 'added' | 'removed' | 'moved' | 'hidden' | 'exposed' | 'states' | 'kind' | 'flag';

export interface IaChange {
  kind: IaChangeKind;
  id: string;
  role?: string;
  /** For hidden and exposed: the flag settings it happens under, when it doesn't happen under all of them. */
  when?: Record<string, boolean>;
  detail: string;
}

export type Flags = Record<string, boolean>;

/** Every on/off setting of `flags`: 2 for one flag, 4 for two. */
export function settings(flags: string[]): Flags[] {
  return flags.reduce<Flags[]>((acc, f) => acc.flatMap((s) => [{ ...s, [f]: true }, { ...s, [f]: false }]), [{}]);
}

const holds = (term: Flags, s: Flags) => Object.entries(term).every(([f, v]) => s[f] === v);

/**
 * The fewest partial settings that cover exactly `hit` among `all`: `[{}]` when it is all of
 * them, `{ x: false }` when it is every setting with x off, else one full setting at a time.
 */
export function cover(hit: Flags[], all: Flags[], flags: string[]): Flags[] {
  const terms = [{}, ...flags.flatMap((f) => [{ [f]: true }, { [f]: false }]), ...all];
  const left = new Set(hit);
  const out: Flags[] = [];
  for (const t of terms) {
    const covered = all.filter((s) => holds(t, s));
    if (covered.every((s) => hit.includes(s)) && covered.some((s) => left.has(s))) {
      out.push(t);
      for (const s of covered) left.delete(s);
    }
  }
  return out;
}

const whileText = (term: Flags) =>
  Object.keys(term).length === 0 ? '' : ` while ${Object.entries(term).map(([f, on]) => `${f} is ${on ? 'on' : 'off'}`).join(' and ')}`;

/** Whether `p` shows to `role` with `flags` set: the role sees it, and its flag, if it has one, is on. */
export const visibleUnder = (ia: Ia, p: IaPage, role: string, flags: Flags) =>
  ia.roles.includes(role) && visibleTo(ia, p).includes(role) && (!p.flag || flags[p.flag] === true);

/**
 * What changed between two versions of ia.json, by stable page ID, per role and flag. A page's
 * visibility is compared under every setting of the flags it had and has, so a flag added,
 * removed or swapped shows which roles it hides the page from or exposes it to, and when.
 */
export function diffIa(before: Ia, after: Ia): IaChange[] {
  const changes: IaChange[] = [];
  const old = new Map(before.pages.map((p) => [p.id, p]));
  const cur = new Map(after.pages.map((p) => [p.id, p]));
  for (const p of after.pages) {
    const o = old.get(p.id);
    if (!o) {
      changes.push({ kind: 'added', id: p.id, detail: `${p.title}${p.route ? ` at ${p.route}` : ''} (${p.kind})` });
      continue;
    }
    const moves: string[] = [];
    if ((o.route ?? '') !== (p.route ?? '')) moves.push(`route ${o.route ?? '-'} -> ${p.route ?? '-'}`);
    if ((o.parent ?? null) !== (p.parent ?? null)) moves.push(`parent ${o.parent ?? '-'} -> ${p.parent ?? '-'}`);
    if ((o.order ?? null) !== (p.order ?? null)) moves.push(`order ${o.order ?? '-'} -> ${p.order ?? '-'}`);
    if (moves.length > 0) changes.push({ kind: 'moved', id: p.id, detail: moves.join(', ') });
    if (o.kind !== p.kind) changes.push({ kind: 'kind', id: p.id, detail: `${o.kind} -> ${p.kind}` });
    const added = p.states.filter((s) => !o.states.includes(s));
    const dropped = o.states.filter((s) => !p.states.includes(s));
    if (added.length + dropped.length > 0) {
      changes.push({
        kind: 'states',
        id: p.id,
        detail: [added.length ? `+${added.join(' +')}` : '', dropped.length ? `-${dropped.join(' -')}` : ''].filter(Boolean).join(' '),
      });
    }
    if ((o.flag ?? '') !== (p.flag ?? '')) {
      const detail = !o.flag ? `now behind flag ${p.flag}` : !p.flag ? `no longer behind flag ${o.flag}` : `flag ${o.flag} -> ${p.flag}`;
      changes.push({ kind: 'flag', id: p.id, detail });
    }
    const flags = [...new Set([o.flag, p.flag].filter((f): f is string => !!f))];
    const all = settings(flags);
    const roles = [...new Set([...before.roles, ...after.roles])];
    for (const role of roles) {
      const hidden = all.filter((s) => visibleUnder(before, o, role, s) && !visibleUnder(after, p, role, s));
      const exposed = all.filter((s) => !visibleUnder(before, o, role, s) && visibleUnder(after, p, role, s));
      for (const [kind, hit, text] of [
        ['hidden', hidden, `no longer visible to ${role}`],
        ['exposed', exposed, `now visible to ${role}`],
      ] as const) {
        for (const when of cover(hit, all, flags)) {
          changes.push({ kind, id: p.id, role, ...(Object.keys(when).length > 0 ? { when } : {}), detail: `${text}${whileText(when)}` });
        }
      }
    }
  }
  for (const o of before.pages) {
    if (!cur.has(o.id)) changes.push({ kind: 'removed', id: o.id, detail: `${o.title}${o.route ? ` at ${o.route}` : ''}` });
  }
  return changes;
}

export function formatIaDiff(changes: IaChange[]): string {
  if (changes.length === 0) return 'No IA changes.';
  const mark: Record<IaChangeKind, string> = { added: '+', removed: '-', moved: '~', hidden: '!', exposed: '!', states: '~', kind: '~', flag: '~' };
  return changes.map((c) => `${mark[c.kind]} ${c.kind.padEnd(8)} ${c.id}: ${c.detail}`).join('\n');
}
