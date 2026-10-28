// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

// The rendered-state contract: what a page or component state must show once it renders, judged
// from what fwos's harness saw in the running app, not from what a test is called. A state's name
// sets its contract (loading is busy, an error announces itself and drops the ready state's
// content), and every state must render, and render differently from the ready one. In any state,
// what looks clickable must act: a row that paints on hover while a click only reaches its title
// has a dead hit area.

/**
 * Something in a state fixture that looks clickable, which the harness hovered and then clicked
 * away from the controls inside it.
 */
export interface HitObservation {
  /** Its text, to name it. */
  text: string;
  /** What hovering it changed (`background-color`), and `cursor: pointer` when it shows one. Empty when it promises nothing. */
  paints: string[];
  /** The controls inside it, which a click does reach: `link "Dune"`. */
  controls: string[];
  /** What the click away from them did: `nothing`, or what it changed (`navigated to /books/dune`, `changed the page`). */
  click: string;
}

/** What fwos's harness saw inside one state fixture of the running app. */
export interface StateObservation {
  state: string;
  /** The fixture page's HTTP status. */
  status: number;
  /** The fixture's container was on the page. */
  found: boolean;
  /** The app has no fixture for this state yet: the screen or component isn't registered. */
  missing?: boolean;
  /** What the page threw or logged as an error while the fixture rendered. */
  errors?: string[];
  /** Elements inside the fixture. */
  nodes: number;
  /** The fixture's visible text, its whitespace collapsed. */
  text: string;
  /** Elements marked aria-busy="true". */
  busy: number;
  /** The text of each visible role="alert". */
  alerts: string[];
  /** The text of each visible role="status" or <output>. */
  statuses: string[];
  /**
   * Content: the text outside links and buttons of each visible list item, table body row and
   * article, outside nav, header and footer.
   */
  items: string[];
  /** Disabled controls. */
  disabled: number;
  /** Elements marked aria-invalid="true". */
  invalid: number;
  /** What looks clickable, and what a click on it did. Absent from runs of a harness that didn't look. */
  hits?: HitObservation[];
}

export interface StateVerdict {
  state: string;
  /** ok: it renders as its contract says. violation: it doesn't. missing: there is no fixture to judge. */
  verdict: 'ok' | 'violation' | 'missing';
  /** How it breaks the contract its name sets. */
  problems: string[];
  /** Its dead hit areas: something that paints on hover, or shows a pointer, where a click does nothing. */
  dead: string[];
  /** named: its name has a contract. generic: only that it renders, and differently from ready. */
  contract: 'named' | 'generic';
}

interface Rule {
  busy?: 'required' | 'forbidden';
  alert?: 'required' | 'forbidden';
  status?: 'required';
  /** A role="status" or role="alert", either. */
  message?: 'required';
  disabled?: 'required';
  invalid?: 'required';
  /** Its own content (list items, rows, articles). */
  content?: 'required';
  /** None of the ready state's content: on a first load that failed or found nothing, old rows are stale. */
  freshOnly?: true;
  text: string;
}

const EMPTY: Rule = {
  status: 'required',
  busy: 'forbidden',
  alert: 'forbidden',
  freshOnly: true,
  text: 'a role="status" that says so (as EmptyState renders), nothing aria-busy, no alert, none of the ready state\'s content',
};

/** The contract per state name. A name not here is held to the generic rules only. */
const RULES: Record<string, Rule> = {
  loading: { busy: 'required', alert: 'forbidden', freshOnly: true, text: 'something marked aria-busy="true", no alert, none of the ready state\'s content' },
  empty: EMPTY,
  zero: EMPTY,
  filtered: EMPTY,
  'filtered-empty': EMPTY,
  error: { alert: 'required', busy: 'forbidden', freshOnly: true, text: 'a role="alert" that says what went wrong, nothing aria-busy, none of the ready state\'s content' },
  critical: { alert: 'required', text: 'a role="alert"' },
  info: { status: 'required', alert: 'forbidden', text: 'a role="status" and no alert' },
  ready: { busy: 'forbidden', alert: 'forbidden', text: 'its content, nothing aria-busy, no alert' },
  default: { busy: 'forbidden', text: 'its content, nothing aria-busy' },
  disabled: { disabled: 'required', text: 'a disabled control' },
  invalid: { invalid: 'required', text: 'something marked aria-invalid="true"' },
  offline: { message: 'required', text: 'a role="status" or role="alert" that says so; loaded content may stay' },
  'no-permission': { message: 'required', busy: 'forbidden', freshOnly: true, text: "a role=\"status\" or role=\"alert\" that says so, nothing aria-busy, none of the ready state's content" },
  'not-found': { busy: 'forbidden', freshOnly: true, text: "nothing aria-busy, none of the ready state's content" },
  partial: { message: 'required', content: 'required', text: 'what loaded, and a role="status" or role="alert" saying what is missing' },
};

