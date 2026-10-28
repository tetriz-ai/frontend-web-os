# Tip Splitter

Built with Frontend Web OS (fwos). This app is the demo in the Frontend Web OS repository, and
the repository's [LICENSE](../../LICENSE) covers all of it.

## Historical workflow records

The documents and approvals in `docs/app/` preserve the workflow used to build this demo. Its
spec and decision D-29 use an older meaning of `Proven against: local` tied to browser tests.
Current fwos uses that field only for data provenance: `mock` means the generated mock fetch,
`local` means device data or no data layer, and `real` means a real backend. Test level is a
separate choice in the test plan. This calculator has no data layer, so its current provenance
is `local`; its browser checks separately demonstrate browser behavior.

This note does not rewrite the approved spec, decisions, test plan or generated acceptance
report, and does not create a new approval. A future revision of those bound documents must go
through the current spec review, evidence refresh and human approval workflow.

The checked-in keyboard smoke test verifies the skip link and main-content navigation. It does not prove every calculator control works using only the keyboard; that broader plan item still needs a recorded walkthrough or a complete test.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

## Check it

```bash
pnpm test           # unit and component tests (results in .fwos/local/results/)
pnpm e2e            # end-to-end tests against a production build
pnpm check          # fwos check: PASS, FAIL or OFF for every check, with the reason
```

## Where things live

| Path | What |
|---|---|
| `docs/app/` | The brief, spec, test plan, decisions, `ia.json` and `modules.json` |
| `design-system/` | Your tokens and component registry |
| `apps/web/src/features/<name>/` | One feature per folder; other code imports only its `index.ts` |
| `apps/web/src/shared/ui/` | Registered components, styled only through design-system slots |
| `packages/api-contract/` | `openapi.yaml` and the JSON fixtures every test shares |
| `packages/tokens/generated/` | Generated from `design-system/`; don't edit (`pnpm tokens` rebuilds it) |

Screens in every state, on fake data, are at `/fwos-screens` while `pnpm dev` runs.
