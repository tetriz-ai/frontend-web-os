# Discovery topics

The interview covers these, in order, one topic per round, skipping any the first prompt already
answered. `--quick` asks T1 to T8 and defaults the rest as `[ASSUMED]`.

| # | Topic | Ask (with your suggestion and why) | `--quick` |
|---|---|---|---|
| T1 | The problem | What's painful today without this app? What do people do instead? | ask |
| T2 | Who it's for | Who opens it first? Who else? How often, on what device? | ask |
| T3 | Core jobs and success | What 3 things must work on day one? How will you know it works? | ask |
| T4 | Platforms | Web, a desktop app (Electron), native Mac, or a mix? Which matters most? | ask |
| T5 | Features | For each feature: must-have, later, or not doing? | ask |
| T6 | Data | Where does the data come from, and where is it saved? Is there an API already? | ask |
| T7 | Accounts | Sign-in? Which kind? Different roles? | ask |
| T8 | Design system | Do you have one (a shadcn theme, tokens, a Figma file)? A brand voice? | ask |
| T9 | Offline | Must it work without internet? Edits offline too? | default |
| T10 | Integrations | Payments, maps, AI, calendars, email? | default |
| T11 | Constraints | Deadline, team size, tech you must use or avoid? | default |
| T12 | Privacy and compliance | Personal data? GDPR, HIPAA, SOC 2? Analytics? | default |
| T13 | Accessibility and language | Which languages? Right-to-left? Target (WCAG 2.2 AA by default)? | default |
| T14 | Distribution | Where is it hosted? Mac App Store or direct download? Which desktop OSes? | default |
| T15 | App identity | The app's name, a reverse-DNS ID (com.example.app), an icon? | default |
| T16 | Minimum versions | The oldest browser or macOS to support? | default |

## Defaults when the user says "use your defaults"

| Topic | Default, tagged `[ASSUMED]` | Why |
|---|---|---|
| T4 | Web, responsive down to a phone | Works everywhere; a desktop app can come later without a rewrite |
| T6 | Local mode: data saved on this device, behind an API contract | Survives a reload with no backend; swap in a real API later |
| T7 | No sign-in for the first version | Fewer moving parts; add it when data is shared |
| T8 | The neutral starter design system, light and dark | Passes contrast; swap in your brand any time |
| T9 | Reads offline after the first visit; no offline edits | Edits offline need a sync and conflict policy |
| T10 | None | Each one adds a backend dependency |
| T12 | Only what's needed; no analytics | Nothing to consent to |
| T13 | English only, WCAG 2.2 AA | The common legal bar |
| T14 | Any static-friendly host (the user picks at release) | fwos never deploys |
| T16 | The last 2 versions of evergreen browsers | Covers most people |

## Corner cases

| Case | What to do |
|---|---|
| Very vague ("an app for notes, documents and tables") | Ask which part matters most; propose a narrow first version. |
| "Just build it" | Switch to `--quick`; show every `[ASSUMED]` item in one list before moving on. |
| Contradicts an earlier answer | Show both answers; ask which wins; log it in decisions.md. |
| Doesn't know | Suggest a default with the reason, tagged `[ASSUMED]`. |
| Scope is huge | Propose a first release of the 3 core jobs; move the rest to "later" with the user's OK. |
| Question fatigue | After round 3, offer to default the remaining topics. |
| Confidential idea | Ask once whether research may use the idea's words in web searches. |
| Wants a phone app | Say it isn't supported; offer responsive web or a PWA; record the choice. |
| Wants a backend | fwos doesn't build one: offer a contract with mocks, local mode, or their existing API or hosted backend (Supabase, Firebase). |
