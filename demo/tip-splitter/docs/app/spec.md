---
title: "Tip Splitter: spec"
based_on: [brief.md@a279ee905c8d, ia.json@4e01c58576df, modules.json@d5c2906f7e3d]
---

# Tip Splitter: spec

Builds on [the brief](brief.md) (not repeated here), [ia.json](ia.json) and
[modules.json](modules.json). Decisions are in [decisions.md](decisions.md).

## 1. What you're approving

1. First release: one screen that splits a bill plus tip evenly, live, with nothing saved.
2. One page, `calculator` at `/`, in 6 states; 4 journeys: split a bill, fix a mistake, start the next bill, use it offline.
3. Data: none. No backend, no API, no storage. Every test runs against the app on this device (`local`).
4. Web only, responsive down to a 320px phone, a static export any HTTPS host can serve.
5. 27 ACs. 1 is manual (a screen-reader walkthrough). 1 named gap: no app icon yet, so home-screen install uses the browser's default icon.

## 2. Journeys

- **J1 Split a bill**: the person sorting out the bill opens the app at the table, types the bill, picks a tip, sets the head count and reads each person's share.
- **J2 Fix a mistake**: they type something the app can't use (a typo, a silly tip, 0 people), see what's wrong, fix it, and the results come back.
- **J3 Next bill**: they tap Reset and start again from the opening values.
- **J4 Use it anywhere**: after one visit, they open it with no signal (or from the home screen) and it still works.

## 3. Scope by platform

| Feature | Web | Electron | Mac | Notes (each difference intended and logged) |
|---|---|---|---|---|
| Calculator screen | yes | not planned | not planned | Web only (brief T4) |
| Offline after first visit | yes | n/a | n/a | Hand-written service worker (D-13) |
| Add to home screen | yes | n/a | n/a | Web manifest (D-6) |
| Screen-reader walkthrough | VoiceOver on iOS Safari only | n/a | n/a | Android TalkBack and desktop screen readers aren't walked through by hand in v1; automated a11y checks cover all |

## 4. Screens and navigation

From ia.json: one page, `calculator` ("Split the bill") at `/`, kind `nav`, order 1, visible to the
one role `user`. No drill-downs, no unlinked pages. The header shows the app name; with one page the
nav has a single entry.

## 5. States per screen

| Page | States | Notes |
|---|---|---|
| calculator | empty | Opening values: blank bill, 18% picked, 2 people; results show "—" (D-21) |
| calculator | ready | Valid inputs; tip, total and each share show, live. A typed $0 bill is valid and shows $0.00 (D-22) |
| calculator | rounded | Shares add up to more than the total; the rounding note shows (D-16) |
| calculator | invalid-bill | Bill isn't a usable amount; message on blur, results "—" (D-19) |
| calculator | invalid-tip | Custom tip outside 0-100%, more than 2 decimals or not a number (message on blur); or no tip chosen at all, custom cleared with no pick (D-18). Results "—" |
| calculator | people-bounds | At 1 (− off, "Just you" note) or 50 (+ off); or typed 0, over 50 or not a whole number (D-20) |

No loading, error-with-retry, no-permission or partial states: nothing is fetched. Offline doesn't
change the screen; it's proven by AC-calc-20.

## 6. Data and API contract

No operations in `packages/api-contract/openapi.yaml`, nothing fetched or saved, no sign-in (D-8).
With no data layer, "Proven against: local" means the test runs in a real browser against the built
app on this device, with nothing mocked.

## 7. Architecture

Modules from modules.json: the `tip-calculator` feature owns the screen and depends on `shared-ui`
and `shared-lib`; money math and number parsing are pure, in whole cents, in `shared-lib`, covered
by a unit table; the `app` route renders the feature and wires the manifest and offline support.
Off the default stack: a static export (D-7), no data layer (D-8), CSP set by a meta tag because a
static export can't set headers. Build mechanics are in D-24.

## 8. Design system binding

