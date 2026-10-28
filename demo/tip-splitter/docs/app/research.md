---
title: "Tip Splitter: research"
based_on: [brief.md@a279ee905c8d]
---

# Tip Splitter: research

Run 2026-10-12. Every finding has a source and a date, or is marked `[UNVERIFIED]`. Research
suggests; the user decides. Picks and rejections are logged in decisions.md.

## Verdict

**exists free**: many free web and phone tip calculators already do bill, tip %, people and
per-person. What's left is polish: no ads, no sign-up, phone-first, and rounding you can see. The user chose: continue (D-4).

## Market

Read from search snippets only. Store pages weren't opened, so ratings and prices are second-hand.

| Product | Price | What users praise | What users complain about | Source, date |
|---|---|---|---|---|
| Tip Calculator % Pro (iOS) | $11.99 | Simple, split, no ads (4.8/5, 877 ratings) | Round-up setting doesn't stay on | apps.apple.com/us/app/tip-calculator-pro/id534950419, 2026-10-12 |
| Tip Calculator % Free (iOS) | free | Quick, uncomplicated | none found | bridgingapps.org (review), 2026-10-12 |
| Tips (iOS) | [UNVERIFIED] | Large text, split slider, rounding, pre-tax tip | Last update Feb 2021 | apps.appfollow.io/ios/tips/284650141, 2026-10-12 |
| Split Bill / Tip Calculator +++ (iOS) | free | Share summary by text; bill tracker, tax exclusion, dark mode | none found | apps.apple.com id971560709; apps.appfollow.io id539396423, 2026-10-12 |
| CalculatorSoup app (iOS) | free, no ads | Any number of people, tax and tip, round total up | none found | apps.apple.com id6738851422, 2026-10-12 |
| CalcPlanet, Codeshack (web) | free | No sign-up; bill, tip %, people | Ad policy not stated | calcplanet.com/daily-life/tip-split-calculator; codeshack.io/tip-calculator, 2026-10-12 |
| Splitwise | free tier capped; Pro $4.99/mo | Group expense tracking | Daily entry cap, ads, paywall (vendor blog, unreliable) | getfinny.app/blog/best-splitwise-alternatives-2026, 2026-10-12 |
| Tricount, Splid, Settle Up, Tab | free / freemium | Group splitting | Need accounts or group codes [UNVERIFIED] | same Finny article, 2026-10-12 |

Gaps worth filling:

- Show when rounding happened. An old Tipper review complains it rounded the total with no indication (windowscentral.com/review-tipper, 2026-10-12).
- No ads, no account, nothing saved: competitors are criticised for ads, caps and paywalls (getfinny.app, 2026-10-12).
- Current user sentiment is thin; no recent complaint threads found [UNVERIFIED].

## Features

### Bill amount

