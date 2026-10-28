---
title: "Reading list: spec"
based_on: [brief.md@7ed84a9082e3, ia.json@a39c9d1f0f3f, modules.json@199c971ec9e9]
---

# Reading list: spec

Builds on [the brief](brief.md) (not repeated here), [ia.json](ia.json) and
[modules.json](modules.json). Decisions are in [decisions.md](decisions.md).

## 1. What you're approving

1. First release: save links, mark them read or unread, filter the list, and delete with undo, on one device.
2. One page, the list at `/`, in five states (loading, empty, filtered-empty, error, ready), and three journeys: save, read next, tidy up.
3. Data is local: links are saved in this browser, behind the same API contract a real backend would use later. Clearing the browser's site data deletes them.
4. Web only, responsive down to a 320px-wide phone.
5. 10 first-release ACs and 1 later one (sync across devices). No manual checks. One named gap: sync can't be tested because there's no sync backend.

## 2. Journeys

- **J1 Save**: a reader with a link copied from somewhere else opens `/`, pastes it into the link field, optionally types a title, presses "Save link", and sees it at the top of the list.
- **J2 Read next**: a reader opens `/`, chooses "Unread", opens a link in a new tab, comes back and marks it read.
- **J3 Tidy up**: a reader deletes a link they no longer want, and undoes it if it was a mistake.
- **J4 Another device** (later): a reader opens the app on a second device and sees the same list.

## 3. Scope by platform

| Feature | Web | Electron | Mac | Notes (each difference intended and logged) |
|---|---|---|---|---|
| Save a link | yes | not planned | not planned | Web only in this release (brief) |
| List, newest first | yes | not planned | not planned | |
| Mark read or unread | yes | not planned | not planned | |
| Filter in the address | yes | not planned | not planned | |
| Delete with undo | yes | not planned | not planned | D-2 |
| Sync across devices | later | later | later | Needs an account and a server (D-1) |

## 4. Screens and navigation

From ia.json: one nav page, `list` at `/` (title "Reading list"). The nav hides itself while
there's only one page. The filter lives in the address: `/` (All), `/?show=unread`,
`/?show=read`. Any other `show` value means All. There are no drill-downs or unlinked pages;
saved links open the original site in a new tab.

## 5. States per screen

| Page | States | Notes |
|---|---|---|
| list | loading | First load only, while the list is read: a skeleton shaped like three rows, in a region marked busy. Never shown again once rows have shown. |
| list | empty | Nothing saved yet: "Save your first link", one line on what happens, and "Add a link", which moves focus to the link field. No filter. |
| list | filtered-empty | Links exist but the filter hides them all: "No unread links" or "No read links", how many the filter is hiding, and "Show all". The filter stays on screen. |
| list | error | The browser blocks site storage: "Couldn't load your reading list", the reason, and "Try again". The save form stays. |
| list | ready | The filter, then the rows, newest first. |

The save form shows in every state.

## 6. Data and API contract

`packages/api-contract/openapi.yaml`. Every operation runs in local mode in the first release: a
repository in the reading-list feature implements it over this browser's site storage, so a real
API can replace it without changing a screen.

| Operation | Purpose | Mode | Fixtures |
|---|---|---|---|
| listItems | Every saved link, newest first | local | listItems.default (3 unread), listItems.empty, listItems.many (8, 3 read, long and non-English titles, dates beyond a week), listItems.unavailable (503: storage blocked, with the reason) |
| createItem | Save a link; a blank title becomes the hostname | local | createItem.default |
| updateItem | Mark read or unread | local | updateItem.default |
| deleteItem | Delete for good (after the undo window) | local | deleteItem.default (204) |

No sign-in and no tokens. There's no network to be slow: the one failure is storage being
unavailable (blocked site data, a private window that refuses storage, or a full quota). Then
listItems fails with the reason in listItems.unavailable, and a failed save keeps the form filled.

## 7. Architecture

From modules.json: one feature module, `reading-list`, which may depend on `shared-ui`,
`shared-lib` and `api-contract`. The route `/` imports only the feature's public entry. Storage is
touched only inside the feature's data layer, never in `app/` or `shared/ui` (rule pack
no-storage-in-ui). The dev-only `screens` module renders the feature's own view on fixtures, so the
screens and the app can't drift apart. Server state goes through TanStack Query. No new
dependencies.

## 8. Design system binding

The neutral starter, light and dark (D-10). Registered components only: `card` (the form),
`text-field` (link and title, with the error tied to the field), `button` (one primary, "Save
link"; the rest secondary or ghost), `badge` ("Read"), `alert` (critical for errors, info for the
undo message), `empty-state` (zero and filtered), `skeleton`, `state-handler`. Slots: surfaces,
text, borders, brand, status critical and info, hover, selected and focus. No new components, no
chart palette (no charts). Dates only through the shared formatter.

## 9. Cross-cutting

Only overrides of fwos defaults (WCAG 2.2 AA, English, no analytics, CSP on, no secrets in the client):

- None. Saved links open the original site in a new tab, marked for screen readers and with `noopener` (R-interaction-9).

## 10. Acceptance criteria

### AC-reading-1: Save a link and find it at the top, after a reload too
- Journey: J1
- Given the list page, when I enter `https://example.com/articles/slow-reading` with the title "The case for slow reading" and press "Save link", then it's the first row, showing that title, the hostname "example.com" and "Saved now"; both fields clear and focus goes back to the link field. After a reload it's still the first row.
- Proven against: local
- Release: first