Neutral starter (D-14), light and dark by `prefers-color-scheme`. Registered components used:
`text-field`, `segmented-control` (new: default, selected, disabled), `number-stepper` (new:
default, at-min, at-max, invalid), `button`, `card`. The per-person amount uses the `metric` type
role; every amount uses tabular numbers.

## 9. Cross-cutting

Only overrides of fwos defaults (WCAG 2.2 AA, English, no analytics, CSP on, no secrets in the client):

- Tap targets at least 44px (stricter than the 24px default): it's used one-handed at a table.
- Currency fixed to USD (D-5).

## 10. Acceptance criteria

### AC-calc-1: I see the opening values when I open the app
- Journey: J1
- Given a first visit to `/`, when the page loads, then the bill field is empty, "18%" is the checked tip, People shows 2, and "Each person pays", Tip and Total all show "—".
- Proven against: local
- Release: first

### AC-calc-2: I see each share as soon as I type the bill
- Journey: J1
- Given the opening values, when I type "120.00" in Bill amount and press + twice (4 people), then without pressing anything else Tip shows $21.60, Total $141.60 and Each person pays $35.40.
- Proven against: local
- Release: first

### AC-calc-3: Picking a tip updates the results
- Journey: J1
- Given a bill of 120.00 and 4 people, when I tap "20%", then "20%" is checked, Tip shows $24.00, Total $144.00 and Each person pays $36.00.
- Proven against: local
- Release: first

### AC-calc-4: I can type my own tip
- Journey: J1
- Given a bill of 120.00, 4 people and 18% checked, when I type "12.5" in Custom tip, then no quick pick is checked, Tip shows $15.00, Total $135.00 and Each person pays $33.75; and when I then tap "15%", the Custom tip field is emptied and Tip shows $18.00.
- Proven against: local
- Release: first

### AC-calc-5: A 0% tip is allowed
- Journey: J1
- Given a bill of 50.00 and 2 people, when I type "0" in Custom tip, then Tip shows $0.00, Total $50.00 and Each person pays $25.00, with no error.
- Proven against: local
- Release: first

### AC-calc-6: I'm told when shares were rounded up
- Journey: J1
- Given a bill of 100, 18% and 3 people, when the results show, then Each person pays shows $39.34 and the note reads "Rounded up: the group pays $118.02, $0.02 over the total."
- Proven against: local
- Release: first

### AC-calc-7: No rounding note when the split is exact
- Journey: J1
- Given a bill of 120.00, 18% and 4 people, when the results show, then no text starting "Rounded up" is on the page.
- Proven against: local
- Release: first

### AC-calc-8: The tip rounds to the nearest cent
- Journey: J1
- Given a bill of 33.33, 1 person, when I tap "15%", then Tip shows $5.00 and Total $38.33 (4.9995 rounds half up).
- Proven against: local
- Release: first

### AC-calc-9: I can type amounts the way I'm used to
- Journey: J1
- Given 1 person and 0% tip, when I type each of these in Bill amount, then Total shows: "42,50" → $42.50; "$1,234.50" → $1,234.50; "1,234" → $1,234.00; " 42.5 " → $42.50; "1.234,50" → $1,234.50; "1,234,567" → $1,234,567.00; "1.234.567" → $1,234,567.00; "12,345.6" → $12,345.60. And "1,2345" and "1.234" get the bill error from AC-calc-10.
- The rule: spaces and a leading "$" are ignored. If both "." and "," appear, the last one is the decimal point and the other separates thousands in groups of 3. If only one kind appears more than once, it separates thousands in groups of 3. A single "," followed by exactly 3 digits separates thousands; followed by 1 or 2 digits it's the decimal point; followed by 4 or more digits it's invalid. A single "." is always the decimal point. At most 2 decimals; anything else is invalid.
- Proven against: local
- Release: first

### AC-calc-10: I'm told when the bill isn't a usable amount
- Journey: J2
- Given the opening values, when I type "12..5" in Bill amount, then results show "—" at once and no message shows while the field has focus; and when I leave the field, it's marked invalid and reads "Enter an amount like 42.50, up to 9,999,999.99." The same happens for "abc", "-5", "4.505" (3 decimals) and "10000000".
- Proven against: local
- Release: first

