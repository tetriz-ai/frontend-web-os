// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos prototype`: check a bundle, promote it once its inputs are committed (pinning each by hash
// in .fwos/prototypes.json, which only the CLI writes), see it go stale when one changes, and
// compare its intended IA with the real app's routes and fresh runs of fwos's IA harness.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type IaRun, hashText, loadProject, revisionOf, writeRun } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject, writeFiles } from '../../../kernel/testing.ts';
import { dispatch } from '../../hooks/index.ts';
import type { Io } from '../commands.ts';
import { main } from '../main.ts';

afterAll(cleanupTempProjects);

async function fwos(cwd: string, ...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (...l) => out.push(...l), err: (...l) => err.push(...l), cwd };
  const code = await main(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const commit = (root: string) => {
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=fwos test', '-c', 'user.email=fwos@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'bundle');
};

const home = { id: 'home', title: 'Home', route: '/', kind: 'nav', order: 1, states: ['ready'] };
const list = { id: 'list', title: 'Reading list', route: '/list', kind: 'nav', order: 2, states: ['ready'] };
const members = { id: 'members', title: 'Members', route: '/members', kind: 'nav', order: 3, visibleTo: ['admin'], flag: 'members-enabled', states: ['ready'] };
const IA = { schema: 1, roles: ['member', 'admin'], flags: ['members-enabled'], pages: [home, list, members] };
const DIR = 'docs/app/prototypes/members';
const BUNDLE = {
  schema: 1,
  id: 'members',
  title: 'Members under /team',
  pages: ['members'],
  visual: [{ kind: 'figma', ref: 'https://example.com/design/design/abc123/Members' }],
  companion: [{ kind: 'route', page: 'members', ref: '/fwos-screens/members' }],
  states: `${DIR}/states.md`,
  spec: 'docs/app/spec.md#members',
  ia: `${DIR}/ia.json`,
};
const page = (id: string) => `import { guardPage } from '@/shared/session';\n\nexport default async function Page() {\n  await guardPage('${id}');\n  return null;\n}\n`;

/** A web app with three guarded routes, its IA, and a bundle that moves members under /team and hides the list from members. */
async function project() {
  const root = tempProject({
    'apps/web/package.json': { name: 'web', dependencies: { next: '16.4.0' } },
    'apps/web/app/page.tsx': page('home'),
    'apps/web/app/list/page.tsx': page('list'),
    'apps/web/app/members/page.tsx': page('members'),
    'docs/app/ia.json': IA,
    'docs/app/spec.md': '# Spec\n\n## Members\n\n### AC-members-1: Admins see the members\n- Given ...\n',
    [`${DIR}/bundle.json`]: BUNDLE,
    [`${DIR}/ia.json`]: { ...IA, pages: [home, { ...list, visibleTo: ['admin'] }, { ...members, route: '/team/members' }] },
    [`${DIR}/states.md`]: '## members\n- ready: the members table\n',
  });
  expect((await fwos(root, 'init', '--name', 'Bundles')).code).toBe(0);
  return root;
}

describe('fwos prototype check', () => {
  it('says a valid bundle is ready to promote, and lists what stops another', async () => {
    const root = await project();
    const ok = await fwos(root, 'prototype', 'check');
    expect(ok.code).toBe(0);
    expect(ok.out).toBe(`members  ${DIR}/bundle.json\n  ready to promote: fwos prototype promote members --by "<who>"`);
    writeFiles(root, { [`${DIR}/bundle.json`]: { ...BUNDLE, visual: [{ kind: 'html', ref: 'working/members.html' }] }, 'working/members.html': '<p>draft</p>\n' });
    const bad = await fwos(root, 'prototype', 'check', '--json');
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.out).bundles).toEqual([
      expect.objectContaining({ id: 'members', problems: ["visual working/members.html is in working/: a promoted bundle can't rest on a draft"], promoted: null, stale: [] }),
    ]);
  });

  it('says so when there is no bundle', async () => {
    const root = tempProject({});
    await fwos(root, 'init');
    expect(await fwos(root, 'prototype', 'check')).toMatchObject({ code: 0, out: 'No prototype bundles yet: each is docs/app/prototypes/<id>/bundle.json.' });
  });
});

