// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The pack (the project's own design system, rule overrides, pages and modules) and fwos's records
// each name the schema they were written against. One this fwos can't read fails closed: `fwos
// check` stops before any check that isn't a gate runs, and the session start says why. A file
// that doesn't parse is a different problem, left to the check that reads it.

import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { PACK_FILES, loadProject, pluginPath } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { starterFiles } from '../../../modules/design-system/index.ts';
import { dispatch } from '../../hooks/index.ts';
import { runChecks } from '../runner.ts';

afterAll(cleanupTempProjects);

const SLICE = '.fwos/slices/0001-initial/S1.json';

/** A project whose every pack file and record is at the schema this fwos reads. */
function supported(): Record<string, string | object> {
  return {
    '.fwos/state.json': { schema: 1, pluginVersion: '0.1.0', mode: 'new', platforms: ['web'] },
    ...Object.fromEntries(starterFiles().map((f) => [`design-system/${f.path}`, f.content])),
    'design-system/rules.yaml': 'schema: 1\nrules:\n  no-pie-chart: off\n',
    'docs/app/ia.json': { schema: 1, roles: ['user'], pages: [{ id: 'home', title: 'Home', route: '/', kind: 'nav', states: ['ready'] }] },
    'docs/app/modules.json': { schema: 1, modules: [{ name: 'app', path: 'apps/web/app', dependsOn: ['*'] }] },
    '.fwos/quarantine.json': { schema: 1, tests: [] },
    '.fwos/fidelity.json': { schema: 1, decisions: [] },
    '.fwos/prototypes.json': { schema: 1, bundles: {} },
    [SLICE]: { schema: 1, slice: 'S1', change: '0001-initial', title: 'Home', platform: 'web', modules: ['app'], acs: [] },
  };
}

/** The same project with `file` naming schema `version`. */
function withSchema(file: string, version: number): Record<string, string | object> {
  const files = supported();
  const was = files[file]!;
  files[file] =
    typeof was === 'string' && file.endsWith('.yaml')
      ? was.replace(/^schema: 1$/m, `schema: ${version}`)
      : { ...(typeof was === 'string' ? JSON.parse(was) : was), schema: version };
  return files;
}

const sessionContext = (root: string): string => {
  const out = dispatch('session-start', { cwd: root, hook_event_name: 'SessionStart' }, root).stdout;
  return out ? (JSON.parse(out) as { hookSpecificOutput: { additionalContext?: string } }).hookSpecificOutput.additionalContext ?? '' : '';
};

const GATES = ['state/schema', 'design-system/schema'];
const PACK = ['design-system/design-system.json', 'design-system/components.json', 'design-system/rules.yaml', 'docs/app/ia.json', 'docs/app/modules.json'];
const RECORDS = ['.fwos/quarantine.json', '.fwos/fidelity.json', '.fwos/prototypes.json', SLICE];

describe('the pack', () => {
  it('is the five files of yours fwos reads, each at the schema this release reads', () => {
    const project = loadProject(tempProject(supported()));
    expect(PACK_FILES.map((f) => f.path(project))).toEqual(PACK);
    // The table is the one place a release says what it reads, and it agrees with each file's own JSON Schema.
    const own: Record<string, string[]> = {
      'design-system.json': ['design-system', 'design-system.schema.json'],
      'components.json': ['design-system', 'components.schema.json'],
      'rules.yaml': ['rules', 'rules-config.schema.json'],
      'ia.json': ['screens', 'ia.schema.json'],
      'modules.json': ['architecture', 'modules.schema.json'],
    };
    for (const f of PACK_FILES) {
      const [module, file] = own[f.name]!;
      const schema = JSON.parse(readFileSync(pluginPath('modules', module!, 'schema', file!), 'utf8')) as { properties: { schema: { const: number } } };
      expect(schema.properties.schema.const, f.name).toBe(f.schema);
    }
  });

  it('finds components.json where design-system.json says it is', () => {
    const files = supported();
    files['design-system/design-system.json'] = { ...JSON.parse(files['design-system/design-system.json'] as string), components: 'registry/components.json' };
    files['design-system/registry/components.json'] = files['design-system/components.json']!;
    delete files['design-system/components.json'];
    const project = loadProject(tempProject(files));
    expect(PACK_FILES.find((f) => f.name === 'components.json')!.path(project)).toBe('design-system/registry/components.json');
  });
});

