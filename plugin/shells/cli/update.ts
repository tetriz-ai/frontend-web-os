// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos update`: after a plugin upgrade, brings a project to this fwos. It reads the schema of
// every pack file and record first, then plans the refresh of the vendored CLI, and writes nothing
// while anything stands in the way: a file from a newer schema, an older one it has no migration
// for, or a file in .fwos/cli someone patched. Then it backs up every file it migrates, replaces or
// removes, and writes them.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { type FileSchema, FwosError, type Project, isDir, packSchemas, parseJsonc, pluginVersion, readJson, readText, writeText } from '../../kernel/index.ts';
import { backupFiles, logEvent, recordSchemas } from '../../modules/state/index.ts';
import { REFUSED_FIX, VENDORED_CLI, VENDORED_PIN, type VendorPlan, planVendor, vendorChanges, writeVendor } from './vendor.ts';

/** One step of a file's format, from one schema to the next. */
export interface Migration {
  from: number;
  to: number;
  run(data: unknown): unknown;
}

/** Migrations by the name a file goes by (`ia.json`, `state.json`). */
export type Migrations = Record<string, Migration[]>;

/**
 * The migrations this release ships: none. Every pack file and record is still at its first
 * schema, so there is nothing older to migrate from. The first schema 2 adds its step here, with a
 * test on a file as the fwos before it wrote it.
 */
export const MIGRATIONS: Migrations = {};

/** What update does with a file: nothing, migrate it, or stop because it can't. */
export type SchemaAction = 'current' | 'migrate' | 'newer' | 'no-migration';

export interface UpdatePlan {
  /** The fwos it updates to. */
  version: string;
  /** Every pack file and record that names a schema, with what update does with it. */
  schemas: (FileSchema & { action: SchemaAction })[];
  /** The refresh of the vendored CLI, or null when there is no copy to refresh. */
  vendored: VendorPlan | null;
  /** The project's fwos-check pin when it points somewhere other than the vendored copy. */
  pin: string | null;
  /** What stands in the way, a line each. While there is one, update writes nothing. */
  blocked: string[];
}

/** The steps that take a file from schema `from` to `to`, or null when there is a gap. */
function chain(steps: readonly Migration[], from: number, to: number): Migration[] | null {
  const out: Migration[] = [];
  let at = from;
  while (at < to) {
    const next = steps.find((m) => m.from === at && m.to > at && m.to <= to);
    if (!next) return null;
    out.push(next);
    at = next.to;
  }
  return out;
}

/** What `fwos update` would do in `project`, read before anything is written. */
export function planUpdate(project: Project, migrations: Migrations = MIGRATIONS): UpdatePlan {
  const blocked: string[] = [];
  const schemas = [...recordSchemas(project), ...packSchemas(project)]
    // A file that doesn't parse, or names no schema, is for the check that reads it to report.
    .filter((s) => s.schema !== null)
    .map((s) => {
      const at = s.schema!;
      let action: SchemaAction = 'current';
      if (at > s.reads) {
        action = 'newer';
        blocked.push(`${s.path} is schema ${at}, newer than this fwos reads (${s.name} schema ${s.reads}): upgrade fwos`);
      } else if (at < s.reads) {
        action = chain(migrations[s.name] ?? [], at, s.reads) ? 'migrate' : 'no-migration';
        if (action === 'no-migration') {
          blocked.push(
            `${s.path} is schema ${at}, and this fwos has no migration from it to ${s.name} schema ${s.reads}: rewrite it as schema ${s.reads} (docs/file-formats.md), or use the fwos that wrote it`,
          );
        }
      }
      return { ...s, action };
    });
  const pkg = readJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(project.abs('package.json'));
  const pinned = { ...pkg?.dependencies, ...pkg?.devDependencies }['fwos-check'];
  const pin = pinned && pinned !== VENDORED_PIN ? pinned : null;
  const vendored = pin === null && isDir(project.abs(VENDORED_CLI)) ? planVendor(project.root) : null;
  for (const r of vendored?.refused ?? []) blocked.push(`${r.path}: ${r.why}`);
  return { version: pluginVersion(), schemas, vendored, pin, blocked };
}

/** Why update stopped, every line of it, and how to clear the way. */
export function updateRefusal(plan: UpdatePlan): FwosError {
  const hints = ['Nothing was written. Clear each line, then run `fwos update` again.'];
  if (plan.vendored?.refused.length) hints.push(REFUSED_FIX);
  return new FwosError(`update stopped before writing anything:\n${plan.blocked.map((b) => `  ${b}`).join('\n')}`, hints.join(' '));
}

/** Whether a plan changes nothing. */
export function upToDate(plan: UpdatePlan): boolean {
  return plan.schemas.every((s) => s.action === 'current') && (!plan.vendored || (plan.vendored.writes.every((w) => w.status === 'unchanged') && plan.vendored.removes.length === 0));
}

