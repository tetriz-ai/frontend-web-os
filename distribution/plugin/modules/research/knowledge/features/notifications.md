# Notifications

Tells a person when something they care about has happened, through the channel they chose, without nagging.

## Sub-features a complete version needs

- An in-app inbox (a bell or a list) with an unread count, newest first, each entry linking to the thing it is about.
- Mark one as read, mark all as read, and dismiss or archive.
- Toasts for things that just happened in this session (saved, failed, someone joined), kept separate from the inbox.
- Browser or desktop system notifications for important events while the app is in the background, after the person opts in.
- Email and phone push, if the app needs them (both need a backend, see below).
- Preferences per event type and per channel, plus "Pause all" (do not disturb) for a set time.
- A digest option that bundles small events into one daily or weekly email.
- Grouping: five comments on one item show as one notification with a count.
- An unsubscribe link in every email that works in one click, without signing in.
- Quiet hours in the person's own time zone.
- Notifications clear themselves once the thing is handled (the invite was accepted, the task was closed).
- Backend split (fwos does not build backends):
  - Frontend owns: the inbox UI, toasts, the unread badge, preference screens, asking for system permission, showing system notifications while the app runs.
  - A hosted backend or existing API must provide: deciding who gets what, storing the inbox, sending email, sending web push or Apple push, unsubscribe handling, digests and quiet hours.

## States every screen must show

- Loading: the inbox shows placeholder rows, and the badge does not flash a wrong number.
- Empty (zero): "You're all caught up", not an empty box.
- Filtered-empty: "No unread notifications" when the Unread filter is on, with a link to show all.
- Error (with reason + retry): the inbox failed to load, with Retry; the badge hides rather than show an old count.
- Offline: the inbox shows what was last loaded, with a note that it may be out of date.
- Permission not asked, granted or denied: the preferences screen shows which, and how to change it if denied.
- No permission: a notification about an item the person can no longer open says so when clicked.
- Paused: a visible sign that do not disturb is on, with the time it ends.

## Edge cases

- The browser or OS blocks notifications: the in-app inbox still works and the app explains how to allow them.
- The app is open in two tabs: a system notification appears once, not twice.
- A notification links to a deleted item: opening it shows "This item was deleted", not an error page.
- The unread count is over 99: the badge shows "99+".
- The person reads a notification on one device: the badge on another device updates on its next refresh.
- Many events arrive at once (100 in a minute): they are grouped, and the page stays responsive.
- An unsubscribe link is clicked twice, or after the account was deleted: it still shows a clear result.
- Notification text has emoji or right-to-left names: it displays correctly and is cut cleanly if long.
- Quiet hours cross midnight (22:00 to 07:00): they work in the person's time zone, including on daylight saving change days.

## Platform conventions

- **Web**
  - Ask for notification permission only after a clear user action (a button), never on page load; browsers may block or hide early asks.
  - Web push needs a service worker and a push sender on the backend; on iPhone and iPad it works only for sites added to the Home Screen.
  - Toasts use a polite live region so screen readers announce them, and stay long enough to read (until dismissed if they have an action).
- **Electron (desktop)**
  - Use Electron's `Notification` from the main process; clicking one focuses the window and opens the item.
  - Show the unread count on the dock icon (macOS) or as a taskbar overlay (Windows), and clear it when read.
  - The OS decides whether notifications show; link to the system settings if they are off.
- **Mac (SwiftUI)**
  - Use the UserNotifications framework, and ask for permission at a moment that makes sense, not at launch.
  - Remote push needs the Apple Push Notification service and a server that sends to it.
  - Set the dock badge for unread items, and respect Focus modes instead of building a separate quiet mode where possible.

## Questions to settle in discovery

- Which events are worth interrupting someone for? Default: only things that need the person to act (a mention, a request, a failure). Why: too many alerts make people turn them all off.
- Which channels are needed in the first release: in-app only, or email and phone push too? Default: in-app only. Why: email and push need a backend that sends them, which fwos does not build.
- Should many small updates be bundled into one daily email? Default: yes, once a day for anything not urgent. Why: one summary is less annoying than ten emails.
- Should the app ask for system notification permission during setup? Default: no, ask the first time the person turns on an alert. Why: people say yes more often when they can see why.

## Acceptance criteria starters

### AC-notifications-1: Unread badge clears when read
- Given I have 3 unread notifications, when I open the inbox and choose "Mark all as read", then the badge disappears.
- Proven against: mock

### AC-notifications-2: A notification opens the right item
- Given a notification about a comment, when I click it, then the item opens at that comment and the notification is marked read.
- Proven against: local

### AC-notifications-3: Permission is asked only after a user action
- Given I have never been asked, when the app first loads, then no permission prompt appears until I press "Turn on desktop alerts".
- Proven against: local

### AC-notifications-4: Blocked permission is explained
- Given I blocked notifications in the browser, when I open notification settings, then the page says they are blocked and shows how to allow them.
- Proven against: mock

### AC-notifications-5: Unsubscribe works without signing in
- Given I received a digest email, when I click its unsubscribe link while signed out, then I see that digests are off and no more digests arrive.
- Proven against: real
