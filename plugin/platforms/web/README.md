# platforms/web

Next.js adapters, web profile, security and licence checks.

## Owns

The web profile (supported): the 4 adapters for Next.js (component registry IDs to `@/shared/ui/<id>`, the App Router walk with the links the routes' code makes, the page ID each route declares with `guardPage`, whether anything in a route can turn a visitor away, and redirects from pages and `next.config`, the fail-closed mock fetch from the contract, the Playwright verify driver with fwos's harness in `templates/harness/`: `fwos-states.spec.ts` renders every state fixture, hovers and clicks whatever looks clickable in it, and `fwos-ia.spec.ts` opens every static route as each role and flag setting; the driver says where each state fixture renders (the screens browser, or for a component in an app without it the gallery's fixture mode), and `render.ts` starts the app's own `next dev`, renders one fixture in Chromium through the app's own Playwright and opens `/` as a role, for `fwos doctor --start`), adopt mode's reader (`adopt.ts`): the layout (the Next.js app, its source folders, the workspace packages it uses, the other workspace packages it skips, and its UI folder, each with what it came from) and the inventory `fwos adopt` shows (the apps in the repo and, for the one adopted, its stack, routes, components, theme, data, auth, flags and tests, then the repo's scripts, CI, hooks, lint, agent guidance and docs, each finding with its file and each empty area with what was looked for), the app's own test commands for `fwos tests run` (`runners.ts`: its test scripts, the runner each calls, and the JUnit reporter added on the command line for Vitest, Playwright, Jest, Cypress and Mocha), a change's map onto the code for `fwos change map` (`map.ts`: a route's page, the route files around it, what they import, the API routes and server actions they call, and the tests that import the page or visit the route), doctor's tool probes, and web-only checks. The component folder is `paths.ui.web` when set, else `<app>/src/shared/ui`. In it, a script file is a component named after the file and a folder is one component named after the folder. Only the screens browser (`/fwos-screens` and below, in the `(fwos-screens)` route group) is a dev-only screen. The comparison gallery (`gallery.ts`): what a component's source says it can render (variant axes from `cva` or union-typed props, states from props and state classes, interactions from elements, Radix primitives and classes), recipes that render fwos's starter components and the common shadcn ones with their parts, and the files `fwos design-system gallery` writes under `(fwos-screens)/fwos-screens/fwos-gallery/`: the page, the frame with every cell, the data and a Playwright runner that compares both sides and writes `.fwos/local/results/fidelity.json`. A cell that shows a state is a state fixture in the harness's container (`data-fwos-fixture`, `data-fwos-state`), drawn from the app's own `componentStates` (`src/screens/components.tsx`) where both sides render the same component and the app has one, so a component in a state is one fixture wherever it renders; `?fixture=<id>&state=<state>` renders that one cell alone.

## Public entry

`index.ts`: `profile`, plus `routeOf`, `mockFetchSource`, `uiDir`, `HARNESS_DIR`, `verify` (with `fixture` and `render`), `inferLayout`, `inventory`, `normalizeDir`, `runnerOf`, `testCommands`, `mapChange`, `matchRoute`, `gallery`, `describeComponent`, `galleryCommand`.

## Skills and agents

Skill `web-profile` (preloaded by the builder, test writer and QA explorer).

## Checks

`web/security` (a `Content-Security-Policy` header with a value, comments ignored; no secret-looking `NEXT_PUBLIC_` values, no hard-coded keys, no committed `.env`), `web/licences` (no AGPL, SSPL or unlicensed runtime dependency, nor any package one pulls in, walked through node_modules and named with the path that pulls it in; read from SPDX expressions and the old `license`/`licenses` forms, a missing licence counting as unlicensed; no GPL for the Mac App Store; `workspace:`, `link:`, `file:` and private packages are walked but not graded; a project package.json that isn't valid JSON fails; off while any dependency, direct or pulled in, isn't found, unless something is already found).

## Depends on

`kernel` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

`fwos doctor` shows each adapter at 3 levels. The verify driver reaches the third only under `fwos doctor --start`, which starts the app and renders a state fixture in Chromium; plain doctor finds Playwright, its config and Chromium installed, starts nothing, and says so. The harness runs the app under `pnpm e2e`: `fwos harness status` shows its last runs and whether each still counts. `tests/render.test.ts` covers where each fixture renders and what the render says when the app can't start. `tests/web.test.ts` runs the generated mock fetch for real, `tests/adopt.test.ts` covers the layout reader and the inventory, `tests/runners.test.ts` the test commands, `tests/map.test.ts` a change's map and `tests/gallery.test.ts` the component reader and the gallery files. `scripts/tests/gallery.test.ts` (`pnpm test:e2e`) runs the gallery in Chromium on a scaffolded app and on an adopted one.
