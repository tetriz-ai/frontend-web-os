// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// `fwos change map` on web: what a change touches, read from the app's code. A route's page and
// what wraps it, everything they import, the UI components among them, the API routes they call
// and the server actions they import, the existing tests that import the page or visit the route,
// and who owns it. Nothing is guessed: a target that matches no route or file is refused.

import { afterAll, describe, expect, it } from 'vitest';
import { loadProject } from '../../../kernel/index.ts';
import { cleanupTempProjects, tempProject } from '../../../kernel/testing.ts';
import { mapChange, matchRoute } from '../index.ts';

afterAll(cleanupTempProjects);

const state = { schema: 1, pluginVersion: '0.1.0', mode: 'adopt', platforms: ['web'], adopt: { level: 'delivery' }, paths: { apps: { web: '.' }, source: ['app/**', 'components/**', 'lib/**'], ui: { web: 'components/ui' } } };

const APP = {
  '.fwos/state.json': state,
  'package.json': { dependencies: { next: '15.3.0' } },
  'tsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } } },
  'app/globals.css': ':root { --background: #fff; }\n',
  'app/layout.tsx': "import './globals.css';\nimport { getUser } from '@/lib/session';\nexport default function Root({ children }: { children: React.ReactNode }) {\n  return children;\n}\n",
  'app/(dashboard)/layout.tsx': "import { Button } from '@/components/ui/button';\nexport default function Dashboard({ children }: { children: React.ReactNode }) {\n  return children;\n}\n",
  'app/(dashboard)/members/page.tsx': `'use client';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { removeMember } from '@/app/actions';
// A comment that mentions '/api/settings' is not a call.
export default function Members({ id }: { id: string }) {
  const { data } = useSWR('/api/members', (u: string) => fetch(u).then((r) => r.json()));
  const remove = () => fetch(\`/api/members/\${id}\`, { method: 'DELETE' });
  return <Input />;
}
`,
  'app/(dashboard)/members/loading.tsx': 'export default function Loading() {\n  return null;\n}\n',
  'app/(dashboard)/members/[id]/page.tsx': 'export default function Member() {\n  return null;\n}\n',
  'app/(dashboard)/settings/page.tsx': "import { Card } from '@/components/ui/card';\nexport default function Settings() {\n  return null;\n}\n",
  'app/api/members/route.ts': "import { db } from '@/lib/db';\nexport async function GET() {\n  return Response.json(db);\n}\nexport async function POST() {\n  return Response.json({});\n}\n",
  'app/api/members/[id]/route.ts': 'export const DELETE = async () => new Response(null);\n',
  'app/api/settings/route.ts': 'export async function GET() {\n  return Response.json({});\n}\n',
  'app/actions.ts': "'use server';\nimport { db } from '@/lib/db';\nexport async function removeMember() {}\nexport async function renameTeam() {}\n",
  'lib/db.ts': 'export const db = {};\n',
  'lib/session.ts': 'export const getUser = () => null;\n',
  'components/ui/button.tsx': 'export const Button = () => null;\n',
  'components/ui/input.tsx': 'export const Input = () => null;\n',
  'components/ui/card.tsx': 'export const Card = () => null;\n',
  'app/(dashboard)/members/members.test.tsx': "import Members from './page';\nit('lists them', () => {});\n",
  'e2e/members.spec.ts': "test('opens', async ({ page }) => {\n  await page.goto('/members');\n});\n",
  'e2e/settings.spec.ts': "test('opens', async ({ page }) => {\n  await page.goto('/settings');\n});\n",
  'lib/db.test.ts': "import { db } from './db';\nit('is there', () => {});\n",
  '.github/CODEOWNERS': '# Who reviews what\n* @example-org/web\n/app/(dashboard)/members/ @example-org/members @example-owner\n',
};

describe('matchRoute', () => {
  it('matches literal segments first, then dynamic and catch-all ones', () => {
    const routes = ['/members', '/members/[id]', '/members/export', '/docs/[...slug]', '/shop/[[...rest]]'];
    expect(matchRoute('/members', routes)).toBe('/members');
    expect(matchRoute('/members/export', routes)).toBe('/members/export');
    expect(matchRoute('/members/42', routes)).toBe('/members/[id]');
    expect(matchRoute('/docs/a/b', routes)).toBe('/docs/[...slug]');
    expect(matchRoute('/shop', routes)).toBe('/shop/[[...rest]]');
    expect(matchRoute('/members/[]', routes)).toBe('/members/[id]');
    expect(matchRoute('/nope', routes)).toBeNull();
  });
});

describe("mapChange: what a change touches, from the app's code", () => {
  it('reads a route: its page, what wraps it, what it imports, its data calls, its tests and owners', () => {
    const m = mapChange(loadProject(tempProject(APP)), ['/members']);
    expect(m.targets).toEqual([{ target: '/members', file: 'app/(dashboard)/members/page.tsx' }]);
    expect(m.wrappers).toEqual(['app/(dashboard)/layout.tsx', 'app/(dashboard)/members/loading.tsx', 'app/layout.tsx']);
    expect(m.components).toEqual(['components/ui/button.tsx', 'components/ui/input.tsx']);
    expect(m.data).toEqual([
      { kind: 'api', what: 'GET, POST /api/members', file: 'app/api/members/route.ts' },
      { kind: 'api', what: 'DELETE /api/members/[id]', file: 'app/api/members/[id]/route.ts' },
      { kind: 'action', what: 'removeMember', file: 'app/actions.ts' },
    ]);
    // Everything the page renders, the handlers it calls, and their own imports; nothing else.
    expect(m.files).toEqual([
      'app/(dashboard)/layout.tsx',
      'app/(dashboard)/members/loading.tsx',
      'app/(dashboard)/members/page.tsx',
      'app/actions.ts',
      'app/api/members/[id]/route.ts',
      'app/api/members/route.ts',
      'app/globals.css',
      'app/layout.tsx',
      'components/ui/button.tsx',
      'components/ui/input.tsx',
      'lib/db.ts',
      'lib/session.ts',
    ]);
    expect(m.tests).toEqual([
      { file: 'app/(dashboard)/members/members.test.tsx', via: 'imports app/(dashboard)/members/page.tsx' },
      { file: 'e2e/members.spec.ts', via: 'visits /members' },
    ]);
    expect(m.owners).toEqual(['@example-org/members', '@example-owner']);
  });

  it('reads a dynamic route by any URL it serves, and a file by its path', () => {
    const p = loadProject(tempProject(APP));
    expect(mapChange(p, ['/members/42']).targets).toEqual([{ target: '/members/42', file: 'app/(dashboard)/members/[id]/page.tsx' }]);
    const m = mapChange(p, ['components/ui/input.tsx']);
    expect(m.targets).toEqual([{ target: 'components/ui/input.tsx', file: 'components/ui/input.tsx' }]);
    expect(m.wrappers).toEqual([]);
    expect(m.owners).toEqual(['@example-org/web']);
  });

  it('refuses what matches no route or file, naming the routes there are', () => {
    expect(() => mapChange(loadProject(tempProject(APP)), ['/memebers'])).toThrow(/\/memebers matches no route or file\. Routes: \/members, \/members\/\[id\], \/settings/);
  });
});
