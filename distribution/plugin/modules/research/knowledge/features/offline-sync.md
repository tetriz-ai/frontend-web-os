# Offline and sync

Lets a person keep working without a connection, and have their changes show up on their other devices once they are back online.

## Sub-features a complete version needs

- The app and recent data open without a network (cached app files plus a local database on the device).
- Changes made offline are saved on the device at once and queued to send later, in order.
- A connection indicator: online, offline, syncing, and "All changes saved".
- A small mark on items that have not been sent yet.
- Automatic retry with longer waits each time sending fails, and a manual "Sync now".
- A written conflict rule (latest change per field wins, or ask the person) and a screen to see and settle a conflict.
- Getting changes made on other devices: on a timer, when the window gets focus, or live, as decided in discovery.
- Deletes sync too (kept as markers until every device has seen them), so deleted items do not come back.
- A limit on what is kept offline (for example the last 90 days, or pinned items), with storage used shown in Settings.
- Sign out clears local data on shared computers, after warning about unsent changes.
- Data format upgrades: a newer app version reads and upgrades data saved by an older one.
- Backend split (fwos does not build backends; sync between devices always needs one):
  - Frontend owns: the local database, the outgoing queue, retries, status UI, applying incoming changes, conflict screens.
  - A hosted backend, sync service or existing API must provide: the shared copy, accepting changes with ids and versions, sending changes since a given point, deciding final order, permission checks.
  - An app used on one device only can work offline with no backend at all.

## States every screen must show

- Offline: a calm banner or icon saying changes are saved on this device and will sync later.
- Syncing: a small progress hint, never a full-screen block.
- Success: "All changes saved" or "Synced just now", with the time of the last sync.
- Error (with reason + retry): sync failed (signed out, server down, change refused), with Retry and the number of changes waiting.
- Conflict: the item shows both versions or the chosen winner, and lets the person pick.
- Partial data: only some data is on this device; screens show what is stored and say what needs a connection.
- No permission: a change was refused because access was removed; the person can copy their text before it is dropped.
- Loading: the first launch on a new device shows download progress for the starting data.
- Storage full: the device has no room for more offline data, with what can be cleared.

## Edge cases

- The same field is edited on two devices while both are offline: the conflict rule applies and nothing is lost silently.
- An item is edited on one device and deleted on another: the rule picks one outcome and tells the person.
- The connection drops in the middle of sending: nothing is saved twice (each change carries an id the server can match).
- The device clock is hours off: order comes from server time or version numbers, not the device clock.
- The app is closed with changes still queued: they send on the next launch.
- Someone else signs in on the same device: the first person's data and queue are neither shown nor sent.
- Wi-Fi is connected but there is no internet (a hotel login page): the app treats it as offline after a failed request, not from the network flag alone.
- 1,000 changes are waiting: sync finishes without freezing the screen and shows progress.
- A newer app version on one device writes data an older version cannot read: the older one asks to update instead of damaging data.

## Platform conventions

- **Web**
  - Use a service worker to cache the app files and IndexedDB for data; local storage is too small and blocks the page.
  - Ask for lasting storage with `navigator.storage.persist()`, because browsers can clear site data when space runs low.
  - Safari can delete a site's stored data after 7 days of use without a visit to it, unless the site was added to the Home Screen or Dock.
  - The `online` and `offline` events are only a hint; confirm with a real request.
- **Electron (desktop)**
  - Keep data in a local database file (for example SQLite) in the app data folder, not in the page's storage.
  - Run sync in the main process or a background worker, so it keeps going while windows are closed (if the app stays in the tray or menu bar).
  - Use `net.isOnline()` and sleep and wake events to pause and resume sync.
- **Mac (SwiftUI)**
  - Use SwiftData or Core Data for the local store; CloudKit sync is an option only for data kept in the person's own iCloud.
  - Watch the connection with `NWPathMonitor`, and resume sync on wake and when the app becomes active.
  - Show sync status in the toolbar or at the foot of the sidebar, as Mac apps usually do.

## Questions to settle in discovery

- Must the app work fully offline, or is "read-only when offline" enough? Default: read and edit offline, then sync when back online. Why: people expect their lists and notes to work on a plane.
- Will people use the app on more than one device? Default: yes, which means a backend is needed for sync. Why: without one, data stays on the device where it was made.
- When the same thing is changed in two places, which change should win? Default: the latest change per field wins, and the person is told. Why: edits to different fields are both kept, and the rule is easy to explain.
- How much should be kept on each device? Default: everything for personal apps, the last 90 days for team apps. Why: personal data is small, and team data can grow past what a device should hold.

## Acceptance criteria starters

### AC-offline-sync-1: Edits made offline are kept
- Given I am offline, when I create an item and close and reopen the app, then the item is still there and marked as waiting to sync.
- Proven against: local

### AC-offline-sync-2: Queued changes send when back online
- Given I made three changes offline, when the connection returns, then all three reach the server in order and the status shows "All changes saved".
- Proven against: local

### AC-offline-sync-3: No duplicate after a dropped connection
- Given a change was sent but the reply was lost, when the app retries, then the server holds one copy of the item, not two.
- Proven against: mock

### AC-offline-sync-4: A conflict is shown, not lost
- Given the same field was edited on two offline devices, when both sync, then the conflict rule is applied and the other value can still be seen and restored.
- Proven against: real

### AC-offline-sync-5: Deleted items stay deleted
- Given I deleted an item on one device, when another device that was offline syncs, then the item disappears there and does not come back.
- Proven against: real
