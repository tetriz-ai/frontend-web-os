---
name: spec
description: 'Step 6 of Frontend Web OS writes and reviews the numbered requirements, then has an isolated planner derive the test plan from the spec. The user approves both documents together. Loaded by /fwos:start at the spec step.'
user-invocable: false
---

# Step 6: Spec and test plan

Goal: one spec, and one test plan written from the same requirements, before any feature code.

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md and
${CLAUDE_PLUGIN_ROOT}/modules/spec/knowledge/ac-writing.md.
`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

In an adopted app (`fwos next --json` has `adopt`), follow
${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/adopted-app.md where it differs from this step.

## 6a. The spec

1. Start from ${CLAUDE_PLUGIN_ROOT}/modules/spec/templates/spec.md. Draft everything you can derive
   from the brief, research, modules.json, the design system and ia.json.
2. Ask only the real forks, one at a time, each with a recommended answer and what changes if it
   flips. Record each answer in decisions.md before moving on. No silent forks.
3. Write ACs per the format, one per state and journey step that matters. Stable IDs.
4. Slices (section 13): thin, ordered, each naming its modules, ACs and what it depends on. The
   last slice is the real-use slice: try the whole app as the target user would.
5. `fwos stamp docs/app/spec.md --from brief.md,ia.json,modules.json`, then
   `fwos check spec` and fix every finding (sections, AC format, dangling references).
6. **Review**: launch the `spec-reviewer` agent. Fix its findings and review again. Only a full PASS
   goes to the user. After 2 rounds, show the user the doc with the open findings; they may accept
   with logged exceptions (a row per finding in decisions.md).

## 6b. The test plan

1. Launch the `test-planner` agent. Put the **full text** of `docs/app/spec.md`,
   `docs/app/ia.json` and `packages/api-contract/openapi.yaml` (and the fixture file names) in its
   prompt. It has no tools and must not see the code: tests derived from intent check what was
   meant, not what got built.
   If the agent can't start, stop and tell the user, with the exact error. Don't write the plan
   yourself or with another agent: one that can read the code breaks the promise that tests come
   from intent.
2. Save what it returns as `docs/app/test-plan.md` (you write the file, it can't).
3. `fwos stamp docs/app/test-plan.md --from spec.md,ia.json` and `fwos check plan`. Fix gaps by
   asking the planner again with the finding, never by writing cases yourself.
4. Review the plan yourself against: every AC covered; every test checks behaviour, not code
   details; edge states included; every seam has a shared fixture; manual checks only with a reason;
   named gaps say exactly which access is missing.

## Approval (both together)

Show: the "What you're approving" box, the number of ACs and slices, manual checks and named gaps,
and a rough cost and time estimate for the build. Ask for a budget if they want one.

Yes: `fwos approve spec --by "<name>"` (it records both files' hashes). Then `fwos step build`.

If the spec changes later, its hash changes: the test plan becomes stale and the edit hook closes
app source again until both are re-approved. Re-plan only the changed ACs.