- Sub-features: text input with `inputmode="decimal"` (it's a keyboard hint only, so validate in code) (MDN inputmode, 2026-10-12); accept "." or "," as the decimal; strip spaces and currency symbols; max 2 decimals [UNVERIFIED].
- States: empty (results show a placeholder, never $0.00 or NaN), invalid (inline message, results cleared), zero, over the max.
- Edge cases: 0.01, huge values (cap around 9,999,999.99), pasted text, multiple separators.
- Platform conventions: input font ≥16px so iOS doesn't zoom on focus; visible label [UNVERIFIED].

### Tip %

- Sub-features: quick picks as a real radio group; a custom field that clears the quick pick when typed in, and vice versa [UNVERIFIED].
- States: a default pick (the brief doesn't say which), custom empty, invalid, over the max.
- Edge cases: 0% is valid (total = bill); decimals like 12.5% allowed; negative invalid; cap (e.g. 100%).
- Platform conventions: tap targets ≥44px [UNVERIFIED].

### Number of people

- Sub-features: − / + stepper around a numeric field (`inputmode="numeric"`), buttons disabled at 1 and 50, labelled "Decrease people" / "Increase people" [UNVERIFIED].
- States: empty or 0 (revert to last valid on blur), over 50 (clamp or error), non-integers, pasted text.
- Edge cases: 1 person, so per-person = total.

### Live results

- Sub-features: tip, total, per person, updating on every change; per person is the big number.
- States: placeholder until inputs are valid.
- Edge cases: rounding each share up means people × share can exceed the total by up to (people − 1) cents. Use integer cents and `ceilDiv(a, b) = floor((a + b − 1) / b)` to avoid float off-by-one [UNVERIFIED].
- Accessibility: pre-rendered `aria-live="polite"` + `aria-atomic="true"` region, empty on load; don't announce every keystroke (debounce ~500ms) (MDN aria-live, 2026-10-12). Tabular numbers.
- Convention: tip is usually on the pre-tax amount; a one-line hint helps [UNVERIFIED].

## Feasibility

| Concern | Finding | Impact on the plan | Source, date |
|---|---|---|---|
| Money math | Floats give wrong cents; integer cents avoid it | No dependency; unit-test 0.01, 1 and 50 people, 15% of 33.33, big bills | [UNVERIFIED] general knowledge, 2026-10-12 |
| Number parsing | `Intl.NumberFormat` formats but doesn't parse | Small custom parser; `type="text"` + `inputmode="decimal"` over `type="number"` | [UNVERIFIED], 2026-10-12 |
| Static export | `output: 'export'` gives a static `out/` folder; no `headers` config, no default image optimisation (docs v16.4.0) | Fits. Security headers set at the host | nextjs.org/docs/app/guides/static-exports, 2026-10-12 |
| Offline after first visit | Needs a service worker over HTTPS; Next.js points to Serwist; a hand-written precache worker is viable for one page | Small cache-first worker, versioned cache, `sw.js` served no-cache, offline test incl. hard reload | nextjs.org/docs/app/guides/progressive-web-apps, 2026-10-12 |
| Secure context | Service workers need HTTPS (or localhost) | Host must serve HTTPS | developer.mozilla.org Service_Worker_API, 2026-10-12 |
| Hosting | Any static host; root domain keeps SW scope simple | Prefer a host that allows custom headers | nextjs.org static exports, 2026-10-12 |
| Live numbers a11y | Live region must exist empty on load; polite; atomic | One hidden status region, debounced; check WCAG 4.1.3, 2.5.8, 1.4.10 in QA | developer.mozilla.org aria-live, 2026-10-12 |

## Libraries

Each checked live against the registry the day of the run. Downloads are last week (2026-10-05 to 2026-10-11).

| Need | Candidate | Version | Last release | Downloads/week | Licence | Repo | Checked |
|---|---|---|---|---|---|---|---|
| Money math | none (integer cents) | n/a | n/a | n/a | n/a | n/a | recommended |
| Money math | big.js | 7.0.1 | 2025-04-21 | 34,015,177 | MIT | github.com/MikeMcl/big.js | 2026-10-12, optional |
| Money math | decimal.js | 10.6.0 | 2025-07-06 | 100,562,946 | MIT | github.com/MikeMcl/decimal.js | 2026-10-12, skip (too big) |
| Money math | dinero.js | 2.0.2 | 2026-03-13 | 768,689 | MIT | github.com/dinerojs/dinero.js | 2026-10-12, skip (overkill) |
| Offline | hand-written `sw.js` | n/a | n/a | n/a | n/a | n/a | recommended |
| Offline | @serwist/next | 9.5.13 | 2026-10-04 | 451,072 | MIT | github.com/serwist/serwist | 2026-10-12; webpack plugin, Next 16 defaults to Turbopack [UNVERIFIED compat] |
| Offline | next-pwa | 5.6.0 | 2022-08-23 | 233,965 | MIT | github.com/shadowwalker/next-pwa | 2026-10-12, skip (unmaintained) |
| Numeric input | react-number-format | 5.4.5 | 2026-03-22 | 5,599,426 | MIT | github.com/s-yadav/react-number-format | 2026-10-12, skip |

## Suggested additions

Each needs the user's yes before it reaches the brief.

| # | Suggestion | Why | Accepted? |
|---|---|---|---|
| 1 | Money math in integer cents, no library | Avoids float cent errors; zero dependencies | yes |
| 2 | Show rounding: "Rounded up: the group pays $X.XX" when shares exceed the total | Rounding with no indication is a known complaint | yes |
| 3 | Accept "." or "," as the decimal; strip spaces and symbols | `inputmode` only changes the keyboard | yes |
| 4 | Limits: bill up to 9,999,999.99; tip 0–100% with decimals; people 1–50 with a −/+ stepper | Stops nonsense output; stepper is easier on a phone | yes |
| 5 | Default tip pick: 18% | The brief doesn't set one; 18% is a common middle | yes |
| 6 | Results show a placeholder until the bill is valid (never $0.00 or NaN) | Clear empty and error states | yes |
| 7 | Reset button | Next bill without reloading | yes |
| 8 | One-line hint: "Tip is on the amount you enter. Enter it before tax if you tip pre-tax." | Matches tipping convention without adding a tax field | yes |
| 9 | Polite, debounced screen-reader announcement of the results | WCAG 4.1.3 status messages | yes |
| 10 | Offline via a small hand-written service worker (no library) | Brief wants offline; avoids Serwist/Turbopack friction | yes |
| 11 | Web manifest so it can be added to the home screen | Cheap, built into Next.js | yes |
| 12 | Currency: show a "$" symbol (USD formatting) vs no symbol | Brief says local format, no symbol; feasibility suggests a fixed currency | yes ($, D-5) |

## Contradictions with the brief

None left. Currency display (#12) was resolved: show "$" with USD formatting (D-5), replacing the
brief's "no currency symbol" assumption.
