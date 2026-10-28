---
title: "Tip Splitter: test plan"
based_on: [spec.md@31b0cef31624, ia.json@4e01c58576df]
---

# Tip Splitter: test plan

Conventions: Vitest + Testing Library for unit and component cases; Playwright against the production static build (`apps/web/out/`) for browser-component and e2e cases. Test names carry tags: `@AC-calc-<n>`, `@state:calculator:<state>`, `@TC-default-<row>`. There are no fixtures because the API contract has no operations; every case uses typed inputs against the app on this device, with nothing mocked ("Data: none" below, with the typed values named in the case).

## Cases

### TC-calc-1: Opening values on first visit
- AC: AC-calc-1
- Level: e2e
- Platform: web
- Status: new
- Given a first visit to `/` in a fresh browser context, when the page loads, then the bill field is empty, "18%" is the checked tip, People shows 2, Custom tip is empty, and "Each person pays", Tip and Total all show "—", with no error text. Tags: @AC-calc-1 @state:calculator:empty
- Data: none (opening values)

### TC-calc-2: Opening values render in the component
- AC: AC-calc-1
- Level: component
- Platform: web
- Status: new
- Given the calculator rendered with no input, when it mounts, then the same opening values show as in TC-calc-1. Tags: @AC-calc-1 @state:calculator:empty
- Data: none

### TC-calc-3: Results update live as I type the bill
- AC: AC-calc-2
- Level: component
- Platform: web
- Status: new
- Given the opening values, when I type "120.00" in Bill amount and press + twice, then with no other action Tip shows $21.60, Total $141.60, Each person pays $35.40. Tags: @AC-calc-2 @state:calculator:ready
- Data: none

### TC-calc-4: Picking a tip updates results
- AC: AC-calc-3
- Level: component
- Platform: web
- Status: new
- Given bill 120.00 and 4 people, when I tap "20%", then "20%" is checked, Tip $24.00, Total $144.00, Each person pays $36.00. Tags: @AC-calc-3 @state:calculator:ready
- Data: none

### TC-calc-5: Custom tip replaces the pick, and a pick clears the custom tip
- AC: AC-calc-4
- Level: component
- Platform: web
- Status: new
- Given bill 120.00, 4 people, 18% checked, when I type "12.5" in Custom tip, then no quick pick is checked, Tip $15.00, Total $135.00, Each $33.75; when I then tap "15%", Custom tip is emptied and Tip shows $18.00. Tags: @AC-calc-4
- Data: none

### TC-calc-6: 0% custom tip is allowed
- AC: AC-calc-5
- Level: component
- Platform: web
- Status: new
- Given bill 50.00 and 2 people, when I type "0" in Custom tip, then Tip $0.00, Total $50.00, Each $25.00, and no error shows. Tags: @AC-calc-5 @state:calculator:ready
- Data: none

### TC-calc-7: Rounding note when shares are rounded up
- AC: AC-calc-6
- Level: component
- Platform: web
- Status: new
- Given bill 100, 18%, 3 people, when results show, then Each pays $39.34 and the note reads exactly "Rounded up: the group pays $118.02, $0.02 over the total." Tags: @AC-calc-6 @state:calculator:rounded
- Data: none

### TC-calc-8: No rounding note on an exact split
- AC: AC-calc-7
- Level: component
- Platform: web
- Status: new
- Given bill 120.00, 18%, 4 people, when results show, then no text starting "Rounded up" is on the page. Tags: @AC-calc-7 @state:calculator:ready
- Data: none

### TC-calc-9: Tip rounds half up to the cent (unit table)
- AC: AC-calc-8
- Level: unit
- Platform: web
- Status: new
- Given the money function in whole cents, when bill 33.33 with 15% is computed, then tip is 500 cents and total 3833 cents (4.9995 rounds half up). Add rows for other half-cent boundaries and 0.01 at 0%. Tags: @AC-calc-8
- Data: none (unit table)

### TC-calc-10: Tip rounding visible on screen
- AC: AC-calc-8
- Level: component
- Platform: web
- Status: new
- Given bill 33.33 and 1 person, when I tap "15%", then Tip shows $5.00 and Total $38.33. Tags: @AC-calc-8
- Data: none

### TC-calc-11: Bill parsing table
- AC: AC-calc-9, AC-calc-10
- Level: unit
- Platform: web
- Status: new
- Given the parser, when fed each of "42,50" → 4250; "$1,234.50" → 123450; "1,234" → 123400; " 42.5 " → 4250; "1.234,50" → 123450; "1,234,567" → 123456700; "1.234.567" → 123456700; "12,345.6" → 1234560, then each parses as shown; and "1,2345", "1.234", "12..5", "abc", "-5", "4.505", "10000000" are invalid; "9999999.99" and "0" are valid. Also add: lone "$", empty string, "1,23,456" (bad grouping), "1,234.567". Tags: @AC-calc-9 @AC-calc-10
- Data: none (unit table)

