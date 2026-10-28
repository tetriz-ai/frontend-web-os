---
title: "<App name>: spec"
based_on: []
---

# <App name>: spec

Builds on [the brief](brief.md) (not repeated here), [ia.json](ia.json) and
[modules.json](modules.json). Decisions are in [decisions.md](decisions.md).

## 1. What you're approving

1. <the first release in one line>
2. <the screens and journeys>
3. <data: mock, local or real, and where it lives>
4. <platforms>
5. <the number of ACs and anything manual or a named gap>

## 2. Journeys

- **J1 <name>**: <who, starting where, doing what, ending where>

## 3. Scope by platform

| Feature | Web | Electron | Mac | Notes (each difference intended and logged) |
|---|---|---|---|---|

## 4. Screens and navigation

From ia.json. <Nav order, drill-downs, unlinked pages and why.>

## 5. States per screen

| Page | States | Notes |
|---|---|---|

## 6. Data and API contract

`packages/api-contract/openapi.yaml`. Per operation: mock, local or real.

| Operation | Purpose | Mode | Fixtures |
|---|---|---|---|

<No operations: say so; every AC is then proven against local.>

<Sign-in flow if any. Token storage. What happens when the backend is slow or down.>

## 7. Architecture

<Modules from modules.json and who depends on whom; anything off the default stack.>

## 8. Design system binding

<Slots and registered components used; any new component, with its required states.>

## 9. Cross-cutting

Only overrides of fwos defaults (WCAG 2.2 AA, English, no analytics, CSP on, no secrets in the client):

- <override>: <why>

## 10. Acceptance criteria

### AC-<feature>-1: <title>
- Journey: J1
- Given ..., when ..., then ...
- Proven against: local
- Release: first

## 11. Release and distribution

| Target | Artifact | Signing | Built on | Secrets it needs |
|---|---|---|---|---|
| Web | `next build` output | none | CI | none |

fwos never deploys, signs or submits: it prepares the commands.

## 12. Open questions

- <question>: recommended <answer>; if it flips, <what changes>

## 13. Slices

Thin, ordered, each with verified depends-on edges. The last slice per platform is the real-use
slice: try the whole app as the target user would.

| Slice | What | Modules | ACs | Depends on | Platform |
|---|---|---|---|---|---|
| S1 | | | | | web |
