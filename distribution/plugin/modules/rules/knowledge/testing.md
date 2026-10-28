# Testing

Tests prove the acceptance criteria (ACs) and the states a user can see. Rule ids are stable: lenses, checks and test names cite them.

**R-tests-1: Test what a user sees and does, not code details.**
Find elements by role, label and text (`getByRole('button', { name: 'Save' })`), act like a user (type, click, press keys), and assert on what's on screen or in the URL. Don't assert on internal state, hook calls, class names, or snapshots of markup.
- Don't: `expect(result.current.isOpen).toBe(true)` to prove a menu opened. Check the menu is visible.

**R-tests-2: Pick the cheapest level that proves the behaviour.**
- Unit (Vitest): logic in `model/`, like totals, validation rules and formatting.
- Component in jsdom (Vitest): what renders for given fake data, including each state.
- Component in a real browser: layout and geometry, like truncation, sticky headers, hit target size, a button that keeps its width.
- End-to-end (Playwright): navigation, URL state, focus across pages, first paint (no theme flash, skeleton timing), real clicks through the whole stack.
jsdom has no layout, so it can't prove geometry. Don't use end-to-end for what a unit test proves.

**R-tests-3: Tag test names with the AC and the states they prove.**
Add `@AC-<feature>-<n>` to each test that proves an acceptance criterion, and `@state:<component-or-page-id>:<state>` for each required state. Tooling reads these tags to work out coverage, so spell them exactly.
- Do: `it('shows a retry after a failed load @AC-orders-3 @state:orders-table:error', ...)`

**R-tests-4: Both sides of a seam test against the same JSON fixture.**
The repository test (does the client parse this response?) and the UI test (does the screen render this data?) load the same file from the contract fixtures folder. When the contract changes, one fixture changes and both sides fail together.
- Don't: a hand-written object in the UI test that drifts from the real response shape.

**R-tests-5: Fakes fail closed, and tests assert the fake was called.**
A fake server or repository throws on any request it wasn't set up for, so a wrong URL or a missing call can't pass quietly. Then assert the expected call happened, with its method, path and body.
- Don't: a fake that returns `{}` for anything, so the test passes even when the code calls the wrong endpoint.

**R-tests-6: Never stub the component's own hook.**
Mocking `useOrders` in the test for `OrdersTable` skips the code most likely to break. Fake the boundary instead (the repository or the network) and let the hook run.
- Don't: `vi.mock('../data/useOrders')` in the test of the component that calls it.

**R-tests-7: No fixed sleeps. Wait for the condition, and use fake timers for time.**
Wait for what you care about: `findByRole`, `expect.poll`, or Playwright's retrying `expect(locator)`. For debounces, polling and relative times, use fake timers and a fixed system time, then advance them.
- Don't: `await page.waitForTimeout(2000)` or `await sleep(500)`.

**R-tests-8: Pin everything that can vary.**
Each test sets up its own data and passes in any order. Fix the clock, time zone, locale and random seed. A test that only passes on one machine or at one time of day is broken.

**R-tests-9: Flaky means it failed, then passed on retry. Quarantine it with an expiry date, then fix it.**
Mark it quarantined with a reason and a date no more than two weeks out. It still runs but doesn't block. When the date passes, it blocks again. Fix the cause (usually a race or shared state), don't raise a timeout.

**R-tests-10: A quarantined test never proves an AC.**
While it's quarantined, its `@AC` and `@state` tags don't count toward coverage, so the AC shows as unproven until the test is fixed or another passing test proves it.

**R-tests-11: Every required state has at least one test.**
If the spec lists loading, empty, error and partial for a table, each has a test tagged `@state:<id>:<state>` that renders it and checks what the user sees. A state with no tagged test counts as not built. fwos's harness separately renders each state's fixture and judges what it shows by its name, so the tagged test is where what the state does gets checked: the retry retries, the skeleton gives way to the rows.

**R-tests-12: Test data looks like real data.**
Use fixtures with long names, a 0 value, a missing value, one item, many items and non-English text (R-states-13). A list of "Item 1", "Item 2" hides most layout and formatting bugs.

**R-tests-13: A bug fix starts with a failing test.**
Write the test that reproduces the bug, see it fail for the right reason, then fix the code. Tag it with the AC it protects, if there is one.

**R-tests-14: Automated accessibility scans are a floor, not proof.**
Run an automated scan in component and end-to-end tests, and fail on any violation. Then still test keyboard paths and focus by hand-written steps: a scan can't tell whether focus returns to the right place.
