// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The API contract: OpenAPI 3.1 in `packages/api-contract/openapi.yaml`, plus JSON fixtures named
// `<operationId>.<variant>.json` holding `{ "status": 200, "body": ... }`. Every platform's tests
// load the same fixtures, so both sides of a seam test against one file.

import { posix } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  type ContractModel,
  type ContractOperation,
  type Finding,
  type FixtureRef,
  type Project,
  validateWith,
} from '../../kernel/index.ts';

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'];

export interface OpenApiDoc {
  openapi?: string;
  paths?: Record<string, Record<string, OpenApiOperation | unknown>>;
  components?: { schemas?: Record<string, unknown> };
}

interface OpenApiOperation {
  operationId?: string;
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
}

export function contractSource(project: Project): string | null {
  for (const name of ['openapi.yaml', 'openapi.yml', 'openapi.json']) {
    const rel = posix.join(project.paths.contract, name);
    if (project.exists(rel)) return rel;
  }
  return null;
}

export function parseOpenApi(text: string): OpenApiDoc {
  const doc = parseYaml(text) as unknown;
  if (!doc || typeof doc !== 'object') throw new Error('not an object');
  return doc as OpenApiDoc;
}

export function operationsOf(doc: OpenApiDoc): { ops: ContractOperation[]; problems: string[] } {
  const ops: ContractOperation[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = (item as Record<string, unknown>)[method] as OpenApiOperation | undefined;
      if (!op) continue;
      if (!op.operationId) {
        problems.push(`${method.toUpperCase()} ${path} has no operationId`);
        continue;
      }
      if (seen.has(op.operationId)) problems.push(`operationId "${op.operationId}" is used twice`);
      seen.add(op.operationId);
      ops.push({ operationId: op.operationId, method: method.toUpperCase(), path, statuses: Object.keys(op.responses ?? {}) });
    }
  }
  return { ops, problems };
}

/** Reads the contract. Returns null when there is no openapi file. Throws on unparseable files. */
export function loadContract(project: Project): { model: ContractModel; doc: OpenApiDoc; problems: string[]; findings: Finding[] } | null {
  const source = contractSource(project);
  if (!source) return null;
  const doc = parseOpenApi(project.read(source) ?? '');
  const { ops, problems } = operationsOf(doc);
  const findings: Finding[] = [];
  const fixtures: FixtureRef[] = [];
  const dir = project.paths.contract;
  for (const file of project.files([`${dir}/fixtures/**/*.json`])) {
    const name = posix.basename(file, '.json');
    const dot = name.indexOf('.');
    if (dot <= 0) {
      findings.push({ file, rule: 'fixture-name', message: 'fixture names are <operationId>.<variant>.json' });
      continue;
    }
    let data: { status?: unknown };
    try {
      data = JSON.parse(project.read(file) ?? '');
    } catch (e) {
      findings.push({ file, rule: 'fixture-json', message: `not valid JSON: ${(e as Error).message}` });
      continue;
    }
    const status = typeof data?.status === 'number' ? data.status : NaN;
    if (!Number.isInteger(status)) {
      findings.push({ file, rule: 'fixture-shape', message: 'a fixture is { "status": <number>, "body": <response body> }' });
      continue;
    }
    fixtures.push({ operationId: name.slice(0, dot), variant: name.slice(dot + 1), file, status });
  }
  return { model: { dir, source, operations: ops, fixtures }, doc, problems, findings };
}

/** Validates each fixture body against its operation's response schema. */
export function validateFixtures(project: Project, doc: OpenApiDoc, model: ContractModel): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(model.operations.map((o) => [o.operationId, o]));
  for (const fx of model.fixtures) {
    const op = byId.get(fx.operationId);
    if (!op) {
      findings.push({ file: fx.file, rule: 'unknown-operation', message: `no operation "${fx.operationId}" in ${model.source}` });
      continue;
    }
    const raw = (doc.paths?.[op.path] as Record<string, OpenApiOperation>)[op.method.toLowerCase()]!;
    const responses = raw.responses ?? {};
    const response = responses[String(fx.status)] ?? responses[`${String(fx.status)[0]}XX`] ?? responses.default;
    if (!response) {
      findings.push({
        file: fx.file,
        rule: 'unknown-status',
        message: `${fx.operationId} doesn't declare a ${fx.status} response (declares ${op.statuses.join(', ') || 'none'})`,
      });
      continue;
    }
    const schema = response.content?.['application/json']?.schema;
    const body = (JSON.parse(project.read(fx.file) ?? '{}') as { body?: unknown }).body;
    if (!schema) {
      if (body !== undefined && body !== null) {
        findings.push({ file: fx.file, rule: 'unexpected-body', message: `${fx.operationId} ${fx.status} declares no JSON body, but the fixture has one` });
      }
      continue;
    }
    for (const err of validateWith(wrapSchema(schema, doc), body)) {
      findings.push({ file: fx.file, rule: 'schema', message: `body ${err.replace(/^\(root\)/, '').trim() || err}` });
    }
  }
  return findings;
}

/** Inlines `#/components/schemas/X` refs as `#/$defs/X` so the schema validates on its own. */
export function wrapSchema(schema: unknown, doc: OpenApiDoc): object {
  const rewrite = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(rewrite);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = k === '$ref' && typeof val === 'string' ? val.replace('#/components/schemas/', '#/$defs/') : rewrite(val);
      }
      return out;
    }
    return v;
  };
  const defs = rewrite(doc.components?.schemas ?? {}) as Record<string, unknown>;
  const root = rewrite(schema) as Record<string, unknown>;
  return { ...root, $defs: { ...defs, ...((root.$defs as object) ?? {}) } };
}
