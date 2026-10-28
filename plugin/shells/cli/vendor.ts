// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The copy of this CLI that `fwos scaffold` vendors into a project, so `pnpm install`, the git
// hook and CI run `fwos check` without a registry package or a path to the plugin.

import { readdirSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { FwosError, hashText, pluginPath, pluginRoot, pluginVersion, readJson, readText, toPosix } from '../../kernel/index.ts';
import { PACK_DIR } from '../../modules/rules/index.ts';
import { TEMPLATES_DIR } from '../../modules/screens/index.ts';
import { backupFiles, ownedPath, ownedStatus, readManifest, removeOwned, writeOwned } from '../../modules/state/index.ts';
import { HARNESS_DIR } from '../../platforms/web/index.ts';

/** Where the scaffold puts its own copy of this CLI, and the pin that points at it. */
export const VENDORED_CLI = '.fwos/cli';
export const VENDORED_PIN = `file:${VENDORED_CLI}`;

/** Every file under an absolute folder, as a sorted posix path relative to `base` (the plugin root by default). */
function filesUnder(dir: string, base = pluginRoot): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // not there
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(join(abs, e.name));
      else if (e.isFile()) out.push(toPosix(relative(base, join(abs, e.name))));
    }
  };
  walk(dir);
  return out.sort();
}

/** The plugin's folders the CLI reads whole at run time, so a file added to one changes what it does. */
function runtimeDirs(): string[] {
  return [PACK_DIR, pluginPath('modules', 'design-system', 'starter'), TEMPLATES_DIR, HARNESS_DIR];
}

/**
 * Every file this CLI reads from the plugin folder at run time, relative to it: the bundle and its
 * licences, the rule pack (`check`), the design-system starter (`design-system init`), the app
 * templates (`scaffold`) and fwos's harness for the app (`harness`, `check`). The vendored package.json stands in for .claude-plugin/plugin.json, and
 * `codex agents` refuses to run from a copy, so neither the manifest nor the agents are here.
 */
export function runtimeFiles(): string[] {
  return ['dist/fwos.mjs', 'dist/THIRD-PARTY-LICENSES.txt', 'LICENSE', 'NOTICE', ...runtimeDirs().flatMap((d) => filesUnder(d))];
}

export interface VendorPlan {
  /** Every file this fwos puts in the copy, with what writing it does. */
  writes: { path: string; content: string; source: string; status: 'new' | 'replace' | 'unchanged' }[];
  /** Files an older fwos put in the copy that this one doesn't ship: they go. */
  removes: string[];
  /** Files fwos won't touch, with why: edited since fwos wrote them, or not written by fwos. */
  refused: { path: string; why: string }[];
}

/**
 * What refreshing the copy in `root` would do, file by file, read before anything is written: a
 * refresh that stopped at the first patched file would leave half of one version and half of the
 * other. A file is refused when it was edited since fwos wrote it, or when fwos didn't write it and
 * it sits where the copy reads its bundle, rules, starter or templates, since the copy would run it.
 */
export function planVendor(root: string): VendorPlan {
  const manifest = readManifest(root);
  const files = runtimeFiles().map((rel) => {
    const text = readText(pluginPath(rel));
    if (text === null) throw new FwosError(`The plugin is missing ${rel}.`, 'Reinstall the plugin, or pass --fwos-check <spec> to pin a local checkout or GitHub Release archive.');
    return { path: posix.join(VENDORED_CLI, rel), content: text, source: `plugin ${rel}` };
  });
  const pkg = {
    name: 'fwos-check',
    version: pluginVersion(),
    private: true,
    description: 'The fwos CLI, vendored by fwos scaffold. Run fwos vendor to refresh it.',
    license: 'MIT',
    bin: { fwos: 'dist/fwos.mjs' },
    engines: { node: '>=22' },
  };
  files.push({ path: posix.join(VENDORED_CLI, 'package.json'), content: `${JSON.stringify(pkg, null, 2)}\n`, source: 'fwos scaffold' });
  const plan: VendorPlan = { writes: [], removes: [], refused: [] };
  for (const f of files) {
    const status = ownedStatus(root, f.path, f.content, manifest);
    if (status === 'edited') plan.refused.push({ path: f.path, why: 'edited since fwos wrote it' });
    else if (status === 'foreign') plan.refused.push({ path: f.path, why: "fwos didn't write it" });
    else plan.writes.push({ ...f, status });
  }
  const shipped = new Set(files.map((f) => f.path));
  for (const [rel, entry] of Object.entries(manifest.files)) {
    if (entry.kind !== 'fwos' || !rel.startsWith(`${VENDORED_CLI}/`) || shipped.has(rel)) continue;
    const text = readText(ownedPath(root, rel));
    if (text !== null && hashText(text) !== entry.sha) plan.refused.push({ path: rel, why: 'edited since fwos wrote it, and this fwos no longer ships it' });
    else plan.removes.push(rel);
  }
  const read = ['dist', ...runtimeDirs().map((d) => toPosix(relative(pluginRoot, d)))].map((d) => posix.join(VENDORED_CLI, d));
  const extra = read.flatMap((d) => filesUnder(join(root, d), root)).filter((rel) => !shipped.has(rel) && !manifest.files[rel]);
  for (const rel of extra) plan.refused.push({ path: rel, why: "fwos didn't write it" });
  plan.refused.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return plan;
}

