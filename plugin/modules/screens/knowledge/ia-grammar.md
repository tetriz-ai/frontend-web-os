# ia.json: the information architecture as data

`docs/app/ia.json` lists every screen with a stable ID. The nav is rendered from it, and each page
calls `guardPage('<id>')` from `@/shared/session` first: that declares which page the route is, and
lets in only the roles and flag setting ia.json shows it to (anyone else gets the not-found page).
The IA check compares ia.json with the real app's routes in both directions, the page ID each route
declares, redirects, and a nav link to every nav page (the page at `/` aside). It fails a limited
page whose route has nothing that could turn anyone away. fwos's IA harness, which `pnpm e2e` runs,
opens every static route as each role and flag setting and reads the nav, and from its runs the
check fails a page shown to someone ia.json hides it from, one a role can't open, and a nav page
missing from the nav. Without a fresh run, who sees a limited page is off, named.

`fwos ia diff` shows what a change moved, added, hid or exposed, per role and flag. The diff compares
two versions of ia.json, not the app: a flag added, removed or swapped on a page shows with the roles
it hides the page from or exposes it to, and the flag setting that happens under.

```json
{
  "schema": 1,
  "roles": ["user"],
  "flags": [],
  "pages": [
    { "id": "list", "title": "Reading list", "route": "/", "kind": "nav", "order": 1,
      "states": ["loading", "empty", "filtered-empty", "error", "ready"], "deepLink": "/" },
    { "id": "item", "title": "Article", "route": "/items/[id]", "kind": "drilldown", "parent": "list",
      "states": ["loading", "not-found", "ready"] }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Stable, kebab-case. It never changes when the page moves. |
| `route` | The URL (dynamic segments as `[id]`). Desktop surfaces use `surface`: window, scene, menu-item, menu-bar-extra, settings. |
| `kind` | `nav` (in the nav), `drilldown` (reached from `parent`), `redirect` (to `redirectTo`), `unlinked` (reachable only by URL, with `unlinkedReason`). |
| `order` | Position in the nav. |
| `visibleTo` | Roles that see it; default all. A child can't be visible to a role its parent hides from. A role it hides from gets the not-found page, unless the page lists a `no-permission` state to show them instead. |
| `flag` | A feature flag from `flags`. |
| `states` | Every state the page must show. Each needs a passing test tagged `@state:<id>:<state>`, and must render as its name says under fwos's state harness (loading is busy, an error has an alert and none of the ready rows, an empty state announces itself). |
| `deepLink` | The link that opens it directly; tested signed in and signed out once sign-in exists. |

## What each state must render

fwos's state harness opens each state's fixture (the page's screen from `src/screens/registry.tsx`,
or a component's from `src/screens/components.tsx`) and judges what renders by the state's name.
`loading`: something marked `aria-busy="true"`, no alert. `empty`, `zero`, `filtered`,
`filtered-empty`: a `role="status"`, as `EmptyState` renders. `error`: a `role="alert"`. None of
these three shows the ready state's rows: an error on first load keeps no stale data. `ready` and
`default`: content, nothing busy. `disabled`: a disabled control. `invalid`: `aria-invalid="true"`.
`critical` and `info`: an alert, a status. `offline`, `no-permission` and `partial`: a status or an
alert saying so. Any other name: something, rendered differently from ready. A fixture that ignores
its state renders the same for each and fails.

## States to consider for every page

loading (first load only), empty (zero: nothing yet), filtered-empty (filters hide everything),
error (a reason and a retry), offline, no permission, partial data, ready. Plus any the feature
checklist adds (not-found for drill-downs, saving, saved).

## The check refuses

A duplicate ID or route, an unknown role or flag, a missing parent, a drill-down whose parent chain
never reaches a nav page, an unlinked page with no reason, a page with no states.
