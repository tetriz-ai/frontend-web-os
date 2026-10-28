// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// Quarantine for flaky tests. A quarantined test never proves an AC, and quarantine expires:
// after `until`, `fwos check` fails until the test is fixed (without a fixed sleep) or removed.

import { join } from 'node:path';
import { type TestCase, readJson } from '../../kernel/index.ts';

export interface QuarantineEntry {
  /** Part of the test name, or an AC tag, matched as whole words (`@AC-list-1` never matches `@AC-list-10`). */
  match: string;
  reason: string;
  by: string;
  until: string;
}

export function readQuarantine(root: string): QuarantineEntry[] {
  return readJson<{ tests?: QuarantineEntry[] }>(join(root, '.fwos', 'quarantine.json'))?.tests ?? [];
}

const wholeWords = (match: string) => new RegExp(`(?<![\\w-])${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);

export function isQuarantined(entries: QuarantineEntry[], tc: TestCase): boolean {
  return entries.some((q) => typeof q.match === 'string' && q.match !== '' && (wholeWords(q.match).test(tc.name) || wholeWords(q.match).test(tc.classname)));
}

/**
 * Entries past their `until` day, compared as UTC dates. One with no date, or a date fwos can't read,
 * counts as expired, so every quarantine names the day it ends.
 */
export function expired(entries: QuarantineEntry[], today = new Date().toISOString().slice(0, 10)): QuarantineEntry[] {
  return entries.filter((q) => typeof q.until !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(q.until) || q.until < today);
}
