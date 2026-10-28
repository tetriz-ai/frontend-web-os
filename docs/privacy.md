# Privacy

fwos has no telemetry and no servers of its own. It collects nothing about you or your project.

| Traffic | When it happens |
|---|---|
| Model calls | Every step, through Claude Code or Codex, to the model you already use |
| Web searches and page fetches | The research step only. Turn it off with `--no-research`, or say skip. |
| npm registry lookups | Research checks library candidates live; off with research |
| Package and browser downloads | `pnpm install` and Playwright's Chromium, each after fwos asks |

What fwos writes stays on your machine: `docs/app/`, `design-system/` and `.fwos/`, plus test
results and logs in `.fwos/local/`, which is gitignored.

For a confidential idea, fwos asks once whether research may use the idea's words in searches.
In the apps fwos builds, analytics are off by default. When a brief asks for them, the spec gets
an events list, consent comes first for EU users, and an acceptance criterion proves nothing is
sent before consent.
