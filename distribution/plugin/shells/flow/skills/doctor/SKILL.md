---
name: doctor
description: 'Read-only health report for Frontend Web OS: tools, platforms, adapters, the design system, and every check as on or off with the reason. Use when the user runs /fwos:doctor, or when a check is off and they want to know why.'
---

# /fwos:doctor

`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

1. Run `fwos doctor`. Show its output as is, in a code block.
2. Then explain, briefly:
   - Each MISSING tool and its fix. Never run `sudo` or a global install; print the command.
   - Each adapter that isn't at all 3 levels (loaded, matched real app data, active check) and why.
   - Each OFF check and what turns it on (usually a step that hasn't happened yet, or a blank slot).
   - Platforms marked "not in this release": they can be planned now, built later.
3. Change nothing. Doctor is read-only.