### TC-calc-12: Typed amount formats show the right Total
- AC: AC-calc-9
- Level: component
- Platform: web
- Status: new
- Given 1 person and 0% tip, when I type each of the eight valid strings from AC-calc-9, then Total shows the stated amount; and "1,2345" and "1.234" show the bill error on blur. Tags: @AC-calc-9 @state:calculator:invalid-bill
- Data: none

### TC-calc-13: Bill error appears on blur only, results dash at once
- AC: AC-calc-10
- Level: component
- Platform: web
- Status: new
- Given the opening values, when I type "12..5", then results show "—" immediately and no message shows while focused; when I blur, the field is marked invalid and reads "Enter an amount like 42.50, up to 9,999,999.99." Repeat for "abc", "-5", "4.505", "10000000". Tags: @AC-calc-10 @state:calculator:invalid-bill
- Data: none

### TC-calc-14: Fixing the bill brings results back
- AC: AC-calc-11
- Level: component
- Platform: web
- Status: new
- Given the bill error shown for "12..5", when I change it to "12.5", then the message is gone, the field is not invalid, and Each pays $7.38 (total $14.75, rounded up). Tags: @AC-calc-11 @state:calculator:rounded
- Data: none

### TC-calc-15: $0 bill shows $0.00
- AC: AC-calc-12
- Level: component
- Platform: web
- Status: new
- Given the opening values, when I type "0" in Bill amount, then Tip, Total, Each pay all show $0.00 and there is no error. Tags: @AC-calc-12 @state:calculator:ready
- Data: none

### TC-calc-16: Custom tip out of range or malformed
- AC: AC-calc-13
- Level: component
- Platform: web
- Status: new
- Given bill 80.00 and 2 people, when I type "150" in Custom tip and blur, then the field is invalid and reads "Enter a tip from 0 to 100%, up to 2 decimals.", no quick pick is checked, results "—". Same for "-1", "abc", "12.345". "100", "12.5", "12.55" are accepted with no error. Tags: @AC-calc-13 @state:calculator:invalid-tip
- Data: none

### TC-calc-17: No tip chosen asks for one
- AC: AC-calc-14
- Level: component
- Platform: web
- Status: new
- Given bill 80.00 and "12" in Custom tip, when I clear Custom tip, then results show "—" and "Pick a tip or type one." shows; tapping "18%" brings results back and the text goes. Tags: @AC-calc-14 @state:calculator:invalid-tip
- Data: none

### TC-calc-18: People stepper stops at 1 and 50
- AC: AC-calc-15
- Level: component
- Platform: web
- Status: new
- Given bill 64.50 and 20%, when I press "Decrease people" from 2, then People is 1, "Decrease people" is disabled, Each pays $77.40 and "Just you, so you pay the whole total." shows. Given "49" typed in People, when I press "Increase people", People is 50 and "Increase people" is disabled. Tags: @AC-calc-15 @state:calculator:people-bounds
- Data: none

### TC-calc-19: Invalid head counts
- AC: AC-calc-16
- Level: component
- Platform: web
- Status: new
- Given bill 80.00 and 18%, when I type "0" in People and blur, then it is invalid, reads "Enter 1 to 50 people.", results "—", and People still shows "0". Same for "51", "2.5", "abc". Tags: @AC-calc-16 @state:calculator:people-bounds
- Data: none

### TC-calc-20: Reset restores the opening values and focuses the bill
- AC: AC-calc-17
- Level: e2e
- Platform: web
- Status: new
- Given bill 100, custom tip "12.5", 5 people in the built app, when I click Reset, then the screen matches TC-calc-1 (empty bill, 18% checked, empty Custom tip, 2 people, results "—", no errors) and focus is in Bill amount. Tags: @AC-calc-17 @state:calculator:empty
- Data: none

### TC-calc-21: Reset clears error states
- AC: AC-calc-17
- Level: component
- Platform: web
- Status: new
- Given each of an invalid bill, invalid custom tip and invalid People shown, when I press Reset, then all error messages are gone and no field is marked invalid. Tags: @AC-calc-17 @state:calculator:invalid-bill @state:calculator:invalid-tip @state:calculator:people-bounds
- Data: none

### TC-calc-22: Status region announces once typing settles
- AC: AC-calc-18
- Level: component
- Platform: web
- Status: new
- Given fake timers, bill 120.00, 18%, 4 people, when I type keystroke by keystroke, then the status region does not change until 500 ms without change, and within 1 s it contains exactly "Tip $21.60, total $141.60, $35.40 each." Given bill 100, 18%, 3 people it contains exactly "Tip $18.00, total $118.00, $39.34 each, rounded up." Tags: @AC-calc-18
- Data: none

