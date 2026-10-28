// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// web/security: the web security baseline (a CSP is set, no secrets in the client bundle, no .env
// committed). web/licences: no dependency under a licence the chosen channels can't ship.

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { type Check, type Finding, isFile, maskComments, off, parseJsonc, readJson, readText, readWorkspace, result, toPosix } from '../../../kernel/index.ts';
import { webApp } from '../adapters.ts';
import { configCsp, middlewareCsp, metaCspEvidence, hostFileCsp } from '../csp.ts';

/** "1 file", "2 files". */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Script, style and MDX files (the ones the design-system token scan reads), and JSON and HTML, which hold keys as often. */
const SCANNED = /\.(?:[cm]?[jt]sx?|css|scss|less|mdx|json|html)$/;

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bsk_live_[0-9a-zA-Z]{10,}/, 'a live Stripe secret key'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, 'an API secret key (sk-...)'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'a private key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
];

/** A static export has no response-header server. */
const STATIC_EXPORT = /\boutput\s*:\s*(["'`])export\1/;

export const securityCheck: Check = {
  id: 'web/security',
  title: 'Web security baseline',
  catches: 'no Content-Security-Policy, a secret-looking NEXT_PUBLIC_ variable, a hard-coded key, a committed .env',
  platforms: ['web'],
  run({ project, staged }) {
    const id = 'web/security';
    const app = webApp(project);
    if (!project.exists(`${app}/package.json`)) return off(id, `no web app at ${app} yet`);
    const findings: Finding[] = [];
    const configs = project.files([`${app}/next.config.{ts,mjs,js}`, `${app}/{middleware,proxy}.{ts,js}`, `${app}/src/{middleware,proxy}.{ts,js}`]);
    // A static export has no server: next.config headers() and proxy/middleware never run, so there
    // the CSP is a <meta http-equiv> tag in the page, or a host headers file (public/_headers), and
    // only those count.
    const exported = project.files([`${app}/next.config.{ts,mjs,js}`]).some((f) => STATIC_EXPORT.test(maskComments(project.read(f) ?? '', false)));
    const policies = configs.map((file) => /next\.config\./.test(file) ? configCsp(project.read(file) ?? '') : middlewareCsp(project.read(file) ?? ''));
    const viaHeaders = policies.includes('present');
    const unresolved = policies.includes('unknown');
    const rootLayouts = project.files([`${app}/app/layout.{tsx,jsx,ts,js}`, `${app}/src/app/layout.{tsx,jsx,ts,js}`, `${app}/pages/_document.{tsx,jsx,ts,js}`, `${app}/src/pages/_document.{tsx,jsx,ts,js}`]);
    const metaPolicies = exported ? rootLayouts.map((file) => metaCspEvidence(project.read(file) ?? '')) : [];
    const viaPage = exported && (metaPolicies.includes('present') || hostFileCsp(project.read(`${app}/public/_headers`) ?? ''));
    const unknownPage = metaPolicies.includes('unknown');
    if (exported ? !viaPage && !unknownPage : !viaHeaders && !unresolved) {
      findings.push({
        file: `${app}/next.config.ts`,
        rule: 'csp',
        message: !exported
          ? 'no Content-Security-Policy header is set (next.config headers(), or proxy/middleware)'
          : viaHeaders
            ? 'the Content-Security-Policy in next.config headers() or proxy/middleware is never sent by a static export; set it with a <meta http-equiv> tag in the root layout, or a line in public/_headers'
            : 'no Content-Security-Policy is set; a static export needs a <meta http-equiv> tag in the root layout, or a line in public/_headers',
      });
    }
    // Those files anywhere in the app and in every package, tests aside.
    let sources = project.files([`${app}/**`, 'packages/*/**'], ['**/*.test.*', '**/*.spec.*']).filter((f) => SCANNED.test(f));
    if (staged) sources = sources.filter((f) => staged.includes(f));
    for (const f of sources) {
      const text = project.read(f) ?? '';
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const pub = /\bNEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE|PASSWORD|SERVICE_ROLE)[A-Z0-9_]*/.exec(line);
        if (pub) findings.push({ file: f, line: i + 1, rule: 'public-secret', message: `${pub[0]} would ship to every browser; secrets stay on a server` });
        for (const [re, what] of SECRET_PATTERNS) {
          if (re.test(line)) findings.push({ file: f, line: i + 1, rule: 'hard-coded-secret', message: `looks like ${what}; move it to an environment variable on the server` });
        }
      });
    }
    try {
      const tracked = execFileSync('git', ['ls-files', '--', '.env', '.env.*', '**/.env', '**/.env.*'], { cwd: project.root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .split('\n')
        .filter((f) => f && !/\.env\.(example|sample|template)$/.test(f));
      for (const f of tracked) findings.push({ file: f, rule: 'env-committed', message: 'an .env file is committed; commit .env.example instead and gitignore the real one' });
    } catch {
      // not a git repo: nothing is committed
    }
    if (findings.length === 0 && (exported ? !viaPage && unknownPage : !viaHeaders && unresolved)) return off(id, 'Content-Security-Policy response delivery cannot be determined statically; inspect the production response headers', configs);
    return result(id, findings, [`${app}/next.config.*`, `${app}/**`, 'packages/*/**', '.env*'], undefined, [`${count(sources.length, 'file')} scanned`]);
  },
};

/** Licences no channel can ship (strong network copyleft, source-available, unlicensed). */
const DENY_ALWAYS = [/^AGPL/i, /^SSPL/i, /^BUSL/i, /^UNLICENSED$/i, /^Commons-Clause/i];
/** Licences the App Store's terms conflict with. */
const DENY_APP_STORE = [/^GPL/i, /^LGPL/i];

const LOCAL_SPEC = /^(?:workspace|link|file|portal):/;

interface Manifest {
  license?: unknown;
  licenses?: unknown;
  private?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
}

/**
 * What a package needs at run time: `dependencies` (required), and `optionalDependencies` and
 * `peerDependencies` (followed only when installed). devDependencies never ship.
 */
function runtimeDeps(pkg: Manifest | null): { name: string; spec: string; required: boolean }[] {
  const field = (k: keyof Manifest) => Object.entries((pkg?.[k] as Record<string, unknown> | undefined) ?? {});
  const deps = new Map<string, { name: string; spec: string; required: boolean }>();
  for (const [name, spec] of field('dependencies')) deps.set(name, { name, spec: String(spec), required: true });
  for (const k of ['optionalDependencies', 'peerDependencies'] as const) {
    for (const [name, spec] of field(k)) if (k === 'optionalDependencies' || !deps.has(name)) deps.set(name, { name, spec: String(spec), required: false });
  }
  return [...deps.values()];
}

function realpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Where Node finds `name` from `dir`: the nearest node_modules on the way up, as a real path so pnpm's links are followed. */
function findPackage(name: string, dir: string): string | null {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = join(d, 'node_modules', name);
    if (basename(d) !== 'node_modules' && isFile(join(candidate, 'package.json'))) return realpath(candidate);
    if (dirname(d) === d) return null;
  }
}