export interface UpdateDone {
  migrated: string[];
  written: string[];
  removed: string[];
  /** The backup folder, relative to the project root, or null when nothing was replaced. */
  backup: string | null;
}

/**
 * Carries out a plan with nothing in the way. Every file it migrates, replaces or removes is
 * copied to one folder under .fwos/local/backup/ first; a plan with anything blocked writes nothing.
 */
export function applyUpdate(project: Project, plan: UpdatePlan, migrations: Migrations = MIGRATIONS): UpdateDone {
  if (plan.blocked.length > 0) throw updateRefusal(plan);
  const migrate = plan.schemas.filter((s) => s.action === 'migrate');
  const backup = backupFiles(project.root, [...migrate.map((s) => s.path), ...(plan.vendored ? vendorChanges(plan.vendored) : [])]);
  for (const s of migrate) {
    const text = readText(project.abs(s.path))!;
    let data: unknown = s.format === 'yaml' ? parseYaml(text) : parseJsonc(text);
    for (const step of chain(migrations[s.name]!, s.schema!, s.reads)!) data = step.run(data);
    writeText(project.abs(s.path), s.format === 'yaml' ? stringifyYaml(data) : `${JSON.stringify(data, null, 2)}\n`);
  }
  const done = plan.vendored ? writeVendor(project.root, plan.vendored) : { written: [], removed: [] };
  const out = { migrated: migrate.map((s) => s.path), ...done, backup };
  logEvent(project.root, 'update', { version: plan.version, migrated: out.migrated.length, written: out.written.length, removed: out.removed.length, backup });
  return out;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** The pin line, when the project's fwos-check isn't the vendored copy. */
const pinNote = (plan: UpdatePlan) =>
  plan.pin ? [`fwos-check is pinned to ${plan.pin}, not the vendored copy, so ${VENDORED_CLI} is left as it is: update that pin yourself.`] : [];

/** The preview: what `fwos update --yes` would do, file by file. */
export function formatUpdate(plan: UpdatePlan): string {
  if (upToDate(plan)) {
    const cli = plan.vendored ? `, and ${VENDORED_CLI} matches fwos ${plan.version}` : '';
    return [`Nothing to update: each pack file and record is at a schema this fwos reads${cli}.`, ...pinNote(plan)].join('\n');
  }
  const out = [`fwos update: this project to fwos ${plan.version}. Nothing is written until you add --yes.`, ''];
  const migrate = plan.schemas.filter((s) => s.action === 'migrate');
  if (migrate.length === 0) out.push(`Pack and records: ${plural(plan.schemas.length, 'file')}, each at a schema this fwos reads; nothing to migrate.`);
  else {
    out.push(`Pack and records: ${plural(migrate.length, 'file')} to migrate, ${plan.schemas.length - migrate.length} current`);
    for (const s of migrate) out.push(`  migrate  ${s.path}  schema ${s.schema} to ${s.reads}`);
  }
  if (plan.vendored) {
    const v = plan.vendored;
    const by = (status: string) => v.writes.filter((w) => w.status === status).map((w) => w.path);
    const [add, replace, same] = [by('new'), by('replace'), by('unchanged')];
    out.push('', `${VENDORED_CLI}: ${replace.length} to replace, ${add.length} to add, ${v.removes.length} to remove, ${same.length} unchanged`);
    for (const f of replace) out.push(`  replace  ${f}`);
    for (const f of add) out.push(`  add      ${f}`);
    for (const f of v.removes) out.push(`  remove   ${f}`);
  }
  const pin = pinNote(plan);
  if (pin.length > 0) out.push('', ...pin);
  out.push('', 'Run `fwos update --yes` to do it. Each file it migrates, replaces or removes is copied to .fwos/local/backup/ first.');
  return out.join('\n');
}

/** What `fwos update --yes` did. */
export function formatDone(plan: UpdatePlan, done: UpdateDone): string {
  const out: string[] = [];
  const copied = done.migrated.length + (plan.vendored ? vendorChanges(plan.vendored).length : 0);
  if (done.backup) out.push(`Backed up ${plural(copied, 'file')} to ${done.backup}/.`);
  for (const s of plan.schemas.filter((x) => x.action === 'migrate')) out.push(`Migrated ${s.path} from schema ${s.schema} to ${s.reads}.`);
  if (plan.vendored) {
    out.push(`Refreshed ${VENDORED_CLI} to fwos ${plan.version}: ${plural(done.written.length, 'file')} written, ${done.removed.length} removed. Run pnpm install so node_modules picks it up.`);
  }
  out.push(...pinNote(plan));
  return out.join('\n');
}
