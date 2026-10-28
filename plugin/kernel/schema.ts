// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// JSON Schema validation (draft 2020-12, which OpenAPI 3.1 also uses). Every file format
// fwos owns ships a schema in its module's `schema/` folder; this validates against it.

import Ajv2020Module from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';

type AjvCtor = new (opts: Record<string, unknown>) => {
  compile(schema: object): ValidateFunction;
  addSchema(schema: object, key?: string): unknown;
  getSchema(key: string): ValidateFunction | undefined;
};
const Ajv2020 = ((Ajv2020Module as unknown as { default?: AjvCtor }).default ?? Ajv2020Module) as unknown as AjvCtor;

const cache = new WeakMap<object, ValidateFunction>();

function ajv() {
  // strict: false so OpenAPI keywords such as `example` and `discriminator` don't throw.
  return new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
}

let shared: ReturnType<typeof ajv> | null = null;

export function validateWith(schema: object, data: unknown): string[] {
  let fn = cache.get(schema);
  if (!fn) {
    shared ??= ajv();
    fn = shared.compile(schema);
    cache.set(schema, fn);
  }
  return fn(data) ? [] : formatErrors(fn.errors ?? []);
}

export function formatErrors(errors: ErrorObject[]): string[] {
  return errors.map((e) => {
    const at = e.instancePath === '' ? '(root)' : e.instancePath;
    const extra =
      e.keyword === 'additionalProperties'
        ? ` (${String((e.params as { additionalProperty?: string }).additionalProperty)})`
        : e.keyword === 'enum'
          ? ` (${((e.params as { allowedValues?: unknown[] }).allowedValues ?? []).join(', ')})`
          : '';
    return `${at} ${e.message ?? 'is invalid'}${extra}`;
  });
}
