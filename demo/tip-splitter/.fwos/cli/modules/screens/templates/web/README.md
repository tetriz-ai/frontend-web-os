# {{APP_NAME}}

Built with Frontend Web OS (fwos). Keep the two header lines on the starter files: they name the
licence the starter is under. Everything you build on them is yours.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

## Check it

```bash
pnpm test           # unit and component tests (results in .fwos/local/results/)
pnpm e2e            # end-to-end tests against a production build, fwos's harness included
pnpm check          # fwos check: PASS, FAIL or OFF for every check, with the reason
```

`apps/web/e2e/fwos-states.spec.ts` and `fwos-ia.spec.ts` are fwos's own tests: they render every
state on fake data and open every page as each role and flag setting, and `fwos check` reads their
runs. Don't edit them (`pnpm exec fwos harness` puts them back). The end-to-end server sets
`FWOS_SCREENS=1` and `FWOS_TEST_ACCESS=1` for them: never set either for a real deployment.

## Where things live

| Path | What |
|---|---|
| `docs/app/` | The brief, spec, test plan, decisions, `ia.json` and `modules.json` |
| `design-system/` | Your tokens and component registry |
| `apps/web/src/features/<name>/` | One feature per folder; other code imports only its `index.ts` |
| `apps/web/src/shared/ui/` | Registered components, styled only through design-system slots |
| `apps/web/src/shared/session/` | Who is asking, and `guardPage`, which every page calls first with its ID from `ia.json` |
| `packages/api-contract/` | `openapi.yaml` and the JSON fixtures every test shares |
| `packages/tokens/generated/` | Generated from `design-system/`; don't edit (`pnpm tokens` rebuilds it) |

Screens and components in every state, on fake data, are at `/fwos-screens` while `pnpm dev` runs.
