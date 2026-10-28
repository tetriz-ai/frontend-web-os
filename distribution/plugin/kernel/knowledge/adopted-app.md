# Working in an adopted app

An adopted app is one fwos didn't create: `fwos next --json` and `fwos status --json` have `adopt`
with its level. The team's code, conventions and tools stay the source of truth, and fwos adds only
what the level turns on. `fwos status` lists each capability, on or off and why.

## The team's conventions win

- Read the agent guidance and docs `fwos adopt` listed (AGENTS.md, CLAUDE.md, CONTRIBUTING.md,
  Cursor or Copilot rules). Where they differ from fwos's defaults, follow them unless the user
  says otherwise.
- Build with the app's own components (`paths.ui` in `.fwos/state.json`), aliases, styling, data
  layer and auth. Never bring in fwos's starter components, data layer or architecture. If a change
  needs a pattern the app doesn't have, ask before adding it.
- Run the app's own test scripts with `fwos tests run`. It runs them as the team does, through
  their package manager, and adds a JUnit reporter on the command line, so their results count and
  their configs stay as they are. Don't add a test framework. A script fwos can't read results from
  says `Not mapped`: its run proves nothing, so say so rather than count it. If the app has no
  runner for a level a test needs, say so and record it as a gap.
- Keep the team's branch and pull request conventions, its PR template and its review. `fwos change
  new` names the branch in their pattern (`workflow.branch` in `fwos next --json`): create it only
  after asking. The spec delta and the acceptance report go up for review in their pull request.
- Record an approval only when a person says yes, from now on, on the change it is for. A yes given
  in a pull request review is recorded with its link: `fwos approve spec --by "<reviewer>" --via pr
  --ref <review URL>`. fwos refuses an approval of the product as it was (its brief, architecture,
  design system or screens) and one with no change open.

## Stages: what fwos adds, and what stays the team's

`fwos adopt` and `fwos status` show six stages, from the idea to its acceptance: `idea`, `design`,
`spec`, `test-plan`, `build` and `acceptance`. For each: what the team does there today (each
finding with the file it came from), what that leaves open, what fwos adds and what would show it
helped. Show them as they are, and claim no gain the evidence doesn't show.

A team that already serves a stage well keeps it: `fwos adopt --keep <stage> --reason "<why>"`,
then `--yes` (`--use <stage>` gives it back). fwos adds nothing to a kept stage, and `fwos next
--json` lists the kept ones in `adopt.keep`. Link the team's own artifact for a kept stage to each
change: `fwos change link <url|path> --stage <stage>`.

- `idea`: no `## Request` in the delta; the change's links are the request.
- `design`: no `## States`.
- `spec`: the delta holds only `## Acceptance criteria`, and each of the change's criteria says where
  in the team's spec it comes from (`- Source: <link>`), a link the change holds.
- `test-plan`: no test plan. The spec is approved alone, and `fwos tests run` still runs the team's tests.
- `build`: no spec gate, and an edit outside the map doesn't hold the change open.
- `acceptance`: the change closes on the team's sign-off, linked with `--stage acceptance`, not on
  `fwos approve acceptance`.

## A change in an adopted app

At level delivery a request becomes a change: `fwos change new "<request>" --route <route>`, with
`--link <url|path>` for each issue, PRD, design doc or spec it comes from. Links stay where they
are: they are context, never copied into fwos's files. `code-only` enters at the build, and
`touches-ac`, `new-feature` and `data-change` at the spec. A change answers only for its own steps:
the app's brief, architecture and screens are the team's, and fwos never asks to approve them.

### Map it onto the code

Before the spec delta, find what the request touches and run `fwos change map <route|file>...`,
a route by its URL (`/dashboard`) and a file by its path. From the code it reads the page and the
route files around it, every file they import, the app's UI components among them, the API routes
and server actions they call, the existing tests that import the page or visit the route, and the
code owners. It records them on the change. The spec can't be approved until the change is mapped,
and the build's edits are held against the map. If the change turns out to touch more, map it again
and have the spec approved again.

### The spec delta

`docs/app/spec.md` holds only what changes delivered through fwos added, never a spec of what the
app already does. For a change, rewrite these sections (`fwos check spec` reads them, and
docs/file-formats.md in the fwos repository shows each block):