### AC-calc-11: Fixing the bill brings the results back
- Journey: J2
- Given the bill shows the error for "12..5", when I change it to "12.5", then the message is gone, the field isn't marked invalid, and Each person pays shows $7.38 (18%, 2 people: total $14.75, rounded up).
- Proven against: local
- Release: first

### AC-calc-12: A $0 bill shows $0.00, not a blank
- Journey: J1
- Given the opening values, when I type "0" in Bill amount, then Tip, Total and Each person pays all show $0.00 and there's no error (D-22).
- Proven against: local
- Release: first

### AC-calc-13: I'm told when my custom tip is out of range
- Journey: J2
- Given a bill of 80.00 and 2 people, when I type "150" in Custom tip and leave the field, then the field is marked invalid and reads "Enter a tip from 0 to 100%, up to 2 decimals.", no quick pick is checked, and results show "—". The same happens for "-1" and "abc". "100" and "12.5" are accepted, and so is "12.55"; "12.345" gets the same message (D-23).
- Proven against: local
- Release: first

### AC-calc-14: With no tip chosen I'm asked to pick one
- Journey: J2
- Given a bill of 80.00 and "12" typed in Custom tip (no quick pick checked), when I clear the Custom tip field, then results show "—" and the text "Pick a tip or type one." shows; tapping "18%" brings the results back.
- Proven against: local
- Release: first

### AC-calc-15: The people stepper stops at 1 and 50
- Journey: J1
- Given a bill of 64.50 and 20%, when I press "Decrease people" once from 2, then People shows 1, "Decrease people" is disabled, Each person pays shows $77.40 and "Just you, so you pay the whole total." shows; and given I typed "49" in People, when I press "Increase people", then People shows 50 and "Increase people" is disabled.
- Proven against: local
- Release: first

### AC-calc-16: I'm told when the head count isn't 1 to 50
- Journey: J2
- Given a bill of 80.00 and 18%, when I type "0" in People and leave the field, then it's marked invalid and reads "Enter 1 to 50 people.", results show "—", and People still shows "0" (not changed for me). The same for "51", "2.5" and "abc".
- Proven against: local
- Release: first

### AC-calc-17: Reset starts the next bill
- Journey: J3
- Given a bill of 100, "12.5" custom tip and 5 people, when I press Reset, then the screen matches AC-calc-1 (empty bill, 18% checked, empty Custom tip, 2 people, results "—", no errors) and focus is in Bill amount.
- Proven against: local
- Release: first

### AC-calc-18: Screen readers hear the result once typing settles
- Journey: J1
- Given a bill of 120.00, 18% and 4 people, when I finish typing, then within 1 second the page's status region contains exactly "Tip $21.60, total $141.60, $35.40 each." and it doesn't change on each keystroke while I'm typing (it updates only after 500 ms without a change). Given a bill of 100, 18% and 3 people, the status region contains exactly "Tip $18.00, total $118.00, $39.34 each, rounded up."
- Proven against: local
- Release: first

### AC-calc-19: A screen-reader user can split a bill
- Journey: J1
- Given VoiceOver on iOS Safari, when a person fills in the bill, picks a tip and sets 3 people using only VoiceOver gestures, then every control's name and state is read correctly (tip picks as "radio, checked") and the result is announced once.
- Proven against: local
- Release: first
- Manual: announcement timing and phrasing in a real screen reader can't be automated reliably

### AC-calc-20: It works with no connection after one visit
- Journey: J4
- Given I loaded `/` once from the production build, when the network is turned off and I reload, then the calculator loads, and typing a bill of 120.00 with 4 people shows Each person pays $35.40.
- Proven against: local
- Release: first

### AC-calc-21: I can add it to my home screen
- Journey: J4
- Given the production build, when I open `/`, then the page links a web manifest whose name is "Tip Splitter", start_url "/", and display "standalone".
- Proven against: local
- Release: first

