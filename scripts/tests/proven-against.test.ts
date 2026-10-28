// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// "Proven against" names where an AC's data comes from: mock, local or real. It has one meaning, in
// one place, for every kind of app, and it is never a test level: a spec that defined `local` as
// "runs in a real browser" would send a plan that picks levels by behaviour, and the adjudicator
// that judges against the spec, two different ways.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PLUGIN = join(__dirname, '../../plugin');
const read = (rel: string) => readFileSync(join(PLUGIN, rel), 'utf8');
const DEFINITION = 'modules/spec/knowledge/ac-writing.md';
const LEVELS = 'modules/tests/knowledge/level-router.md';
const link = (rel: string) => '${CLAUDE_PLUGIN_ROOT}/' + rel;

describe('"Proven against"', () => {
  const definition = read(DEFINITION).split(/^## /m).find((s) => s.startsWith('"Proven against"')) ?? '';

  it('has a definition', () => {
    expect(definition).not.toBe('');
  });

  it('says what an app with no data layer uses', () => {
    expect(definition).toMatch(/no data layer/i);
    expect(definition).toMatch(/uses `local`/);
  });

  it('is never a test level', () => {
    expect(definition).toMatch(/never the test level/i);
  });

  it("isn't left for the spec to redefine", () => {
    const data = read('modules/spec/templates/spec.md').split('\n').find((l) => l.startsWith('3. <data'));
    expect(data).toBeDefined();
    expect(data).not.toMatch(/what that means/i);
  });

  it.each(['modules/spec/agents/spec-reviewer.md', 'modules/accept/agents/adjudicator.md'])(
    '%s reads its meaning from the one definition',
    (rel) => {
      expect(read(rel)).toContain(link(DEFINITION));
    },
  );

  it('leaves the test level to the level router when the adjudicator judges a test', () => {
    expect(read('modules/accept/agents/adjudicator.md')).toContain(link(LEVELS));
  });
});
