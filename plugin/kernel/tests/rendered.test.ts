// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { type StateObservation, contractFor, hitContract, judgeStates } from '../index.ts';

/** What the harness sees for a state that renders nothing special: some text, no markers. */
const seen = (state: string, over: Partial<StateObservation> = {}): StateObservation => ({
  state,
  status: 200,
  found: true,
  nodes: 4,
  text: `${state} view`,
  busy: 0,
  alerts: [],
  statuses: [],
  items: [],
  disabled: 0,
  invalid: 0,
  ...over,
});

/** A list page as it should render: a skeleton, a zero state, an error with a retry, and its rows. */
const listPage = (): StateObservation[] => [
  seen('loading', { text: 'Reading list', busy: 1 }),
  seen('empty', { text: 'Reading list Save your first link', statuses: ['Save your first link'] }),
  seen('error', { text: "Reading list Couldn't load your list Try again", alerts: ["Couldn't load your list Try again"] }),
  seen('ready', { text: 'Reading list Dune example.com Neuromancer example.org', items: ['Dune example.com', 'Neuromancer example.org'] }),
];

const verdicts = (obs: StateObservation[]) => Object.fromEntries(judgeStates(obs).map((v) => [v.state, v.verdict === 'ok' ? 'ok' : `${v.verdict}: ${v.problems.join('; ')}`]));

