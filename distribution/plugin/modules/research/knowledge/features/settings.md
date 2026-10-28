# Settings

Lets a person change how the app behaves for them, and manage their account, in one predictable place.

## Sub-features a complete version needs

- One Settings screen grouped into sections (General, Account, Notifications, Appearance, Privacy, Advanced), each with its own address or tab.
- Appearance: light, dark, or match the system; text size if the app is text heavy.
- Language and region (date, time and number formats), starting from the device's choice.
- Notification choices per event type and per channel (in-app, email, push), if the app sends them.
- Account details: name, email, password, and links to sessions and account deletion (see sign-in).
- Privacy: what data is collected, download my data, and a switch for optional analytics (off until the person agrees where the law requires it).
- One saving rule per section: switches save at once; text fields save on leaving the field or with a Save button, never both styles mixed.
- A "Saved" confirmation that does not block, and Undo for risky changes.
- Reset a section to defaults, with a confirm step.
- Settings that need a restart or reload say so next to the control.
- A list of keyboard shortcuts (desktop), and a way to change them if the app has many.
- A danger zone at the bottom (delete data, leave team, delete account), set apart, each with a second confirm.
- Backend split (fwos does not build backends):
  - Frontend owns: the screens, input checks, applying changes at once, and storing device-only settings (browser storage, a settings file on desktop, `UserDefaults` on Mac).
  - Settings that follow the person across devices need a hosted backend or existing API to store them, plus a rule for which change wins.

## States every screen must show

- Loading: controls show placeholders and stay disabled until real values arrive, so nobody flips a switch twice.
- Saving: the changed control shows a small spinner while the rest of the page stays usable.
- Success: a short "Saved" next to the control or in a toast.
- Error (with reason + retry): the control goes back to its old value and says why, with Retry.
- Offline: device-only settings still work; synced ones are disabled or queued, and the page says which.
- No permission: settings set by an admin show as read-only and say who controls them.
- Unsaved changes: leaving a section with unsaved text asks to save or discard.
- Partial data: if one section fails to load, the others still work and that section shows its own error.

## Edge cases

- The same setting is changed on two devices: the last change wins and the other device shows it on its next load.
- Appearance is "Match system" and the system switches to dark at sunset: the app follows without a reload.
- An email change is waiting for verification: the old email stays active and the screen shows the pending one.
- Pasted text has spaces at the start or end: they are trimmed before saving.
- A setting saved by an older app version is no longer valid: the app falls back to the default instead of crashing.
- A switch is pressed three times fast: the final position is what gets saved.
- A language with long words (for example German) does not overflow labels or buttons.
- "Reset to defaults" changes only the chosen section.
- The person leaves the page while a save is still running: the save finishes or the person is warned.

## Platform conventions

- **Web**
  - Settings live at `/settings/<section>`, so emails and help pages can link straight to a section.
  - Use `prefers-color-scheme` and `prefers-reduced-motion` as the starting values.
  - Use real form controls (checkbox, radio, select) with labels, so keyboard and screen reader users can change everything.
- **Electron (desktop)**
  - On macOS, "Settings..." sits in the app menu with Cmd+,; on Windows and Linux, put it in the File or Edit menu with Ctrl+,.
  - Settings open in one window or view, and opening them again focuses the same one.
  - Read the system appearance with `nativeTheme`; store settings in a file in the app data folder.
- **Mac (SwiftUI)**
  - Use the `Settings` scene, which adds the menu item and Cmd+, for free.
  - Use a tab view with icons for sections, as the Apple Human Interface Guidelines describe, and apply changes at once with no Save or OK button.
  - Store simple values with `@AppStorage` (backed by `UserDefaults`); secrets go in the Keychain.

## Questions to settle in discovery

- Should settings follow the person to their other devices, or stay on each device? Default: account settings follow the person, look and feel stays per device. Why: people often want dark mode on one computer and light on another.
- Should changes save the moment they are made, or with a Save button? Default: save at once, with Undo for risky ones. Why: it matches what desktop and phone apps do, and nothing is lost by forgetting to press Save.
- Should a team admin be able to lock some settings for everyone? Default: no, not in the first release. Why: locked settings need roles and a backend, which adds work.
- Should the app follow the computer's light or dark mode at first? Default: yes. Why: most people set this once for their whole computer.

## Acceptance criteria starters

### AC-settings-1: A switch saves and survives a reload
- Given I am in the Notifications section, when I switch off weekly emails and reload the page, then the switch is still off.
- Proven against: local

### AC-settings-2: A failed save rolls back
- Given the server rejects changes, when I change my display name and leave the field, then the field shows my old name and a message says why it was not saved.
- Proven against: mock

### AC-settings-3: Appearance follows the system
- Given Appearance is set to "Match system", when the system switches to dark mode, then the app turns dark without a reload.
- Proven against: local

### AC-settings-4: The shortcut opens one Settings window
- Given the desktop app is open, when I press Cmd+, (Ctrl+, on Windows) twice, then one Settings window is open and focused.
- Proven against: local

### AC-settings-5: Locked settings are read-only
- Given an admin has locked the language setting, when I open Settings, then the language control is disabled and says who controls it.
- Proven against: mock