### AC-reading-2: A link saved without a title is named after its hostname
- Journey: J1
- Given the title field is blank or only spaces, when I save `https://blog.example.org/2026/09/notes-on-focus`, then the new row's title is "blog.example.org".
- Proven against: local
- Release: first

### AC-reading-3: Only web addresses are saved, checked when I leave the field and when I save
- Journey: J1
- Given the link field, when I type `example.com/page` and leave the field, then "Enter a web address that starts with http:// or https://." shows under it, the field is marked invalid and the message is read out with it. Pressing "Save link" with the field empty ("Enter the link you want to save.") or invalid (including `ftp:` and `javascript:` addresses) saves nothing and moves focus to the link field. No message shows while I type a first value; once a message shows, it clears as soon as the address is valid.
- Proven against: local
- Release: first

### AC-reading-4: The list shows newest first, with title, hostname and saved date
- Journey: J2
- Given the 8 links in listItems.many, when the list loads, then they show newest first; each row has its title as a link that opens in a new tab, its hostname, and when it was saved: relative within a week ("5 hours ago", "3 days ago") and a date beyond ("Sep 28, 2026"), with the full date on hover. Before the first read finishes, a busy skeleton region shows; once rows have shown, saving or changing a link never brings the skeleton back.
- Proven against: local
- Release: first

### AC-reading-5: Mark a link read or unread
- Journey: J2
- Given an unread link, when I press "Mark as read" on its row, then the row shows a "Read" badge and its button reads "Mark as unread"; pressing that makes it unread again. The state is the same after a reload.
- Proven against: local
- Release: first

### AC-reading-6: Filter All, Unread or Read, kept in the address
- Journey: J2
- Given the 8 links in listItems.many (3 read), when I choose "Unread", then the address becomes `/?show=unread`, "Unread" is marked current, and only the 5 unread links show, newest first. Reloading keeps the filter, opening `/?show=read` directly shows the 3 read links, and Back returns to the previous filter. An unknown value such as `/?show=everything` shows All.
- Proven against: local
- Release: first

### AC-reading-7: A filter that hides everything offers "Show all"
- Journey: J2
- Given the 3 unread links in listItems.default, when I open `/?show=read`, then instead of rows the list says "No read links" and that the filter is hiding all 3 saved links, with "Show all"; the filter stays on screen. "Show all" goes to `/` and shows all 3.
- Proven against: local
- Release: first

### AC-reading-8: Delete a link, with 5 seconds to undo
- Journey: J3
- Given a saved link, when I press "Delete" on its row, then the row disappears at once and a "Deleted." message naming the link shows above the list with "Undo", which takes keyboard focus. "Undo" within 5 seconds puts the row back in its place. Otherwise, after 5 seconds the message goes and the link is gone for good, after a reload too. Deleting another link while the message shows makes the first deletion final.
- Proven against: local
- Release: first

### AC-reading-9: The first visit shows how to start
- Journey: J1
- Given nothing has been saved, when I open the list, then it shows "Save your first link", one line saying links stay in this browser, and "Add a link", which moves focus to the link field. No filter shows.
- Proven against: local
- Release: first

### AC-reading-10: When the browser blocks storage, the list says why and offers "Try again"
- Journey: J1
- Given this browser blocks site storage, when I open the list, then it shows "Couldn't load your reading list", the reason from listItems.unavailable and "Try again"; once storage is allowed and I press "Try again", the list shows. Saving a link while storage is blocked shows the same reason under the form and keeps what I typed.
- Proven against: local
- Release: first

### AC-reading-11: The same list on another device
- Journey: J4
- Given I saved links on one device, when I open the app on a second device and sign in, then the same links show with the same read state.
- Proven against: real
- Release: later

## 11. Release and distribution

| Target | Artifact | Signing | Built on | Secrets it needs |
|---|---|---|---|---|
| Web | `next build` output | none | CI | none |

fwos never deploys, signs or submits: it prepares the commands. Any static-friendly host that runs
`next start` works; the person picks one at release.

## 12. Open questions

- How long should undo last? Recommended 5 seconds; if it flips, only the timing in AC-reading-8 changes.
- Should default titles drop "www."? Recommended no (D-3); if it flips, only AC-reading-2's expected title changes.

## 13. Slices

Thin, ordered, each with verified depends-on edges. The last slice per platform is the real-use
slice: try the whole app as the target user would.

| Slice | What | Modules | ACs | Depends on | Platform |
|---|---|---|---|---|---|
| S1 | Save and list: the form and its checks, the list newest first, the zero, loading and error states, the local repository, and `/` wired to the feature | reading-list, app, screens | AC-reading-1, AC-reading-2, AC-reading-3, AC-reading-4, AC-reading-9, AC-reading-10 | none | web |
| S2 | Read state and the filter: mark read or unread, All / Unread / Read in the address, the filtered-empty state | reading-list | AC-reading-5, AC-reading-6, AC-reading-7 | S1 | web |
| S3 | Delete with undo, then real use | reading-list | AC-reading-8 | S2 | web |

Real use (after S3): use the production build as the target user for one sitting. Save five links
(one without a title, one with a typo first), mark two read, filter both ways, delete one and undo
it, delete another and let it go, reload, and repeat on a phone-sized window in dark mode. Anything
that surprises is a fix in this change or a change request.
