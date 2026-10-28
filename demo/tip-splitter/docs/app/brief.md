---
title: "Tip Splitter: brief"
change: "0001-initial"
---

# Tip Splitter: brief

> **What you're approving**
> 1. Splitting a restaurant bill plus tip between friends is slow and error-prone in your head or a phone calculator.
> 2. It's for whoever at the table picks up the bill, on their phone, a few times a month.
> 3. First release, one screen: enter the bill, pick a tip %, set how many people, see what each person pays.
> 4. Web, responsive down to a phone, works offline after the first visit. Nothing is saved: all the math happens in the browser.
> 5. Amounts in US dollars. Each share rounds up to the cent, and the screen says so when the group pays a few cents over.

## The problem

Working out the tip and then dividing the total by the number of people takes a calculator and a
couple of steps, and it's easy to get wrong at the table. Today people pass a phone calculator
around, or one person pays and everyone settles roughly ("just send me 40"). [ASSUMED]

## Who it's for

Whoever at the table is sorting out the bill, on their phone, at the restaurant. A few times a
month. Nobody else has to open it: they just get told their share. [ASSUMED]

## Core jobs (first release)

1. **Enter the bill amount**: any amount with cents is accepted; nonsense (empty, negative, letters) shows a clear message instead of a wrong answer.
2. **Pick a tip %**: the tip amount and the bill total update as soon as the % changes.
3. **Set the number of people and see each share**: each person's share (tip included) shows right away, and the shares add up to at least the total.

## Features

| Feature | Priority | Notes |
|---|---|---|
| Bill amount input | must-have | Up to $9,999,999.99. Accepts "." or "," as the decimal (D-6) |
| Tip % input with quick picks (10, 15, 18, 20) plus a custom % | must-have | 18% picked by default (D-6). Custom allows 0–100% with decimals. Quick picks are [ASSUMED] |
| Number of people input | must-have | 1 to 50, with a − / + stepper (D-6) |
| Results: tip amount, total, amount per person | must-have | Updates live, no "calculate" button [ASSUMED]. Shows a placeholder until the bill is valid, never $0.00 or NaN (D-6) |
| Rounding note | must-have | "Rounded up: the group pays $X.XX" when shares add up to more than the total (D-6) |
| Reset button | must-have | Clears for the next bill (D-6) |
| Pre-tax hint | must-have | One line: the tip is on the amount you enter (D-6) |
| Screen-reader announcement of results | must-have | Polite and debounced, not on every keystroke (D-6) |
| Works offline after first visit | must-have | Small hand-written service worker, no library (D-6) |
| Add to home screen | must-have | Web manifest (D-6) |
| Even split | must-have | Only split mode in v1 (decided, D-1) |
| Uneven or itemised split ("I only had a salad") | not doing | v1 stays tiny (D-1) |
| Accounts and sign-in | not doing | D-2 |
| Saving past bills / history | later | Nothing to save in v1 [ASSUMED] |
| Tax handled separately from tip | later | v1 tips on whatever amount is entered [ASSUMED] |
| Share result (send to friends) | later | |

## Platforms

Web, responsive down to a phone. Phone is the main use. No desktop or native app.

## Data

None stored. Every number lives on the screen and is gone on reload. No backend, no API. [ASSUMED]
Money math uses whole cents, not decimals, so no cent errors (D-6). Amounts show in US dollars (D-5).

## Accounts

No sign-in, no roles (D-2).

## Non-goals

- Uneven or itemised splits.
- Accounts, history, or syncing between people.
- Payments (Venmo, UPI, etc.) or requesting money.
- More than one screen (D-3).

## Constraints

- Keep v1 tiny: one screen (D-3).
- English only, WCAG 2.2 AA. [ASSUMED]
- No analytics, no personal data. [ASSUMED]

## Success signal

At the table, you get each person's share in under 10 seconds without opening a calculator, and
nobody's short when the money's added up.

## Assumed

Every default taken on the user's behalf. Each stays here, tagged, until confirmed.

- [ASSUMED] T1 Problem: tip math plus dividing at the table is slow and error-prone; today people use a phone calculator or settle roughly (the usual reason a splitter beats a calculator)
- [ASSUMED] T2 Who: the person sorting out the bill, on their phone, a few times a month (it's used at the table)
- [ASSUMED] T3 Success: shares show live, and add up to at least the total (nobody's short)
- [ASSUMED] T4 Platforms: web, responsive down to a phone (works everywhere; no install)
- [ASSUMED] T5 Tip quick picks 10/15/18/20 plus custom (one tap beats typing)
- [ASSUMED] T5 Tip is calculated on the amount entered; no separate tax line (keeps v1 to 3 inputs)
- [ASSUMED] T6 Data: nothing saved, nothing sent anywhere (v1 has nothing worth keeping; this differs from the fwos default of local saving)
- [ASSUMED] T8 Design system: the neutral starter, light and dark (passes contrast; swap in a brand any time)
- [ASSUMED] Rounding rule: each share is rounded up to the next cent (nobody's short). Showing the overage is decided (D-6); the rule itself is still assumed
- [ASSUMED] The tip amount itself rounds to the nearest cent, half up (the usual convention)
- [ASSUMED] T10 Integrations: none (each one adds a backend)
- [ASSUMED] T11 Constraints: no deadline or required tech
- [ASSUMED] T12 Privacy: no personal data, no analytics (nothing to consent to)
- [ASSUMED] T13 English only, WCAG 2.2 AA (the common legal bar)
- [ASSUMED] T14 Hosting: any static host, picked at release (fwos never deploys)
- [ASSUMED] T15 Identity: name "Tip Splitter", no icon yet
- [ASSUMED] T16 Browsers: last 2 versions of evergreen browsers

## Open questions

- Rounding: recommended answer is round each share up to the cent. If it flips to "round to nearest", shares can come up a cent short and we'd show who covers the difference.