### TC-calc-23: Status region in the real browser
- AC: AC-calc-18
- Level: e2e
- Platform: web
- Status: new
- Given the built app, when I type "120.00" at normal speed and set 4 people, then the status region text updates only once, with the exact text from AC-calc-18, within 1 s. Tags: @AC-calc-18
- Data: none

### TC-calc-24: Screen-reader walkthrough on iOS
- AC: AC-calc-19
- Level: manual
- Platform: web
- Status: new
- Given VoiceOver on iOS Safari, when a person fills in the bill, picks a tip and sets 3 people using only VoiceOver gestures, then each control's name and state is read correctly (tip picks "radio, checked") and the result is announced once. See Manual checks.
- Data: none

### TC-calc-25: Works offline after one visit
- AC: AC-calc-20
- Level: e2e
- Platform: web
- Status: new
- Given `/` loaded once from the production build and the service worker active, when the browser context goes offline and I reload, then the calculator loads; typing 120.00 with 4 people shows Each person pays $35.40. Tags: @AC-calc-20
- Data: none

### TC-calc-26: Manifest is linked and correct
- AC: AC-calc-21
- Level: e2e
- Platform: web
- Status: new
- Given the production build, when I open `/`, then the page links a web manifest, and fetching it gives name "Tip Splitter", start_url "/", display "standalone". Icons are not checked (GAP-1). Tags: @AC-calc-21
- Data: none

### TC-calc-27: Tap targets and no sideways scroll at 320px
- AC: AC-calc-22
- Level: browser-component
- Platform: web
- Status: new
- Given a 320px-wide viewport, when the page loads, then each tip pick, −, + and Reset measures at least 44×44 CSS px and document scroll width does not exceed the viewport width. Tags: @AC-calc-22
- Data: none

### TC-calc-28: Biggest bill fits at 320px
- AC: AC-calc-23
- Level: browser-component
- Platform: web
- Status: new
- Given a 320px viewport, when I enter 9999999.99, 18%, 1 person, then Tip $1,800,000.00, Total $11,799,999.99, Each person pays is fully visible (inside the viewport, not clipped) and the page does not scroll sideways. Tags: @AC-calc-23 @state:calculator:ready
- Data: none

### TC-calc-29: Tiny bill split 50 ways
- AC: AC-calc-24
- Level: component
- Platform: web
- Status: new
- Given bill 0.01, 0% custom tip, 50 people, when results show, then Each pays $0.01 and the note reads "Rounded up: the group pays $0.50, $0.49 over the total." The "+" is disabled at 50. Tags: @AC-calc-24 @state:calculator:rounded @state:calculator:people-bounds
- Data: none

### TC-calc-30: Money math invariants
- AC: AC-calc-6, AC-calc-24
- Level: unit
- Platform: web
- Status: new
- Given the money function, when run over a table of bills, tips and head counts (including 100/18%/3, 0.01/0%/50, 120/18%/4), then per-share is total divided by people rounded up to the cent, the group total is never below the total, and the over amount equals group total minus total. Tags: @AC-calc-6 @AC-calc-24
- Data: none (unit table)

### TC-calc-31: No third-party requests and CSP meta tag
- AC: AC-calc-25
- Level: e2e
- Platform: web
- Status: new
- Given the production build, when `/` loads, then every recorded network request goes to the same origin, and the page has a Content-Security-Policy meta tag containing `default-src 'self'`. Tags: @AC-calc-25
- Data: none

### TC-calc-32: Pre-tax hint is shown and is the field description
- AC: AC-calc-26
- Level: component
- Platform: web
- Status: new
- Given the opening values, when the page loads, then "Tip is on the amount you enter. Enter it before tax if you tip pre-tax." shows under Bill amount and the Bill field's accessible description equals that text. Tags: @AC-calc-26 @state:calculator:empty
- Data: none

### TC-calc-33: Splitting sends nothing
- AC: AC-calc-27
- Level: e2e
- Platform: web
- Status: new
- Given the production build loaded and network idle, when I type 120.00, tap "20%" and press "Increase people", then zero network requests are recorded after the page finished loading. Tags: @AC-calc-27
- Data: none

### TC-calc-34: Calculator is the only page and its deep link works
- AC: AC-calc-1
- Level: e2e
- Platform: web
- Status: new
- Given the production build, when I open `/` directly, then the header shows the app name, the nav has a single entry "Split the bill", and the page is in the empty state. Tags: @AC-calc-1 @state:calculator:empty
- Data: none

