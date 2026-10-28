---
title: "Reading list: test plan"
based_on: [spec.md@88fac9d8842f, ia.json@a39c9d1f0f3f]
---

# Reading list: test plan

Written from [the spec](spec.md) and [ia.json](ia.json) alone, by an agent that never saw the code.
Level router: the cheapest level that proves the behaviour.

## Cases

### TC-reading-1: saving a link with a title puts it first and resets the form
- AC: AC-reading-1
- Level: component
- Platform: web
- Status: new
- Given an empty list, when I enter `https://example.com/articles/slow-reading` and "The case for slow reading" and press "Save link", then the first row shows that title, "example.com" and "Saved now"; both fields are empty and the link field has focus.
- Data: fixture listItems.empty in the local store

### TC-reading-2: the first visit shows the zero state, and a saved link survives a reload
- AC: AC-reading-1, AC-reading-9
- Level: e2e
- Platform: web
- Status: new
- Given a browser with no saved data, when I open `/`, then "Save your first link" shows; when I save a link with a title and reload, then it's still the first row.
- Data: empty browser storage; the link from TC-reading-1

### TC-reading-3: a blank or spaces-only title becomes the hostname
- AC: AC-reading-2
- Level: component
- Platform: web
- Status: new
- Given the title field holds only spaces, when I save `https://blog.example.org/2026/09/notes-on-focus`, then the new row's title is "blog.example.org".
- Data: fixture listItems.empty in the local store

### TC-reading-4: the link rule accepts only http and https web addresses
- AC: AC-reading-3
- Level: unit
- Platform: web
- Status: new
- Given candidate values, when each is checked, then `https://example.com/a` and ` http://example.com ` (spaces trimmed) pass; empty gives "Enter the link you want to save."; `example.com/page`, `ftp://example.com/file`, `javascript:alert(1)` and `https://` give "Enter a web address that starts with http:// or https://."
- Data: literal values

### TC-reading-5: the link field is checked on blur and on save, and its message clears once fixed
- AC: AC-reading-3
- Level: component
- Platform: web
- Status: new
- Given the empty form, when I type `example.com/page`, then no message shows; when I leave the field, the message shows, the field is invalid and the message is its description; when I correct it to `https://example.com/page`, the message clears while I type. Pressing "Save link" with the field empty saves nothing, shows "Enter the link you want to save." and focuses the link field.
- Data: fixture listItems.empty in the local store; the store is checked to be unchanged

### TC-reading-6: rows show newest first with title, hostname and saved date
- AC: AC-reading-4
- Level: component
- Platform: web
- Status: new
- Given listItems.many and the clock at 2026-10-07 12:00 UTC, when the list loads, then 8 rows show newest first; the first title links to its URL, opens in a new tab and says so; dates read "Saved 2 minutes ago", "Saved 3 days ago", "Saved Sep 28, 2026"; each date carries the full date on hover.
- Data: fixture listItems.many

### TC-reading-7: saved dates read relative within a week and as a date beyond it
- AC: AC-reading-4
- Level: unit
- Platform: web
- Status: existing
- Given the shared formatter and a fixed "now" of 2026-10-07 12:00 UTC, when it formats savedAt values 2 minutes, 3 days and 9 days old, then it gives "2 minutes ago", "3 days ago" and "Sep 28, 2026".
- Data: savedAt values from listItems.many

### TC-reading-8: the skeleton shows on the first load only
- AC: AC-reading-4
- Level: component
- Platform: web
- Status: new
- Given a store that hasn't answered yet, when the page renders, then a busy region labelled "Loading your reading list" shows and no rows; once the store answers the rows show, and saving another link keeps them on screen with no busy region.
- Data: fixture listItems.default behind a store the test releases

### TC-reading-9: the zero state explains how to start
- AC: AC-reading-9
- Level: component
- Platform: web
- Status: new
- Given listItems.empty, when the list loads, then "Save your first link" and its line show, no filter shows, and "Add a link" moves focus to the link field.
- Data: fixture listItems.empty

### TC-reading-10: blocked storage shows the reason, and "Try again" recovers
- AC: AC-reading-10
- Level: component
- Platform: web
- Status: new
- Given a store that refuses to be read, when the list loads, then an alert says "Couldn't load your reading list" with the message from listItems.unavailable and "Try again"; when the store is allowed and I press "Try again", the 3 rows show.
- Data: fixtures listItems.unavailable and listItems.default

### TC-reading-11: a save while storage is blocked keeps what I typed
- AC: AC-reading-10
- Level: component
- Platform: web
- Status: new
- Given a store that refuses writes, when I save a valid link with a title, then the message from listItems.unavailable shows under the form and both fields keep their values.
- Data: fixture listItems.unavailable

