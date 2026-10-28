---
name: discovery
description: 'Step 1 of Frontend Web OS. Interviews the user one topic at a time, with a suggested answer for every question, and writes docs/app/brief.md with every default tagged [ASSUMED]. Loaded by /fwos:start when the current step is discovery.'
user-invocable: false
---

# Step 1: Discovery

Goal: understand every thought behind the first prompt before anything is designed.

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md (how to ask) and
${CLAUDE_PLUGIN_ROOT}/modules/discovery/knowledge/topics.md (the 16 topics, defaults and corner
cases). `fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

## Before the first question

1. Read what's already decided: the first prompt, and `docs/app/brief.md` if this is a later change
   (a new-feature change asks only about the new feature).
2. Say up front, once, what fwos doesn't build: phone apps (it offers responsive web or a PWA) and
   backends (it offers a contract with mocks, local mode, or the user's existing API).
3. Say how it works: "I'll go topic by topic, 3 to 5 questions each, each with my suggestion. One
   word confirms it. 'Use your defaults' works any time."

## The interview

For each topic in topics.md that the prompt didn't already answer:

1. Ask 3 to 5 questions. Each one: the question, **Suggestion:** your answer, **Why:** one line,
   then "or your own take".
2. Record progress: `fwos change cursor --section T<n> --pending "Q-<a>,Q-<b>"`.
3. Play back what you heard in 2 or 3 lines; ask "right?".
4. Fix anything they correct before moving on.

After round 3, offer to default the remaining topics. With `--quick`, ask only T1 to T8.

## Write the brief

Write `docs/app/brief.md` from ${CLAUDE_PLUGIN_ROOT}/modules/discovery/templates/brief.md.

- The "What you're approving" box: 5 plain lines a non-technical person can approve.
- Every default you took goes under **Assumed**, tagged `[ASSUMED]`, with its reason.
- Features carry a priority: must-have, later, or not doing. The first release is the 3 core jobs.
- Record each real decision (a fork the user chose) as a row in `docs/app/decisions.md`:
  `| D-<n> | <date> | discovery | <decision> | <why> | <who> |`. Create the file with that header
  if it doesn't exist.

## Approval

Show the "What you're approving" box and the Assumed list. Ask: "Approve the brief?"

- Yes: `fwos approve brief --by "<their name>"`. Then `fwos step research` and hand back to
  `fwos:start`.
- Changes: edit, show only what changed, ask again.
- Rejected twice: stop regenerating, ask what's wrong, offer to approve section by section.
