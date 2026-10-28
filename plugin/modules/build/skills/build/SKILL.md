---
name: build
description: 'Step 7 of Frontend Web OS. Builds the app slice by slice. For each slice a separate agent writes the tests first (new behaviour must fail once), the tests are locked by hash, the builder agent implements, and fwos check plus the verify loop prove it before a commit with a slice manifest. Loaded by /fwos:start when the step is build.'
user-invocable: false
---

# Step 7: Build

Goal: working code, slice by slice, each slice proven.

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md and
${CLAUDE_PLUGIN_ROOT}/modules/build/knowledge/slice-manifest.md.
`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

In an adopted app (`fwos next --json` has `adopt`), follow
${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/adopted-app.md where it differs from this step.

Before the first slice: say how many slices there are, a rough cost, and ask to go. Slices run one
at a time.

## Per slice (in the spec's order)

1. **Context pack.** Collect: the slice row from spec section 13, its ACs (full text), its test
   cases from the test plan, spec sections 7 and 8, and the relevant fixtures. Not the whole spec.
2. **Manifest.** Write `.fwos/slices/<change>/<slice>.json` with `status: "in-progress"`.
3. **Tests first.** Launch the `test-writer` agent with the context pack. It writes the tests and
   runs them. Check its report: tests for `new` behaviour fail for the right reason.
4. **Lock.** `fwos tests lock <files> --red --slice <id>` (it refuses unless each file has a failing
   test in the results). Files that only cover existing behaviour: `--existing`.
5. **Build.** Launch the `builder` agent with the context pack and the locked file list.
6. **Check.** Run `fwos check` yourself; don't take the builder's word. ACs and states of slices
   that haven't started show as pending (info, not a failure) until the accept step; everything
   this slice claims must pass. Run `fwos slice drift <slice> --base <commit before the slice>`
   (commit the skeleton first, so there is a base). A behaviour change outside the slice becomes a
   change request.
7. **Commit.** Set the manifest's `status` to `"done"`, run `fwos check` once more (build/slices
   confirms the claimed ACs are proven), and with the user's OK commit the slice with its manifest:
   `Slice <id>: <title>`.

## When something goes wrong

- **The builder wants to change a test**: it can't. Show the user the test and the builder's
  reason. If they agree the test itself is wrong, `fwos tests unlock <file> --reason "<why>"
  --reviewer "<name>"`, fix it, lock it again. The acceptance report lists every unlock.
- **The verify loop doesn't converge** after 3 rounds: stop and ask.
- **A new dependency**: needs a decision row in decisions.md and the registry check from research.
- **A flaky test** (failed, then passed on retry): quarantine it in `.fwos/quarantine.json` with an
  expiry date, and fix it without a fixed sleep. A quarantined test never proves an AC.

## When every slice is done

Run the last slice, the real-use slice: try the whole app as the target user would, end to end. Then
`fwos step accept` and hand back to `fwos:start`.
