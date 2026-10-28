// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The test plan. Cases are headings with `- Key: value` lines, written by the test-planner agent
// from the spec alone (never the code):
//
//   ### TC-reading-1: saving a link shows it first
//   - AC: AC-reading-1
//   - Level: component
//   - Platform: web
//   - Status: new
//   - Given an empty list, when I save https://example.com, then it is the first row.

import { posix } from 'node:path';
import type { AdapterSet, Project } from '../../kernel/index.ts';
import { AC_ID, parseBlocks } from '../spec/index.ts';

export const LEVELS = ['unit', 'component', 'browser-component', 'e2e', 'manual'] as const;
export type Level = (typeof LEVELS)[number];

/** Rows every plan gets on web: a crawl, an accessibility audit, keyboard-only, both themes, a phone viewport, a production build. */
export const DEFAULT_ROWS = ['crawl', 'a11y', 'keyboard', 'themes', 'phone', 'prod'] as const;

export interface TestCaseSpec {
  id: string;
  title: string;
  line: number;
  acs: string[];
  level?: string;
  platform?: string;
  status?: string;
  fields: Record<string, string>;
}

export interface Gap {
  id: string;
  title: string;
  line: number;
  missing?: string;
}

const CASE_HEADING = /^#{2,4}\s+(TC-[a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:[:.–—-]\s*(.*))?$/;
const GAP_HEADING = /^#{2,4}\s+(GAP-[a-z0-9-]+)\s*(?:[:.–—-]\s*(.*))?$/;

export const testPlanPath = (p: Project) => posix.join(p.paths.docs, 'test-plan.md');

/** Levels whose cases run in a real browser. */
export const BROWSER_LEVELS = ['e2e', 'browser-component'];

/** What the app's own test scripts can run: a case at any level (some script fwos reads results from), and one in a browser. */
export interface Runners {
  any: boolean;
  browser: boolean;
}

/** The app's runners, from its test scripts as the platform reads them. Null when the platform can't say. */
export function runnersOf(project: Project, adapters: AdapterSet): Runners | null {
  const tests = adapters.profiles.find((x) => x.tests)?.tests;
  if (!tests) return null;
  try {
    const mapped = tests.commands(project).commands.filter((c) => c.results);
    return { any: mapped.length > 0, browser: mapped.some((c) => c.browser) };
  } catch {
    return null; // a package.json fwos can't read: `fwos tests run` says why
  }
}

export interface RegressionScope {
  /** The plan has a `## Regression scope` section. */
  present: boolean;
  /** It names no test and says so ("None: ..."). */
  none: boolean;
  /** The existing tests it names, each with why. */
  entries: { path: string; why: string; line: number }[];
}

/**
 * An adopted app's change names, in its test plan, the existing tests that cover the behaviour
 * around it: its regression scope, one test file per line (`- <path>: <what it covers>`), or a
 * line that says there are none and why.
 */
export function parseRegressionScope(text: string): RegressionScope {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,6}\s+regression scope\b/i.test(l.trim()));
  if (start === -1) return { present: false, none: false, entries: [] };
  const entries: RegressionScope['entries'] = [];
  let none = false;
  for (let i = start + 1; i < lines.length && !/^#{1,6}\s/.test(lines[i]!); i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const item = /^[-*]\s+(.+)$/.exec(line)?.[1] ?? null;
    const body = item ?? line;
    if (/^none\b/i.test(body)) {
      none = true;
      continue;
    }
    if (item === null) continue;
    const m = /^`?([^\s`]+?)`?:?(?:\s+(.*))?$/.exec(item);
    if (m) entries.push({ path: m[1]!, why: (m[2] ?? '').trim(), line: i + 1 });
  }
  return { present: true, none: none && entries.length === 0, entries };
}

export function parseTestPlan(text: string): { cases: TestCaseSpec[]; gaps: Gap[] } {
  const cases = parseBlocks(text, CASE_HEADING).map((b) => {
    const tc: TestCaseSpec = {
      id: b.id,
      title: b.title,
      line: b.line,
      acs: [...(b.fields.ac ?? b.fields.acs ?? '').matchAll(AC_ID)].map((m) => m[0]),
      fields: b.fields,
    };
    if (b.fields.level) tc.level = b.fields.level.toLowerCase();
    if (b.fields.platform) tc.platform = b.fields.platform.toLowerCase();
    if (b.fields.status) tc.status = b.fields.status.toLowerCase();
    return tc;
  });
  const gaps = parseBlocks(text, GAP_HEADING).map((b) => {
    const g: Gap = { id: b.id, title: b.title, line: b.line };
    if (b.fields.missing) g.missing = b.fields.missing;
    return g;
  });
  return { cases, gaps };
}
