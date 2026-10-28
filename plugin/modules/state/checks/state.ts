// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// state/schema: the state and change files are valid, and every file of fwos's records and of the
// pack names a schema this fwos reads. A gate: if it fails, `fwos check` stops before any other
// check runs (fail closed), so nothing reads a file it can't understand.
// state/approvals: while building or later, every approval the build rests on still holds.
// state/owned: no [generated] file was edited by hand.

import { readdirSync } from 'node:fs';
import { posix } from 'node:path';
import {
  type Check,
  type CheckResult,
  type FileSchema,
  type Finding,
  type Project,
  off,
  packSchemas,
  parseJsonc,
  readText,
  result,
  schemaOf,
  unsupportedSchema,
  validateWith,
} from '../../../kernel/index.ts';
import baselineSchema from '../schema/baseline.schema.json' with { type: 'json' };
import changeSchema from '../schema/change.schema.json' with { type: 'json' };
import manifestSchema from '../schema/manifest.schema.json' with { type: 'json' };
import provenanceSchema from '../schema/provenance.schema.json' with { type: 'json' };
import stateSchema from '../schema/state.schema.json' with { type: 'json' };
import { allApprovals, changeApprovalState, docStaleness, satisfied } from '../approvals.ts';
import { type Change, STATE_SCHEMA_VERSION } from '../model.ts';
import { editedOwnedFiles } from '../owned.ts';
import { FWOS_DIR, isAdoptionRecord, latestChange } from '../store.ts';

export const schemaCheck: Check = {
  id: 'state/schema',
  title: 'fwos state files',
  catches: 'a pack file or .fwos/ record from a schema this fwos does not read, or a malformed .fwos/ file',
  platforms: ['web', 'electron', 'mac'],
  gate: true,
  run({ project }) {
    if (!project.initialized) return off('state/schema', 'not an fwos project (no .fwos/state.json); run /fwos:start');
    const pack = packSchemas(project).map((s) => s.path);
    return result('state/schema', recordProblems(project), [`${FWOS_DIR}/state.json`, `${FWOS_DIR}/changes/*.json`, ...pack]);
  },
};

