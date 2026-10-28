# Features

One folder per feature, e.g. `src/features/reading-list/`. Each has one public entry,
`index.ts`; other code imports only that file, and only if `docs/app/modules.json` allows it.
`fwos check walls` enforces both.

A feature usually holds: `components/` (views built from `@/shared/ui`), `data/` (a repository that
matches the API contract, so mock, local and real backends swap), `model/` (logic, no UI), and tests
named with the AC they prove (`@AC-<feature>-<n>`).
