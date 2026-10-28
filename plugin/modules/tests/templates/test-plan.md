---
title: "<App name>: test plan"
based_on: []
---

# <App name>: test plan

Written from [the spec](spec.md) and [ia.json](ia.json) alone, by an agent that never saw the code.
Level router: the cheapest level that proves the behaviour.

## Cases

### TC-<feature>-1: <behaviour>
- AC: AC-<feature>-1
- Level: unit | component | browser-component | e2e | manual
- Platform: web
- Status: new | existing
- Given ..., when ..., then ...
- Data: fixture <operationId>.<variant>

## Seams

| Seam | Shared fixture | Consumer test | Provider side |
|---|---|---|---|

## Default rows

### TC-default-crawl: every route loads, no console errors or broken links
- Level: e2e
### TC-default-a11y: no serious accessibility violations (axe) on any route
- Level: e2e
### TC-default-keyboard: each key journey works with the keyboard alone
- Level: e2e
### TC-default-themes: light and dark screenshots of each screen
- Level: e2e
### TC-default-phone: a phone viewport, no sideways scrolling
- Level: e2e
### TC-default-prod: one run against the production build
- Level: e2e

## Non-functional

| Check | Tool | Reference machine | Runs | Tolerance |
|---|---|---|---|---|

## Manual checks

| Item | Why it can't be automated | Who signs off |
|---|---|---|

## Named gaps

### GAP-1: <title>
- Missing: <exactly which access is missing>
