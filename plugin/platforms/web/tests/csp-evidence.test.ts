// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT
import { afterAll, expect, it } from 'vitest';
import { cleanupTempProjects, contextFor, tempProject } from '../../../kernel/testing.ts';
import { profile } from '../index.ts';
const checks = profile.checks;
afterAll(cleanupTempProjects);
const header = (value: string) => `export default {headers: async () => [{source:'/:path*', headers:[{key:'Content-Security-Policy', value:${value}}]}]}`;
it.each([
  ["const csp=''; " + header('csp'), 'fail'],
  [header('"not-a-real-directive value"'), 'fail'],
  [header('" ; ; "'), 'fail'],
  [header('"default-src \'self\'"'), 'pass'],
  ["const csp=\"default-src 'self'\"; " + header('csp'), 'pass'],
  ["const unused={key:'Content-Security-Policy',value:\"default-src 'self'\"}; export default {};", 'fail'],
  [header('process.env.CSP'), 'off'],
  ["const config=readConfig(); export default config;", 'off'],
  [header('"default-src \'self\'"').replace('/:path*', '/not-a-route'), 'fail'],
])('requires an exported literal response policy: %s', async (source, status) => {
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/next.config.ts': source!, 'apps/web/app/page.tsx': 'export default function Page(){return null;}' });
  const result = await checks.find((c) => c.id === 'web/security')!.run(contextFor(root));
  expect(result.status).toBe(status);
  if (status === 'off') expect(result.reason).toMatch(/CSP|Content-Security-Policy/);
});
it.each([
  [`export function middleware(req) {req.headers.set('Content-Security-Policy',"default-src 'self'"); return NextResponse.next();}`, 'fail'],
  [`export function middleware() {const unused={'Content-Security-Policy':"default-src 'self'"}; return NextResponse.next();}`, 'fail'],
  [`export function middleware() {const res=NextResponse.next(); res.headers.set('Content-Security-Policy',"default-src 'self'"); return res;}`, 'pass'],
  [`export function middleware() {const res=NextResponse.next(); res.headers.set('Content-Security-Policy',process.env.CSP); return res;}`, 'off'],
])('checks returned middleware responses: %s', async (source, status) => {
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/next.config.ts': 'export default {};', 'apps/web/middleware.ts': source! });
  expect((await checks.find((c) => c.id === 'web/security')!.run(contextFor(root))).status).toBe(status);
});
it('does not treat an unused exported component meta tag as static root delivery', async () => {
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/next.config.ts': "export default {output:'export'};", 'apps/web/app/layout.tsx': 'export default function L({children}){return <html><body>{children}</body></html>;}', 'apps/web/src/unused.tsx': 'export default function Unused(){return <meta httpEquiv="Content-Security-Policy" content="default-src self"/>;}' });
  expect((await checks.find((c) => c.id === 'web/security')!.run(contextFor(root))).status).toBe('fail');
});
it('reports a dynamic root meta policy as undetermined', async () => {
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/next.config.ts': "export default {output:'export'};", 'apps/web/app/layout.tsx': 'export default function L(){return <html><head><meta httpEquiv="Content-Security-Policy" content={process.env.CSP}/></head></html>;}' });
  expect((await checks.find((c) => c.id === 'web/security')!.run(contextFor(root))).status).toBe('off');
});

it.each([
  ["res.headers.delete('Content-Security-Policy');", 'fail'],
  ["const alias = res; alias.headers.delete('Content-Security-Policy');", 'fail'],
  ["res.headers.delete('X-Unrelated');", 'pass'],
  ["res.headers = new Headers();", 'off'],
  ["mutate(res.headers);", 'off'],
  ["res.headers.delete(keyFromRequest);", 'off'],
] as const)('tracks response policy mutations after set: %s', async (mutation, expected) => {
  const source = `export function middleware(){const res=NextResponse.next(); res.headers.set('Content-Security-Policy', "default-src 'self'"); ${mutation} return res;}`;
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/middleware.ts': source });
  expect((await checks.find((c) => c.id === 'web/security')!.run(contextFor(root))).status).toBe(expected);
});