- **What you're approving**: the request, in a paragraph.
- **Context**: the request as given, each linked artifact, and the routes, components, data calls
  and tests the map found, with their paths. `spec/format` fails a Context that doesn't name a file
  the change maps.
- **Request**: the request as given, then each thing it asks for as `### REQ-<n>: <ask>`, with
  `- AC:` naming the criteria that deliver it, or `- Dropped: <why> (<who>)` when the user leaves it
  out. Every criterion of the change answers an ask, so nothing reaches the build untraced and no
  ask drops silently.
- **States**: a table (`| State | What the user sees | Criterion |`) of what the change touches:
  each state its interactions bring (a search brings `filtered-empty`, a save or send that can fail
  brings `error`), each existing state it changes, and those it keeps (`unchanged`). `spec/format`
  names a state the change brings that the table leaves out.
- **Acceptance criteria**: the new or changed behaviour, one AC each in the format the spec step
  uses, and an AC for adjacent behaviour the change must not break. Keep the ACs earlier changes
  added: they stay proven, and stay theirs. A change needs criteria of its own, added or changed
  since it began, or `spec/format` fails it. Say exactly what the user sees: `spec/format` flags a
  term in the change's own criteria that needs interpretation ("relevant", "quickly", "some").
- **Open questions**: only what the repo and the links don't answer, each as `### Q-<n>:
  <question>`. Ask them, write each answer under its question (`- Answer: <answer> (<who>)`), and
  only then ask for the approval: `fwos approve spec` refuses while one has no answer.

### The test plan delta

`docs/app/test-plan.md` gets cases for the change's ACs from the test planner, at the levels the
app's runners support. The default rows a new fwos app needs (crawl, themes, phone and the rest)
aren't required here.

- At least one of the change's own ACs gets a case at level `e2e` or `browser-component`, so the
  change is seen working in a real browser. If the app can't run a browser test yet, add
  `### GAP-browser` with `- Missing:` saying what, for a person to sign off. `tests/plan` names the
  change's cases no test script can run yet.
- A criterion the change changes gets a case marked `new`: its existing cases prove what it said
  before, and `tests/plan` fails a changed criterion with only `existing` ones.
- Add `## Regression scope` yourself, from the map's paths (the planner still never sees code): one
  line per existing test file around the change, `- <path>: <what it covers>`, every one the map
  found among them, or `None` and why. Those tests are the team's: they run with the app's own
  commands and are never locked.

### Build and evidence

- The spec gate covers the adopted app's own source until the change's spec is approved.
- Write the change's tests first, run them with `fwos tests run` and see them fail, then lock them.
  `fwos tests lock` takes only files the change added or changed, never the suite the app already
  had. Tag each test with the AC it proves (`@AC-<feature>-<n>`).
- Build in place: edit what the change maps, with the app's own components and data boundaries.
  `fwos change drift` lists an edit to an existing file of the app outside the map. Map it as well
  and have the spec approved again, or make it a change of its own. `fwos change done` refuses
  while there is one.
- Run every test script with `fwos tests run`, unit, component and E2E, after your last edit. An AC
  with a browser case is proven only by a passing test from a browser run of the code as it is, and
  `tests/regression` fails when a test in the regression scope fails, or never ran by acceptance. The team's browser setup (its dev server, test
  database and sign-in) is theirs: use it, never invent one.
- `fwos report` keeps pre-existing debt (the baseline) apart from new findings, and what people
  approved in the change (its criteria, who, when and where) apart from what it builds on: the
  request and its links, the code it maps, earlier changes' criteria and the team's own tests. Debt
  is never evidence that the change works, and a new finding is the change's to fix.
- `fwos change done` closes the change once the checks pass and its acceptance report is approved.
  Closing it leaves the report as it was: until the next change starts, `fwos report` still
  reports that change, so the approval holds.

### Handoffs

At each handoff (the spec's approval, `fwos step build`, `fwos step accept` and `fwos change done`)
fwos says what the change carries on: open questions, `[ASSUMED]` lines in its spec delta and test
plan, dropped asks, criteria dropped since it began, and kept stages with nothing linked. `fwos next
--json` has them in `open`. Show them to the user at each handoff, so none is lost on the way.
`fwos change trace` hands the whole chain out, from the request to its evidence (`--json` for
another tool), and the acceptance report carries it under `## Traceability`.
