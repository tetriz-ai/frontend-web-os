---
name: status
description: 'Show where a Frontend Web OS project stands: the current change and step, pending questions, stale approvals and docs, locked tests, and which checks are off and why. Use when the user runs /fwos:status or asks where the project is.'
---

# /fwos:status

`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

1. Run `fwos status` and `fwos next --json`.
2. Run `fwos doctor --json` and pick out the checks with `on: false`.
3. Reply in this shape, short:
   - **Adoption** (an adopted app): the level, and each capability that is off with what turns it
     on, verbatim from `fwos status`.
   - **Change**: id, title, step, section and pending questions if any, and its links.
   - **Approvals**: one line each; mark stale ones loudly and name the file that changed.
   - **Checks off**: each with its reason, verbatim from doctor.
   - **Locked tests**: count, and any changed without an unlock.
   - **Spend**: per step, if recorded.
   - **Next**: the `action` sentence from `fwos next`.

Don't change anything. This is read-only.
