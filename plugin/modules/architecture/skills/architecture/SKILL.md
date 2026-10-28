---
name: architecture
description: 'Step 3 of Frontend Web OS. Captures the user''s stack preferences (with defaults explained as consequences), plans a modular monolith, writes docs/app/modules.json and decision rows, and checks the walls. Loaded by /fwos:start when the step is architecture.'
user-invocable: false
---

# Step 3: Architecture

Goal: a plan the build can follow, with the user's preferences captured first.

Read ${CLAUDE_PLUGIN_ROOT}/kernel/knowledge/house-rules.md,
${CLAUDE_PLUGIN_ROOT}/modules/architecture/knowledge/stack-defaults.md and
${CLAUDE_PLUGIN_ROOT}/modules/architecture/knowledge/modular-monolith.md.
`fwos` means `node "${CLAUDE_PLUGIN_ROOT}/dist/fwos.mjs"`.

## 1. Preferences

Ask about each area in stack-defaults.md in one round, each with the default and its consequence.
A technical user may change any of them; a non-technical one usually says "defaults". Tag every
default you take `[ASSUMED]` in decisions.md.

Ask especially: where data lives (the brief's T6) and whether a backend exists. fwos builds no
backend: the answer picks local mode, mock mode, or the user's API.

## 2. Modules

From the brief's core jobs and features, propose modules: one feature module per user-facing
capability, plus the shared modules from the scaffold's defaults. Show them as a short list with
who may depend on whom, and why. Keep it small: 2 to 6 feature modules for a first release.

Write `docs/app/modules.json` (format in modular-monolith.md). Run `fwos check walls`: before the
scaffold it reports OFF ("0 files matched"), which is fine; a FAIL means modules.json itself is
invalid (unknown dependency, cycle): fix it.

## 3. The contract

If the app reads or writes data, sketch the API in `packages/api-contract/openapi.yaml` (OpenAPI
3.1, one `operationId` per operation) with schemas under `components.schemas`. Add one fixture per
state the screens need, named `<operationId>.<variant>.json` and holding `{ "status": 200, "body": ... }`
(variants like `default`, `empty`, `error`). Fixtures are synthetic: no real personal data. Then
`fwos check contract` validates every fixture against the schemas.

(The scaffold creates the empty contract later; if it isn't there yet, write these files now:
`writeYours` semantics apply, fwos won't overwrite them.)

## 4. Decisions

One row per decision in `docs/app/decisions.md` (template:
${CLAUDE_PLUGIN_ROOT}/modules/architecture/templates/decisions.md): stack, data mode, modules, the
app ID, anything off-default and which checks that turns off.

## Approval

Show the module list, the data mode and the stack in 6 lines. "Approve the architecture?"
Yes: `fwos approve architecture --by "<name>"`, then `fwos step design-system`.
The user may skip with defaults: `fwos skip architecture --reason "<why>" --by "<name>"` (the
scaffold's default modules.json applies).
