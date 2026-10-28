# States

Every screen that shows data has more than one state. Build each one on purpose and test it (tag the test, see R-tests-3). Rule ids are stable: lenses, checks and test names cite them.

## Loading

**R-states-1: Show a skeleton on first load only, never on a refetch.**
A skeleton means "nothing to show yet". Once data has rendered, a refetch, poll or filter change keeps it on screen so the page doesn't jump and the user keeps their place.
- Do: `if (!data && isLoading) return <OrdersSkeleton />`
- Don't: `if (isFetching) return <OrdersSkeleton />`

**R-states-2: Keep old data visible while it refreshes, and show that it's refreshing.**
Add a small spinner or "Updating..." near the heading and set `aria-busy="true"` on the region. If the refresh fails, keep the old data and show the error beside it with its age ("Last updated 5 min ago").

**R-states-3: Make the skeleton match the loaded layout, and don't flash it for fast loads.**
Same row height, column count and card size as the real view, so nothing shifts when data lands. Wait about 300 ms before showing it, so a quick response goes straight to content.

## Empty

**R-states-4: Design the three kinds of zero state separately.**
- First use (never had any): say what will appear here and offer the one action that adds the first item.
- Nothing yet after use (no new items today): one calm line. No big call to action.
- Cleared by the user (they archived or deleted everything): confirm it worked, and link to the archive or offer undo.
- Don't: one generic "No data" for all three.

**R-states-5: A filtered-empty result isn't a zero state. Offer to clear the filters.**
Say that filters are hiding results and give a one-click way out. Keep the filter controls on screen.
- Do: "No orders match these filters." with a "Clear filters" button.
- Don't: show the first-use "Create your first order" panel while filters are on.

**R-states-6: 0 is a value, not "no data".**
Keep `0` and `null` apart from the API to the screen. A real zero shows as "0" (or "$0.00"). Missing data shows a placeholder with a reason.
- Do: `value === null ? 'Not available' : formatNumber(value)`
- Don't: `value || 'No data'` (turns a real 0 into "No data")

**R-states-7: A delta needs a prior period. Without one, don't show it.**
Label what it's compared to ("vs last week"). If the prior value is missing or 0, a percent change means nothing: show "New" or nothing at all.
- Don't: "+Infinity%", "NaN%", or a green arrow with no comparison label.

## Problems

**R-states-8: Errors say what went wrong and offer a retry.**
Use the error formula (R-copy-1) and a Retry button that re-runs the same request. A failed panel shows its error in place. It doesn't blank the whole page.
- Don't: "Something went wrong." with no reason and no next step.

**R-states-9: Toasts confirm. Banners report problems that persist.**
A toast is a short confirmation of something the user just did ("Saved", "Link copied"). It goes away on its own, so it never holds the only copy of an error. A banner stays until the problem is fixed or dismissed (lost connection, expired session, failed sync).
- Don't: show "Payment failed" in a toast that fades after 4 seconds.

**R-states-10: Handle offline on purpose.**
Detect it (the `offline` event plus failed requests), show a persistent banner, keep loaded data readable, and disable or queue actions that need the network. When the connection is back, clear the banner and refetch.

**R-states-11: No permission is its own state, not an error or an empty list.**
Say the user can't see this and how to get access. Hide actions they can't take, or disable them with a reason. A 403 never renders as "Nothing here yet".

**R-states-12: Label partial data. Don't hide the gap.**
When some sources or periods failed or are still processing, show what loaded and say what's missing ("2 of 5 accounts couldn't load. Retry"). A total built from partial data says so next to the number.

## Edge cases

**R-states-13: Check every view against this list before calling it done.**
- Very long text: a 200-character name or an unbroken string truncates or wraps without breaking the layout, and the full value is reachable (R-components-6).
- 1 item: singular copy ("1 file", not "1 files") and no layout that only works with many.
- 1000 items: paginate or virtualise, and scrolling, sorting and filtering stay quick.
- Slow network: throttle to a slow connection. Loading states appear, nothing sits blank or frozen.
- Double submit: a second click while saving does nothing (button disabled or request deduped), so there are no duplicate records.
