---
name: learn
description: 'Turn repeated corrections on a Frontend Web OS project into the lightest lasting fix: a check rule in rules.yaml, a decision row, a lens note or a code comment. Use when the user runs /fwos:learn, or after correcting the same thing twice.'
---

# /fwos:learn

`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

1. Read `docs/app/learnings.md` (create it from
   ${CLAUDE_PLUGIN_ROOT}/modules/rules/templates/learnings.md if missing). If the user just corrected
   something for the second time, add or update its row first.
2. For each open learning, propose the lightest home that will hold, with one line of why:

| The learning is | Home | How |
|---|---|---|
| Mechanical (a pattern in code that's always wrong) | a check rule | Add it under `custom:` in `design-system/rules.yaml` with a pattern, a message and passing `bad`/`good` fixtures. `fwos check rules` validates the fixtures. |
| Something that must hold but needs judgement | a rule | A line in `docs/app/decisions.md` that the builder reads, or a project `CLAUDE.md` rule |
| Something reviewers keep missing | a lens row | A row in the project's own lens notes (`docs/app/lenses.md`), passed to the lens reviewer |
| A one-off | a code comment | A comment at the spot, saying why |

3. The user picks. Apply only what they pick, record it in the row's "Home (picked)" column, and run
   `fwos check` to prove a new check rule fires on its bad fixture and stays quiet on the good one.

That's the path from prose, to a soft review, to a hard gate.
