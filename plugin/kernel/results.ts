// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Test results from JUnit XML, which Vitest, Playwright and xcresult converters all produce.
// Traceability and required-states read these: a test counts only if it actually ran.

import { isAbsolute, relative } from 'node:path';
import { readText, toPosix } from './files.ts';
import type { Project } from './project.ts';

export type CaseStatus = 'passed' | 'failed' | 'skipped';

export interface TestCase {
  name: string;
  classname: string;
  file?: string;
  status: CaseStatus;
  /** The first line of the failure message, verbatim. */
  failure?: string;
  /** Which results file it came from. */
  source: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]!] = decodeXml(m[3] ?? m[4] ?? '');
  return out;
}

/**
 * Where the tag whose attributes start at `from` ends: the first `>` outside a quoted attribute
 * value, or -1 when there is none. XML allows a raw `>` inside a value, and while Vitest and
 * Playwright escape it, other JUnit writers need not, so the first `>` can be the wrong one.
 */
function tagEnd(xml: string, from: number): number {
  let quote = '';
  for (let i = from; i < xml.length; i++) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

/** The first line of a <failure> or <error> in a test case's body, or null when the body has neither. */
function failureIn(body: string): { message: string } | null {
  const open = /<(failure|error)(?![\w:-])/.exec(body);
  if (!open) return null;
  const from = open.index + open[0].length;
  const end = tagEnd(body, from);
  // A failure element counts even when it is cut short: a truncated failure is still no pass.
  if (end === -1) return { message: '' };
  const selfClosing = body[end - 1] === '/';
  const a = attrs(body.slice(from, selfClosing ? end - 1 : end));
  let text = '';
  if (!selfClosing) {
    const closeAt = body.indexOf(`</${open[1]}>`, end + 1);
    text = body.slice(end + 1, closeAt === -1 ? body.length : closeAt);
  }
  const msg = a.message ?? decodeXml(text.replace(/<!\[CDATA\[|\]\]>/g, ''));
  return { message: msg.trim().split('\n')[0]?.trim() ?? '' };
}

export function parseJUnit(xml: string, source = ''): TestCase[] {
  const cases: TestCase[] = [];
  // A linear scan: a regex with a lazy body would rescan to the end for every unclosed <testcase>.
  // A <testcase> with no closing tag (a truncated file) is skipped, never counted as a pass.
  let pos = 0;
  let close = xml.indexOf('</testcase>');
  for (;;) {
    const start = xml.indexOf('<testcase', pos);
    if (start === -1) break;
    pos = start + 9;
    if (/[\w:-]/.test(xml[pos] ?? '')) continue; // <testcases> or similar
    const end = tagEnd(xml, pos);
    if (end === -1) break;
    const selfClosing = xml[end - 1] === '/';
    const a = attrs(xml.slice(pos, selfClosing ? end - 1 : end));
    pos = end + 1;
    let body = '';
    if (!selfClosing) {
      if (close !== -1 && close < pos) close = xml.indexOf('</testcase>', pos);
      if (close === -1) continue;
      body = xml.slice(pos, close);
      pos = close + '</testcase>'.length;
    }
    let status: CaseStatus = 'passed';
    let failure: string | undefined;
    const fail = failureIn(body);
    if (fail) {
      status = 'failed';
      failure = fail.message;
    } else if (/<skipped\b/.test(body)) {
      status = 'skipped';
    }
    const tc: TestCase = { name: a.name ?? '', classname: a.classname ?? '', status, source };
    if (a.file) tc.file = a.file;
    if (failure) tc.failure = failure;
    cases.push(tc);
  }
  return cases;
}

const xmlAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** The first line of a runner's message, without its terminal colours. */
const firstLine = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '').trim().split('\n')[0]!.trim();

/**
 * Jest's own results (`jest --json`) as JUnit XML, the one format fwos reads: a case per test, its
 * file relative to `root` as the class, a failure's first line as its message. A file that failed
 * to run at all is a failing case, never nothing. Anything but passed or failed is skipped.
 */
export function jestJsonToJUnit(json: string, root: string): string {
  type Assertion = { fullName?: string; title?: string; status?: string; failureMessages?: string[] };
  type Suite = { name?: string; status?: string; message?: string; assertionResults?: Assertion[] };
  let data: { testResults?: Suite[] } | null = null;
  try {
    data = JSON.parse(json) as { testResults?: Suite[] };
  } catch {
    // unreadable: no cases, so nothing is proven by it
  }
  const suites = (data?.testResults ?? []).map((s) => {
    const name = s.name ?? '';
    const file = xmlAttr(toPosix(isAbsolute(name) ? relative(root, name) : name));
    const cases = (s.assertionResults ?? []).map((a) => {
      const open = `<testcase classname="${file}" name="${xmlAttr(a.fullName ?? a.title ?? '')}"`;
      if (a.status === 'passed') return `${open}/>`;
      if (a.status === 'failed') return `${open}><failure message="${xmlAttr(firstLine(a.failureMessages?.[0] ?? ''))}"/></testcase>`;
      return `${open}><skipped/></testcase>`;
    });
    if (cases.length === 0 && s.status === 'failed') cases.push(`<testcase classname="${file}" name="${file}"><failure message="${xmlAttr(firstLine(s.message ?? ''))}"/></testcase>`);
    return `<testsuite name="${file}">${cases.join('')}</testsuite>`;
  });
  return `<testsuites>${suites.join('')}</testsuites>\n`;
}

export interface ResultSet {
  files: string[];
  cases: TestCase[];
}

export function loadResults(project: Project, allowed?: ReadonlySet<string>): ResultSet {
  const files = project.files(project.paths.results).filter((file) => !allowed || allowed.has(file));
  const cases = files.flatMap((f) => parseJUnit(readText(project.abs(f)) ?? '', f));
  return { files, cases };
}

/**
 * True when the test's name or class carries the tag as a whole id: `@AC-list-1` is not
 * `@AC-list-10`, `@AC-list-1-2` or `@AC-list-1.5`. A full stop after the tag ends a sentence.
 */
export function hasTag(tc: TestCase, tag: string): boolean {
  const re = new RegExp(`${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-]|\\.\\w)`);
  return re.test(tc.name) || re.test(tc.classname);
}

/**
 * Flaky: the same test failed, then passed, in one run (it appears more than once with mixed results).
 * Returns the set of `classname::name` keys.
 */
export function flakyKeys(cases: TestCase[]): Set<string> {
  const byKey = new Map<string, Set<CaseStatus>>();
  for (const c of cases) {
    const k = `${c.source}::${c.classname}::${c.name}`;
    const s = byKey.get(k) ?? new Set();
    s.add(c.status);
    byKey.set(k, s);
  }
  const out = new Set<string>();
  for (const [k, s] of byKey) if (s.has('failed') && s.has('passed')) out.add(k.slice(k.indexOf('::') + 2));
  return out;
}

export const caseKey = (c: TestCase) => `${c.classname}::${c.name}`;

/**
 * Whether a test case comes from the test file at `path` (relative to the project). Runners report
 * the file relative to their own root (Playwright to its testDir), so it's compared by suffix.
 */
export const caseInFile = (tc: TestCase, path: string) =>
  [tc.file, tc.classname].some((s) => !!s && (s === path || s.endsWith(`/${path}`) || path.endsWith(`/${s}`)));
