# Supported versions

fwos 0.1 was tested with these. `fwos doctor` reports the tools it finds.

| Tool | Floor | Tested |
|---|---|---|
| Claude Code | 2.1.278 | 2.1.278 and 2.1.296: install, manifests and agent registration |
| Codex CLI (instead of Claude Code) | 0.155 | 0.155.1 and 0.164.0: install and manifest loading |
| Node.js | 22 | 22.23.4 and 26.12.0 locally; CI matrix 22, 24 and 26 |
| pnpm | 10 | 10.34.5 |
| git | 2.40 | 2.50 |

Development uses Node 24.11 or newer for the pinned lint tools and direct TypeScript scripts.
The repository's `.nvmrc` selects Node 24.11.0 with `nvm use`.
Host installation and registration checks do not prove a model follows the workflow or that every
hook is trusted and active.

The web scaffold pins these ranges:

| Package | Range |
|---|---|
| next | ^16.4 |
| react, react-dom | ^19.3 |
| tailwindcss, @tailwindcss/postcss | ^4.3 |
| @tanstack/react-query | ^5.104 |
| typescript | ^6.0 |
| vitest, vite, @vitejs/plugin-react, jsdom | ^5.0, ^8.3, ^6.1, ^30 |
| @playwright/test, @axe-core/playwright | ^1.63, ^4.13 |