describe('the rendered-state contract', () => {
  it('passes a page whose every state renders as its name says', () => {
    expect(verdicts(listPage())).toEqual({ loading: 'ok', empty: 'ok', error: 'ok', ready: 'ok' });
  });

  it('fails a state that renders another state, whatever its test is called', () => {
    const [loading, empty, error, ready] = listPage();
    // The loading fixture draws the ready list; the error fixture draws the empty state.
    const wrong = [{ ...ready!, state: 'loading' }, empty!, { ...empty!, state: 'error' }, ready!];
    const v = verdicts(wrong);
    expect(v.loading).toMatch(/^violation: .*aria-busy/);
    expect(v.loading).toMatch(/renders exactly as "ready"/);
    expect(v.error).toMatch(/^violation: .*role="alert"/);
    expect(v.empty).toBe('ok');
    expect(v.ready).toBe('ok');
    expect(loading).toBeDefined();
    expect(error).toBeDefined();
  });

  it('fails an error state that keeps the ready state stale content beside its alert', () => {
    const page = listPage();
    page[2] = seen('error', { alerts: ["Couldn't load your list"], items: ['Dune example.com', 'Neuromancer example.org'] });
    expect(verdicts(page).error).toMatch(/keeps the ready state's content \(Dune example\.com, Neuromancer example\.org\)/);
    // The same rows in an empty or loading state are stale too.
    page[0] = seen('loading', { busy: 1, items: ['Dune example.com'] });
    page[1] = seen('empty', { statuses: ['Nothing yet'], items: ['Neuromancer example.org'] });
    const v = verdicts(page);
    expect(v.loading).toMatch(/keeps the ready state's content \(Dune example\.com\)/);
    expect(v.empty).toMatch(/keeps the ready state's content \(Neuromancer example\.org\)/);
  });

  it('lets an offline state keep its content, as long as it says it is offline', () => {
    const page = [...listPage(), seen('offline', { items: ['Dune example.com'], statuses: ["You're offline"] })];
    expect(verdicts(page).offline).toBe('ok');
    page[4] = seen('offline', { items: ['Dune example.com'] });
    expect(verdicts(page).offline).toMatch(/no role="status" or role="alert"/);
  });

  it('fails a loading state with an alert, a ready state still busy, an empty state with no status', () => {
    const v = verdicts([
      seen('loading', { busy: 1, alerts: ['Boom'] }),
      seen('empty', { text: 'Nothing here' }),
      seen('ready', { busy: 2, items: ['a row'] }),
    ]);
    expect(v.loading).toMatch(/shows an alert \(Boom\)/);
    expect(v.empty).toMatch(/no role="status"/);
    expect(v.ready).toMatch(/still marked aria-busy="true"/);
  });

  it('judges component states by name: disabled, invalid, critical and info', () => {
    const v = verdicts([
      seen('default', { text: 'Save' }),
      seen('disabled', { text: 'Save' }),
      seen('invalid', { text: 'Link' }),
      seen('critical', { statuses: ['Saved'] }),
      seen('info', { alerts: ['Saved'] }),
    ]);
    expect(v.disabled).toMatch(/no disabled control/);
    expect(v.invalid).toMatch(/aria-invalid="true"/);
    expect(v.critical).toMatch(/role="alert"/);
    expect(v.info).toMatch(/role="status"/);
    expect(
      verdicts([seen('default', { text: 'Save' }), seen('disabled', { text: 'Save', disabled: 1 }), seen('invalid', { invalid: 1 }), seen('critical', { alerts: ['x'] }), seen('info', { statuses: ['y'] })]),
    ).toEqual({ default: 'ok', disabled: 'ok', invalid: 'ok', critical: 'ok', info: 'ok' });
  });

  it('holds a state with no named contract to rendering, and rendering differently from ready', () => {
    const v = verdicts([seen('ready', { items: ['a'] }), seen('saving', { text: 'ready view', items: ['a'] }), seen('archived', { text: 'Archived' })]);
    expect(v.saving).toMatch(/renders exactly as "ready", so the fixture ignores its state/);
    expect(v.archived).toBe('ok');
    expect(contractFor('archived')).toMatch(/renders, and differently from ready/);
    expect(contractFor('loading')).toMatch(/aria-busy="true"/);
  });

  it('fails a hover that paints a row while a click on it outside its title does nothing (a dead hit area)', () => {
    const row = { text: 'Dune by Frank Herbert', paints: ['background-color', 'cursor: pointer'], controls: ['link "Dune"'], click: 'nothing' };
    const page = listPage();
    page[3] = { ...page[3]!, hits: [row] };
    const [v] = judgeStates(page).filter((x) => x.state === 'ready');
    expect(v).toMatchObject({
      verdict: 'violation',
      problems: [],
      dead: ['hovering "Dune by Frank Herbert" paints it (background-color, cursor: pointer), but a click on it outside link "Dune" does nothing'],
    });
    // The same hover with nothing inside to click, in any state, a loading one included.
    page[0] = { ...page[0]!, hits: [{ ...row, controls: [] }] };
    expect(judgeStates(page).find((x) => x.state === 'loading')?.dead).toEqual(['hovering "Dune by Frank Herbert" paints it (background-color, cursor: pointer), but a click on it does nothing']);
    expect(hitContract()).toMatch(/acts on a click anywhere on it/);
  });

  it('passes the clean controls: a painted row whose click acts, and a row that paints nothing on hover', () => {
    const page = listPage();
    page[3] = {
      ...page[3]!,
      hits: [
        { text: 'Dune by Frank Herbert', paints: ['background-color'], controls: [], click: 'navigated to /list' },
        { text: 'Neuromancer by William Gibson', paints: ['cursor: pointer'], controls: ['link "Neuromancer"'], click: 'changed the page' },
        { text: 'A quiet row', paints: [], controls: ['link "A quiet row"'], click: 'nothing' },
      ],
    };
    expect(verdicts(page)).toEqual({ loading: 'ok', empty: 'ok', error: 'ok', ready: 'ok' });
    expect(judgeStates(page).every((v) => v.dead.length === 0)).toBe(true);
  });

  it('fails a fixture that renders nothing, throws, or is not on the page; and reports a missing one as missing', () => {
    const v = verdicts([
      seen('ready', { nodes: 0, text: '' }),
      seen('empty', { errors: ['TypeError: items is undefined'], statuses: ['x'] }),
      seen('error', { found: false, alerts: ['x'] }),
      seen('loading', { missing: true, found: false }),
    ]);
    expect(v.ready).toMatch(/renders nothing/);
    expect(v.empty).toMatch(/throws while it renders \(TypeError: items is undefined\)/);
    expect(v.error).toMatch(/no fixture container/);
    expect(v.loading).toMatch(/^missing: no state fixture/);
  });
});