/**
 * The folder a local dependency points at. `link:`, `file:` and `portal:` name a path from the
 * package that declares it; `workspace:` names a workspace package (`workspace:*`, or an alias
 * such as `workspace:ui@*`) or a path. Failing that, the copy or link installed in node_modules.
 * Null for a tarball that isn't installed, or a folder that isn't there.
 */
function localFolder(name: string, spec: string, fromDir: string, root: string, workspace: () => Map<string, string>): string | null {
  const [protocol, rest] = [spec.slice(0, spec.indexOf(':')), spec.slice(spec.indexOf(':') + 1)];
  let dir: string | undefined;
  if (protocol !== 'workspace' || /^\.{0,2}\//.test(rest)) dir = resolve(fromDir, rest);
  else {
    const ws = workspace().get(/^(@?[^@]+)@/.exec(rest)?.[1] ?? name);
    if (ws !== undefined) dir = join(root, ws);
  }
  if (dir && isFile(join(dir, 'package.json'))) return realpath(dir);
  return findPackage(name, fromDir);
}

/** A package.json, and `error` when the file is there but isn't valid JSON or isn't an object. */
function readManifest(path: string): { pkg: Manifest | null; error?: string } {
  const text = readText(path);
  if (text === null) return { pkg: null };
  try {
    const pkg = parseJsonc(text);
    if (pkg && typeof pkg === 'object' && !Array.isArray(pkg)) return { pkg: pkg as Manifest };
    return { pkg: null, error: 'not a JSON object' };
  } catch (e) {
    return { pkg: null, error: `not valid JSON: ${(e as Error).message}` };
  }
}

/** The licence a package.json declares: `license`, the legacy `license: { type }`, or the legacy `licenses` list (any of them). */
function licenceOf(pkg: { license?: unknown; licenses?: unknown } | null): string | null {
  const typeOf = (l: unknown) => (typeof l === 'string' ? l : typeof (l as { type?: unknown })?.type === 'string' ? (l as { type: string }).type : '').trim();
  const one = typeOf(pkg?.license);
  if (one) return one;
  const many = Array.isArray(pkg?.licenses) ? pkg.licenses.map(typeOf).filter(Boolean) : [];
  if (many.length === 0) return null;
  return many.length === 1 ? many[0]! : many.map((l) => `(${l})`).join(' OR ');
}

/**
 * Whether an SPDX expression can't be shipped: an AND is denied if any part is, an OR only if every
 * branch is. `X WITH <exception>` is denied if either is (Commons-Clause). Returns null when the
 * text isn't an SPDX expression.
 */
function spdxDenied(expr: string, denied: (id: string) => boolean): boolean | null {
  const t = expr.replace(/[()]/g, ' $& ').trim().split(/\s+/);
  let i = 0;
  const op = () => t[i]?.toUpperCase();
  const atom = (): boolean => {
    const tok = t[i++];
    if (tok === '(') {
      const d = any();
      if (t[i++] !== ')') throw new Error('unbalanced');
      return d;
    }
    if (!tok || tok === ')' || ['AND', 'OR', 'WITH'].includes(tok.toUpperCase())) throw new Error('unexpected');
    const base = denied(tok.replace(/\+$/, ''));
    if (op() !== 'WITH') return base;
    const exception = t[i + 1] ?? '';
    i += 2;
    return base || denied(exception);
  };
  const all = (): boolean => {
    let d = atom();
    while (op() === 'AND') {
      i++;
      d = atom() || d;
    }
    return d;
  };
  const any = (): boolean => {
    let d = all();
    while (op() === 'OR') {
      i++;
      d = all() && d;
    }
    return d;
  };
  try {
    const d = any();
    return i === t.length ? d : null;
  } catch {
    return null;
  }
}

export const licencesCheck: Check = {
  id: 'web/licences',
  title: 'Dependency licences',
  catches: 'a runtime dependency, or a package one pulls in, under a licence the chosen channels cannot ship (AGPL, SSPL, unlicensed; GPL for the App Store)',
  platforms: ['web', 'electron'],
  run({ project }) {
    const id = 'web/licences';
    const app = webApp(project);
    const manifests = ['package.json', `${app}/package.json`, ...project.files(['packages/*/package.json'])].filter((f) => project.exists(f));
    if (manifests.length === 0) return off(id, 'no package.json yet');
    const channels = readJson<{ channels?: string[] }>(project.abs('.fwos/state.json'))?.channels ?? [];
    const deny = [...DENY_ALWAYS, ...(channels.includes('mac-app-store') ? DENY_APP_STORE : [])];
    const denied = (licence: string) => deny.some((re) => re.test(licence));
    const where = channels.length ? `the ${channels.join(', ')} channel` : 'this project';
    const findings: Finding[] = [];
    let checked = 0;
    let direct = 0;
    const notInstalled = new Set<string>();
    const lost: string[] = [];
    const localMissing: string[] = [];
    const local = new Set<string>();
    const custom: string[] = [];
    /** The project's own package.json files must parse: one that doesn't hides everything it declares. */
    const own = (file: string, read: { pkg: Manifest | null; error?: string }) => {
      if (read.error) findings.push({ file, rule: 'manifest', message: `${read.error}, so the dependencies it declares can't be checked` });
      return read.pkg;
    };
    let ws: Map<string, string> | undefined;
    const workspace = () => {
      if (!ws) {
        try {
          ws = readWorkspace(project.root);
        } catch {
          ws = new Map();
        }
      }
      return ws;
    };
    // Breadth first, so the path named for a denied package is the shortest one that pulls it in.
    // `direct` marks a package that only the project's own code (its manifests and local packages) pulls in.
    const queue: { dir: string; chain: string[]; manifest: string; direct: boolean; local: boolean }[] = [];
    const seen = new Set<string>();
    const realRoot = realpath(project.root);
    const follow = (fromDir: string, pkg: Manifest | null, chain: string[], manifest: string, isDirect: boolean) => {
      for (const dep of runtimeDeps(pkg)) {
        const isLocal = LOCAL_SPEC.test(dep.spec);
        const dir = isLocal ? localFolder(dep.name, dep.spec, fromDir, project.root, workspace) : findPackage(dep.name, fromDir);
        if (!dir) {
          if (!dep.required) continue;
          const named = chain.length > 0 ? `${dep.name} (via ${chain.join(' > ')})` : dep.name;
          if (isLocal) localMissing.push(named);
          else if (isDirect) notInstalled.add(dep.name);
          else lost.push(named);
          continue;
        }
        if (seen.has(dir)) continue;
        seen.add(dir);
        queue.push({ dir, chain: [...chain, dep.name], manifest, direct: isDirect, local: isLocal });
      }
    };
    for (const m of manifests) follow(dirname(project.abs(m)), own(m, readManifest(project.abs(m))), [], m, true);
    for (let i = 0; i < queue.length; i++) {
      const { dir, chain, manifest: m, direct: isDirect, local: isLocal } = queue[i]!;
      const dep = chain.at(-1)!;
      const read = readManifest(join(dir, 'package.json'));
      // A local package, or a private one (npm won't publish it), is the project's own code: not
      // graded itself, but what it pulls in ships.
      if (isLocal || read.pkg?.private === true) {
        local.add(dep);
        const rel = toPosix(relative(realRoot, join(dir, 'package.json')));
        if (!/^\.\.\/|(?:^|\/)node_modules\//.test(rel) && !manifests.includes(rel)) manifests.push(rel);
        follow(dir, own(rel, read), chain, m, isDirect);
        continue;
      }
      const pkg = read.pkg;
      checked++;
      if (isDirect) direct++;
      const via = chain.length > 1 ? ` (pulled in by ${chain.join(' > ')})` : '';
      if (pkg === null) {
        findings.push({ file: m, rule: dep, message: `${dep}'s package.json can't be read, so its licence is unknown${via}` });
        continue;
      }
      follow(dir, pkg, chain, m, false);
      const lic = licenceOf(pkg);
      if (lic === null) {
        findings.push({ file: m, rule: dep, message: `${dep} has no licence field, so it is UNLICENSED (no one granted the right to use it), which ${where} can't ship${via}` });
        continue;
      }
      const verdict = spdxDenied(lic, denied);
      if (verdict === null) {
        // Not an SPDX expression ("SEE LICENSE IN ..."): judge the text as one licence, and say so.
        if (denied(lic)) findings.push({ file: m, rule: dep, message: `${dep} is ${lic}, which ${where} can't ship${via}` });
        else custom.push(`${dep} (${lic})`);
      } else if (verdict) {
        findings.push({ file: m, rule: dep, message: `${dep} is ${lic}, which ${where} can't ship${via}` });
      }
    }
    const list = (xs: Iterable<string>) => {
      const all = [...xs];
      return `${all.slice(0, 5).join(', ')}${all.length > 5 ? '...' : ''}`;
    };
    const unread: string[] = [];
    if (notInstalled.size > 0) unread.push(`not installed, so their licences can't be read: ${list(notInstalled)} (run pnpm install; licences come from node_modules)`);
    if (lost.length > 0) unread.push(`not found in node_modules, so not checked: ${list(lost)}`);
    if (localMissing.length > 0) unread.push(`local packages not found, so not checked: ${list(localMissing)}`);
    // A package that isn't found could pull in anything, direct or not, so a pass can't be given
    // yet. A finding already made stands, though: installing more can't clear it.
    if (unread.length > 0 && findings.length === 0) return off(id, unread.join('; '), manifests);
    if (checked === 0 && findings.length === 0) return off(id, 'no third-party runtime dependencies to check', manifests);
    const info = [`${count(checked, 'dependency', 'dependencies')} checked (${direct} direct)`, ...unread];
    if (local.size > 0) info.push(`local packages, not checked: ${list(local)}`);
    if (custom.length > 0) info.push(`not an SPDX licence, so read it yourself: ${list(custom)}`);
    return result(id, findings, manifests, undefined, info);
  },
};

export const checks = [securityCheck, licencesCheck];