/** One line saying what a state of that name must render. */
export function contractFor(state: string): string {
  const rule = RULES[state];
  return rule ? `renders ${rule.text}` : 'renders, and differently from ready (no contract for this name beyond that)';
}

/**
 * What fwos's state harness can catch in states like these (each a page's or component's states):
 * another state under a state's name and a dead hit area always; stale content where a target has a
 * ready state and one that must drop its content; a loading state that isn't busy where one is named so.
 */
export function stateClasses(targets: string[][]): string {
  const parts = ['another state under its name'];
  const stale = targets.filter((t) => t.includes('ready') && t.some((s) => RULES[s]?.freshOnly === true));
  if (stale.length > 0) parts.push(stale.some((t) => t.includes('error')) ? 'stale content on error' : 'stale content in a state that drops it');
  if (targets.some((t) => t.includes('loading'))) parts.push('a loading state not busy');
  return `a state that renders wrong (${parts.join(', ')}) and a hover with a dead hit area`;
}

/** What every state must do with what looks clickable, whatever its name. */
export function hitContract(): string {
  return 'anything that changes on hover, or shows a pointer, acts on a click anywhere on it';
}

const quote = (xs: string[], max = 3) => xs.slice(0, max).join(', ') + (xs.length > max ? `, and ${xs.length - max} more` : '');

/** `link "Dune"`, `link "Dune" and button "Remove"`. */
const listed = (xs: string[]) => (xs.length <= 2 ? xs.join(' and ') : quote(xs));

/** Each hit that paints on hover while a click away from its controls does nothing. */
function deadHits(o: StateObservation): string[] {
  return (o.hits ?? [])
    .filter((h) => h.paints.length > 0 && h.click === 'nothing')
    .map((h) => `hovering "${h.text}" paints it (${h.paints.join(', ')}), but a click on it ${h.controls.length > 0 ? `outside ${listed(h.controls)} ` : ''}does nothing`);
}

/** What `obs` shows, for telling two states apart. */
const fingerprint = (o: StateObservation) => JSON.stringify([o.text, o.nodes, o.busy, o.alerts, o.statuses, o.items, o.disabled, o.invalid]);

/**
 * Judges one target's states (a page's or a component's) together: each against its name's
 * contract, and against the ready state (or `default`, for a component), which tells stale
 * content and a fixture that ignores its state apart.
 */
export function judgeStates(observations: StateObservation[]): StateVerdict[] {
  const rendered = (o: StateObservation | undefined) => !!o && o.found && !o.missing;
  const reference = [observations.find((o) => o.state === 'ready'), observations.find((o) => o.state === 'default')].find(rendered);
  const readyContent = new Set(reference?.state === 'ready' ? reference.items : []);
  return observations.map((o) => {
    const rule = RULES[o.state];
    const contract = rule ? 'named' : 'generic';
    if (o.missing) return { state: o.state, verdict: 'missing', problems: ['no state fixture renders it yet'], dead: [], contract };
    const problems: string[] = [];
    if (!o.found) problems.push(`no fixture container on the page (HTTP ${o.status})`);
    else if ((o.errors ?? []).length > 0) problems.push(`throws while it renders (${quote(o.errors!, 1)})`);
    else if (o.nodes === 0 && o.text === '') problems.push('renders nothing');
    if (problems.length === 0) {
      if (rule?.busy === 'required' && o.busy === 0) problems.push('nothing is marked aria-busy="true"');
      if (rule?.busy === 'forbidden' && o.busy > 0) problems.push('still marked aria-busy="true"');
      if (rule?.alert === 'required' && o.alerts.length === 0) problems.push('no role="alert"');
      if (rule?.alert === 'forbidden' && o.alerts.length > 0) problems.push(`shows an alert (${quote(o.alerts, 1)})`);
      if (rule?.status === 'required' && o.statuses.length === 0) problems.push('no role="status"');
      if (rule?.message === 'required' && o.statuses.length + o.alerts.length === 0) problems.push('no role="status" or role="alert" saying so');
      if (rule?.disabled === 'required' && o.disabled === 0) problems.push('no disabled control');
      if (rule?.invalid === 'required' && o.invalid === 0) problems.push('nothing is marked aria-invalid="true"');
      if (rule?.content === 'required' && o.items.length === 0) problems.push('shows no content (list items, rows or articles)');
      if (rule?.freshOnly) {
        const stale = o.items.filter((i) => readyContent.has(i));
        if (stale.length > 0) problems.push(`keeps the ready state's content (${quote(stale)})`);
      }
      if (reference && reference !== o && fingerprint(reference) === fingerprint(o)) problems.push(`renders exactly as "${reference.state}", so the fixture ignores its state`);
    }
    const dead = o.found ? deadHits(o) : [];
    return { state: o.state, verdict: problems.length + dead.length > 0 ? 'violation' : 'ok', problems, dead, contract };
  });
}
