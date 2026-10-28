# screens

The scaffold, ia.json, the IA diff, screens checks.

## Owns

Step 5: the walking-skeleton scaffold (templates per platform), screens on fake data with a state switcher, `ia.json`, the IA diff, and prototype bundles (`prototype.ts`): one feature's handoff in `docs/app/prototypes/<id>/bundle.json`, what stops its promotion, the hash of each input a promotion pins, and its intended IA compared with the real app's routes and the runs of fwos's IA harness.

## Public entry

`index.ts`: `parseIa`, `validateIa`, `diffIa`, `formatIaDiff`, `normRoute`, `reaches`, `visibleUnder`, `loadIa`, `iaRunPlan`, `judgeIaRun` and `isIaRun` (what the IA harness runs, and what its runs show), `TEST_ACCESS_COOKIE`, `listBundles`, `checkBundle`, `parseStates`, `compareWithApp` and `formatAppDiff` (prototype bundles), `renderTemplate`, `checks`.

## Skills and agents

Skill `screens`. Knowledge `knowledge/ia-grammar.md`. The web template in `templates/web/` (a Next.js workspace with the starter components, render tests per required state, component state fixtures, the access rule and the page guard, Playwright default rows and CI; the scaffold adds fwos's harness from the web platform).

## Checks

`screens/ia` (ia.json valid; matches the real app through the screen adapter: routes in both directions, the page ID each route declares, redirects, a guard on every page ia.json limits, and every nav page but `/` linked; and, from fresh runs of fwos's IA harness, what each role and flag setting can open and sees in the nav; off, saying why, when there is no app to compare, or, with nothing else failing, while no fresh run shows who sees a limited page), `screens/states` (each page state has a passing test tagged `@state:<page>:<state>` and renders as its contract says in a fresh run of fwos's state harness; off, naming what's unproven, while a render proof is missing).

## Depends on

`kernel`, `architecture`, `design-system`, `rules` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

A route the check calls "unexpected": `fwos doctor` shows how many routes the screen adapter found. Template problems: scaffold into a temp folder and run `pnpm install && pnpm test && pnpm e2e` (the repo's e2e test does this).
