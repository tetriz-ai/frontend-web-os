# Stack defaults

The architect asks about each area and offers these. For a non-technical user, explain each default
as a consequence ("you can add a desktop app later without a rewrite") and tag it `[ASSUMED]`.

| Area | Default | Why |
|---|---|---|
| Web | Next.js App Router, React, Tailwind v4, TanStack Query, components from the fwos registry (shadcn-compatible) | One framework for pages and data; the scaffold wires it all |
| Electron (planned, not built yet) | Electron Forge + Vite + React, sharing components and feature modules with web | Features written once for both |
| Mac (planned, not built yet) | SwiftUI, a thin Xcode project plus a local Swift package with one target per module | Module walls enforced by the compiler |
| Repo | One pnpm workspace: `apps/<platform>`, `packages/{api-contract,tokens}` (and `packages/features` once a second platform shares code) | Adding a platform later is cheap |
| API contract | OpenAPI 3.1 in `packages/api-contract/openapi.yaml`; fixtures are plain JSON every platform's tests load | One file both sides test against |
| No backend yet | Local mode (browser storage behind the contract) or mock mode (the generated mock fetch) | Data survives a reload; swap in a real API later |
| Data on device | Web: cache only, unless local mode | Simplest correct thing |
| Tests | Vitest + Testing Library (unit, component), Playwright (end to end) | Fast, and real-browser where it matters |
| Storybook | Off. Required states are proven by render tests | Fewer moving parts |
| CI | GitHub Actions calling `fwos check` | The same command everywhere |
| Architecture | Modular monolith | Walls without the cost of services |

## When the user wants something else

- **A stack fwos doesn't support**: allowed. `fwos doctor` lists which checks go off. Log it.
- **Micro-frontends, feature-sliced design, MVVM vs TCA on Mac**: explain the trade-off in 3 lines,
  log the choice, and express it in `modules.json` (it's the one source the walls check reads).
- **Only one platform**: the others are skipped, not stubbed.
- **Mac on any host**: the Mac track stops after the spec and test plan in this release. A macOS
  CI runner does not enable the unavailable Mac build profile.

## Things to lock here

- The app ID (reverse DNS). Changing it after release breaks store identity and data paths.
- For Mac (later): team ID, App Group, minimum macOS (MenuBarExtra needs 13, SwiftData needs 14).