### AC-calc-22: Every control is easy to hit on a phone
- Journey: J1
- Given a 320px-wide viewport, when the page loads, then the tip picks, −, +, and Reset are each at least 44×44 CSS px, and the page doesn't scroll sideways.
- Proven against: local
- Release: first

### AC-calc-23: Big bills still fit
- Journey: J1
- Given a 320px-wide viewport, when I enter a bill of 9999999.99, 18% and 1 person, then Tip shows $1,800,000.00, Total $11,799,999.99, and Each person pays is fully visible without the page scrolling sideways.
- Proven against: local
- Release: first

### AC-calc-24: A tiny bill split 50 ways rounds up per person
- Journey: J1
- Given a bill of 0.01, 0% tip and 50 people, when the results show, then Each person pays shows $0.01 and the note reads "Rounded up: the group pays $0.50, $0.49 over the total."
- Proven against: local
- Release: first

### AC-calc-25: The page loads nothing from other sites
- Journey: J1
- Given the production build, when `/` loads, then every network request goes to the same origin, and the page has a Content-Security-Policy meta tag with `default-src 'self'`.
- Proven against: local
- Release: first

### AC-calc-26: I'm told the tip is on the amount I enter
- Journey: J1
- Given the opening values, when the page loads, then the text "Tip is on the amount you enter. Enter it before tax if you tip pre-tax." shows under Bill amount and is read as the field's description.
- Proven against: local
- Release: first

### AC-calc-27: Splitting a bill sends nothing anywhere
- Journey: J1
- Given the production build loaded at `/`, when I type a bill of 120.00, tap "20%" and press "Increase people", then no network request is made after the page finished loading.
- Proven against: local
- Release: first

## 11. Release and distribution

| Target | Artifact | Signing | Built on | Secrets it needs |
|---|---|---|---|---|
| Web | `apps/web/out/` (static export) | none | CI | none |

Host on any HTTPS static host (the service worker needs HTTPS). Set at the host: `frame-ancestors 'none'`
(CSP header), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
and `Cache-Control: no-cache` for `/sw.js`. fwos never deploys, signs or submits: it prepares the commands.

## 12. Open questions

- App icon (identity slot C18 is blank): recommended to add one before release; if it stays blank, home-screen install uses the browser's default icon. Named gap for AC-calc-21: icons aren't tested.

## 13. Slices

Thin, ordered, each with verified depends-on edges. The last slice per platform is the real-use
slice: try the whole app as the target user would.

| Slice | What | Modules | ACs | Depends on | Platform |
|---|---|---|---|---|---|
| S1 | Static export with the CSP meta tag and no data layer (shared-data's query provider removed); `/` shows the calculator in its opening state | app, shared-data, tip-calculator | AC-calc-1, AC-calc-25 | | web |
| S2 | Money math and parsing in whole cents, as a unit table (unit coverage for AC-calc-8 and AC-calc-9; their UI ACs land in S3) | shared-lib | | | web |
| S3 | Live results: bill, tip picks, custom tip, stepper, rounding note, pre-tax hint | tip-calculator | AC-calc-2, AC-calc-3, AC-calc-4, AC-calc-5, AC-calc-6, AC-calc-7, AC-calc-8, AC-calc-9, AC-calc-12, AC-calc-15, AC-calc-23, AC-calc-24, AC-calc-26, AC-calc-27 | S1, S2 | web |
| S4 | Errors and recovery, Reset | tip-calculator | AC-calc-10, AC-calc-11, AC-calc-13, AC-calc-14, AC-calc-16, AC-calc-17 | S3 | web |
| S5 | Screen-reader announcement and tap targets | tip-calculator, shared-ui | AC-calc-18, AC-calc-19, AC-calc-22 | S3, S4 | web |
| S6 | Offline and add to home screen | app | AC-calc-20, AC-calc-21 | S1, S3 | web |
| S7 | Real use: split 3 real bills on a phone, as the person at the table | app, tip-calculator | AC-calc-1, AC-calc-2, AC-calc-6, AC-calc-17, AC-calc-20 | S4, S5, S6 | web |
