# Coverage and trust limits

Read these boundaries before relying on an acceptance result. [Limit tests](../scripts/tests/limits.test.ts)
and [Codex validation](../README.md#tests) document the checks behind them. Passing a planted case
does not prove every possible input is handled.

## The checks

**Misses (can let something through)**

- **All OFF passes.** OFF never fails a run, so a CI job where every check is OFF exits 0. Read
  `fwos doctor` once in a new setup.
- **Requirements before acceptance.** Until a change reaches the accept step, a first-release
  requirement that no test ran is pending, not failing, because a later slice may build it. From
  the accept step on, it fails.
- **Shell edits.** The edit hooks only see the agent's edit tools, so a shell command writes past
  them. `fwos check` still catches what `tests/locked` catches, so run it in CI.
- **Runtime values.** The token scan reads source text, so a colour assembled at runtime is not seen.
- **Spacing.** The token scan checks colours, type and radii, not spacing, so a raw padding,
  margin, gap or width such as `p-[13px]` or `margin: 7px` passes.
- **Computed imports.** The walls check reads import paths, so an import from a computed path is not
  seen.
- **Effective CSP.** Source analysis cannot prove that a production host sends a policy on every
  route or that its directives permit only the intended resources. The check reads supported
  literal bindings and supported header or static-export forms; runtime-computed expressions
  still need review. Inspect the deployed response headers, or the effective CSP meta tag for a
  static export, and test the app's required resources.
- **Other routers.** The screen check reads the Next.js App Router. With no `app/` folder it is OFF
  and says so.
- **Roles and flags.** Without a fresh run of fwos's IA harness, `screens/ia` can't see whom a
  guarded page lets in, so while `ia.json` limits a page by role or flag it is OFF unless something
  else fails, and names those pages. A limited page whose route can't turn anyone away fails
  without a run. Run `pnpm e2e`.
- **Dynamic routes.** fwos's IA harness opens static routes only, so who sees a page at a route such
  as `/items/[id]` is compared through its code alone, and stays OFF, named.
- **Links from source.** Without a fresh run of fwos's IA harness, `screens/ia` reads the link paths
  in the code a route imports, not the rendered page, so a link that never renders, such as one
  behind a condition, still counts.
- **Who approved.** An approval records the name it is given. fwos doesn't check that the person
  said yes, so review approvals in the change file's history.
- **Local evidence is trusted.** For a result file associated with a recorded `fwos tests run`,
  only a current run counts; a stale or unavailable revision does not establish current proof.
  Unrecorded JUnit does not count as current acceptance proof. A person or shell can still write results or run records.
  A harness run must match the current code and shipped harness, but these checks do not
  authenticate who produced its observations. Review the assertions and provenance in CI.
- **State tags.** A state's tagged test is taken on trust. fwos's state harness proves what each
  state renders, not what it does: it clicks what looks clickable outside controls, but not the
  controls themselves, so a retry button that does nothing passes with a test that checks nothing.
  No agent reviews those tests at acceptance either: the adjudicator judges the requirements.
- **Dead hit areas.** The harness looks for them in list items, table rows, articles, anything with
  a pointer cursor and anything with a `hover:` or `group` class, so a card styled for hover any
  other way isn't tried.
- **Doctor's start.** `fwos doctor --start` runs `next dev`, not a production build, renders one
  state fixture, and needs what your app needs to boot (its env, a reachable database if a layout
  queries one). It shows the browser checks can run in your app, not that they pass.
- **Stale content.** The state contract reads the ready state's content from list items, table
  rows and articles, so stale data shown in plain boxes, such as a grid of cards, isn't seen.
- **Unnamed states.** A state whose name the contract has no rule for, such as `archived`, is held
  only to rendering, and differently from ready.
- **Fixtures, not routes.** fwos's state harness renders each state's fixture in the screens
  browser, not the page at its route, so a route that draws a state differently from its fixture
  isn't seen.
- **Test identity.** fwos's IA harness opens the app as each role through a test cookie the app
  honours only while `FWOS_TEST_ACCESS=1`, so a run proves what the app shows that identity, not
  your sign-in. Never set it, or `FWOS_SCREENS`, for a real deployment.
- **Malformed hook input.** When the host sends hook input that isn't a JSON object, the hook lets
  the tool call through rather than lock up a session. `fwos check` and the commit hook still read
  the files.

**Flags too much (harmless)**

- **Clicks that only send.** A click counts as acting when it changes the address, the page or
  focus, or opens a window, so a row whose click only sends a request, such as analytics, fails as a
  dead hit area.
- **Unreadable state.** With a broken `.fwos/` file fwos can't tell what is approved or locked, so
  the edit hooks block app source and test files, and leave that file, the docs and the design
  system writable for the repair. `fwos check` and the commit hook fail closed.
- **Theme keys in style objects.** A style object's `fontSize`, `fontFamily`, `font` or radius
  string is read as CSS, so a CSS-in-JS theme key such as `fontSize: 'md'` is flagged. Use the slot
  classes, or add `// fwos-ignore tokens`.

- **Hex-like strings.** The token scan reads a string that is exactly a short hex value, such as
  `'#add'`, as a colour, unless it is the value of `href`, `to`, `id` or `key`. Add
  `// fwos-ignore tokens` on that line.
- **Bundler-only aliases.** An import path set only in a bundler config (a Vite or webpack alias
  that tsconfig doesn't mirror) is reported unresolved. Add the alias to tsconfig `paths`.
- **Links built from data.** Without a fresh run of fwos's IA harness, `screens/ia` reads link
  paths written in the code, so a nav page linked only through a path read from data, such as an
  API, has no link it can see. Run `pnpm e2e`, write the path in the code, or build the nav from
  `ia.json` as the scaffold does.

## The gallery

**Misses (can let something through)**

- **Read from source.** Variants, states and interactions come from each component's source, so a
  variant built at runtime is missed. fwos's starter components and the common shadcn ones have a
  recipe for their parts, and any other component renders as its main export with a line of text.
- **Two widths.** It renders at 390 and 1280 pixels wide in each mode the design system has, so a
  difference at another breakpoint isn't compared.
- **Variables only.** The two sides differ only in the variables they set, so a style from
  elsewhere in your CSS renders the same on both and is never reported.
- **No taste.** A defaulted slot renders the same on both sides, since your source has no value to
  compare. Its row in the report still needs your decision.

- **Recipes as state fixtures.** In an app with no screens browser, the gallery's cell for a state
  is fwos's recipe with the prop that sets it, so a state only your own markup can put a component
  in (a menu open on a given item, a form mid-submit) has no fixture there and stays unproven.

**Flags too much (harmless)**

- **Pages that need services.** The gallery runs inside your app with `next dev`, so a root layout
  that reads a database or an API needs its environment set, or the run reports page errors.

## Prototype bundles

**Misses (can let something through)**

- **Looks aren't compared.** fwos checks that a bundle links a visual artifact, not that the app
  looks like it: the gallery and a person do that.
- **Companions are links.** A companion route is checked as a link to a page the bundle covers.
  That it renders each state from registered components is what `screens/states` shows, from a run
  of the harness.
- **Who sees what, as last run.** `fwos prototype diff` reads who sees what from fwos's IA harness,
  which opens the routes the project's `ia.json` lists. A page only the bundle has is compared by
  its route alone until the build adds it, and a role and flag setting no run covered is named as
  not compared. Redirect pages are classified, not compared.
- **Committed, not reviewed.** A promotion needs git to hold each input as it is, not that the
  commit was pushed or reviewed, and it records the name it is given.

## The agents

**Misses (can let something through)**

- **Model judgement.** The interview, spec, tests and code are the model following fwos's prompts, so
  their quality varies with the model, while fwos enforces the order, the approvals and the test
  evidence. The cases in [plugin/evals](../plugin/evals/) compare the prompts with a no-plugin
  baseline, and [MODELS.md](../plugin/evals/MODELS.md) records one Haiku smoke run, with no full
  baseline comparison and no Codex model run.
- **Test intent.** A passing test tagged with a requirement proves it to `fwos check`. Whether the
  test checks the right thing is the adjudicator agent's job at acceptance. That agent follows
  fwos's prompts, its verdict isn't recorded, and neither `fwos check` nor the acceptance report
  depends on it.

**Flags too much (harmless)**

None known.

## In Codex

fwos reads the same skills, hooks and files in Codex, and the hooks check an `apply_patch` file by
file. fwos's agents are written to `.codex/agents/fwos-*.toml` with this machine's plugin folder in
them, so they're git-ignored. Run `fwos codex agents` on each machine and after a plugin update, and
`fwos doctor` says when they're out of date.

**Misses (can let something through)**

- **Hooks need your trust once.** Codex installs plugin hooks untrusted. Until you trust fwos's in
  `/hooks`, nothing stops feature code before the spec or an edit to a locked test, though
  `fwos check` and the commit check still catch both.
- **The Codex app.** Plugin installation and hook registration were checked with Codex CLI 0.155.1 and 0.164.0. Before you rely on the hooks in the
  Codex app, check that it refuses an edit to app source while the spec is unapproved.
- **The test planner.** Codex has no per-agent tool list, so the planner's isolation rests on fwos's
  hook, which refuses every tool the planner tries. The hook knows the planner by the agent name
  Codex sends with each call.

**Flags too much (harmless)**

- **The sandbox.** Codex keeps `.git/` and `.codex/` read-only even in a writable workspace, so it
  asks before `git init`, the commit hook and `fwos codex agents` write there. Approve them, or run
  them in a terminal.
- **Unreadable patches.** fwos refuses an `apply_patch` whose files it can't read, rather than let
  it past the spec gate and the locked tests.
