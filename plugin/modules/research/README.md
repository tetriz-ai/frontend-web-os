# research

The researcher agent, feature checklists, registry checks.

## Owns

Step 2: one researcher agent in four modes (market, features, feasibility, libraries), run in parallel, and research.md.

## Public entry

No code.

## Skills and agents

Skill `research`. Agent `researcher` has only WebSearch and WebFetch in Claude Code. In Codex it uses a read-only filesystem sandbox, with web-only behavior instructed in its prompt rather than enforced by a tool allowlist. The main session embeds feature and registry guidance in its tasks. Knowledge: `knowledge/features/*.md` (10 feature checklists) and `knowledge/registry-checks.md` (live npm checks against made-up and typosquatted packages). Template `templates/research.md`.

## Checks

None.

## Depends on

`kernel`, `discovery` Enforced by `fwos check walls` on the plugin itself (see `plugin/modules.json`).

## Debugging

A finding with no source or a package that doesn't exist: the agent's rules in `agents/researcher.md` and `registry-checks.md`; eval cases in `plugin/evals/`.
