---
name: screens
description: 'Step 5 of Frontend Web OS. Scaffolds the walking skeleton (web app, tokens, module walls, tests and fwos check wired, one smoke test green), then builds every key screen on fake data with a state switcher, and writes docs/app/ia.json. The user clicks real screens in every state before the spec is frozen. Loaded by /fwos:start when the step is screens.'
user-invocable: false
---

# Step 5: Screens

Goal: the user sees and clicks every screen, in every state, before anything is frozen. Changes
here cost the least.

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md,
${CLAUDE_PLUGIN_ROOT}/modules/screens/knowledge/ia-grammar.md and
${CLAUDE_PLUGIN_ROOT}/modules/rules/knowledge/states.md. Use the platform profile skill
(`fwos:web-profile`) for how the app is laid out. `fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

The spec gate is on: until the spec is approved, the edit hook only allows docs, the design system,
the contract, `apps/*/src/screens/`, `apps/*/src/shared/ui/` and the dev-only screens routes under
`apps/*/app/(fwos-screens)/fwos-screens/`. That's deliberate: screens are built from registered
components on fake data, not as features. Real routes, with their `guardPage` call, come with the
slices.

## 1. Scaffold (the walking skeleton)

1. `fwos scaffold web --name "<app name>"`. It never overwrites a file; it reports what it kept.
2. `fwos tokens build` and, if the contract has operations, `fwos contract mocks`.
3. Ask, then run: `pnpm install` (about 150 packages) and
   `pnpm --filter web exec playwright install chromium` (a browser download, about 150 MB).
4. Run `pnpm typecheck`, `pnpm test`, `pnpm e2e`, then `fwos check`. All green except checks that
   are OFF for a stated reason (spec, test plan, locked tests, slices) proves the toolchain before
   any feature exists. `pnpm e2e` includes fwos's harness (`e2e/fwos-*.spec.ts`): never edit those
   files (`fwos harness` restores them). If something fails, fix the skeleton first.
5. Suggest a commit: "Walking skeleton".
6. With a design system the user brought (`fwos design-system report` shows coverage other than
   none), compare it with their source now: `fwos design-system gallery`, then the command it prints,
   then `fwos design-system report`, as ${CLAUDE_PLUGIN_ROOT}/modules/design-system/knowledge/fidelity.md
   says. Go through the differences and the undecided items with the user, record each decision,
   and on their yes `fwos approve fidelity --by "<name>"`. They may leave it for later: it is optional.

## 2. Screens on fake data

Ask the forcing questions, one round:

- What can we reuse (registered components, the user's existing screens)?
- Which are the key screens for the 3 core jobs?
- For each, every non-happy state: empty, filtered-empty, loading, error, offline, no permission,
  partial data. (Use the feature checklists from research.)
- Do roles see different things?

Then, per screen:

- Build it in `apps/web/src/screens/<page-id>.tsx` from `@/shared/ui` components and slot classes
  only, fed by fixtures from `packages/api-contract/fixtures/` (or literal fake data that matches
  the contract). It takes a `state` prop and renders that state, and only that state: a loading
  state marks its region `aria-busy="true"`, an error shows a `role="alert"` with a retry and none
  of the ready rows, an empty state renders `EmptyState`. fwos's state harness renders each state
  and `fwos check` fails one that renders wrong (ia-grammar.md says what each state must render).
- Register it in `apps/web/src/screens/registry.tsx` under its page ID.
- Add the page to `docs/app/ia.json` with every state, and give its route a page that calls
  `await guardPage('<page-id>')` first (from `@/shared/session`) once the route exists.
- A missing component goes in `apps/web/src/shared/ui/` and gets registered in
  `design-system/components.json` with its required states, and each required state gets a
  fixture in `apps/web/src/screens/components.tsx`.

The user clicks through them at `http://localhost:3000/fwos-screens` (`pnpm dev`). Iterate as long
as they want; this is the point of the step.

## 3. ia.json

Make sure every page has a stable ID, route, kind, order, visibility and states (ia-grammar.md).
Run `pnpm e2e`, then `fwos check ia states`. Before features exist, pages whose routes aren't built
yet show as "missing"; that's expected now and goes green as slices land. Fix every other finding.

## Tiny apps

The clickable screens can be skipped (`fwos skip screens --reason "tiny app" --by "<name>"`), but
`ia.json` and the state inventory can't: write them from the brief and show them as a list for
approval.

## A prototype from another tool

When the design came from elsewhere (an HTML prototype, a Figma frame, a Storybook story), or a
feature is handed off later, promote a bundle for it in `docs/app/prototypes/<id>/`: a
`bundle.json` linking the visual artifact, each page's screens browser route as its companion, a
`states.md` with a `## <page>` section and a `- <state>: what it shows` line per state, the spec
section, the decision record when there is one, and the intended `ia.json` (the whole app as the
feature leaves it). Never link a `working/` draft. `fwos prototype check` names what stops it; on
the user's yes, commit it and run `fwos prototype promote <id> --by "<name>"`. After the build and
`pnpm e2e`, `fwos prototype diff <id>` shows what the app still lacks or shows to the wrong role:
report it, and a divergence the user keeps goes in the decision record.

## Approval

"These screens are right?" Show the list of pages and states. Yes:
`fwos approve screens --by "<name>"`, then `fwos step spec`. The screen components are kept: slices
later wire real data into them.
