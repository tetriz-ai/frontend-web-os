# Search

Lets a person find a specific item fast by typing a few words, then narrow the results with filters and sorting.

## Sub-features a complete version needs

- One search box in a fixed place, reachable by keyboard from anywhere in the app.
- Results update as the person types, after a short pause, with the matching words highlighted.
- Forgiving matching: upper and lower case, accents ("cafe" finds "café"), extra spaces, and small typos if discovery asks for them.
- Filters (type, date, owner, status) shown as chips that can be removed one at a time, plus "Clear all".
- Sort options (most relevant, newest, oldest, name), with the current choice visible.
- The words, filters and sort live in the page address, so a search can be shared, bookmarked and restored with Back.
- Recent searches, with a way to remove one or clear them all.
- Suggestions while typing (matching item names) that can be picked with the arrow keys.
- Paging or "Load more" for long lists, with the total count shown when it is known.
- A scope choice: this area only (for example, this folder) or everywhere, with the scope shown.
- Results respect permissions: a person never sees an item they cannot open, not even its title.
- Backend split (fwos does not build backends):
  - Frontend owns: the box, the typing pause, cancelling old requests, highlighting, filter UI, address state, recent searches kept on the device.
  - Data already on the device can be searched in the app with a small local index.
  - Large or shared data needs a hosted search service or existing API for matching, ranking, permission checks and counts.

## States every screen must show

- Before search: recent searches or helpful starting points, not a blank panel.
- Initial loading: placeholders while the first results arrive, with no prior result rows.
- Refreshing: keep the previous results visible with a light updating hint until the new ones arrive.
- Empty (zero): no items exist yet, with a button to create the first one.
- Filtered-empty: "No results for 'term' with these filters", with buttons to remove filters or search everywhere.
- Error (with reason + retry): the search service did not answer, with Retry and the words kept in the box.
- Offline: search runs on what is stored on the device and says the results may be incomplete.
- Partial data: some sources answered and some did not, with a note naming what is missing.
- Too short: a one-letter query waits or says more letters are needed (if that rule is chosen).

## Edge cases

- The person types fast: only the answer to the latest query is shown, and older answers that arrive late are dropped.
- The query has quotes, slashes, emoji, or symbols like `%` and `&`: nothing breaks and the page address stays valid.
- A very long query (over 200 characters) is cut or refused with a message, not sent as is.
- Right-to-left text or letters with combining accents still match and highlight in the right place.
- An item is deleted while it shows in the results: opening it says it no longer exists.
- The person opens a result and presses Back: the same words, filters, sort and scroll position return.
- Filters combine to zero results: the filtered-empty state shows which filter to remove.
- Highlighting never puts HTML from the item text into the page.
- A query of only spaces does nothing and shows no error.
- Items are added while the person pages through results: no item is shown twice or skipped.

## Platform conventions

- **Web**
  - `/` or Ctrl+K (Cmd+K on Mac) focuses search; pick one, show it as a hint, and let Escape clear or close.
  - Use `role="search"`, a visible label, and a live region that announces the result count to screen readers.
  - Keep state in the query string (`?q=...&sort=...`).
- **Electron (desktop)**
  - Cmd/Ctrl+F searches the current view; Cmd/Ctrl+K or a menu item opens a search-everywhere panel.
  - Add "Find" to the Edit menu with its shortcut, so it can be found in menus.
  - Search large local data in a worker or the main process so typing never stutters.
- **Mac (SwiftUI)**
  - Use the `.searchable` modifier, which puts the field in the toolbar where Mac users expect it.
  - Cmd+F moves focus to the search field; use search tokens for filters where they fit.
  - Spotlight indexing (Core Spotlight) is optional, only if items should be findable from outside the app.

## Questions to settle in discovery

- What should search look through: only titles, or the full text of each item too? Default: titles and the start of the text. Why: it finds most things without a heavy setup.
- Should a small typo still find the item ("recieve" finds "receive")? Default: yes for data on the device, no for server search unless the service offers it. Why: typo matching is cheap on the device and costly to build on a server.
- Should past searches be remembered? Default: yes, the last 10, kept only on this device. Why: it saves typing and nothing private leaves the device.
- Should search cover everything or only the area the person is in? Default: the current area, with one click to widen to everything. Why: people usually search where they are.

## Acceptance criteria starters

### AC-search-1: Matching ignores case and accents
- Given an item called "Café Plans", when I search for "cafe plans", then that item appears with the matching words highlighted.
- Proven against: mock

### AC-search-2: Filtered-empty offers a way out
- Given items exist but none match my words and filters, when the search finishes, then I see a filtered-empty message with a button that removes the filters.
- Proven against: mock

### AC-search-3: Back restores the search
- Given I searched, filtered and opened a result, when I press Back, then the same words, filters, sort and results are shown.
- Proven against: local

### AC-search-4: Late answers do not replace newer ones
- Given the server answers my first query slower than my second, when both answers arrive, then only the results for the second query are shown.
- Proven against: mock

### AC-search-5: Hidden items stay hidden
- Given an item I cannot access matches my words, when I search, then neither the item nor its title appears and the count leaves it out.
- Proven against: real
