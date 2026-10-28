# Architecture

Where code lives, how parts talk to each other, and what must never reach the browser. Rule ids are stable: lenses, checks and test names cite them.

## Structure

**R-arch-1: No business logic in UI components.**
Components render props and call hooks. Calculations, validation rules, permission checks and data shaping live in the feature's `model/` (pure functions) or `data/` (fetching and caching) layer, where a unit test reaches them without rendering anything.
- Do: `const total = orderTotal(lines)`, imported from `model/`.
- Don't: tax and discount maths written inline in a `.tsx` file.

**R-arch-2: One folder per feature, with one public `index.ts`.**
`features/<name>/` holds its `ui/`, `model/`, `data/` and tests. Its `index.ts` exports only what other code may use. Everything else in the folder is private.

**R-arch-3: Features import each other only through that index, and only if `modules.json` allows it.**
No deep imports into another feature. If feature A needs feature B, add the edge to `modules.json` first. No cycles. If two features need the same thing, move it to `shared/`.
- Do: `import { InvoiceBadge } from '@/features/billing'`
- Don't: `import { calcTax } from '@/features/billing/model/tax'`

**R-arch-4: Shared code lives in `shared/`, split into `ui`, `lib` and `types`.**
`shared/` never imports from `features/`. Move something there only once two features use it, or when it's a true primitive (a button, the formatter).

**R-arch-5: Data access sits behind a repository that matches the API contract.**
Each feature reads and writes through a repository interface whose types match the API contract. Mock, local and real backends all implement it, and one place at startup picks which. Swapping backends changes no component. UI code never calls `fetch`, storage or IndexedDB directly.
- Don't: a component that reads `localStorage.getItem('orders')`.

**R-arch-6: No theme flash on load.**
Set the theme class or `data-theme` on `<html>` before first paint, with a small static script in the root layout's `<head>` that reads the saved choice or `prefers-color-scheme`. Don't wait for hydration to apply it. In Next.js, add `suppressHydrationWarning` to `<html>`.
- Don't: apply the theme in a `useEffect`, so dark-mode users see a white flash on every load.

## Security and privacy

**R-security-1: No personal data in logs.**
Don't log names, emails, phone numbers, addresses, tokens, or whole request and response bodies. Log ids and event names. Redact in the shared logger, not at each call site.
- Do: `log.info('order.saved', { orderId })`
- Don't: `console.log('saved', user, order)`

**R-security-2: No secrets in client code.**
Anything shipped to the browser is public. Only `NEXT_PUBLIC_` variables reach client code, and only values that are safe to publish (a public site key, a base URL). Secrets stay in server-only code and in `.env` files that aren't committed.
- Don't: `NEXT_PUBLIC_API_SECRET`, or a secret read inside a `'use client'` file.

**R-security-3: Raw HTML only through one audited sanitiser.**
Render text wherever you can. If you must render HTML from data (rich text, converted markdown), pass it through the single sanitiser in `shared/lib` with an allowlist of tags and attributes. That's the only place allowed to set inner HTML.
- Don't: `dangerouslySetInnerHTML={{ __html: comment.body }}`

**R-security-4: Links built from data are checked.**
An `href` from user or API data must be `http:`, `https:`, `mailto:` or a relative path. Block `javascript:` and `data:` in the same shared helper.

## Next.js boundaries

**R-arch-7: Mark a component `'use client'` only when it needs to.**
Add it when the component uses state, effects, event handlers or browser APIs. Keep the client boundary as low in the tree as you can, so pages and layouts stay on the server and ship less code.
- Don't: `'use client'` at the top of a page just because one button inside it has an `onClick`.

**R-arch-8: API types come from the contract, not from each component.**
Generate or define the request and response types once, next to the contract fixtures (R-tests-4). Repositories and hooks use those types. Components get view types shaped by `model/`, not raw API payloads.
