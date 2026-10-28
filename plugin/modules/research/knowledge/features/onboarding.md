# Onboarding

Gets a new person from first open to their first useful result quickly, and teaches only what they need along the way.

## Sub-features a complete version needs

- A first-run screen that says what the app does in one line and has one main button.
- The shortest path to a first result: create the first item, import some data, or load a sample.
- Sample data, clearly marked, that can be removed in one step.
- A short setup that asks only what the first screen needs (a name, a goal, a preference), each question skippable.
- A progress hint for multi-step setup ("Step 2 of 3") and a Back button on every step.
- "Skip for now" on everything that is not required, and a way back to it later from Settings or Help.
- Empty states that teach: each empty screen says what goes there and has the button to add it.
- A checklist of first tasks that ticks itself off as the person does them, and can be hidden.
- One-time tips next to new controls, shown once, never stacked on top of each other.
- "What's new" after an update, shown once and only when there is something worth saying.
- Permission asks (notifications, files, camera) at the moment they are needed, with a line on why, never all at first launch.
- Progress kept, so closing the app mid-setup resumes at the same step.
- Backend split (fwos does not build backends):
  - Frontend owns: every screen, tips, the checklist, and progress kept on the device. Onboarding can run with no backend at all.
  - If progress must follow the person across devices, or setup depends on invites or teams, a hosted backend or existing API must store that.

## States every screen must show

- First run: no data yet, with the main action and an option to load sample data.
- Loading: steps that fetch data (templates, team details) show placeholders, not a blank step.
- Error (with reason + retry): a step that fails to load or save keeps the person's answers and offers Retry and Skip.
- Offline: steps that need the network say so and let the person continue with the rest.
- Resumed: a person who left mid-setup sees "Pick up where you left off" with the step named.
- Done: a clear end, or a direct jump to the person's first useful screen, never a dead end.
- Empty (zero): every main screen has a teaching empty state, separate from its filtered-empty state.
- Returning person: someone who already finished never sees onboarding again on that account.

## Edge cases

- The person skips every step: the app still works and shows helpful empty states.
- The person refreshes or quits on step 3: they return to step 3 with earlier answers kept.
- The person was invited to an existing team: team creation is skipped and they land in the shared space.
- Sample data is loaded, then real items are added: removing sample data keeps the real ones.
- A tip points at a control that is hidden in a small window: the tip waits until the control is visible, or is not shown.
- The person declines a system permission: the app says what will not work and how to turn it on later.
- Keyboard-only and screen reader users can finish every step and close every tip.
- A very long name does not break the welcome screen layout.
- Onboarding is restarted from Settings (for a new person on the same device): it runs again without deleting data.

## Platform conventions

- **Web**
  - Each step has its own address so Back and refresh work; do not trap the person in a modal.
  - Ask for browser notification permission only after the person turns on an alert in the app.
- **Electron (desktop)**
  - The first window opens centered at a sensible size; after that, remember size and position.
  - Ask for macOS permissions (files, screen, notifications) at first use, with a link to System Settings if they were denied.
  - Offer "Open at login" as an off-by-default choice, never turned on silently.
- **Mac (SwiftUI)**
  - Follow the Apple Human Interface Guidelines on onboarding: keep it short, let people skip it, and teach by doing rather than long tours.
  - A welcome window or first-run sheet is fine; avoid splash screens that delay the app.
  - Put "What's New" in the Help menu as well as showing it once after an update.

## Questions to settle in discovery

- What is the one thing a new person should do in their first minute? Default: create or import their first item. Why: people who get a result early are more likely to come back.
- Should the app start with example data? Default: offer it as a choice, not load it by default. Why: example data helps people explore but gets in the way once they add their own.
- Must people answer setup questions before they can use the app? Default: no, every question can be skipped. Why: each required step makes some people give up.
- Should onboarding progress follow the person to other devices? Default: no, keep it on the device in the first release. Why: syncing it needs a backend, and seeing it twice costs little.

## Acceptance criteria starters

### AC-onboarding-1: First run leads to a first item
- Given I open the app for the first time, when I follow the main button, then I can create my first item in three steps or fewer.
- Proven against: local

### AC-onboarding-2: Setup resumes where I left off
- Given I quit during step 2 of setup, when I open the app again, then I am on step 2 with my earlier answers filled in.
- Proven against: local

### AC-onboarding-3: Skipping everything still works
- Given I skip every setup step, when I reach the main screen, then I see a teaching empty state with a button to add my first item.
- Proven against: mock

### AC-onboarding-4: Sample data removes cleanly
- Given I loaded sample data and added one real item, when I choose "Remove sample data", then only the sample items are gone and my item remains.
- Proven against: local

### AC-onboarding-5: Onboarding shows only once
- Given I finished onboarding, when I sign out and back in on the same device, then onboarding does not show again.
- Proven against: local
