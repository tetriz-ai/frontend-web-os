// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The sections an adopted app's change adds to its spec delta, read without a model: the request
// broken into asks, the questions and their answers, the states of what it touches, and the words
// in a criterion that leave it open to interpretation.

import { describe, expect, it } from 'vitest';
import { parseQuestions, parseRequest, parseStates, statesBrought, vagueTerms } from '../index.ts';

const DELTA = `# Changes delivered through fwos

## What you're approving
Search on the members page.

## Request
"search the members list, and let me export it"

### REQ-1: Search the members by name or email
- AC: AC-members-1, AC-members-2

### REQ-2: Export the list as CSV
- Dropped: the app has no download route; a change of its own (Example Owner)

### REQ-3: Keep the list as it is without a search

## States
The members list (app/members/page.tsx), as the change leaves it:

| State | What the user sees | Criterion |
|---|---|---|
| filtered | only the members whose name or email holds the search | AC-members-1 |
| filtered-empty | No members match "<search>". | AC-members-2 |
| empty | No members yet. | unchanged |
| loading | | |
| offline | | none: the page renders on the server |

## Acceptance criteria
### AC-members-1: Searching narrows the list
- Given three members, when I search "ada", then only Ada shows.
- Proven against: mock

## Open questions
### Q-1: Does a search match emails as well as names?
- Answer: Names and emails: a member with no name shows their email (Example Owner)

### Q-2: Should the search remember itself across visits?

- What about members invited but not joined yet?
None of the rest.
`;

describe('the request, as asks', () => {
  it('reads each ask with the criteria that deliver it, or why it was dropped', () => {
    const r = parseRequest(DELTA);
    expect(r.present).toBe(true);
    expect(r.asks.map((a) => ({ id: a.id, title: a.title, criteria: a.criteria, dropped: a.dropped }))).toEqual([
      { id: 'REQ-1', title: 'Search the members by name or email', criteria: ['AC-members-1', 'AC-members-2'], dropped: undefined },
      { id: 'REQ-2', title: 'Export the list as CSV', criteria: [], dropped: 'the app has no download route; a change of its own (Example Owner)' },
      { id: 'REQ-3', title: 'Keep the list as it is without a search', criteria: [], dropped: undefined },
    ]);
    expect(r.asks[0]!.line).toBe(9);
  });

  it('says when the delta has no Request section', () => {
    expect(parseRequest('# Spec\n\n## Acceptance criteria\n')).toEqual({ present: false, asks: [] });
  });
});

describe('the questions', () => {
  it('reads each question with its answer, and the questions written without an ID', () => {
    const q = parseQuestions(DELTA);
    expect(q.questions.map((x) => ({ id: x.id, text: x.text, answer: x.answer }))).toEqual([
      { id: 'Q-1', text: 'Does a search match emails as well as names?', answer: 'Names and emails: a member with no name shows their email (Example Owner)' },
      { id: 'Q-2', text: 'Should the search remember itself across visits?', answer: undefined },
    ]);
    expect(q.loose).toEqual([{ text: 'What about members invited but not joined yet?', line: 39 }]);
  });
});

describe('the states of what the change touches', () => {
  it('reads each row: the state, what the user sees and the criterion, "unchanged" or "none" with why', () => {
    const s = parseStates(DELTA);
    expect(s.present).toBe(true);
    expect(s.none).toBe(false);
    expect(s.rows.map(({ line: _, ...r }) => r)).toEqual([
      { state: 'filtered', what: 'only the members whose name or email holds the search', criteria: ['AC-members-1'] },
      { state: 'filtered-empty', what: 'No members match "<search>".', criteria: ['AC-members-2'] },
      { state: 'empty', what: 'No members yet.', criteria: [], note: 'unchanged' },
      { state: 'loading', what: '', criteria: [] },
      { state: 'offline', what: '', criteria: [], note: 'none: the page renders on the server' },
    ]);
  });

  it('takes "None" and why as a delta with no state to list', () => {
    expect(parseStates('## States\nNone: the change only renames a column.\n')).toEqual({ present: true, none: true, rows: [] });
    expect(parseStates('## Acceptance criteria\n')).toEqual({ present: false, none: false, rows: [] });
  });
});

describe('words that leave a criterion open to interpretation', () => {
  it('finds subjective, unmeasured, open-ended and loophole terms, outside quoted copy', () => {
    expect(vagueTerms('Given some members, when I search, then the relevant ones show quickly, etc.')).toEqual(['some', 'relevant', 'quickly', 'etc']);
    expect(vagueTerms('then it is user-friendly and easy to use, if possible')).toEqual(['user-friendly', 'easy', 'if possible']);
    // Quoted text is the app's copy, not the criterion's wording.
    expect(vagueTerms('then the card says "Something went wrong, try again soon" and `fast mode` is off')).toEqual([]);
    expect(vagueTerms('Given three members, when I search "ada", then only Ada shows within 1 second.')).toEqual([]);
    // "How many" asks for a number; "many" alone leaves it open.
    expect(vagueTerms('A search says how many members it matches')).toEqual([]);
    expect(vagueTerms('then many members show')).toEqual(['many']);
    // A link or a file path names a place, not the behaviour: https://example.com/some and lib/fast.ts say nothing vague.
    expect(vagueTerms('- Source: https://example.com/specs/some\n- Given the list in lib/fast.ts, then it shows')).toEqual([]);
  });
});

describe("the states a change's interactions bring", () => {
  it('names the state each interaction brings, and the word that brought it', () => {
    expect(statesBrought('add search to the members list')).toEqual([{ state: 'filtered-empty', what: 'a search or filter can match nothing', word: 'search' }]);
    expect(statesBrought('Filter the orders, then save the view offline')).toEqual([
      { state: 'filtered-empty', what: 'a search or filter can match nothing', word: 'Filter' },
      { state: 'error', what: 'saving or sending can fail', word: 'save' },
      { state: 'offline', what: 'the network can drop', word: 'offline' },
    ]);
    // A label in quotes names the app's copy, not what the change does.
    expect(statesBrought('then the "Search members" field is focused')).toEqual([]);
    expect(statesBrought('show how many members there are')).toEqual([]);
  });
});
