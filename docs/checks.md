# Checks

`fwos check` runs these, and each prints PASS, FAIL or OFF with the reason. None calls a model, so
CI, your laptop and Claude Code get the same answer. Each check's good and bad fixtures live in
`checks/fixtures/<check>/`, and the test suite runs them.

- **Gate** checks run first. If one fails, every other check reports OFF (fail closed): nothing runs against a malformed or unsupported file.
- **Baseline:** in an existing app (adopt mode), `fwos baseline --init` records today's findings. Checks then fail only on new or worse ones, and the baseline can only shrink. Gates, `state/approvals`, `tests/traceability`, `tests/locked` and `tests/regression` are never baselined.
- **Run some:** `fwos check walls`, `fwos check design-system`, `fwos check tests/traceability`.
- **Inline exceptions:** `// fwos-ignore tokens` (raw values) or `// fwos-ignore <rule-id>` (rule pack) on the line.

| Check | Applies to (only web is built in 0.1) | Catches |
|---|---|---|
| [`state/schema`](#stateschema) (gate) | web, electron, mac | a pack file or .fwos/ record from a schema this fwos does not read, or a malformed .fwos/ file |
| [`state/approvals`](#stateapprovals) | web, electron, mac | building on a brief, spec or test plan that changed after it was approved |
| [`state/owned`](#stateowned) | web, electron, mac | a [generated] file edited by hand |
| [`design-system/schema`](#design-systemschema) (gate) | web, electron, mac | a malformed or unsupported design system, a broken alias, a required slot left blank |
| [`design-system/contrast`](#design-systemcontrast) | web, electron, mac | a text or foreground slot under 4.5:1 against the surface it sits on, in any mode |
| [`design-system/chart-palette`](#design-systemchart-palette) | web, electron, mac | chart colours that are missing, too alike, or the same as a UI colour |
| [`design-system/tokens`](#design-systemtokens) | web, electron | raw colours, default-palette classes, raw font sizes, fonts and radii outside the token layer |
| [`design-system/generated`](#design-systemgenerated) | web, electron | CSS variables or the Tailwind theme out of date with the tokens |
| [`design-system/registry`](#design-systemregistry) | web, electron | an installed component missing from components.json, or a removed or superseded one still used |
| [`design-system/required-states`](#design-systemrequired-states) | web, electron, mac | a registered component's required state with no passing test tagged `@state:<id>:<state>`, or whose fixture fwos's harness saw render wrong |
| [`architecture/walls`](#architecturewalls) | web, electron | an import modules.json does not allow, a deep import past a public entry, an import from spikes/, a dependency cycle, an import that resolves to no file or package |
| [`architecture/contract`](#architecturecontract) | web, electron, mac | a fixture that no longer matches openapi.yaml (unknown operation, undeclared status, wrong body shape) |
| [`architecture/mocks`](#architecturemocks) | web, electron, mac | generated contract mocks (the mock fetch on web) out of date with openapi.yaml or its fixtures |
| [`screens/ia`](#screensia) | web, electron, mac | routes and ia.json that disagree, a route that declares another page ID, a redirect that goes nowhere or elsewhere, a limited page nothing guards, a missing nav link; and, in a run of the app as each role and flag setting, a page shown to a role ia.json hides it from or one a role can't open |
| [`screens/states`](#screensstates) | web, electron, mac | a page state from ia.json with no passing test tagged `@state:<page-id>:<state>`, or whose fixture fwos's harness saw render wrong: not busy while loading, an error with no alert or with the ready state's stale content, an empty state with no status, a row that paints on hover while a click only reaches its title |
| [`spec/format`](#specformat) | web, electron, mac | a missing spec section, a duplicate or malformed AC, an AC with no "proven against", a reference to an AC that does not exist; in an adopted app's change, an ask with no criterion, a criterion no ask names, a state its interactions bring left out, a criterion that needs interpretation, a question with no ID |
| [`tests/plan`](#testsplan) | web, electron, mac | an AC with no test case, a case for an AC that does not exist, a bad level or status, a missing default row; in an adopted app's change, a changed criterion with only existing cases, no case in a browser, a regression scope missing a test around it |
| [`tests/traceability`](#teststraceability) | web, electron, mac | from the accept step on, a first-release AC with no passing test (before it, one no test ran yet is pending); at any step, a failing or only-quarantined test, a test tagged with an unknown AC, an expired quarantine |
| [`tests/locked`](#testslocked) | web, electron, mac | a locked test edited or deleted without a recorded unlock, by any tool, the shell included, or a lock the last commit holds dropped or re-hashed |
| [`tests/regression`](#testsregression) | web, electron, mac | in an adopted app, an existing test a change names as its regression scope that fails, or that never ran by acceptance |
| [`build/slices`](#buildslices) | web, electron, mac | a slice claiming an AC that no test proves, an unregistered component, an unknown screen or module |
| [`rules/pack`](#rulespack) | web, electron | a pattern from any check-hardness rule in the rule pack (plugin/modules/rules/pack/) or in your design-system/rules.yaml |
| [`web/security`](#websecurity) | web | no Content-Security-Policy, a secret-looking NEXT_PUBLIC_ variable, a hard-coded key, a committed .env |
| [`web/licences`](#weblicences) | web, electron | a runtime dependency, or a package one pulls in, under a licence the chosen channels cannot ship (AGPL, SSPL or unlicensed, and GPL for the App Store) |

## state/schema

**fwos state files.** Catches a pack file or .fwos/ record from a schema this fwos does not read, or a malformed .fwos/ file.

- **Reads:** `.fwos/state.json` and every change file in full, and the `schema` named by the other records (the manifest, provenance, baseline, quarantine and slice manifests) and by the pack: `design-system.json`, `components.json`, `rules.yaml`, `ia.json` and `modules.json`. A pack file that doesn't parse is left to the check that reads it.
- **Off when:** not an fwos project yet
- **Fix:** Fix the file and field it names. A newer schema means a newer fwos wrote it: upgrade fwos. An older one: `fwos update` migrates it when this fwos has a migration, and otherwise says what to change.

## state/approvals

**Approvals still hold.** Catches building on a brief, spec or test plan that changed after it was approved.

- **Reads:** change files and every approved doc
- **Off when:** before the build step (approvals are enforced from build on)
- **Fix:** Re-approve the changed doc (`fwos approve <target> --by "<name>"`), or route the edit as a change. A stale `based_on` means regenerate the affected parts and `fwos stamp` the doc.

## state/owned

**Generated files untouched.** Catches a [generated] file edited by hand.

- **Reads:** `.fwos/manifest.json` and the generated files it lists
- **Off when:** not an fwos project yet
- **Fix:** Undo the hand edit and change the source instead (tokens, the contract), then regenerate.

## design-system/schema

**Design system contract.** Catches a malformed or unsupported design system, a broken alias, a required slot left blank.

- **Reads:** `design-system/design-system.json`, the token files, `components.json`
- **Off when:** there is no design system yet
- **Fix:** Fill the blank required slot, fix the alias or the file it names. A slot your tokens name differently: map it in `slots`.
- **A pass says:** the design system is valid. It doesn't say it matches the theme or tokens you brought, and for an import the pass line says so. `fwos design-system report` maps each slot to its source and keeps adoption coverage and fidelity apart.

## design-system/contrast

**Text contrast.** Catches a text or foreground slot under 4.5:1 against the surface it sits on, in any mode.

- **Reads:** every text/surface pair in every mode. A translucent surface is laid over that mode's `surface.base` before it is measured, so a dark mode is measured on dark. The ratio is rounded to six decimal places before it is compared with 4.5, so a pair at exactly 4.5:1 passes on every Node version.
- **Off when:** no design system yet, or it has schema errors
- **Fix:** Pick the suggested shade, or another that passes. Never silently: it is your brand.

## design-system/chart-palette

**Chart palette.** Catches chart colours that are missing, too alike, or the same as a UI colour.

- **Reads:** the C9 chart slots
- **Off when:** the chart palette is blank (that is fine for apps without charts)
- **Fix:** Fill all five chart slots with colours that are distinct from each other and from UI colours.

## design-system/tokens

**No raw design values.** Catches raw colours, default-palette classes, raw font sizes, fonts and radii outside the token layer.

- **Reads:** app source (`paths.source`): `.ts`, `.tsx`, `.js` and `.jsx` files (with their `.mjs`, `.cjs`, `.mts` and `.cts` forms), and `.css`, `.scss`, `.less` and `.mdx` files. It skips test files (`paths.tests`, by default `*.test.*`, `*.spec.*` and `__tests__/`), `tests/` and `e2e/` folders at a package root (the project root, `apps/<name>`, `packages/<name>` or a folder with a package.json), Storybook stories (`*.stories.*`), type declarations (`*.d.ts`), the design system folder and the generated token files (`paths.tokensOut`). A folder named `tests` deeper in app source, such as `src/features/tests/`, is scanned. A generated-file header does not exempt a file in app source.
- **Catches in detail:**
  - A hex colour or colour function (in any case, so `RGB(255,0,0)` too) in a string or a Tailwind arbitrary value, such as `"1px solid #ff0000"` or `shadow-[0_1px_2px_rgba(0,0,0,.5)]`.
  - A CSS named colour where a colour goes, such as a CSS colour property, `color: "red"` in a style object or `text-[red]`.
  - Tailwind default-palette classes at every shade from 50 to 950, including the mauve, olive, mist and taupe palettes of Tailwind 4.3 and the `inset-shadow-*`, `inset-ring-*`, `drop-shadow-*` and `text-shadow-*` colours of Tailwind 4.
  - The same palette through its theme variables: `bg-(--color-red-500)`, `var(--color-red-500)` in a class, a string or CSS, and `--theme(--color-red-500)` or `theme(colors.red.500)` in CSS. The slot variables the theme defines, such as `var(--color-fg)`, are fine.
  - Raw font sizes, fonts and radii: as a class (`text-sm`, `text-[length:14px]`, `text-[.875rem]`, `font-[Inter]`, `rounded-xl`), a CSS declaration (`font-size`, `font-family`, `font`, `border-radius` and its longhands, in any case) or a style object key, quoted or not (`fontSize`, `'fontFamily'`, `"font"`, `borderRadius` and its longhands).

  A value is fine only when all of it comes from tokens: a `var(...)`, arithmetic on `var(...)`s and plain numbers in `calc()`, `min()`, `max()` or `clamp()` (such as `calc(var(--ds-radius-lg) * 2)`), a zero radius, or a CSS-wide keyword (`inherit`, `initial`, `unset`, `revert`). Anything else in the value makes it raw: a raw fallback (`var(--radius, 7px)`), a length beside or inside a token (`var(--r) 4px`, `calc(var(--r) + 4px)`), `clamp(1rem, 2vw, 3rem)`, a keyword size such as `large`, a family after the token (`var(--ds-font-sans), Arial`), or a `font` shorthand whose family isn't a token (`font: var(--ds-type-body-size)/1.5 Arial`). A style object string is read the same way, so `fontSize: 'var(--x, 14px)'` is raw. Spacing is not checked: a raw padding, margin, gap or width passes.

  A hex inside longer text counts only when the string is a colour key's value or reads as CSS (a unit such as `px`, a percentage right after the hex as in `#fff 50%`, a border style, a gradient or a colour property such as `color:`), so `"Order #1234 is 50% off"`, `"#feed .item"` and `url(#fade)` are left alone. A string that is exactly a three- or four-digit hex, such as `'#add'`, is a colour unless it is the value of `href`, `to`, `id` or `key`. Text inside JSX elements is not read as a comment.
- **Off when:** no app source yet
- **Fix:** Use the slot class the message names (`bg-surface`, `text-fg`, `text-body`, `rounded-md`). A deliberate exception: `// fwos-ignore tokens` in a comment on the line (`/* fwos-ignore tokens */` in CSS), or `fwos-ignore-next-line tokens` in a comment on the line above. A marker in a string or in JSX text doesn't count.

## design-system/generated

**Generated token files current.** Catches CSS variables or the Tailwind theme out of date with the tokens.

- **Reads:** the design system and `packages/tokens/generated/`
- **Off when:** no design system yet, it has errors, or the token CSS was never built (an adopted app, before `fwos tokens build`). Once one output exists, a missing one fails.
- **Fix:** `fwos tokens build`.

## design-system/registry

**Registered components only.** Catches an installed component missing from components.json, or a removed or superseded one still used.

- **Reads:** `components.json`, the UI components folder and the imports in app source: script files in any of their forms, and MDX files, whose `import` and `export` blocks and `{...}` expressions count but whose prose doesn't. The folder is `paths.ui.web` in `.fwos/state.json` when set (adopt mode sets it from the app, for example `components/ui`), else `apps/web/src/shared/ui/`. In it, each script file (`.tsx`, `.ts`, `.jsx`, `.js` and their `.m` and `.c` forms) is a component named after the file, and each folder is one component named after the folder. Its `index` barrel, tests, stories and `.d.ts` files are not components. Imports resolve the way TypeScript resolves them, as the walls check does: tsconfig `paths` and `baseUrl`, relative paths, and folder index files, so `~/shared/ui/old-button`, `shared/ui/old-button` (with `baseUrl`) and `@/shared//ui/./old-button` all reach the same file. A superseded or removed component is in use when a file imports its file (with or without an extension, or with a dynamic `import()`), or imports from the barrel (`@/shared/ui`, or `@/shared/ui/`) a name its own file exports (or its id in PascalCase, `OldButton`). A namespace import of the barrel (`import * as UI`) takes every component the barrel exports. The barrel's own re-exports don't count.
- **Off when:** no registry, no adapter, or no components in the UI folder yet (the reason names the folder it looked in)
- **Fix:** Register the component (with its required states) or remove it. For a superseded one, switch to its replacement.

## design-system/required-states

**Every required state renders as its contract says, with a passing tagged test.** Catches a registered component's required state with no passing test tagged `@state:<id>:<state>`, or whose fixture fwos's state harness saw render wrong.

- **Reads:** `components.json`, the JUnit results, and the run records of fwos's state harness in `.fwos/local/runs/states/` (see [Rendered states](#rendered-states))
- **Trusts:** the tag, for the tagged test: it counts whatever it asserts. What the state renders isn't taken from it: the harness renders the component's fixture from `src/screens/components.tsx` and the state's contract judges it. An app with no screens browser, such as an adopted one, gets its component fixtures from the comparison gallery once `fwos design-system gallery` has written it: each state the gallery can set renders alone at `/fwos-screens/fwos-gallery?fixture=<id>&state=<state>`.
- **When:** a state needs both. With nothing failing and a render proof missing (no harness in the app, no run since the code changed), it is off and names what's unproven. From the accept step on, a missing or stale render proof fails wherever the app has the harness. A failing or missing tag fails at any step.
- **Off when:** no component declares states, no tests have run, or (with nothing failing) a render proof is missing
- **Fix:** Add a fixture for the state to `src/screens/components.tsx`, a test per state that checks what the user sees, named with `@state:<component>:<state>`, and run the tests and the end-to-end tests (`pnpm test`, `pnpm e2e`).

## architecture/walls

**Module walls.** Catches an import modules.json does not allow, a deep import past a public entry, an import from spikes/, a dependency cycle, an import that resolves to no file or package.

- **Reads:** `docs/app/modules.json` and every file in its modules. Imports resolve the way TypeScript does: relative paths, tsconfig `paths` and `baseUrl` (following `extends`, a file, a package or a list, where a later entry wins), package.json `imports` (`#name`) and workspace packages. A bare name is a package when Node has it built in, or a package.json above the file declares it, or a node_modules above the file has it. A relative or `#name` import must reach a file (a `.d.ts` counts). A `bannedImports` glob matches the import as written and the package it names, a workspace package included. Cycles are found in the imports as well as in `dependsOn`, so two modules with `dependsOn: ["*"]` can't import each other in a circle.
- **Off when:** no modules.json yet, it lists no files, or none of its modules holds a file yet (another app's modules.json, say), since then no wall is checked. An import that resolves to nothing still fails, module or not
- **Fix:** Import through the module's public entry, or (if the dependency is intended) add it to `dependsOn` and log the decision. For `unresolved`, fix the path, or check the tsconfig paths, baseUrl and extends that apply to the file (the finding names any `extends` it couldn't find), or add the package to package.json and install it. For `cycle`, move what the modules share into a module of its own.

## architecture/contract

**API contract and fixtures.** Catches a fixture that no longer matches openapi.yaml (unknown operation, undeclared status, wrong body shape).

- **Reads:** `packages/api-contract/openapi.yaml` and `fixtures/*.json`
- **Off when:** no contract, or one with no operations yet
- **Fix:** Fix the fixture so it matches the schema, or the schema if the API changed (that is a data change).

## architecture/mocks

**Generated contract mocks current.** Catches generated contract mocks (the mock fetch on web) out of date with openapi.yaml or its fixtures.

- **Reads:** `packages/api-contract/openapi.yaml`, `fixtures/*.json` and the mocks each platform generates from them (`generated/mock-fetch.ts` on web). The mock fetch bakes in each operation's method and path and the list of fixtures, so a route renamed or removed in the contract would otherwise keep answering in tests. `fwos contract mocks --check` asks the same question; this check puts it in `fwos check`, which CI and the commit hook run.
- **Off when:** no contract, one with no operations yet, or mocks never generated (the reason says to run `fwos contract mocks`)
- **Fix:** `fwos contract mocks`.

## screens/ia

**IA matches the app: routes, page IDs, redirects, nav, roles and flags.** Catches a page in ia.json the app lacks, a route the app exposes that ia.json lacks, a route that declares another page ID, a redirect that goes nowhere or elsewhere, a page ia.json limits that nothing in its route guards, a nav page no link reaches, an unreachable page, an unknown role; and, in a run of the app as each role and flag setting, a page shown to a role ia.json hides it from, a page a role can't open, a nav page missing from the nav, an unlinked page in the nav.

- **Reads:** `docs/app/ia.json`, the app's routes, the links and guards in its code (screen adapter), and the run records of fwos's IA harness in `.fwos/local/runs/ia/`. The screens browser, `/fwos-screens` and the routes under it in the `(fwos-screens)` route group, is dev-only and left out. Any other page in that group is compared like the rest.
- **The code, on web:** a page declares its ID with `guardPage('<id>')` from `@/shared/session` (the scaffold's), which also lets in only the roles and flag setting ia.json shows the page to. A route is open to everyone when nothing in its page, its layouts or what they import could turn a visitor away (no guard, no `notFound`, `redirect`, `forbidden` or `unauthorized`, no router replace) and no proxy or middleware stands in front of it. Redirects come from `next.config` (`source` and `destination` written as paths) and from a page that redirects to a literal path.
- **Links, on web:** a path starting with `/` given to `href`, `to`, `pathname`, `path`, `route` or `url` (a JSX attribute or an object key, so a nav list counts), or to `push`, `replace`, `redirect` or `permanentRedirect`. It reads every route file (page, layout, template, loading, error and the rest) and every project file one imports, at any depth, through relative paths, tsconfig `paths` and barrels. A `${...}` in a template literal is a dynamic segment, so `` `/items/${id}` `` reaches `/items/[id]`, and so does `/items/42`. A file that imports `ia.json` and sets `href={...}` from it, as the scaffold's nav does, links every nav page. Tests, stories and the screens browser don't count. The nav page at `/` needs no link, since the app opens there, and drill-downs, redirects and unlinked pages need none. Without a run the code is read, not run: a link that never renders still counts, and a path read from data, such as an API, isn't seen.
- **A run of the app:** fwos's IA harness (`e2e/fwos-ia.spec.ts`; in an app with no ia.json it runs nothing) opens every static route as each role in ia.json, with every setting of the flags its pages use (each flag alone, all on and all off past four flags), through a test cookie the app honours only while `FWOS_TEST_ACCESS=1`, and reads every link in the page's `nav`. A page that role should see must open, a page it shouldn't must neither open nor show in the nav (a page with a `no-permission` state may show that state), and every nav page it sees needs a link in the nav. With fresh runs for every setting, the rendered nav replaces the links read from the code.
- **When:** without fresh runs, who sees a limited page isn't compared: with nothing failing it is off and names those pages, unless nothing in the page's route can turn anyone away, which fails. From the accept step on, a missing or stale run fails wherever the app has the harness.
- **Off when:** no ia.json yet, or no app to compare it with (for web, no Next.js App Router `app/` folder). Also off, with nothing else failing, while ia.json limits a page by role or flag and no fresh run shows who sees it, or the page is at a dynamic route, which the harness doesn't open: the reason names those pages, and a failing run lists them too. A broken ia.json still fails.
- **Fix:** Add the missing route or page, call `guardPage('<id>')` first in each page, link the nav page from the nav (or make it a drill-down, or an unlinked page with a reason), fix the redirect, and run the end-to-end tests (`pnpm e2e`).

## screens/states

**Every page state renders as its contract says, with a passing tagged test.** Catches a page state from ia.json (empty, error, offline...) with no passing test tagged `@state:<page-id>:<state>`, or whose fixture fwos's state harness saw render wrong.

- **Reads:** `docs/app/ia.json`, the JUnit results and the run records of fwos's state harness in `.fwos/local/runs/states/`
- **Trusts:** the tag, for the tagged test, as `design-system/required-states` does. What renders comes from the harness, which renders the page's screen from `src/screens/registry.tsx` in each state.
- **When:** as `design-system/required-states`, except that a state with no tagged test waits for acceptance as a not-yet-built requirement does.
- **Off when:** no ia.json, no tests have run, or (with nothing failing) a render proof is missing
- **Fix:** Register the screen in `src/screens/registry.tsx` so it renders each state on fake data, tag a test per state `@state:<page-id>:<state>`, and run `pnpm e2e`.

### Rendered states

fwos's state harness (`e2e/fwos-states.spec.ts`, written by `fwos harness` and the scaffold) opens each state's fixture where the app renders it, and reads what renders inside its `[data-fwos-fixture]` container. `fwos harness targets states` says where: the screens browser (`/fwos-screens/<page>` and `/fwos-screens/components/<id>`, which the scaffold writes), or for a component in an app without it, the comparison gallery's fixture of that state. A component state is one fixture wherever it renders: the gallery draws a state from `src/screens/components.tsx` when the app has one, and from its recipe otherwise. The state's name sets its contract:

| State | Renders |
|---|---|
| `loading` | something marked `aria-busy="true"`, no alert, none of the ready state's content |
| `empty`, `zero`, `filtered`, `filtered-empty` | a `role="status"` (as `EmptyState` renders), nothing busy, no alert, none of the ready state's content |
| `error` | a `role="alert"`, nothing busy, none of the ready state's content: an error on first load keeps no stale data |
| `critical` | a `role="alert"` |
| `info` | a `role="status"` and no alert |
| `ready`, `default` | its content, nothing busy; `ready` shows no alert |
| `disabled`, `invalid` | a disabled control; something marked `aria-invalid="true"` |
| `offline`, `no-permission`, `partial`, `not-found` | a status or alert saying so (`offline` may keep its content, `no-permission` and `not-found` may not, `partial` shows some) |
| any other name | something, and differently from ready |

Every state must render something, throw nothing, and differ from the ready (or default) state, or its fixture ignores the state. The ready state's content is the text, outside links and buttons, of its list items, table body rows and articles outside nav, header and footer.

In any state, what looks clickable must act. The harness hovers each list item, table row and article, anything that sets a pointer cursor and anything with a hover style (a `hover:` or `group` class) in the fixture, at a point no link, button or other control inside it covers. When the hover changes how it looks or shows a pointer, it clicks there, and a click that changes nothing (no new address, no change on the page, no focus moved, no window opened) is a dead hit area: a row that paints on hover while only its title is a link fails.

A run counts while it ran on the code as it is: its record holds a content hash of the app, its packages, the design system and `ia.json`, and the harness that recorded it. Edit any of them and the state is unproven until `pnpm e2e` runs again.

## spec/format

**Spec structure and AC format.** Catches a missing spec section, a duplicate or malformed AC, an AC with no "proven against", a reference to an AC that does not exist.

In an adopted app, an open change's spec delta answers for its request, by rule:

- `request`: each ask (`### REQ-<n>`) names the criteria that deliver it or why it was dropped, and each of the change's own criteria answers an ask.
- `states`: `## States` lists the states of what the change touches, each covered by a criterion, `unchanged` or `none: <why>`, and has every state the change's interactions bring: a search or filter brings `filtered-empty`, a save, send, invite, upload or delete brings `error`, offline work brings `offline`. The words come from the request, its asks and the change's own criteria, outside quoted copy.
- `vague`: a criterion the change adds or changes holds a term that needs interpretation, after ISO/IEC/IEEE 29148's terms to avoid: subjective words (easy, intuitive), unmeasured ones (fast, relevant, some), loopholes (if possible, as needed) and open ends (etc., and/or, TBD). Quoted text is the app's copy and is skipped.
- `question`: a question in `## Open questions` with no `### Q-<n>` heading, so its answer would go unrecorded. `fwos approve spec` refuses while a `Q-<n>` has no `- Answer:`.
- `context` and `delta`: the Context names each file the change maps, and the change adds or changes a criterion.

A stage the team keeps (`fwos adopt --keep`) drops its rules: idea drops `request`, design drops `states`, and spec drops the sections but `## Acceptance criteria` with `context`, `vague` and `question`, asking instead that each of the change's criteria names where it comes from (`- Source:`, one of the change's links).

- **Reads:** `docs/app/spec.md`, and in an adopted app the open change's record
- **Off when:** no spec yet
- **Fix:** Add the missing section, fix the AC heading (`### AC-<feature>-<n>: <title>`, the feature in lowercase letters, digits and hyphens). Any other heading that starts with `AC-` is flagged, not skipped. Then add `- Proven against: mock | local | real`. In an adopted app's change, trace each ask, list the states, say exactly what the user sees, and give each question an ID and its answer.

## tests/plan

**Test plan covers the spec.** Catches an AC with no test case, a case for an AC that does not exist, a bad level or status, a missing default row.

In an adopted app, an open change's plan also needs a case in a browser for one of its own criteria (or a `GAP-browser`), a regression scope naming every test the map found around it (`regression`), and a case marked `new` for each criterion it changes, since the old cases prove what the criterion said before (`changed-ac`). While the plan is written, its info line names the change's cases no test script in package.json can run yet.

- **Reads:** `docs/app/test-plan.md` and the spec, and in an adopted app the app's test scripts
- **Off when:** no test plan yet, or the team keeps its own test planning (`fwos adopt --keep test-plan`)
- **Fix:** Ask the test planner to cover the AC, or fix the case's level or status. Keep the six default rows. For a changed criterion, add a case that fails first.

## tests/traceability

**Every AC proven by a test that ran.** Catches, from the accept step on, a first-release AC with no passing test; at any step, a failing or only-quarantined test, a test tagged with an unknown AC, an expired quarantine.

- **Reads:** the spec and JUnit results; at acceptance only results bound to current application/test inputs and exact result hashes through `fwos tests run`. Browser evidence requires a current recorded browser run; a Playwright or Cypress filename alone proves nothing
- **When:** a first-release AC that no test ran fails from the accept step on, and once every change is closed. Before that, while the slices are built, it is pending: the check passes and lists it as "not built yet (pending until acceptance)". A failing test fails at any step.
- **Off when:** no spec, or no tests have run before the accept step (at the accept step, no results at all fails)
- **Fix:** Write or fix the test that proves the AC, tagged `@AC-<id>`. Fix a flaky test instead of retrying it.

## tests/locked

**Locked tests unchanged.** Catches a locked test edited or deleted without a recorded unlock, by any tool, the shell included, or a lock the last commit holds dropped or re-hashed.

- **Reads:** locked test hashes in the change files, and through git the change files as the last commit has them. The CLI never removes a lock and re-hashes one only after an unlock, so a lock the commit holds that is gone from the change files (`vanished`), or held at another hash (`rehashed`), with no unlock recorded since, fails. With no git or no commit yet, only the working copy is compared.
- **Off when:** no tests are locked yet, and the last commit locks none
- **Fix:** Revert the edit, or `fwos tests unlock <file> --reason "..." --reviewer "<name>"`, edit, then lock again.

## tests/regression

**The tests around a change still pass.** Catches, in an adopted app, an existing test a change names as its regression scope that fails, or that never ran by acceptance.

- **Reads:** the `## Regression scope` of `docs/app/test-plan.md` (one existing test file per line, `- <path>: <what it covers>`), and the JUnit results in `.fwos/local/results/`. A result counts for a file when its class or file attribute names it, by suffix, since runners report paths from their own root. `fwos change map` lists the tests around a change, and `tests/plan` asks the scope to name each of them.
- **Off when:** the project isn't an adopted app, there is no test plan, its regression scope names no test (or says "None"), no test has run yet before the accept step, or the team keeps its own test planning
- **Fix:** Fix what broke the test, then run the tests again with `fwos tests run`. A regression test is the team's: it is never locked, and a change that has to change one says so in its spec.

## build/slices

**Slice manifests match the results.** Catches a slice claiming an AC that no test proves, an unregistered component, an unknown screen or module.

- **Reads:** `.fwos/slices/**/*.json`
- **Off when:** no slice manifests yet
- **Fix:** Fix the manifest, register the component, or make the claimed AC's test pass before marking the slice done.

## rules/pack

**Rule pack.** Catches a pattern from any check-hardness rule in the rule pack (plugin/modules/rules/pack/) or in your design-system/rules.yaml.

- **Reads:** files each rule names, plus `design-system/rules.yaml`
- **Off when:** every rule is off, or no files match
- **Fix:** Follow the rule's fix. A rule that doesn't fit your app: turn it off or scope it in `rules.yaml`.

## web/security

**Web security baseline.** Catches no Content-Security-Policy, a secret-looking NEXT_PUBLIC_ variable, a hard-coded key, a committed .env.

- **Reads:** `next.config.*`, proxy/middleware, `public/_headers`, tracked `.env` files, and for keys every file the token scan reads (scripts in any of their forms, styles and MDX) plus JSON and HTML files, anywhere in the app folder and in `packages/*`, tests aside. The CSP evaluator follows supported literal bindings on actual exported response configurations or root meta output. Known empty, unused or request-only policies fail; unresolved delivery is OFF.
- **Off when:** no web app yet, or policy delivery cannot be resolved statically
- **Fix:** Verify the effective production response headers. Set a `Content-Security-Policy` header with a value, in `headers()` or with `headers.set` in proxy or middleware. A static export (`output: 'export'`) sends neither, so there set it with a `<meta http-equiv>` tag in the root layout or a line in `public/_headers`. A comment doesn't count. Move secrets to the server, commit `.env.example` instead of `.env`.

## web/licences

**Dependency licences.** Catches a runtime dependency, or a package one pulls in, under a licence the chosen channels cannot ship (AGPL, SSPL or unlicensed, and GPL for the App Store).

- **Reads:** `package.json` files and installed `node_modules`, following each dependency to what it pulls in (`dependencies`, and `optionalDependencies` and `peerDependencies` when installed; never `devDependencies`), through pnpm's links too. A finding names the path that pulls the package in. It reads SPDX expressions (`AND` is denied if any part is, `OR` is allowed if any branch is) and the old `license: { type }` and `licenses` forms. A package with no licence is UNLICENSED, and `UNLICENSED` is denied in any case. A local package (a `workspace:`, `link:` or `file:` dependency, found through `pnpm-workspace.yaml` or the `workspaces` field of `package.json`, or a private package) is the project's own code, so it isn't graded, but what it pulls in is. A package.json of the project's own (the root, the app, `packages/*` and local packages) that isn't valid JSON fails, since what it declares can't be checked.
- **Off when:** a dependency isn't found, direct or pulled in (it names them), and nothing is found yet, or there are no third-party runtime dependencies. A finding stands while others aren't installed, and the result names the missing ones.
- **Fix:** Replace the dependency (or the one that pulls the package in), or record a decision if the licence is acceptable for your channels.
