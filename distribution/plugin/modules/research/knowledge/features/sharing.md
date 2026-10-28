# Sharing

Lets a person give other people access to something they made, choose what those people can do, and take access back.

## Sub-features a complete version needs

- A Share button on each item that opens one panel with every sharing choice.
- Invite by email, with a role per person (view, comment, edit) and an optional message.
- Share by link: off by default, with a choice of who the link works for (anyone with it, signed-in people only, team members only) and what they can do.
- Copy link, with a "Copied" confirmation.
- A list of who has access, with each person's role and pending invites marked, and a way to change or remove each one.
- Remove access and reset the link, so an old link stops working.
- An expiry date or password on links, if discovery asks for them.
- Transfer ownership to another person, with a confirm step.
- Request access: someone who opens a link without access can ask the owner, who is notified.
- The invited side: an invite email, an accept screen, and a "Shared with me" list.
- The system share sheet for sending a link through other apps, where the platform has one.
- A history of who shared what and when, if discovery asks for it.
- Backend split (fwos does not build backends; sharing between people always needs one):
  - Frontend owns: the share panel, role pickers, copy link, the access list, accept screens, "Shared with me", read-only and no-access views.
  - A hosted backend or existing API must provide: storing who has access, checking it on every request, creating and revoking link tokens, sending invite emails, ownership transfer.

## States every screen must show

- Loading: the access list shows placeholders, and the Share button does not wait for it.
- Empty (zero): "Only you can see this", with the invite field ready to type in.
- Error (with reason + retry): an invite failed (bad address, invite limit reached), naming which address failed.
- Offline: the panel shows current access but disables changes, with a note.
- No permission: a person without access sees "You need access" and a Request access button, never the item content.
- Read-only: a viewer sees the item with editing controls hidden or disabled, and a label saying they can only view.
- Pending: invites not yet accepted are marked pending, with Resend.
- Success: "Invited 3 people", and the list updates at once.
- Link no longer works: an expired or reset link says so and who to ask.

## Edge cases

- An invited email has no account yet: the person can sign up from the invite and land on the item.
- The owner tries to remove their own access: the app refuses until ownership is moved.
- Access is removed while the person has the item open: their next action shows "You no longer have access", and unsaved edits are offered as a copy.
- The same person is invited twice: one entry remains, keeping the higher role or asking the owner.
- An invited email has capital letters or spaces: it is matched the same way sign-in matches emails.
- A public link is reset: the old link stops working at once.
- Many emails are pasted at once (comma or line separated): each is checked, and bad ones are listed without dropping the good ones.
- The item sits in a folder shared with different people: the panel says where each person's access comes from.
- The person tries to give a role higher than their own: that role is not offered.

## Platform conventions

- **Web**
  - Use the Web Share API where it exists (mostly phones), and fall back to copy link.
  - Clipboard writes need a user action and a secure (https) page; show a selectable text field if copying fails.
  - Shared links open the item directly, and return to it after sign-in.
- **Electron (desktop)**
  - Links can open the installed app through a custom app link, with a normal web address as the fallback.
  - On macOS, use Electron's share menu; on Windows and Linux, offer copy link.
  - Add "Share..." and "Copy Link" to the File menu and to the item's right-click menu.
- **Mac (SwiftUI)**
  - Use `ShareLink` for the system share sheet; put Share in the toolbar and the File menu.
  - Support universal links, so a shared web address opens the Mac app when it is installed.
  - System cloud sharing (CloudKit) fits only apps whose data lives in the person's own iCloud; apps with their own backend use their own share panel.

## Questions to settle in discovery

- Who should people be able to share with: anyone by email, or only people on their team? Default: anyone by email. Why: it covers both cases, and team-only rules can come later.
- Should share links exist, and should they work for people without an account? Default: links allowed, view-only, for signed-in people only. Why: it is easy to use and keeps items from spreading to strangers.
- What can a shared person do: view, comment, or edit? Default: view or edit. Why: two roles cover most needs and are easy to explain.
- Should links expire on their own? Default: no, but the owner can reset a link at any time. Why: expiry adds steps, and reset handles a leaked link.

## Acceptance criteria starters

### AC-sharing-1: An invite gives access with the chosen role
- Given I own an item, when I invite a second person as a viewer and they accept, then they can open the item but cannot edit it.
- Proven against: real

### AC-sharing-2: Removing access takes effect at once
- Given someone has edit access, when I remove them, then their next request for that item shows the no-access screen.
- Proven against: local

### AC-sharing-3: Resetting a link stops the old one
- Given a share link is on, when I reset it, then opening the old link shows "This link no longer works".
- Proven against: local

### AC-sharing-4: The no-access page shows no content
- Given I am signed in without access, when I open a link to an item, then I see a Request access button and none of the item's title or content.
- Proven against: mock

### AC-sharing-5: Bad addresses do not block good ones
- Given I paste three emails and one is not valid, when I press Invite, then two invites are sent and the bad address is shown with a reason.
- Proven against: mock
