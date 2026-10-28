# Security model

Report a vulnerability privately, as [SECURITY.md](../SECURITY.md) says, never in a public issue.

fwos runs inside Claude Code or Codex with the permissions you give it. This page says what it
defends against, and how.

| Risk | What fwos does |
|---|---|
| Web content steering an agent during research | In Claude Code, the researcher has only WebSearch and WebFetch, with no file, shell or edit tools. In Codex, its generated agent uses a read-only filesystem sandbox, which still permits local reads and shell execution; web-only behavior and treating pages as data are prompt instructions, not enforced tool isolation. The main session supplies sanitized research content and writes the results. |
| Generated code doing something unsafe | Every change goes through `fwos check`: a Content-Security-Policy, no secrets in client code, no committed `.env`, the rule pack. fwos never deploys, signs or submits. |
| Hooks as an attack surface | Hooks run the bundled `dist/fwos.mjs`, which has no runtime dependencies and makes no network calls. They read `.fwos/` and the edited file's path, and stay silent outside fwos projects. |
| Secrets | Keep secrets out of chat and in gitignored env files. Runtime fingerprints read input bytes locally, including app env files, without printing or transmitting their values. Your own test commands use the app environment and may connect to its configured services. |
| Tests bent to pass | `fwos check` compares locked tests by hash, whatever tool edited them, and the lock records against the last commit. fwos's own harness files count only as fwos ships them, and their runs only on the code they ran on. |
| The test switches in a deployment | The scaffold's end-to-end server sets `FWOS_SCREENS=1`, which serves the dev-only screens browser, and `FWOS_TEST_ACCESS=1`, which lets a cookie pick the role and flags. Both are for the tests: a real deployment sets neither, so a visitor can't choose their own role. |

The edit hooks are a guardrail, not a security boundary. A shell command can write past them,
and the commit check and CI are the backstop.

Approvals aren't authenticated. `fwos approve` records the name it is given, from any shell,
the agent's own included. An approval proves what was approved (its hash), not who said yes, so
review approvals in the change file's history the way you review any commit.
