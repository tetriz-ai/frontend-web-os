// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { afterAll, describe, expect, it } from 'vitest';
import { type CheckResult, loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { SPEC_SECTIONS, acReferences, checks, featureOf, parseAcs } from '../index.ts';

afterAll(cleanupTempProjects);

export const sampleSpec = (acs: string) => `---
based_on: [brief.md@000000000000]
---
# Reading list: spec

${SPEC_SECTIONS.filter((s) => s !== 'Acceptance criteria')
  .map((s, i) => `## ${i + 1}. ${s}\n\nText.\n`)
  .join('\n')}
## 10. Acceptance criteria

${acs}
`;

const ACS = `### AC-reading-1: Saving a link puts it first
- Journey: J1
- Given an empty list, when I save https://example.com, then it is the first row.
- Proven against: local
- Release: first

### AC-reading-2 - Marking an item read moves it to Read
- **Proven against**: local (no backend yet)

### AC-sharing-1: Share a link
- Proven against: real
- Release: later

### AC-a11y-1: VoiceOver reads each row
- Proven against: real
- Manual: needs a person with a screen reader; no reliable automation on Mac

\`\`\`
### AC-fake-1: inside a code fence is ignored
\`\`\`
`;

describe('parseAcs', () => {
  it('reads IDs, titles, fields, release and manual reasons', () => {
    const acs = parseAcs(ACS);
    expect(acs.map((a) => [a.id, a.title, a.provenAgainst, a.release, a.manual ?? ''])).toEqual([
      ['AC-reading-1', 'Saving a link puts it first', 'local', 'first', ''],
      ['AC-reading-2', 'Marking an item read moves it to Read', 'local', 'first', ''],
      ['AC-sharing-1', 'Share a link', 'real', 'later', ''],
      ['AC-a11y-1', 'VoiceOver reads each row', 'real', 'first', 'needs a person with a screen reader; no reliable automation on Mac'],
    ]);
    expect(acs[0]!.fields.journey).toBe('J1');
    expect(acs[0]!.line).toBe(1);
  });

  it('knows the feature of an ID', () => {
    expect(featureOf('AC-reading-list-12')).toBe('reading-list');
  });

  it('finds every reference with its line', () => {
    expect(acReferences('see AC-x-1\nand AC-x-10, not AC-x')).toEqual([
      { id: 'AC-x-1', line: 1 },
      { id: 'AC-x-10', line: 2 },
    ]);
  });
});

const run = async (root: string) => (await checks[0]!.run({ project: loadProject(root), adapters: { profiles: [], get: () => undefined } })) as CheckResult;

describe('spec/format', () => {
  it('passes a complete spec', async () => {
    const r = await run(tempProject({ 'docs/app/spec.md': sampleSpec(ACS) }));
    expect(r.findings).toEqual([]);
    expect(r.info).toEqual(['4 ACs (3 first release)']);
    const one = await run(tempProject({ 'docs/app/spec.md': sampleSpec(ACS.slice(0, ACS.indexOf('\n### '))) }));
    expect(one.info).toEqual(['1 AC (1 first release)']);
  });

  it('is off with no spec', async () => {
    expect((await run(tempProject())).status).toBe('off');
  });

  it('catches missing sections, duplicates, missing proven-against, thin manual reasons and dangling references', async () => {
    const acs = `### AC-x-1: one
- Proven against: mock
### AC-x-1: again
- Proven against: mock
### AC-x-2: two
- Manual: n/a
See AC-x-9.
`;
    const spec = sampleSpec(acs).replace(/## \d+\. Open questions/, '## 11. Questions');
    const r = await run(tempProject({ 'docs/app/spec.md': spec }));
    expect(r.findings.map((f) => f.rule)).toEqual(['section', 'ac-duplicate', 'ac-proven-against', 'ac-manual', 'ac-reference']);
  });

  it('flags an AC heading the ID pattern rejects instead of dropping it', async () => {
    const acs = `### AC-list-1: Saves a link
- Proven against: local

### AC-List-2: Deletes a link
- Proven against: local

### AC-read_later-3: Marks read
- Proven against: local

#### ac-list-4: Lowercase prefix
##### AC-list-5: Too deep a heading
### AC-café-6: Non-ASCII feature

\`\`\`
### AC-Fenced-7: inside a code fence is ignored
\`\`\`
`;
    expect(parseAcs(acs).map((a) => a.id)).toEqual(['AC-list-1']);
    const r = await run(tempProject({ 'docs/app/spec.md': sampleSpec(acs) }));
    const malformed = r.findings.filter((f) => f.rule === 'ac-malformed');
    expect(malformed.map((f) => f.message.split(' is not')[0])).toEqual([
      '"AC-List-2: Deletes a link"',
      '"AC-read_later-3: Marks read"',
      '"ac-list-4: Lowercase prefix"',
      '"AC-list-5: Too deep a heading"',
      '"AC-café-6: Non-ASCII feature"',
    ]);
    expect(malformed[0]!.message).toMatch(/### AC-<feature>-<n>: <title>.*lowercase letters, digits and hyphens/);
    expect(r.status).toBe('fail');
  });

  it('flags a spec over the size ceiling', async () => {
    const r = await run(tempProject({ 'docs/app/spec.md': sampleSpec(ACS) + 'x'.repeat(61_000) }));
    expect(r.findings.map((f) => f.rule)).toEqual(['size']);
  });
});
