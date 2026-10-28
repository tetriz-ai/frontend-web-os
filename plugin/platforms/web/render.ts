// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The verify driver's render: start the app's own Next.js dev server with the screens browser on,
// open one state fixture in Chromium through the app's own Playwright, open the app as a role when
// asked, and stop the server. `fwos doctor --start` runs it before it calls the driver active.
// Nothing here is bundled: Next.js and Playwright come from the app's node_modules.

import { type ChildProcess, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { type AddressInfo, connect, createServer } from 'node:net';
import { dirname, join } from 'node:path';
import type { RenderProbe, RenderRequest } from '../../kernel/index.ts';

/** How long the app gets to come up, and a page to compile on its first open. */
const START_MS = 180_000;

// The few parts of Playwright's API this uses, from the app's own copy.
interface Page {
  goto(url: string, opts: { waitUntil: 'networkidle'; timeout: number }): Promise<{ status(): number } | null>;
  on(event: 'pageerror', fn: (e: Error) => void): void;
  evaluate<T>(expression: string): Promise<T>;
}
interface Context {
  addCookies(cookies: { name: string; value: string; url: string }[]): Promise<void>;
  newPage(): Promise<Page>;
  close(): Promise<void>;
}
interface Browser {
  version(): string;
  newContext(): Promise<Context>;
  close(): Promise<void>;
}

const firstLine = (s: string) => s.split('\n')[0]!.trim();
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').trim();
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });
}

/** Whether something accepts connections at the URL's host and port. */
function listening(url: string): Promise<boolean> {
  const u = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: u.hostname === 'localhost' ? '127.0.0.1' : u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) });
    socket.setTimeout(2_000);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

/** The app's `next dev` on a free port, up and accepting connections, or why it isn't. */
async function startNext(appAbs: string, nextBin: string): Promise<{ url: string; child: ChildProcess } | { reason: string }> {
  const port = await freePort();
  const child = spawn(process.execPath, [nextBin, 'dev', '--port', String(port)], {
    cwd: appAbs,
    // The screens browser, and the test identity the IA harness uses: never set in a real deployment.
    env: { ...process.env, FWOS_SCREENS: '1', FWOS_TEST_ACCESS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const said: string[] = [];
  const keep = (b: Buffer) => {
    for (const line of b.toString().split('\n').map(plain)) if (line) said.push(line);
    said.splice(0, Math.max(0, said.length - 20));
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const exited = new Promise<number>((done) => child.once('exit', (code) => done(code ?? 1)));
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + START_MS;
  while (Date.now() < deadline) {
    const code = await Promise.race([exited, wait(300).then(() => null)]);
    if (code !== null) return { reason: `the app stopped before it was up (exit ${code})${said.length > 0 ? `: ${said.at(-1)}` : ''}` };
    if (await listening(url)) return { url, child };
  }
  await stop(child);
  return { reason: `the app wasn't up after ${START_MS / 1000}s${said.length > 0 ? ` (it last said: ${said.at(-1)})` : ''}` };
}

/** Stops the dev server and everything it started. */
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('exit', done));
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32' || !child.pid) child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch {
      // Already gone.
    }
  };
  kill('SIGTERM');
  await Promise.race([exited, wait(5_000)]);
  if (child.exitCode === null && child.signalCode === null) kill('SIGKILL');
}

/** In the page: what the fixture container holds once the page settled, or null when there is none. */
const READ_FIXTURE = String.raw`(() => {
  const el = document.querySelector('[data-fwos-fixture]');
  if (!el) return null;
  return { missing: el.hasAttribute('data-fwos-missing'), nodes: el.querySelectorAll('*').length, text: (el.textContent || '').replace(/\s+/g, ' ').trim() };
})()`;

/** In the page: the role and flags the layout says it rendered for (its fwos-access meta), or null. */
const READ_ACCESS = `document.querySelector('meta[name="fwos-access"]')?.getAttribute('content') ?? null`;

/** Renders `request.fixture` in the app at `app` (relative to the root at `root`). */
export async function renderFixture(root: string, app: string, request: RenderRequest): Promise<RenderProbe> {
  const appAbs = join(root, app);
  const require = createRequire(join(appAbs, 'package.json'));
  const resolve = (spec: string) => {
    try {
      return require.resolve(spec);
    } catch {
      return null;
    }
  };
  let nextBin: string | null = null;
  if (!request.url) {
    const manifest = resolve('next/package.json');
    if (!manifest) return { ok: false, reason: `next isn't installed in ${app} (run pnpm install)` };
    nextBin = join(dirname(manifest), 'dist', 'bin', 'next');
  }
  const playwright = resolve('@playwright/test');
  if (!playwright) return { ok: false, reason: `@playwright/test isn't installed in ${app} (run pnpm install)` };

  let child: ChildProcess | null = null;
  let base = request.url?.replace(/\/$/, '');
  try {
    if (base) {
      if (!(await listening(base))) return { ok: false, reason: `nothing answered at ${base}` };
    } else {
      const started = await startNext(appAbs, nextBin!);
      if ('reason' in started) return { ok: false, reason: started.reason };
      child = started.child;
      base = started.url;
    }
    const { chromium } = require(playwright) as { chromium?: { launch(): Promise<Browser> } };
    if (!chromium) return { ok: false, reason: `the @playwright/test in ${app} has no Chromium launcher` };
    let browser: Browser;
    try {
      browser = await chromium.launch();
    } catch (e) {
      return { ok: false, reason: `Chromium didn't start (${firstLine((e as Error).message)}); in ${app}: pnpm exec playwright install chromium` };
    }
    try {
      const { fixture, path } = request;
      const name = `${fixture.kind} ${fixture.id} "${fixture.state}"`;
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(firstLine(e.message)));
      const response = await page.goto(base + path, { waitUntil: 'networkidle', timeout: START_MS });
      const status = response?.status() ?? 0;
      const seen = await page.evaluate<{ missing: boolean; nodes: number; text: string } | null>(READ_FIXTURE);
      if (!seen) return { ok: false, reason: `${path} has no state fixture on it (HTTP ${status})${status === 404 ? ": the app doesn't serve fwos's screens browser there (it does only in development, or with FWOS_SCREENS=1)" : ''}` };
      if (seen.missing) return { ok: false, reason: `${name} has no fixture yet (${path} says so)` };
      if (errors.length > 0) return { ok: false, reason: `${name} throws while it renders (${errors[0]})` };
      if (seen.nodes === 0 && seen.text === '') return { ok: false, reason: `${name} renders nothing at ${path}` };
      await context.close();
      let access: boolean | undefined;
      if (request.as) {
        const as = await browser.newContext();
        await as.addCookies([{ name: request.as.cookie, value: encodeURIComponent(JSON.stringify({ role: request.as.role, flags: [] })), url: base }]);
        const home = await as.newPage();
        await home.goto(`${base}/`, { waitUntil: 'networkidle', timeout: START_MS });
        try {
          access = (JSON.parse((await home.evaluate<string | null>(READ_ACCESS)) ?? '{}') as { role?: string }).role === request.as.role;
        } catch {
          access = false;
        }
        await as.close();
      }
      return { ok: true, detail: `${name} at ${path} (${request.url ? base : 'next dev'}, chromium ${browser.version()})`, ...(access === undefined ? {} : { access }) };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { ok: false, reason: firstLine((e as Error).message) };
  } finally {
    if (child) await stop(child);
  }
}