/** The files a plan changes on disk: those it replaces and those it removes. */
export const vendorChanges = (plan: VendorPlan) => [...plan.writes.filter((w) => w.status === 'replace').map((w) => w.path), ...plan.removes];

/** A saved plan may outlive a filesystem change, so recheck the complete boundary before applying it. */
function validateVendorPlan(root: string, plan: VendorPlan): void {
  if (plan.refused.length > 0) throw vendorRefusal(plan);
  for (const rel of [...plan.writes.map((file) => file.path), ...plan.removes]) {
    if (!rel.startsWith(`${VENDORED_CLI}/`)) throw new FwosError(`Refusing path outside ${VENDORED_CLI}: ${rel}`, 'Replan the vendor refresh.');
    ownedPath(root, rel);
  }
}

/** Carries out a plan with nothing refused, after backing up every file it replaces or removes. */
export function applyVendor(root: string, plan: VendorPlan): { written: string[]; removed: string[]; backup: string | null } {
  validateVendorPlan(root, plan);
  const backup = backupFiles(root, vendorChanges(plan));
  return { ...writeVendor(root, plan), backup };
}

/** Writes and removes what a plan with nothing refused says, once its caller has backed up vendorChanges(plan). */
export function writeVendor(root: string, plan: VendorPlan): { written: string[]; removed: string[] } {
  validateVendorPlan(root, plan);
  for (const w of plan.writes) writeOwned(root, w.path, w.content, 'fwos', w.source);
  for (const rel of plan.removes) removeOwned(root, rel);
  return { written: plan.writes.filter((w) => w.status !== 'unchanged').map((w) => w.path), removed: plan.removes };
}

/** How to clear the way for a refresh of the copy. */
export const REFUSED_FIX = `Restore each one (\`git checkout -- <file>\`, or delete one fwos didn't write), and keep your changes out of ${VENDORED_CLI}: rule changes go in design-system/rules.yaml.`;

/** Each file a refresh won't touch, and how to clear the way. */
export function vendorRefusal(plan: VendorPlan): FwosError {
  return new FwosError(
    `fwos won't refresh ${VENDORED_CLI} while these are there, so it wrote nothing:\n${plan.refused.map((r) => `  ${r.path}: ${r.why}`).join('\n')}`,
    `${REFUSED_FIX} Then run the command again.`,
  );
}

/**
 * Copies this CLI into the project as a local `fwos-check` package, so `pnpm install`, the git
 * hook and CI all run `fwos check` without the npm package and without a path to the plugin.
 * It keeps the plugin's layout for the files the CLI reads at run time (runtimeFiles), so the
 * bundle finds them the same way. The files are [fwos]: `fwos vendor` and `fwos update` refresh
 * them after a plugin update, all of them or, when one was patched, none.
 */
export function vendorCli(root: string): { written: string[]; removed: string[]; backup: string | null } {
  return applyVendor(root, planVendor(root));
}

/** What doctor says about the project's fwos-check pin when it points at the vendored copy. */
export function vendoredNote(root: string): string {
  const v = readJson<{ version?: string }>(posix.join(root, VENDORED_CLI, 'package.json'))?.version;
  if (!v) return `pinned to ${VENDORED_CLI}, but it's missing: run fwos vendor to restore it`;
  if (v !== pluginVersion()) return `vendored copy in ${VENDORED_CLI} is ${v}, plugin is ${pluginVersion()}: run fwos vendor to refresh it`;
  return `vendored copy in ${VENDORED_CLI}, same version as this plugin`;
}
