# discovery

The interview and the brief.

## Owns

Step 1: the interview (one topic at a time, a suggestion with every question) and the brief.

## Public entry

No code. The skill and its text are the module.

## Skills and agents

Skill `discovery`. Knowledge `knowledge/topics.md` (T1 to T16, defaults, corner cases). Template `templates/brief.md`.

## Checks

None. The brief's approval is a hash in the change file (state module).

## Depends on

`kernel` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

Bad questions or a thin brief: the skill and `topics.md`; eval cases `plugin/evals/discovery-*`.
