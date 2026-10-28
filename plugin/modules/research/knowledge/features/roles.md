# Roles and permissions

Lets the people who run a shared space decide who can see and do what, and shows everyone else what they are allowed to do.

## Sub-features a complete version needs

- A small fixed set of roles with plain names (for example Owner, Admin, Member, Viewer) and a one-line description of each.
- A table of what each role can do, shown wherever a role is picked.
- Invite people with a role, change a role, and remove someone, each only by people allowed to.
- At least one Owner at all times; ownership can be handed over with a confirm step.
- Actions the person cannot take are hidden or disabled, with a short reason where it helps.
- Pages the person cannot see show a no-permission screen naming who to ask, not a broken page (unless even the page's existence must stay hidden).
- Role changes apply on the next request, with no need to sign out.
- Per-item exceptions (a project private to three people), only if discovery asks for them; see sharing.
- A history of role changes: who changed whom, from what, to what, and when.
- Leave a team, with a warning if the person is the last Owner.
- Custom roles only if discovery asks for them, as each one adds a lot of testing.
- Backend split (fwos does not build backends; real permissions always need one):
  - Frontend owns: role pickers, the members list, hiding or disabling controls, no-permission screens, reacting when the server says no.
  - A hosted backend or existing API must provide: storing roles, checking permission on every request, the change history, and the list of what the current person may do (so the UI can match it).
  - Hiding a button is not security: the server must refuse the action too.

## States every screen must show

- Loading: controls that depend on permissions wait for the permission list, so they do not flash on and then off.
- No permission: a clear screen or disabled control saying which role is needed and who to ask.
- Read-only: viewers see content with editing controls hidden or disabled, and a label saying why.
- Empty (zero): a new team with only its owner shows an invite prompt in the members list.
- Filtered-empty: a members search with no match says "No members match" and offers a reset.
- Error (with reason + retry): a role change failed, the old role stays shown, and the reason is given.
- Offline: the members list is read-only, with a note.
- Role changed: when a person's role changes while they use the app, a notice says so and the screen updates.

## Edge cases

- The last Owner tries to leave or lower their own role: the app blocks it and explains how to hand over ownership first.
- Two admins change the same person's role at the same moment: the last change wins and both see the final value.
- A person is removed while they have the app open: their next action shows "You were removed from this team" and moves them to a safe screen.
- An admin tries to give someone a role higher than their own: the option is not offered, and the server refuses it.
- A viewer opens a direct link to an edit page: they get the read-only or no-permission screen, never a half-working editor.
- Keyboard shortcuts for actions the person cannot take do nothing and show no error.
- The person belongs to two teams with different roles: switching teams updates what they can do at once.
- The server refuses something the UI allowed: the app shows the server's reason and reloads the permission list.

## Platform conventions

- **Web**
  - Route guards send people without access to a no-permission page; the server still checks every request.
  - A disabled button keeps a visible reason nearby, so keyboard and screen reader users learn why.
- **Electron (desktop)**
  - Menu items for actions the person cannot take are disabled, not removed, so menus keep a steady shape.
  - Update menu item states as soon as the role or team changes.
- **Mac (SwiftUI)**
  - Disable commands with `.disabled` in menus and toolbars; the Apple Human Interface Guidelines prefer disabling menu items over hiding them.
  - Put member management in a sheet or a Settings tab, with roles picked from a `Picker`.
  - Explain unavailable actions with `.help` text, shown on hover.

## Questions to settle in discovery

- How many kinds of people use the app, and what should each be able to do? Default: three roles, Owner, Member and Viewer. Why: three roles cover most teams and are easy to explain.
- Can a team have more than one Owner? Default: yes. Why: if the only owner leaves or loses access, the team is not stuck.
- Do some items need to be private inside a team? Default: no, not in the first release; everything in a team is visible to all members. Why: per-item rules add many screens and a lot of testing.
- Should admins see a history of who changed which role? Default: yes, a simple list. Why: it answers "who gave this person access?" without guesswork.

## Acceptance criteria starters

### AC-roles-1: A viewer cannot edit
- Given I am a Viewer, when I open an item, then editing controls are hidden or disabled and a label says I can only view.
- Proven against: mock

### AC-roles-2: The server refuses what the UI hides
- Given I am a Viewer, when an edit request is sent straight to the API, then it is refused and nothing changes.
- Proven against: real

### AC-roles-3: The last Owner cannot leave
- Given I am the only Owner, when I choose "Leave team", then the app stops me and explains how to make someone else an Owner.
- Proven against: mock

### AC-roles-4: A role change applies without signing out
- Given an admin changes me from Viewer to Member, when I take my next action, then editing controls appear without signing out.
- Proven against: local

### AC-roles-5: The no-permission screen names who to ask
- Given I am a Member, when I open the team billing page, then I see a no-permission screen that names the Owner.
- Proven against: mock
