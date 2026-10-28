// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { type TestCase, hasTag, jestJsonToJUnit, parseJUnit } from '../index.ts';

describe('parseJUnit', () => {
  it('reads passing, failing, erroring and skipped cases', () => {
    const xml = `<testsuites><testsuite>
      <testcase classname="c" name="a"/>
      <testcase classname="c" name="b"><failure message="boom">stack</failure></testcase>
      <testcase classname="c" name="c"><error><![CDATA[it broke
at x]]></error></testcase>
      <testcase classname="c" name="d"><skipped/></testcase>
    </testsuite></testsuites>`;
    expect(parseJUnit(xml).map((t) => [t.name, t.status, t.failure])).toEqual([
      ['a', 'passed', undefined],
      ['b', 'failed', 'boom'],
      ['c', 'failed', 'it broke'],
      ['d', 'skipped', undefined],
    ]);
  });

  it('skips a case a truncated file never closes, instead of counting it as a pass', () => {
    expect(parseJUnit('<testsuite><testcase classname="c" name="a"/><testcase classname="c" name="b">').map((t) => t.name)).toEqual(['a']);
  });

  it('stays linear on a file full of unclosed cases', () => {
    const xml = '<testcase name="a">'.repeat(12_000);
    const started = performance.now();
    expect(parseJUnit(xml)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('reads a > inside a quoted attribute as part of it, in a case and in its failure', () => {
    // Vitest and Playwright escape > in attributes; XML doesn't require it, so other writers may not.
    const xml = `<testsuite>
      <testcase classname="c" name="@AC-x-1 ok"/>
      <testcase classname="c" name="@AC-x-1 a > b"><failure message="boom"/></testcase>
      <testcase classname='c' name='d'><failure message="expected 2 > 1">stack</failure></testcase>
      <testcase classname="c > d" name="e"/>
    </testsuite>`;
    expect(parseJUnit(xml).map((t) => [t.name, t.classname, t.status, t.failure])).toEqual([
      ['@AC-x-1 ok', 'c', 'passed', undefined],
      ['@AC-x-1 a > b', 'c', 'failed', 'boom'],
      ['d', 'c', 'failed', 'expected 2 > 1'],
      ['e', 'c > d', 'passed', undefined],
    ]);
  });

  it('fails a case whose failure element never closes or is cut short, instead of counting it as a pass', () => {
    const xml = `<testsuite>
      <testcase classname="c" name="a"><failure message="boom"><system-out>x</system-out></testcase>
      <testcase classname="c" name="b"><error message="cut short</testcase>
    </testsuite>`;
    expect(parseJUnit(xml).map((t) => [t.name, t.status, t.failure])).toEqual([
      ['a', 'failed', 'boom'],
      ['b', 'failed', undefined],
    ]);
  });

  it('stays linear on a file full of unclosed quotes', () => {
    const xml = '<testcase name="a>'.repeat(12_000);
    const started = performance.now();
    parseJUnit(xml);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('hasTag', () => {
  const tc = (name: string, classname = ''): TestCase => ({ name, classname, status: 'passed', source: '' });

  it('matches a tag only as a whole id, in the name or the class', () => {
    expect(hasTag(tc('saves a link @AC-list-1'), '@AC-list-1')).toBe(true);
    expect(hasTag(tc('saves a link, @AC-list-1.'), '@AC-list-1')).toBe(true);
    expect(hasTag(tc('@AC-list-1, @AC-list-2 together'), '@AC-list-1')).toBe(true);
    expect(hasTag(tc('a', 'list @AC-list-1'), '@AC-list-1')).toBe(true);
    expect(hasTag(tc('saves @AC-list-10'), '@AC-list-1')).toBe(false);
    expect(hasTag(tc('saves @AC-list-1-2'), '@AC-list-1')).toBe(false);
    expect(hasTag(tc('saves @AC-x-1.5'), '@AC-x-1')).toBe(false);
    expect(hasTag(tc('renders @state:button:loading'), '@state:button:load')).toBe(false);
  });
});

describe('jestJsonToJUnit', () => {
  it("turns Jest's JSON into JUnit cases with the file relative to the root, and the first failure line", () => {
    const json = JSON.stringify({
      testResults: [
        {
          name: '/repo/app/members/members.test.tsx',
          assertionResults: [
            { fullName: 'members narrows the list @AC-members-1', status: 'passed', failureMessages: [] },
            { fullName: 'members says "none" & <stops>', status: 'failed', failureMessages: ['\u001b[31mError: expected 1 to be 2\u001b[39m\n    at x'] },
            { fullName: 'members later', status: 'todo', failureMessages: [] },
            { fullName: 'members skipped', status: 'pending', failureMessages: [] },
          ],
        },
      ],
    });
    expect(parseJUnit(jestJsonToJUnit(json, '/repo')).map((t) => [t.classname, t.name, t.status, t.failure])).toEqual([
      ['app/members/members.test.tsx', 'members narrows the list @AC-members-1', 'passed', undefined],
      ['app/members/members.test.tsx', 'members says "none" & <stops>', 'failed', 'Error: expected 1 to be 2'],
      ['app/members/members.test.tsx', 'members later', 'skipped', undefined],
      ['app/members/members.test.tsx', 'members skipped', 'skipped', undefined],
    ]);
  });

  it('turns a suite that failed to run into a failing case, never into nothing', () => {
    const json = JSON.stringify({ testResults: [{ name: '/repo/a.test.ts', status: 'failed', message: 'SyntaxError: Unexpected token', assertionResults: [] }] });
    expect(parseJUnit(jestJsonToJUnit(json, '/repo')).map((t) => [t.classname, t.status, t.failure])).toEqual([['a.test.ts', 'failed', 'SyntaxError: Unexpected token']]);
  });
});