### TC-calc-35: Boundary values stay valid and error states leave cleanly
- AC: AC-calc-10, AC-calc-15, AC-calc-16
- Level: component
- Platform: web
- Status: new
- Given bill 9999999.99 is accepted with no error, and People "1" and "50" typed directly are accepted with no error; when I move from People "0" (error) to "2", then the error goes and results return. Tags: @AC-calc-10 @AC-calc-16 @state:calculator:ready @state:calculator:people-bounds
- Data: none

## Seams
| Seam | Shared fixture | Consumer test | Provider side |
|---|---|---|---|
| None. The contract has no operations (`paths: {}`), nothing is fetched or saved, and `packages/api-contract/fixtures/` is empty. TC-calc-31 and TC-calc-33 prove that no request leaves the app. | none | n/a | n/a |

## Default rows
### TC-default-crawl: Every ia.json page loads with no console errors
- Level: e2e
- Platform: web
- Status: existing
- Given the production build, when the crawler visits `/` (the only page, `calculator`), then it loads with HTTP 200, no console errors, no failed requests. Tags: @TC-default-crawl

### TC-default-a11y: Automated accessibility scan
- Level: e2e
- Platform: web
- Status: existing
- Given `/` in the empty state and again in each of invalid-bill, invalid-tip, people-bounds and rounded, when scanned with axe at WCAG 2.2 AA, then there are no violations. Tags: @TC-default-a11y

### TC-default-keyboard: Keyboard-only use
- Level: e2e
- Platform: web
- Status: existing
- Given `/`, when I use only Tab, Shift+Tab, arrow keys, Space and Enter, then every control is reachable in a logical order with a visible focus ring, the tip radios are operable, the stepper buttons work, and Reset works. Tags: @TC-default-keyboard

### TC-default-themes: Light and dark
- Level: e2e
- Platform: web
- Status: existing
- Given prefers-color-scheme light and then dark, when `/` loads in the empty and an error state, then text stays readable at AA contrast and nothing is invisible. Tags: @TC-default-themes

### TC-default-phone: Phone viewport
- Level: e2e
- Platform: web
- Status: existing
- Given a 320px-wide viewport, when I walk the calculator in every state, then nothing overflows or scrolls sideways. Tags: @TC-default-phone

### TC-default-prod: Production build smoke
- Level: e2e
- Platform: web
- Status: existing
- Given the static export served from `apps/web/out/`, when `/` is opened, then it renders the calculator with the CSP meta tag applied and the service worker registered. Tags: @TC-default-prod

## Non-functional
| Check | Tool | Reference machine | Runs | Tolerance |
|---|---|---|---|---|
| Accessibility (WCAG 2.2 AA) | axe via Playwright | CI Linux runner, headless Chromium | Every CI run, each state | 0 violations |
| First paint of calculator at `/` (static, nothing fetched) | Playwright performance timing | CI Linux runner, headless Chromium, no throttling | 5 runs per CI build | Median under 1.5 s; no run over 3 s |
| Status announcement delay (AC-calc-18) | Vitest fake timers + Playwright | CI Linux runner | Every CI run | Update 500 ms after last change, visible within 1 s |
| Offline reload (AC-calc-20) | Playwright offline context | CI Linux runner, headless Chromium | Every CI run | Must pass every run; no retries to hide flakiness |
| Network silence (AC-calc-25, 27) | Playwright request log | CI Linux runner | Every CI run | 0 cross-origin requests; 0 requests after load |

## Manual checks
| Item | Why it can't be automated | Who signs off |
|---|---|---|
| AC-calc-19: VoiceOver on iOS Safari walkthrough (fill bill, pick tip, set 3 people; names, "radio, checked", result announced once) | Announcement timing and phrasing in a real screen reader can't be automated reliably | Product owner, on a real iPhone before release |

## Named gaps
### GAP-1: No app icon yet
- Missing: an app icon asset. Home-screen install uses the browser's default icon, so icons are not tested; AC-calc-21 is proven only for manifest name, start_url and display.

### GAP-2: Real home-screen install and iOS offline behaviour
- Missing: access to a physical iOS or Android device with a home-screen install flow. Playwright cannot perform the install, so TC-calc-26 proves the manifest content only, and TC-calc-25 proves offline in headless Chromium only (no WebKit or iOS device run).

### GAP-3: Host response headers
- Missing: a deployed staging HTTPS host. The frame-ancestors, nosniff, Referrer-Policy and `Cache-Control: no-cache` for `/sw.js` headers are set by the host, so no local test can check them. Only the CSP meta tag is tested (TC-calc-31).

### GAP-4: Other screen readers
- Missing: access to Android TalkBack and desktop screen readers for hand walkthroughs. Per the spec these are not walked through in v1; TC-default-a11y automated checks are the only coverage.
