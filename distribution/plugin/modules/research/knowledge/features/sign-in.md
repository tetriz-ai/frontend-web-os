# Sign-in

Lets a person create an account, prove it is theirs, and get back into it on any device.

## Sub-features a complete version needs

- Sign up with email and password, with the password rules shown before the person types, not after they fail.
- Email verification: a link or code sent after sign up, a "Resend" button with a wait timer, and a banner while unverified.
- Sign in with email and password, with a "Show password" toggle.
- Passkeys, or one or two sign-in-with-another-account buttons, if discovery asks for them.
- Forgot and reset password: a request screen, an emailed link, a set-new-password screen, then signed in.
- Two-step verification (a code from an authenticator app) and recovery codes, if the app holds sensitive data.
- Session expiry and silent refresh: the person stays signed in while active and is asked again only when refresh fails.
- Return to the page they were on after signing in (a "return to" address, checked to be inside the app).
- Sign out on this device.
- Sign out everywhere (ends all other devices and sessions).
- A list of active sessions or devices, with a way to end one.
- Change email (verified at the new address) and change password (asks for the current one first).
- Account deletion: a confirm step, a grace period or instant delete (settled in discovery), and a final email.
- Backend split (fwos does not build backends):
  - Frontend owns: forms, input checks, error messages, where tokens are kept, refresh timing, redirects, signed-out screens.
  - A hosted auth service or existing API must provide: password storage, sending emails, issuing and revoking tokens, rate limits, lockout, the session list, account deletion.

## States every screen must show

- Loading: the submit button shows progress and cannot be pressed twice.
- Error (with reason + retry): wrong email or password (one message for both), too many tries (with the wait time), service unreachable.
- Offline: forms keep what was typed, submit is disabled, and a line says sign-in needs a connection.
- Success: after sign up, a "Check your email" screen that names the address used.
- Unverified: signed in but limited, with a banner and a Resend button.
- Expired: a reset or verification link opened too late, with a button to send a new one.
- Signed out by the system: "You were signed out" after expiry or remote sign-out, with the email kept in the field.
- No permission: a signed-in person who opens a page they cannot see gets a clear message, not the sign-in form.

## Edge cases

- The reset link is used a second time: the page says it was already used.
- The reset link is opened after it expires: the page says so and offers a new one.
- The email is typed with capital letters or a trailing space: it still matches the account.
- Someone signs up with an email that already has an account: the screen does not reveal this, and the email they get explains it.
- A password manager fills the form: submit works without the person typing anything.
- Two tabs are open and the person signs out in one: the other tab shows signed out on its next action.
- The access token expires in the middle of a save: the app refreshes, retries once, and keeps what the person typed.
- Refresh fails because the account was disabled or deleted elsewhere: the app signs out and says why.
- The person changes their password: other sessions end (if chosen in discovery) and this one stays signed in.
- Caps Lock is on while typing a password: a small hint shows.
- A "return to" address points to another site: it is ignored and the person lands on the home screen.

## Platform conventions

- **Web**
  - Keep the session in a secure, http-only cookie when the auth service supports it, not in local storage.
  - Use autocomplete hints (`email`, `current-password`, `new-password`, `one-time-code`) so password managers and code autofill work.
  - The sign-in page has its own address, so emails and bookmarks can link to it.
- **Electron (desktop)**
  - Open sign-in in the system browser with PKCE, and come back through a custom app link or a loopback address on `127.0.0.1`.
  - Never collect a password for another service inside an app window.
  - Store tokens with `safeStorage` (backed by the OS keychain), never in plain files or local storage.
  - Handle the return link both when the app is already running and when the link starts it.
  - Put "Sign Out" in the app menu, and show the signed-in account in Settings.
- **Mac (SwiftUI)**
  - Use `ASWebAuthenticationSession` for browser-based sign-in, with PKCE.
  - Keep tokens in the Keychain, never in `UserDefaults`.
  - Passkeys and password autofill come from the AuthenticationServices framework; set text content types on fields.
  - Mac App Store apps that offer sign-in through another company's account must also offer Sign in with Apple or an equal privacy-focused option.
  - Mac App Store apps that let people create an account must let them start deleting it inside the app.

## Questions to settle in discovery

- How should people sign in: email and password, a one-time email link, or an account they already have elsewhere? Default: email and password, with passkeys as an option. Why: it works for everyone and needs no outside account.
- Must people confirm their email before using the app? Default: let them look around first, and require it before saving or sharing. Why: fewer people give up at sign up, and fake emails still get caught.
- How long should someone stay signed in on their own device? Default: 30 days, renewed while they keep using it. Why: people expect to stay signed in on a personal device, and an unused session still runs out.
- When someone deletes their account, is it gone at once or after a wait? Default: 14 days, and signing in again cancels it. Why: it protects against mistakes and stolen sessions.
- Should changing the password sign out every other device? Default: yes. Why: people usually change a password because they worry someone else has it.

## Acceptance criteria starters

### AC-sign-in-1: Wrong password gives one general message
- Given an account exists, when I sign in with the right email and a wrong password, then I see "Email or password is wrong" and the email field keeps what I typed.
- Proven against: mock

### AC-sign-in-2: Reset link works once
- Given I asked for a password reset and used the link, when I open the same link again, then the page says it can no longer be used and offers to send a new one.
- Proven against: local

### AC-sign-in-3: Session refresh keeps unsaved work
- Given my access token expired while I was editing a form, when I press Save, then the app refreshes the session and saves without asking me to sign in.
- Proven against: local

### AC-sign-in-4: Sign out everywhere ends other sessions
- Given I am signed in on two devices, when I choose "Sign out everywhere" on one, then the other shows the signed-out screen on its next request.
- Proven against: real

### AC-sign-in-5: Return to the page I asked for
- Given I am signed out and open a link to a saved item, when I sign in, then I land on that item and not on the home screen.
- Proven against: mock

### AC-sign-in-6: Desktop sign-in uses the system browser
- Given the desktop app is signed out, when I press "Sign in", then my default browser opens the sign-in page and the app is signed in after I finish there.
- Proven against: real
