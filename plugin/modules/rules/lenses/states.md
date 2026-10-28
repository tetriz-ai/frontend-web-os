---
name: states
looks-for: Missing or wrong loading, empty, error, offline, permission and partial-data states in changed UI.
---

# States lens

Review the diff for the states a user can land in. You're read-only: report, don't edit. Rules live in ${CLAUDE_PLUGIN_ROOT}/modules/rules/knowledge/states.md. Follow each hook a changed component calls, since the bug is often in which flag it reads.

## What to look for

1. **Skeleton on refetch (R-states-1).** A loading branch keyed on `isFetching`, `isValidating` or a generic `loading` flag without checking that there's no data yet.
2. **Old data dropped on refresh (R-states-2).** `setItems([])` before a refetch, a query key change that starts from empty with no placeholder data, or a refreshing region with no `aria-busy`.
3. **One empty branch for every case (R-states-4, R-states-5).** A single `items.length === 0` branch that ignores active filters or search, or can't tell first use from cleared.
4. **0 treated as missing (R-states-6).** `value || ...`, `!value`, `value ? a : b` or `if (!count) return null` on numbers.
5. **Deltas without a base (R-states-7).** A percent change with no guard for a missing or 0 prior value, or shown with no "vs ..." label.
6. **Errors with no reason or no retry (R-states-8).** A `catch` that only logs, an error branch that renders nothing, a full-page error for one failed panel, a Retry that doesn't re-run the same request.
7. **Wrong surface (R-states-9).** A failure shown only in a toast that auto-dismisses, or a persistent banner for a one-off success.
8. **Offline, no permission, partial (R-states-10 to R-states-12).** A 403 rendered as an empty list; a `Promise.all` where one rejection blanks everything; a total from partial data with no note.
9. **Edge cases (R-states-13).** Long strings with no truncate or wrap, plurals built by adding "s", unbounded lists rendered in full, a submit handler with no in-flight guard.
10. **Untested states (R-tests-11).** A new state with no test tagged `@state:<id>:<state>`.

## How to report

One finding per issue, most severe first:

```
<file>:<line> [blocker|should-fix|nit] R-states-<n>
User sees: <what happens on screen, in one sentence>
Fix: <the smallest change that fixes it>
```

- **blocker**: data looks wrong or gets lost. 0 shown as "No data", an error swallowed, a double submit that creates duplicates, a refresh that blanks good data.
- **should-fix**: a state is missing or generic, but nothing shown is wrong. One empty state for all cases, no retry, a skeleton flash.
- **nit**: polish inside a state that already works.

If the diff is clean for this lens, say so in one line.

## Not this lens

- The wording of messages beyond "has a reason and a retry": the copy lens.
- Focus, labels and ARIA other than `aria-busy`: the accessibility lens.
- How skeletons and empty states look and line up: the visual lens.
- Anything `fwos check` already fails on: every rule in ${CLAUDE_PLUGIN_ROOT}/modules/rules/pack/, and the raw colours, palette classes, sizes, fonts and radii the `design-system/tokens` check catches.

## Planted-defect example

```tsx
const { data, isFetching } = useOrders(filters);
if (isFetching) return <OrdersSkeleton />;
return <OrdersTable rows={data} />;
```

Expected finding: `OrdersPanel.tsx:2 [should-fix] R-states-1`. User sees: the table blinks to a skeleton every time a filter changes or the poll fires, and loses its scroll position. Fix: show the skeleton only when `!data`, and a small refresh indicator otherwise.

Lint can't catch this: the code is valid, only the choice of flag is wrong.
