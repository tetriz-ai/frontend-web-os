---
name: web-profile
description: 'Frontend Web OS conventions for building and testing a Next.js App Router app with Tailwind v4, Vitest and Playwright. The builder, test writer and QA explorer load this profile before working on a web app.'
user-invocable: false
---

# Web profile

## Layout

```
apps/web/
  app/                    routes (thin: they wire features to URLs); app/(fwos-screens)/fwos-screens/ is the dev-only screens browser
  src/features/<name>/    one feature per folder; index.ts is its only public entry
  src/screens/            screens on fake data, one per ia.json page, registered in registry.tsx
  src/shared/ui/          registered components (design-system/components.json)
  src/shared/lib/         cn() and the one date/number formatter
  src/shared/data/        the query provider
  e2e/                    Playwright tests
packages/api-contract/    openapi.yaml, fixtures/<operationId>.<variant>.json, generated/mock-fetch.ts
packages/tokens/generated/  tokens.css and theme.css (generated; never edit)
```

Imports: `@/features/<name>` (never deeper), `@/shared/ui`, `@/shared/lib`. `fwos check walls`
enforces `docs/app/modules.json`.

## Styling

Use slot classes for design values (the scaffold clears the default colour palette): `bg-surface`,
`bg-surface-elevated`, `bg-surface-subtle`, `text-fg`, `text-fg-secondary`, `text-fg-muted`,
`border-border`, `bg-brand`, `text-on-brand`, `bg-accent`, `text-critical` + `bg-critical-bg` (and
warning, caution, info, success), `bg-hover`, `bg-selected`, `outline-focus`, `rounded-sm|md|lg|full`,
`font-sans|mono`, type roles `text-display|title|heading|subheading|body|body-strong|label|caption|overline|code|metric`.
Spacing uses Tailwind's scale (`p-4`, `gap-2`); avoid arbitrary spacing and widths in app code.
For colours, type sizes, fonts and radii, use slots instead of raw values or palette classes.
`fwos check` rejects the raw values its token scan recognizes, including arbitrary values in those
categories, and the edit hook warns as you type. It does not check padding, margin, gap or width:
arbitrary spacing and widths remain a review concern.

Dark mode follows `prefers-color-scheme`, or `data-theme="dark"` on `<html>`.

## Data

- A feature's repository implements the contract's operations. Local mode stores data in the
  browser behind that same interface; mock mode uses `createMockFetch()` from
  `packages/api-contract/generated/mock-fetch.ts` (fail-closed: unexpected requests throw).
- Server state through TanStack Query. Skeletons only on first load, never on refetch.
- Dates and numbers only through `formatDate` / `formatNumber` / `formatRelative` from `@/shared/lib`.

## Tests

- Unit and component: Vitest + Testing Library, `src/**/*.test.tsx`. `pnpm test`.
- End to end: Playwright, `e2e/*.spec.ts`, against a production build on port 3210.
  `pnpm e2e` (set `FWOS_E2E_DEV=1` to use `next dev` while iterating).
- Results go to `.fwos/local/results/*.xml`, where `fwos check` reads them.
- Names carry tags: `@AC-<feature>-<n>`, `@state:<id>:<state>`, `@TC-default-<row>`.
- `e2e/fwos-states.spec.ts` and `e2e/fwos-ia.spec.ts` are fwos's harness: never edit them (`fwos
  harness` restores them, and a run of an edited one doesn't count). They render every state
  fixture in the screens browser (`[data-fwos-fixture]` marks what they read) and open every route
  as each role and flag setting through a test cookie, keeping each run in `.fwos/local/runs/`.
  The e2e server sets `FWOS_SCREENS=1` and `FWOS_TEST_ACCESS=1` for them; a deployment sets neither.
- Query by role and label (`getByRole('button', { name: 'Save' })`), never by class or test id
  unless there's no accessible name.
- In Playwright, scope alert and status queries to the page's landmark:
  `page.getByRole('main').getByRole('alert')`. Next.js renders a hidden route announcer with
  `role="alert"` on every page, so a bare `page.getByRole('alert')` matches two elements.
- `pnpm typecheck` checks tests too; `next build` uses `tsconfig.build.json`, which leaves tests
  out, so a red run (tests before the code exists) can still build and serve the app.
- Wait for conditions, never fixed sleeps. Fake timers for time.

## The verify loop (Playwright)

For each changed screen: open it in light and dark (`colorScheme`), screenshot to
`.fwos/local/evidence/`, read the console (no errors), check hit targets are at least 24x24 CSS px,
count network requests, and confirm the screen is reachable from `/` through the nav or its parent.

## Next.js docs

For the installed Next.js version, read `node_modules/next/dist/docs/` rather than relying on
memory. The scaffold sets `agentRules: false`, so `next dev` doesn't write an `AGENTS.md`.

## Security baseline

Set a strict Content-Security-Policy through server response headers (`next.config.ts` or
proxy/middleware), or a CSP meta tag or host-applied `public/_headers` for a static export. Add
origins explicitly and confirm the chosen host sends configured headers. No secrets in client
code: only `NEXT_PUBLIC_` values that are safe to publish. Never commit `.env`.
