# rules

The rule pack, the edit-time check, lenses, knowledge, learnings.

## Owns

The rule pack (one YAML file per rule, each with bad and good fixtures), project overrides and custom rules from `design-system/rules.yaml`, the edit-time check, the review lenses, the UI knowledge and learnings.

## Public entry

`index.ts`: `loadPack`, `effectiveRules`, `matchRule`, `fixtureErrors`, `ruleErrors`, `checks`, `hooks`.

## Skills and agents

Skill `learn`. Agent `lens-reviewer`. Lenses in `lenses/` (states, interaction, accessibility, visual, copy). Knowledge in `knowledge/`. Template `templates/learnings.md`.

## Checks

`rules/pack`. Hook: the PostToolUse edit-time check on only the inserted text.

## Depends on

`kernel` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

A rule that misfires: run its fixtures (`tests/rules.test.ts` runs every pack rule's fixtures). Add the false positive as a `good` fixture, then fix the pattern.
