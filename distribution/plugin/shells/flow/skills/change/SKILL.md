---
name: change
description: 'Route a change request to its entry step in Frontend Web OS. Use for /fwos:change or a new request after acceptance.'
argument-hint: '"<request>"'
---

# /fwos:change

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md. `fwos` means
`node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

The request: `$ARGUMENTS`

## 1. Classify it

Pick the one route that fits. When two fit, take the bigger one.

| Route | Example | Re-enters at | What happens |
|---|---|---|---|
| `code-only` | copy, spacing | build | Fix, update the affected tests, check. No spec change. |
| `touches-ac` | a new filter on a list | spec | Spec delta, test-plan delta, then build. |
| `new-feature` | "add sharing" | discovery | Short discovery, research if needed, screens, spec, tests, build. |
| `data-change` | a new field on a saved item | spec | As touches-ac, plus a versioned migration and a test that opens data saved by the previous version. |
| `design-system` | brand colour, renamed token | design-system | Token diff sorted into value / add / rename / remove. Rename and remove list every usage. Contrast and screenshots re-run. |
| `add-platform` | "now a Mac app too" | architecture | Architecture update, parity table, tokens for the new target, every AC re-triaged. |
| `architecture` | "switch to micro-frontends" | architecture | Back to the architect, with the trade-off shown. |

Tell the user the route and why in one line ("This adds an AC (a filter state), so it's
touches-ac: we'll update the spec and test plan, then build"). Wait for "yes".

A behaviour change outside the request (found during the work) becomes its own change.

## 2. Start it

```
fwos change new "<the request in the user's words>" --route <route> [--link <url|path>]
```

`--link` records each issue, PRD, design doc or spec the request comes from, as a URL or a path in
the repo. Read each one before you classify: the request can be text, a link, or both.

Work on a branch per change when the project uses git (ask before creating it):
`git switch -c change/<id>`.

## 3. Continue

Invoke `fwos:start` with no arguments; it reads `fwos next --json` and loads the right step.

## In an adopted app

When `fwos next --json` has `adopt`, read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/adopted-app.md
first. Change delivery needs level delivery: if `fwos change new` says it's off, show the user
`fwos adopt --level delivery` and stop. The routes are code-only, touches-ac, new-feature and
data-change. A request that would change the team's design system, platforms or architecture isn't
delivered through fwos there, so say so and offer to help outside fwos's flow.

There, the branch is the one `fwos change new` names in the team's pattern, not `change/<id>`. Then
map the change onto the code before anything else: `fwos change map <route|file>...`. When the team
made an artifact for a stage of this change (a design, a test plan, a sign-off), link it in place:
`fwos change link <url|path> --stage <stage>`. A stage the team keeps (`adopt.keep` in `fwos next
--json`) needs one.

## Hand edits

If the user edited a doc or code by hand since the last approval, `fwos status` shows it as stale.
That edit is a change too: classify it the same way.