describe('an unsupported schema fails closed', () => {
  it('runs every check when each file is at a schema this fwos reads (the control)', async () => {
    const results = await runChecks(loadProject(tempProject(supported())));
    expect(results.filter((r) => GATES.includes(r.id)).map((r) => [r.id, r.status])).toEqual(GATES.map((g) => [g, 'pass']));
    expect(results.filter((r) => r.reason?.startsWith('stopped:')).map((r) => r.id)).toEqual([]);
  });

  it.each([...PACK, ...RECORDS])('%s from a newer schema stops every check but the gates', async (file) => {
    const results = await runChecks(loadProject(tempProject(withSchema(file, 2))));
    const schema = results.find((r) => r.id === 'state/schema')!;
    expect(schema.status).toBe('fail');
    expect(schema.findings).toContainEqual({ file, rule: 'schema-version', message: expect.stringMatching(/^schema 2 unsupported \(this fwos reads [\w. -]+ schema 1\); upgrade fwos$/) });
    // Nothing that isn't a gate ran: no partial result to read as a pass.
    for (const r of results.filter((x) => !GATES.includes(x.id))) {
      expect(r.status, r.id).toBe('off');
      expect(r.reason, r.id).toMatch(/^stopped: state\/schema failed/);
    }
  });

  it('points an older schema at fwos update, which migrates it or says what to change', async () => {
    const results = await runChecks(loadProject(tempProject(withSchema('docs/app/ia.json', 0))));
    expect(results[0]!.findings).toEqual([
      { file: 'docs/app/ia.json', rule: 'schema-version', message: 'schema 0 unsupported (this fwos reads ia.json schema 1); run `fwos update`, which migrates it or says what to change' },
    ]);
  });

  it('names the schema this fwos reads for its own records too', async () => {
    const files = supported();
    files['.fwos/state.json'] = { ...(files['.fwos/state.json'] as object), schema: 2 };
    const r = (await runChecks(loadProject(tempProject(files))))[0]!;
    expect(r.findings).toContainEqual({ file: '.fwos/state.json', rule: 'schema-version', message: 'schema 2 unsupported (this fwos reads state.json schema 1); upgrade fwos' });
  });

  it('leaves a pack file that does not parse to the check that reads it', async () => {
    const files = supported();
    files['docs/app/ia.json'] = '{ "schema": 1, ';
    const results = await runChecks(loadProject(tempProject(files)));
    expect(results.find((r) => r.id === 'state/schema')!.status).toBe('pass');
    expect(results.find((r) => r.id === 'screens/ia')!.findings[0]!.message).toMatch(/not valid JSON/);
  });

  it('tells the agent at session start, before it builds anything', () => {
    expect(sessionContext(tempProject(withSchema('docs/app/modules.json', 3)))).toContain(
      "fwos: docs/app/modules.json is schema 3, which this fwos doesn't read, so `fwos check` stops before any check runs. Upgrade fwos, then run /fwos:doctor.",
    );
    expect(sessionContext(tempProject(withSchema('design-system/rules.yaml', 0)))).toContain(
      "fwos: design-system/rules.yaml is schema 0, which this fwos doesn't read, so `fwos check` stops before any check runs. Run `fwos update`, which migrates it or says what to change.",
    );
  });

  it('says nothing about the pack at session start while every file is supported', () => {
    expect(sessionContext(tempProject(supported()))).not.toMatch(/doesn't read/);
  });
});
