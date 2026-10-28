---
name: accept
description: 'Step 8 of Frontend Web OS. Proves the whole app matches what the user asked for: production build, the full suite, an independent adjudicator verdict per AC, optional exploratory QA, a lens review of the full diff, and the generated acceptance report the user approves. Loaded by /fwos:start when the step is accept.'
user-invocable: false
---

# Step 8: Accept

Goal: prove the whole app matches the brief.

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md and
${CLAUDE_PLUGIN_ROOT}/modules/accept/knowledge/release-readiness.md.
`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

In an adopted app (`fwos next --json` has `adopt`), follow
${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/adopted-app.md where it differs from this step.

1. **Production build and the full suite.** `pnpm typecheck`, then `fwos tests run` to run the full test scripts and record their inputs and result hashes. Confirm the
   e2e server runs the production artifact: `next build` then `next start` for a server app, or a
   static file server serving the exported `out/` for `output: 'export'`. Record the actual serve
   command; never count `next dev` as production evidence. Every result lands in `.fwos/local/results/`. Acceptance requires these current run records; copied JUnit files or records made before the inputs changed do not prove a criterion.
2. **The report.** `fwos report` runs every check and writes `docs/app/reports/acceptance.md` from the
   evidence. Never edit that file; fix the cause and run it again.
3. **Independent verdict.** Launch the `adjudicator` agent with the first-release ACs (full text), the
   diff since the project started (`git diff <first commit>..HEAD --stat` plus the relevant files),
   and the result files. Where it disagrees with the report, the stricter verdict wins: fix the test
   or the code, then re-run.
4. **Lens review.** Launch the `lens-reviewer` agent once per lens in
   ${CLAUDE_PLUGIN_ROOT}/modules/rules/lenses/ (states, interaction, accessibility, visual, copy), in
   parallel. Give each one the lens file's path and the diff itself: paste the output of
   `git diff <base>` into its prompt, or when that is too long, the changed files with the line
   ranges `git diff --unified=0 <base>` lists. The reviewer may have no shell, so a command to run
   is no use to it. If the project's `docs/app/lenses.md` exists (under the configured docs path
   in an adopted app), read it and include its complete text in every review prompt, naming which
   notes apply to that lens. Say explicitly when there are no project lens notes. Fix blockers;
   show should-fix items to the user.
5. **Optional exploratory QA.** Ask first. Launch `qa-explorer` against a local run with mock or seed
   data. Turn real bugs into change requests or fixes in this change.
6. **Manual checks and gaps.** For each manual AC and named gap in the report, ask the named person
   to check it, then record it: `fwos signoff <AC-x-n|GAP-n> --by "<name>" --note "<what they saw>"`.
7. **Run `fwos report` again.** "Done" means: every first-release AC passes with evidence, none is
   proven only by a quarantined test, every gap and manual check is signed off by name, and no check
   fails.
8. **Release readiness.** Walk the checklist in release-readiness.md for the chosen channels. Prepare
   commands; never run deploy, sign or submit.

## Approval

Show the report's verdict, the AC table and anything off, assumed or skipped. "Accept?"
Yes: `fwos approve acceptance --by "<name>"`, then `fwos change done`. Closing the change doesn't
alter the report, so the approval stays valid. From now on, any request is a change (/fwos:change).