### TC-reading-12: blocked storage in a real browser
- AC: AC-reading-10
- Level: e2e
- Platform: web
- Status: new
- Given a browser whose site storage throws when touched, when I open `/`, then the error, its reason and "Try again" show; when storage is allowed again and I press "Try again", "Save your first link" shows.
- Data: storage blocked by the test before the page loads

### TC-reading-13: the local store keeps the contract's shapes across instances
- AC: AC-reading-1, AC-reading-2
- Level: unit
- Platform: web
- Status: new
- Given empty storage, when one store saves a link with a title and one without, then a second store over the same storage lists both newest first, each with exactly the fields of createItem.default (id, url, title, savedAt, read false), the untitled one named after its hostname; when storage throws, listing fails with the message from listItems.unavailable.
- Data: fixtures createItem.default and listItems.unavailable

### TC-reading-14: mark a link read, then unread
- AC: AC-reading-5
- Level: component
- Platform: web
- Status: new
- Given listItems.default, when I press "Mark as read" on "The case for slow reading", then its row shows "Read" and the button reads "Mark as unread", and the store holds it as read; pressing "Mark as unread" reverses both.
- Data: fixture listItems.default

### TC-reading-15: read state survives a reload
- AC: AC-reading-5
- Level: e2e
- Platform: web
- Status: new
- Given a saved link, when I mark it read and reload, then it still shows "Read" and "Mark as unread".
- Data: one link saved through the form

### TC-reading-16: each filter shows the matching rows; anything else means All
- AC: AC-reading-6
- Level: component
- Platform: web
- Status: new
- Given listItems.many, when the page renders with the filter Unread, Read, `everything` and none, then 5, 3, 8 and 8 rows show newest first and Unread, Read, All and All are marked current.
- Data: fixture listItems.many

### TC-reading-17: the filter lives in the address
- AC: AC-reading-6
- Level: e2e
- Platform: web
- Status: new
- Given three saved links with one marked read, when I choose "Unread", then the address is `/?show=unread`, "Unread" is current and 2 rows show; after a reload the same; opening `/?show=read` shows 1 row; Back returns to `/?show=unread`.
- Data: three links saved through the form

### TC-reading-18: a filter that hides everything offers "Show all"
- AC: AC-reading-7
- Level: component
- Platform: web
- Status: new
- Given listItems.default and the Read filter, when the list loads, then "No read links" and "hiding all 3 saved links" show with a "Show all" link to `/`, and the filter is still on screen.
- Data: fixture listItems.default

### TC-reading-19: "Show all" brings every link back
- AC: AC-reading-7
- Level: e2e
- Platform: web
- Status: new
- Given two unread links and `/?show=read`, when I press "Show all", then the address is `/` and both rows show.
- Data: two links saved through the form

### TC-reading-20: delete hides the row at once and Undo restores it
- AC: AC-reading-8
- Level: component
- Platform: web
- Status: new
- Given listItems.default and fake timers, when I press "Delete" on the second row, then it disappears, "Deleted." with its title and "Undo" show, and "Undo" has focus; "Undo" puts it back as the second row. Deleting it again and advancing 5 seconds removes the message and the store no longer has it; deleting one link and then another makes the first final at once.
- Data: fixture listItems.default

### TC-reading-21: a deletion is final after the undo window, after a reload too
- AC: AC-reading-8
- Level: e2e
- Platform: web
- Status: new
- Given two saved links, when I delete one, undo it, delete it again and let the message go, then after a reload only the other link shows.
- Data: two links saved through the form; the page clock is controlled by the test

## Seams

| Seam | Shared fixture | Consumer test | Provider side |
|---|---|---|---|
| The list page reads the local store | listItems.default, listItems.many, listItems.empty | TC-reading-6, 8, 9, 14, 16, 18, 20 seed the store with the fixture body | TC-reading-13: the store returns items in the same shape |
| Saving a link | createItem.default | TC-reading-1, 3 | TC-reading-13: a saved item has exactly createItem.default's fields |
| Storage blocked | listItems.unavailable | TC-reading-10, 11 show its message | TC-reading-13: the store fails with that message |

## Default rows

### TC-default-crawl: every route loads, no console errors or broken links
- Level: e2e
### TC-default-a11y: no serious accessibility violations (axe) on any route
- Level: e2e
### TC-default-keyboard: each key journey works with the keyboard alone
- Level: e2e
### TC-default-themes: light and dark screenshots of each screen
- Level: e2e
### TC-default-phone: a phone viewport, no sideways scrolling
- Level: e2e
### TC-default-prod: one run against the production build
- Level: e2e

## Non-functional

| Check | Tool | Reference machine | Runs | Tolerance |
|---|---|---|---|---|
| None: the spec sets no performance target, and there's no network | - | - | - | - |

## Manual checks

| Item | Why it can't be automated | Who signs off |
|---|---|---|
| None | - | - |

## Named gaps

### GAP-1: Sync across devices isn't built, so it can't be tested
- Missing: a sync backend and a test account on it (AC-reading-11, later release)
