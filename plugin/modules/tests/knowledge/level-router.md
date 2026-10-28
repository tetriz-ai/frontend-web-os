# The level router

Pick the cheapest test that proves the behaviour.

| The behaviour is about | Level | Tool (web) |
|---|---|---|
| Logic: parsing, sorting, rules, state machines | `unit` | Vitest |
| What renders over fake data: text, states, enabled/disabled, ARIA | `component` | Vitest + Testing Library (jsdom) |
| Layout and geometry: overflow, truncation, sticky, hit-target size | `browser-component` | Playwright against the screens route |
| Navigation, URL, focus, first paint, real clicks, storage across reloads | `e2e` | Playwright |
| What no machine can judge (a screen-reader walkthrough) | `manual` | a named sign-off, with the reason |

## Tags

- Every test that proves an AC carries `@AC-<feature>-<n>` in its name.
- Every test that renders a required state carries `@state:<component-or-page-id>:<state>`.
- Default rows carry `@TC-default-<row>`.

`fwos check` reads the tags from the JUnit results; a test counts only if it ran and passed.

## Seams

Where two sides meet (the app and the API), both test against the same JSON fixture from
`packages/api-contract/fixtures/`. Fakes fail closed: an unexpected request throws. Tests assert the
fake was called. The consuming slice owns the fixture. Never stub the component's own hook.

## New or existing

Each case is `new` (the behaviour doesn't exist yet: its test must fail first, and the red run is
kept) or `existing` (a characterisation test of a screen or code that already works: it may start
green).

## Flaky

Flaky means it failed, then passed on retry in the same run. Quarantine it in
`.fwos/quarantine.json` with a reason, a name and an expiry date; a quarantined test never proves
an AC. Fix it by waiting for a condition, never with a fixed sleep.
