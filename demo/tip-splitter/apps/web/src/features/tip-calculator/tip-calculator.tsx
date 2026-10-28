// Copyright 2026 Workloom Solutions Private Limited
// SPDX-License-Identifier: MIT

'use client';

import { useEffect, useState } from 'react';
import { formatUsd, parseAmount, parsePeople, parsePercent, splitBill, type SplitResult } from '@/shared/lib';
import { type CalculatorField, CalculatorView } from './calculator-view';

const OPENING = { bill: '', tipPick: '18' as string | null, customTip: '', people: '2' };

interface Inputs {
  bill: string;
  tipPick: string | null;
  customTip: string;
  people: string;
}

const BILL_ERROR = 'Enter an amount like 42.50, up to 9,999,999.99.';
const TIP_ERROR = 'Enter a tip from 0 to 100%, up to 2 decimals.';
const PEOPLE_ERROR = 'Enter 1 to 50 people.';
const PICK_PROMPT = 'Pick a tip or type one.';

type Blurred = Record<CalculatorField, boolean>;
const UNTOUCHED: Blurred = { bill: false, tip: false, people: false };

/** The split for the current inputs, or null when any of them doesn't parse yet. */
function compute({ bill, tipPick, customTip, people }: Inputs): SplitResult | null {
  const billCents = parseAmount(bill);
  const tipBasisPoints = tipPick !== null ? Number(tipPick) * 100 : parsePercent(customTip);
  const count = parsePeople(people);
  if (billCents === null || tipBasisPoints === null || count === null) return null;
  return splitBill({ billCents, tipBasisPoints, people: count });
}

/** Announcements wait for typing to settle this long, so a screen reader doesn't read every keystroke. */
const ANNOUNCE_DELAY_MS = 500;

/** What the status region says for a split; empty while there is nothing to show. */
function describe(result: SplitResult | null): string {
  if (result === null) return '';
  const rounded = result.collectedCents > result.totalCents ? ', rounded up' : '';
  return `Tip ${formatUsd(result.tipCents)}, total ${formatUsd(result.totalCents)}, ${formatUsd(result.perPersonCents)} each${rounded}.`;
}

/** The calculator on `/`. Holds the inputs and recomputes the split on every change. */
export function TipCalculator() {
  const [bill, setBill] = useState(OPENING.bill);
  const [tipPick, setTipPick] = useState<string | null>(OPENING.tipPick);
  const [customTip, setCustomTip] = useState(OPENING.customTip);
  const [people, setPeople] = useState(OPENING.people);

  // A field's message shows once it has been left while invalid, and hides again while it's being edited.
  const [blurred, setBlurred] = useState<Blurred>(UNTOUCHED);

  const result = compute({ bill, tipPick, customTip, people });
  // The status region updates once the inputs have stayed the same for ANNOUNCE_DELAY_MS. Every edit
  // restarts the wait, even one that leaves the split unchanged ("120." then "120.0").
  const pending = describe(result);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setAnnouncement(pending), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending, bill, tipPick, customTip, people]);

  const billInvalid = bill.trim() !== '' && parseAmount(bill) === null;
  const tipInvalid = tipPick === null && customTip.trim() !== '' && parsePercent(customTip) === null;
  const peopleInvalid = parsePeople(people) === null;
  const noTip = tipPick === null && customTip.trim() === '';

  const markBlurred = (field: CalculatorField, value: boolean) =>
    setBlurred((current) => (current[field] === value ? current : { ...current, [field]: value }));

  const pickTip = (value: string) => {
    setTipPick(value);
    setCustomTip('');
  };

  const typeCustomTip = (value: string) => {
    setCustomTip(value);
    setTipPick(null);
  };

  const reset = () => {
    setBill(OPENING.bill);
    setTipPick(OPENING.tipPick);
    setCustomTip(OPENING.customTip);
    setPeople(OPENING.people);
    setBlurred(UNTOUCHED);
  };

  return (
    <CalculatorView
      bill={bill}
      billError={blurred.bill && billInvalid ? BILL_ERROR : undefined}
      tipPick={tipPick}
      customTip={customTip}
      tipError={blurred.tip && tipInvalid ? TIP_ERROR : undefined}
      tipPrompt={noTip ? PICK_PROMPT : undefined}
      people={people}
      peopleError={blurred.people && peopleInvalid ? PEOPLE_ERROR : undefined}
      tipCents={result?.tipCents ?? null}
      totalCents={result?.totalCents ?? null}
      perPersonCents={result?.perPersonCents ?? null}
      collectedCents={result?.collectedCents ?? null}
      announcement={announcement}
      onBillChange={setBill}
      onTipPick={pickTip}
      onCustomTipChange={typeCustomTip}
      onPeopleChange={setPeople}
      onPeopleStep={(next) => setPeople(String(next))}
      onReset={reset}
      onFieldFocus={(field) => markBlurred(field, false)}
      onFieldBlur={(field) => markBlurred(field, true)}
    />
  );
}
