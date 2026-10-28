// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { afterAll, expect, it } from 'vitest';
import { cleanupTempProjects, contextFor, tempProject } from '../../../kernel/testing.ts';
import { schemaCheck } from '../checks/design-system.ts';

afterAll(cleanupTempProjects);

it.each([
  ['null', /must be object/],
  ['[]', /must be object/],
  ['false', /must be object/],
  ['42', /must be object/],
  ['{', /not valid JSON/],
  ['{}', /required property/],
] as const)('reports malformed design-system root %s as structured findings', async (text, message) => {
  const file = 'design-system/design-system.json';
  const root = tempProject({ [file]: text });
  const result = await schemaCheck.run(contextFor(root));
  expect(result.status).toBe('fail');
  expect(result.findings.length).toBeGreaterThan(0);
  expect(result.findings.every((finding) => finding.file === file)).toBe(true);
  expect(result.findings.map((finding) => finding.message).join('\n')).toMatch(message);
});