// These shapes escape the small direct-statement evaluator; they must never retain a prior PASS.
it.each([
  "const headers=res.headers; headers.delete('Content-Security-Policy');",
  "const ignored=((r)=>r.headers.delete('Content-Security-Policy'))(res);",
  "for(let i=0;i<1;i++) res.headers.delete('Content-Security-Policy');",
  "const {headers}=res; headers.delete('Content-Security-Policy');",
  "const headers=res.headers; res.headers.set('Content-Security-Policy', \"default-src 'self'\"); headers.delete('Content-Security-Policy');",
  "const ignored=mutate({nested:res}); res.headers.set('Content-Security-Policy', \"default-src 'self'\");",
] as const)('keeps unmodeled response escapes/control flow undetermined: %s', async (mutation) => {
  const source = `export function middleware(){const res=NextResponse.next(); res.headers.set('Content-Security-Policy', "default-src 'self'"); ${mutation} return res;}`;
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/middleware.ts': source });
  const result = await checks.find((c) => c.id === 'web/security')!.run(contextFor(root));
  expect(result.status).toBe('off');
  expect(result.reason).toMatch(/cannot be determined statically/);
});

it('preserves a direct append on a response alias', async () => {
  const source = `export function middleware(){const res=NextResponse.next(); const alias=res; alias.headers.append('Content-Security-Policy', "default-src 'self'"); return res;}`;
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/middleware.ts': source });
  expect((await checks.find((c) => c.id === 'web/security')!.run(contextFor(root))).status).toBe('pass');
});

it.each([
  `function remove(){res.headers.delete('Content-Security-Policy');} const res=new Response(null);res.headers.set('Content-Security-Policy',"default-src 'self'");remove();return res;`,
  `const holder={get value(){res.headers.delete('Content-Security-Policy');return 1;}}; const res=new Response(null);res.headers.set('Content-Security-Policy',"default-src 'self'");const ignored=holder.value;return res;`,
  `function remove(){res.headers.delete('Content-Security-Policy');} const res=new Response(null);res.headers.set('Content-Security-Policy',"default-src 'self'");const ignored=remove();res.headers.set('Content-Security-Policy',"default-src 'self'");return res;`,
])('keeps implicit closure execution undetermined: %s', async (body) => {
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/middleware.ts': `export function middleware(){${body}}` });
  expect((await checks.find((c) => c.id === 'web/security')!.run(contextFor(root))).status).toBe('off');
});
it.each([
  `function unused(){} const res=new Response(null); const label='ready'; const options={enabled:true,labels:['one','two']}; res.headers.set('Content-Security-Policy',"default-src 'self'");return res;`,
  `const res=new Response(null,{headers:{'Content-Security-Policy':"default-src 'self'"}}); const alias=res; const ready=true; return alias;`,
])('preserves ordinary literal setup and direct response constructors: %s', async (body) => {
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/middleware.ts': `export function middleware(){${body}}` });
  expect((await checks.find((c) => c.id === 'web/security')!.run(contextFor(root))).status).toBe('pass');
});

const cspEntry = (extra = '', value = `"default-src 'self'"`) => `{source:'/:path*', ${extra} headers:[{key:'Content-Security-Policy',value:${value}}]}`;
it.each([
  [cspEntry("has:[{type:'header',key:'x-preview',value:'yes'}],"), 'off'],
  [cspEntry("missing:[{type:'cookie',key:'session'}],"), 'off'],
  [cspEntry('has:requestPredicates,'), 'off'],
  [cspEntry('missing:requestPredicates,'), 'off'],
  [cspEntry('has:undefined,'), 'off'],
  [cspEntry('has:[],missing:[],'), 'pass'],
  [cspEntry(), 'pass'],
  [cspEntry() + ',' + cspEntry("has:[{type:'header',key:'x-preview'}],", "''"), 'off'],
  [cspEntry("missing:[{type:'header',key:'x-preview'}],", "''") + ',' + cspEntry(), 'off'],
  [cspEntry() + ',' + cspEntry("has:[{type:'header',key:'x-preview'}],"), 'off'],
  [`{source:'/:path*',has:[{type:'header',key:'x-preview'}],headers:[{key:'X-Preview',value:'yes'}]},` + cspEntry(), 'pass'],
] as const)('requires unconditional config CSP delivery, including overlapping rows: %s', async (entries, expected) => {
  const root = tempProject({ 'apps/web/package.json': '{}', 'apps/web/next.config.ts': `export default {headers:async()=>[${entries}]}` });
  const result = await checks.find((check) => check.id === 'web/security')!.run(contextFor(root));
  expect(result.status).toBe(expected);
  if (expected === 'off') expect(result.reason).toContain('cannot be determined statically');
});
