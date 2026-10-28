// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

'use client';

import { type FocusEvent, useRef } from 'react';
import { formatUsd } from '@/shared/lib';
import { Button, Card, NumberStepper, SegmentedControl, TextField } from '@/shared/ui';

export const TIP_PICKS = ['10', '15', '18', '20'] as const;

/** Everything the calculator shows. Amounts are whole cents; null means "nothing to show yet". */
export interface CalculatorViewProps {
  bill: string;
  billError?: string;
  tipPick: string | null;
  customTip: string;
  tipError?: string;
  /** Shown under the custom tip when no tip is chosen. A prompt, not an error. */
  tipPrompt?: string;
  people: string;
  peopleError?: string;
  tipCents: number | null;
  totalCents: number | null;
  perPersonCents: number | null;
  /** Sum of the rounded-up shares, when it's more than the total. */
  collectedCents: number | null;
  /** What the screen reader hears after typing settles. */
  announcement: string;
  onBillChange?: (value: string) => void;
  onTipPick?: (value: string) => void;
  onCustomTipChange?: (value: string) => void;
  onPeopleChange?: (value: string) => void;
  onPeopleStep?: (next: number) => void;
  onReset?: () => void;
  /** A field gained focus. */
  onFieldFocus?: (field: CalculatorField) => void;
  /** A field lost focus; its error may show from now on. */
  onFieldBlur?: (field: CalculatorField) => void;
}

export type CalculatorField = 'bill' | 'tip' | 'people';

const show = (cents: number | null) => (cents === null ? '—' : formatUsd(cents));
const noop = () => {};

/** The one screen. Slices wire the real math into these props; the layout stays. */
export function CalculatorView(props: CalculatorViewProps) {
  const { perPersonCents, totalCents, collectedCents, people } = props;
  const count = Number.parseInt(people, 10);
  const billRef = useRef<HTMLInputElement>(null);
  const focus = (field: CalculatorField) => () => props.onFieldFocus?.(field);
  const blur = (field: CalculatorField) => () => props.onFieldBlur?.(field);
  /** The stepper takes no focus handlers, so listen around it and keep only its text field. */
  const onField = (handler: () => void) => (event: FocusEvent) => {
    if (event.target instanceof HTMLInputElement) handler();
  };
  const reset = () => {
    (props.onReset ?? noop)();
    billRef.current?.focus();
  };
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <h1 className="text-title text-fg">Split the bill</h1>

      <Card className="sticky top-2 z-10 flex flex-col gap-3">
        <div className="flex flex-col">
          <p className="text-label text-fg-secondary">Each person pays</p>
          <p className="text-metric text-fg tabular-nums">{show(perPersonCents)}</p>
        </div>
        <dl className="grid grid-cols-2 gap-2">
          <div>
            <dt className="text-caption text-fg-muted">Tip</dt>
            <dd className="text-body-strong text-fg tabular-nums">{show(props.tipCents)}</dd>
          </div>
          <div>
            <dt className="text-caption text-fg-muted">Total</dt>
            <dd className="text-body-strong text-fg tabular-nums">{show(totalCents)}</dd>
          </div>
        </dl>
        {collectedCents !== null && totalCents !== null && collectedCents > totalCents ? (
          <p className="text-caption text-fg-secondary">
            Rounded up: the group pays {formatUsd(collectedCents)}, {formatUsd(collectedCents - totalCents)} over the total.
          </p>
        ) : null}
        {Number.isInteger(count) && count === 1 && perPersonCents !== null ? (
          <p className="text-caption text-fg-secondary">Just you, so you pay the whole total.</p>
        ) : null}
      </Card>
      <div role="status" aria-atomic="true" className="sr-only">
        {props.announcement}
      </div>

      <TextField
        label="Bill amount ($)"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        ref={billRef}
        value={props.bill}
        onFocus={focus('bill')}
        onBlur={blur('bill')}
        onChange={(event) => (props.onBillChange ?? noop)(event.target.value)}
        error={props.billError}
        hint="Tip is on the amount you enter. Enter it before tax if you tip pre-tax."
      />

      <div className="flex flex-col gap-2">
        <SegmentedControl
          legend="Tip"
          options={TIP_PICKS.map((value) => ({ value, label: `${value}%` }))}
          value={props.tipPick}
          onChange={props.onTipPick ?? noop}
        />
        <TextField
          label="Custom tip (%)"
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. 12.5"
          value={props.customTip}
          onChange={(event) => (props.onCustomTipChange ?? noop)(event.target.value)}
          onFocus={focus('tip')}
          onBlur={blur('tip')}
          error={props.tipError}
          hint={props.tipPrompt}
        />
      </div>

      <div onFocus={onField(focus('people'))} onBlur={onField(blur('people'))}>
        <NumberStepper
          label="People"
          value={people}
          min={1}
          max={50}
          onChange={props.onPeopleChange ?? noop}
          onStep={props.onPeopleStep ?? noop}
          decrementLabel="Decrease people"
          incrementLabel="Increase people"
          error={props.peopleError}
        />
      </div>

      <Button variant="secondary" onClick={reset} className="h-11 min-w-11 self-start">
        Reset
      </Button>
    </div>
  );
}