describe('fwos prototype promote', () => {
  it('refuses until every input is committed, then pins each by hash; a later edit makes it stale', async () => {
    const root = await project();
    expect(await fwos(root, 'prototype', 'promote', 'members', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringContaining("isn't in a git repository, so fwos can't tell its inputs are committed") });
    git(root, 'init', '-q');
    commit(root);
    writeFiles(root, { [`${DIR}/states.md`]: '## members\n- ready: the members table, one row each\n' });
    expect(await fwos(root, 'prototype', 'promote', 'members', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringContaining(`commit these first: ${DIR}/states.md`) });
    commit(root);
    const r = await fwos(root, 'prototype', 'promote', 'members', '--by', 'Ada');
    expect(r).toMatchObject({ code: 0, out: 'Promoted members: 4 inputs pinned in .fwos/prototypes.json.\nCompare it with the app: fwos prototype diff members' });
    const record = JSON.parse(readFileSync(join(root, '.fwos/prototypes.json'), 'utf8'));
    expect(record).toMatchObject({ schema: 1, bundles: { members: { bundle: `${DIR}/bundle.json`, by: 'Ada', at: expect.any(String) } } });
    expect(Object.keys(record.bundles.members.inputs).sort()).toEqual([`${DIR}/bundle.json`, `${DIR}/ia.json`, `${DIR}/states.md`, 'docs/app/spec.md#members']);
    expect((await fwos(root, 'prototype', 'check')).out).toMatch(/^members {2}docs\/app\/prototypes\/members\/bundle\.json\n {2}promoted by Ada on \d{4}-\d{2}-\d{2}, and current$/);
    // Only the CLI writes the record: the agent's edit tools can't forge or refresh a promotion.
    const deny = JSON.parse(dispatch('pre-tool-use', { tool_name: 'Write', cwd: root, tool_input: { file_path: join(root, '.fwos/prototypes.json'), content: '{}' } }).stdout);
    expect(deny.hookSpecificOutput.permissionDecision).toBe('deny');
    writeFiles(root, { [`${DIR}/ia.json`]: IA });
    const stale = await fwos(root, 'prototype', 'check');
    expect(stale.code).toBe(1);
    expect(stale.out).toContain(`  stale: ${DIR}/ia.json changed since Ada promoted it on`);
  });

  it('refuses a bundle with problems, naming each', async () => {
    const root = await project();
    git(root, 'init', '-q');
    writeFiles(root, { [`${DIR}/states.md`]: '## members\n- ready: the table\n- error: it failed\n' });
    commit(root);
    expect(await fwos(root, 'prototype', 'promote', 'members', '--by', 'Ada')).toMatchObject({
      code: 2,
      err: expect.stringContaining('members can\'t be promoted:\n  states.md: members lists "error", which the bundle\'s ia.json doesn\'t give it'),
    });
    expect(await fwos(root, 'prototype', 'promote', 'nope', '--by', 'Ada')).toMatchObject({ code: 2, err: expect.stringContaining('No prototype bundle "nope"') });
  });
});

describe('fwos prototype diff', () => {
  /** Fresh runs of fwos's own IA harness, as `fwos harness record` keeps them, showing what the app does now. */
  async function ran(root: string) {
    expect((await fwos(root, 'harness')).code).toBe(0);
    const p = loadProject(root);
    const sha = hashText(readFileSync(join(root, 'apps/web/e2e/fwos-ia.spec.ts'), 'utf8'));
    const run = (role: string, flags: string[], open: string[]): IaRun => ({
      role,
      flags,
      applied: true,
      nav: open,
      visits: [home, list, members].map((x) => ({ page: x.id, path: x.route, status: open.includes(x.route) ? 200 : 404, finalPath: x.route, notFound: !open.includes(x.route) })),
    });
    for (const r of [run('member', ['members-enabled'], ['/', '/list']), run('member', [], ['/', '/list']), run('admin', ['members-enabled'], ['/', '/list', '/members']), run('admin', [], ['/', '/list'])]) {
      writeRun(p, {
        schema: 1,
        kind: 'ia',
        target: [r.role, ...r.flags].join('+'),
        fwos: '0.1.0',
        harness: { file: 'apps/web/e2e/fwos-ia.spec.ts', sha },
        revision: revisionOf(p),
        config: { server: 'production build', browser: 'chromium' },
        at: '2026-10-23T00:00:00.000Z',
        observations: r,
      });
    }
  }

  it("compares the intended IA with the app's routes, and with who sees what in fresh runs of the IA harness", async () => {
    const root = await project();
    const routesOnly = await fwos(root, 'prototype', 'diff', 'members');
    expect(routesOnly).toMatchObject({ code: 0 });
    expect(routesOnly.out).toBe(
      [
        '~ moved        members: the bundle puts it at /team/members; the app has it at /members',
        "  not compared: no fresh run of fwos's IA harness, so only routes are compared, not who sees what (run the end-to-end tests)",
      ].join('\n'),
    );
    await ran(root);
    expect((await fwos(root, 'prototype', 'diff', 'members')).out).toBe(
      ['~ moved        members: the bundle puts it at /team/members; the app has it at /members', '! hidden       list: the bundle hides it from member; the app lets member open it'].join('\n'),
    );
    const j = JSON.parse((await fwos(root, 'prototype', 'diff', 'members', '--json')).out);
    expect(j).toMatchObject({ id: 'members', changes: [{ kind: 'moved', id: 'members' }, { kind: 'hidden', id: 'list', role: 'member' }], notCompared: [] });
    // A run of older code doesn't count: the app changed since.
    writeFiles(root, { 'apps/web/app/list/page.tsx': `${page('list')}// changed\n` });
    expect((await fwos(root, 'prototype', 'diff', 'members')).out).toContain("not compared: no fresh run of fwos's IA harness");
  });
});
