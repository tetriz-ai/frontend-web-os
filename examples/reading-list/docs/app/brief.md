---
title: "Reading list: brief"
change: "0001-initial"
---

# Reading list: brief

> **What you're approving**
> 1. Links worth reading get lost in open tabs, chats and notes, and there's no calm place to keep them.
> 2. One person, on one device, saving links to read later.
> 3. First release: save a link, see and filter the list (unread or read), and remove what you don't need.
> 4. A web app that works in any modern browser. Data stays in this browser on this device; there's no account and no server.
> 5. Biggest open assumption: one device is enough for now. Sync across devices is a later release.

## The problem

Interesting links arrive all day: in chats, newsletters and search results. People keep them as
open tabs (until the browser crashes), email them to themselves, or paste them into a notes app
where they sink. Nothing tells them what they've already read.

## Who it's for

One person who reads on the web. They open the app a few times a week, usually on a laptop, and
sometimes on a phone browser. They aren't technical and don't want to sign up for anything.

## Core jobs (first release)

1. Save a link: paste a web address, optionally give it a title, and it's at the top of the list
   straight away. We'll know it works when a link saved before a reload is still there after it.
2. Keep track of what's read: mark a link read or unread, and filter the list to All, Unread or
   Read. We'll know it works when a filtered view survives a reload and can be shared as a link.
3. Tidy up: delete a link, with a way back if it was a mistake. We'll know it works when an
   accidental delete can be undone in one click.

## Features

| Feature | Priority | Notes |
|---|---|---|
| Save a link (web address, optional title) | must-have | The title defaults to the link's hostname. Only http and https links. |
| The list, newest first, with title, hostname and saved date | must-have | One list, no folders. |
| Mark read or unread | must-have | A toggle on each row. |
| Filter All / Unread / Read, kept in the address bar | must-have | So reload, Back and a shared link keep the view. |
| Delete with undo | must-have | A short "Deleted. Undo" message instead of a confirm dialog. |
| Sync across devices | later | Needs an account and a server. |
| Fetching the page's real title and preview image | later | Needs a server to fetch other sites (browsers block it). |
| Tags, folders, search | later | Not needed until lists get long. |
| Import and export | later | Useful once people have a lot saved. |
| Reading the article inside the app | not doing | Browsers already do this well. |

## Platforms

Web only, responsive down to a phone screen. The last two versions of evergreen browsers.

## Data

Local mode: links are saved in this browser on this device, behind the same API contract a real
backend would use later. Nothing leaves the device. fwos builds no backend.

## Accounts

No sign-in. Everyone who opens the app on this device sees the same list.

## Non-goals

- No accounts, sharing or sync in the first release.
- No fetching of page titles, previews or article text.
- No offline-first sync logic: the list already works without a connection because it lives in the browser.

## Constraints

No deadline. One developer. English only. WCAG 2.2 AA. No analytics.

## Success signal

A few weeks in, the person opens the list instead of keeping tabs open, and the Unread filter is
how they pick what to read next.

## Assumed

Every default taken on the user's behalf. Each stays here, tagged, until confirmed.

- [ASSUMED] Platforms: web, responsive down to a phone (works everywhere; a desktop app can come later without a rewrite)
- [ASSUMED] Data: local mode, saved in this browser behind the API contract (survives a reload with no backend; swap in a real API later)
- [ASSUMED] Accounts: no sign-in for the first version (one device, one person)
- [ASSUMED] Design system: the neutral starter, light and dark (passes contrast; swap in a brand any time)
- [ASSUMED] Offline: the list works without a connection after the first visit because it lives in the browser; no sync (sync needs a server and a conflict policy)
- [ASSUMED] Integrations: none (each adds a backend dependency)
- [ASSUMED] Privacy: only the links the person saves, kept on the device; no analytics (nothing to consent to)
- [ASSUMED] Accessibility and language: English only, WCAG 2.2 AA (the common legal bar)
- [ASSUMED] Distribution: any static-friendly host, picked at release (fwos never deploys)
- [ASSUMED] Minimum versions: the last 2 versions of evergreen browsers (covers most people)
- [ASSUMED] Delete: undo for a few seconds rather than a confirm dialog (deleting a link is frequent and cheap to reverse)

## Open questions

- Is one device enough for the first release? Recommended answer: yes. If it flips, we need an account, a sync backend and a conflict policy before anything else.
- Should the title default strip "www."? Recommended answer: no, show the hostname exactly as it is in the link. If it flips, only the default title changes.