/** JSON files in a folder of .fwos/ (and its subfolders when `deep`), as sorted paths relative to the project root. */
function recordFiles(project: Project, dir: string, deep = false): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    let entries;
    try {
      entries = readdirSync(project.abs(rel), { withFileTypes: true });
    } catch {
      return; // no such folder
    }
    for (const e of entries) {
      if (e.isDirectory() && deep) walk(posix.join(rel, e.name));
      else if (e.isFile() && e.name.endsWith('.json')) out.push(posix.join(rel, e.name));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * fwos's own records in .fwos/ that the project has, each with the schema it names. The flaky-test
 * quarantine (the tests module's) and the slice manifests (the build module's) are at schema 1, as
 * their own JSON Schemas say; their checks report what else is wrong with them.
 */
export function recordSchemas(project: Project): FileSchema[] {
  const named: [path: string, name: string, reads: number][] = [
    ...['state.json', 'manifest.json', 'provenance.json', 'baseline.json'].map((n): [string, string, number] => [`${FWOS_DIR}/${n}`, n, STATE_SCHEMA_VERSION]),
    ...recordFiles(project, `${FWOS_DIR}/changes`).map((f): [string, string, number] => [f, 'change file', STATE_SCHEMA_VERSION]),
    [`${FWOS_DIR}/quarantine.json`, 'quarantine.json', 1],
    // The design-system fidelity decisions (`fwos design-system decide`), schema 1.
    [`${FWOS_DIR}/fidelity.json`, 'fidelity.json', 1],
    // The prototype bundles promoted (`fwos prototype promote`), schema 1.
    [`${FWOS_DIR}/prototypes.json`, 'prototypes.json', 1],
    ...recordFiles(project, `${FWOS_DIR}/slices`, true).map((f): [string, string, number] => [f, 'slice manifest', 1]),
  ];
  return named.flatMap(([path, name, reads]) => {
    const text = readText(project.abs(path));
    return text === null ? [] : [{ path, name, schema: schemaOf(text, 'json'), reads, format: 'json' as const }];
  });
}

/** Every file of fwos's records and of the pack that names a schema this fwos doesn't read. */
export function unsupportedSchemas(project: Project): FileSchema[] {
  return [...recordSchemas(project), ...packSchemas(project)].filter((s) => s.schema !== null && s.schema !== s.reads);
}

/**
 * What is wrong with fwos's records in .fwos/, one finding per problem, each naming its file: one
 * that doesn't parse, breaks its schema, or (a change file) has an id that isn't its file name, and
 * any record or pack file from a schema this fwos doesn't read. Never throws, so a broken file is a
 * finding, not a crash.
 */
export function recordProblems(project: Project): Finding[] {
  const unsupported = unsupportedSchemas(project);
  const findings: Finding[] = unsupported.map((s) => ({ file: s.path, rule: 'schema-version', message: unsupportedSchema(s.name, s.schema!, s.reads) }));
  const validate = (rel: string, schema: object, required: boolean): unknown => {
    if (unsupported.some((s) => s.path === rel)) return undefined;
    const text = readText(project.abs(rel));
    if (text === null) {
      if (required) findings.push({ file: rel, message: 'missing' });
      return undefined;
    }
    let data: unknown;
    try {
      data = parseJsonc(text);
    } catch (e) {
      findings.push({ file: rel, message: `is not valid JSON: ${(e as Error).message}` });
      return undefined;
    }
    for (const err of validateWith(schema, data)) findings.push({ file: rel, message: err });
    return data;
  };
  validate(`${FWOS_DIR}/state.json`, stateSchema, true);
  validate(`${FWOS_DIR}/manifest.json`, manifestSchema, false);
  validate(`${FWOS_DIR}/provenance.json`, provenanceSchema, false);
  validate(`${FWOS_DIR}/baseline.json`, baselineSchema, false);
  for (const rel of recordFiles(project, `${FWOS_DIR}/changes`)) {
    const n = posix.basename(rel);
    const id = (validate(rel, changeSchema, true) as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && `${id}.json` !== n) findings.push({ file: rel, message: `id "${id}" doesn't match the file name` });
  }
  return findings;
}

const LATE_STEPS = new Set(['build', 'accept', 'done']);

export const approvalsCheck: Check = {
  id: 'state/approvals',
  title: 'Approvals still hold',
  catches: 'building on a brief, spec or test plan that changed after it was approved',
  platforms: ['web', 'electron', 'mac'],
  run({ project }) {
    if (!project.initialized) return off('state/approvals', 'not an fwos project');
    // Once every change is closed, the last one still has to hold: closing a change mustn't change
    // what this check says (the acceptance report quotes it, and its approval is a hash). In an
    // adopted app that is the last change delivered through fwos, not the adoption record.
    const change = latestChange(project.root);
    if (!change) return off('state/approvals', 'no changes yet');
    const inputs = [`${FWOS_DIR}/changes/${change.id}.json`, `${project.paths.docs}/**`];
    if (project.mode === 'adopt') return adoptedApprovals(project, change, inputs);
    if (!LATE_STEPS.has(change.step)) {
      return off('state/approvals', `change ${change.id} is at step ${change.step}; approvals are enforced from build on`, inputs);
    }
    const findings: Finding[] = [];
    for (const s of allApprovals(project)) {
      if (s.target === 'acceptance') continue;
      if (s.status === 'stale') {
        findings.push({
          rule: s.target,
          message: `${s.target} changed after it was approved (${(s.changed ?? []).join(', ')}); re-approve it or route the edit as a change`,
        });
      } else if (s.required && !satisfied(s)) {
        findings.push({ rule: s.target, message: `${s.target} is ${s.status}; it's a required approval` });
      }
    }
    for (const d of docStaleness(project)) {
      findings.push({
        file: d.doc,
        rule: 'based-on',
        message: `built from an older ${d.stale.map((x) => x.ref).join(', ')}; regenerate the affected parts and restamp it`,
      });
    }
    return result('state/approvals', findings, inputs);
  },
};

/**
 * In an adopted app, a change answers only for the approval it records itself: its spec (a code-only
 * change has none). The app's brief, architecture and screens were never fwos's to approve.
 */
function adoptedApprovals(project: Project, change: Change, inputs: string[]): CheckResult {
  if (isAdoptionRecord(project, change)) return off('state/approvals', 'no fwos change open: adopt mode checks the app as it is', inputs);
  if (!LATE_STEPS.has(change.step)) return off('state/approvals', `change ${change.id} is at step ${change.step}; approvals are enforced from build on`, inputs);
  const findings: Finding[] = [];
  if (change.route !== 'code-only') {
    const spec = changeApprovalState(project, change, 'spec');
    if (spec.status === 'stale') {
      findings.push({ rule: 'spec', message: `spec changed after change ${change.id} approved it (${(spec.changed ?? []).join(', ')}); re-approve it or route the edit as a change` });
    } else if (spec.status !== 'approved') {
      findings.push({ rule: 'spec', message: `spec is ${spec.status} in change ${change.id}; a change builds on the spec it approved itself` });
    }
  }
  for (const d of docStaleness(project)) {
    findings.push({ file: d.doc, rule: 'based-on', message: `built from an older ${d.stale.map((x) => x.ref).join(', ')}; regenerate the affected parts and restamp it` });
  }
  return result('state/approvals', findings, inputs);
}

export const ownedCheck: Check = {
  id: 'state/owned',
  title: 'Generated files untouched',
  catches: 'a [generated] file edited by hand',
  platforms: ['web', 'electron', 'mac'],
  run({ project }) {
    if (!project.initialized) return off('state/owned', 'not an fwos project');
    const edited = editedOwnedFiles(project.root);
    return result(
      'state/owned',
      edited.map((file) => ({
        file,
        message: 'edited by hand, but fwos generates it; put the change in its source and regenerate',
      })),
      [`${FWOS_DIR}/manifest.json`],
    );
  },
};
