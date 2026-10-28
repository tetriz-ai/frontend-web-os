# A second pack

The reading list is fwos's first pack: one surface, one role, one page, and fwos's own component and token names. This second pack, for Tidewatch, a fictional port operations product, was built by hand to differ from it on every seam, and the same fwos reads it with no change to its code. Its two surfaces, `console/` and `site/`, are each an fwos project with a token system of its own, since fwos holds one app and one design system per project.

```sh
examples/second-pack/run.sh
```

```text
console
PASS  state/schema
PASS  design-system/schema         Tidewatch Console: modes light, dark, contrast
PASS  design-system/contrast       54 pairs measured
PASS  design-system/chart-palette
PASS  architecture/walls           32 files, 43 internal imports, 7 modules
PASS  rules/pack                   8 rules active (1 from rules.yaml)

site
PASS  state/schema
PASS  design-system/schema         Tidewatch Site: modes dark; blank (their checks are off): chart.1, chart.2, chart.3, chart.4, chart.other
PASS  design-system/contrast       18 pairs measured
OFF   design-system/chart-palette  chart palette blank (slot C9): chart colour check off
PASS  screens/ia                   web: 7 app routes, 7 ia pages, 4 nav pages linked
PASS  rules/pack                   8 rules active (1 from rules.yaml)

console, with the reading list's components.json
FAIL  design-system/registry         5 findings
      apps/console/src/components/ui/berth-grid.tsx  component "berth-grid" isn't in components.json; register it (8-field spec) or remove it
      apps/console/src/components/ui/command-palette  component "command-palette" isn't in components.json; register it (8-field spec) or remove it
      apps/console/src/components/ui/legacy-berth-table.tsx  component "legacy-berth-table" isn't in components.json; register it (8-field spec) or remove it
      apps/console/src/components/ui/tide-chart.tsx  component "tide-chart" isn't in components.json; register it (8-field spec) or remove it
      apps/console/src/components/ui/vessel-chip.tsx  component "vessel-chip" isn't in components.json; register it (8-field spec) or remove it
FAIL  design-system/required-states  15 findings
      button "default" state: no passing test is tagged @state:button:default (tag the test that renders it)

site, ia diff from the reading list's ia.json
+ added    home: Tidewatch at / (nav)
+ added    pricing: Pricing at /pricing (nav)
+ added    docs: Docs at /docs/[...slug] (nav)
+ added    changelog: Changelog at /changelog/[[...release]] (nav)
+ added    blog: Blog at /blog (nav)
+ added    post: Blog post at /blog/[slug] (drilldown)
+ added    legal: Legal at /legal/[doc] (unlinked)
- removed  list: Reading list at /
```

## What differs

| Seam | Reading list | Tidewatch |
|---|---|---|
| Component IDs and states | `button`, `text-field`, `card` and the rest of the starter, with `default`, `loading`, `disabled` | `berth-grid`, `tide-chart`, `vessel-chip`, `command-palette`, a superseded `legacy-berth-table`, and on the site `hero-banner`, `pricing-table`, `logo-wall`, with states such as `sorted`, `unbooked`, `stale`, `with-video` and `loading-quote` |
| Roles and flags | `user`, no flags | `harbormaster`, `pilot` and `auditor` with the flags `berth-auctions` and `tide-forecast`, and `visitor` on the site |
| Routes | One page at `/` | Nested dynamic segments, a catch-all and an optional catch-all, drill-downs, a redirect, an unlinked page, route groups, a `src/app` router and an app at the project root |
| Page states | `loading`, `empty`, `filtered-empty`, `error`, `ready` | `degraded`, `no-berths`, `stale`, `not-found`, `delayed`, `offline`, `closed`, `forbidden`, `quote-sent`, `missing-page`, `no-releases`, `no-posts`, besides `loading` and `ready` |
| Token systems | The neutral starter, light and dark, under fwos's token names | The console in light, dark and contrast modes under names such as `ui.bg.page`, with a chart palette. The site in one dark mode under names such as `night.sky`, with square corners and a serif |
| Layout | `apps/web`, `src/shared/ui`, `docs/app`, `design-system` | `apps/console`, `src/components/ui`, `docs/product`, `design`, `packages/theme/generated`, and a site at its project root |
| Modules, rules and data | fwos's default modules, no rule overrides, no API contract | Its own modules and walls, `no-raw-intl` scoped away from the readings formatter, its own `no-direct-fetch` and `no-raw-img` rules, and a port API contract with a fixture per state |

[second-pack.test.ts](../../scripts/tests/second-pack.test.ts) proves the rest: every check `fwos doctor` calls ON in each surface passes it and fails once its violation is planted, a file of the reading list in place of the second pack's fails on the second pack's own names, and the generated CSS, the IA diff and `screens/ia`'s reason follow the pack. Nothing under `plugin/` names any of its component IDs, roles, flags or rules, so no fwos code can single it out.

## What it doesn't prove

- **The agent.** fwos's checks and generated files follow the pack. Whether the agent builds from it is a live Claude Code and Codex run, which this example doesn't make.
- **Rendered states.** Nothing in this example renders: `results/stand-in.xml` in each surface marks every tagged test passed without running it. The state checks show they ask for this pack's own state names, not that anything renders them, and the app is enough for the checks to read, not a product to run.
- **Who sees a page.** The console's `screens/ia` is OFF: no screen adapter can see which roles or flags a page checks, so `access.ts` isn't compared with `ia.json`.
- **Two surfaces in one project.** fwos has no surfaces seam, so each surface is its own fwos project, and nothing routes a file to one token system or the other inside a project.
- **The rest of the plan's pack.** There is no signal catalogue or metric ceiling to fill, `voice.md` is read only by the copy lens, and the adapters are fwos's own code, so a pack can't bring its own.
