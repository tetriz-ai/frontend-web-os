# Payments

Lets a person pay for the app or for things in it, see what they paid, and change or cancel their plan.

## Sub-features a complete version needs

- A pricing page: each plan, what it includes, the price and currency, the billing period, and whether tax is included.
- Checkout through the payment provider's hosted checkout page or its embedded payment elements. The app's own forms never collect card numbers.
- Success and cancel return pages that ask the backend for the real payment status before showing "Paid".
- A free trial with its end date shown, and a reminder before the first charge.
- Upgrade, downgrade and cancel, with the new price and access dates shown before confirming (prorated amount, end of period).
- A billing page: current plan, next charge date and amount, payment method (last 4 digits only, from the provider), and receipts or invoices to download.
- Update the payment method through the provider's hosted billing page.
- Failed payment handling: a banner, a grace period, automatic retries, and what stops working if it is not fixed.
- Extra bank checks (for example a one-time code from the bank) handled inside the provider's flow.
- Refunds and promo codes, if discovery asks for them.
- Access to paid features follows the backend's record of the plan, never a flag stored in the browser.
- Backend split (fwos does not build backends; payments always need one):
  - Frontend owns: the pricing page, buttons that start checkout, return pages, the billing page, showing plan status, locking paid features in the UI.
  - A hosted backend or existing API must provide: creating checkout sessions with the secret key, receiving the provider's webhooks, storing who has which plan, deciding access, invoices, tax, refunds.

## States every screen must show

- Loading: the pay button shows progress and is disabled, so nobody is charged twice.
- Processing: back from checkout, "Confirming your payment" until the backend confirms, with a time limit and help text.
- Success: plan name, amount, next charge date, and a link to the receipt.
- Cancelled: the person left checkout, nothing was charged, and they are back on the pricing page.
- Error (with reason + retry): the payment failed, in the provider's words, with "Try again" and "Use another method".
- Offline: buttons that start payment are disabled with a note; the billing page shows the last known plan.
- No permission: only the account owner or a billing admin sees billing; others see who to ask.
- Past due: a banner on every screen with the amount, the date access stops, and a button to fix the payment method.

## Edge cases

- The person closes the tab right after paying: the plan still turns on from the provider's webhook, and the next visit shows it.
- The person presses Back during checkout: nothing is charged and the app shows the cancelled state.
- The success page is opened directly without paying: it shows the true status from the backend, not "Paid".
- Checkout is started in two tabs: only one plan is created, or the second is refused.
- The plan is changed mid-period: the screen shows the prorated amount before the person confirms.
- The price is in a currency with no decimals (yen) or uses a comma as the decimal mark: it is formatted for the person's locale.
- The trial ends while the person is working: paid features lock on the next action with a clear message, and unsaved work is kept.
- A renewal payment fails: the person gets an email and a banner, and access continues for the grace period.
- The person cancels: access stays until the end of the paid period, and that date is shown.

## Platform conventions

- **Web**
  - Redirect to the provider's hosted checkout, or embed the provider's own payment fields in a frame; app code never sees card numbers.
  - Load the provider's script only from the provider's own domain, and keep every secret key on the backend.
- **Electron (desktop)**
  - Open checkout and the billing page in the system browser, return to the app through a custom app link, then re-check the plan with the backend.
  - Do not load checkout inside the app window.
- **Mac (SwiftUI)**
  - Mac App Store apps that sell digital content or features must use Apple in-app purchase (StoreKit); physical goods and real-world services can use an outside provider.
  - With StoreKit 2: load products from the store, handle pending and family-shared purchases, and offer "Restore Purchases".
  - Let people manage or cancel subscriptions from inside the app through the system subscription sheet.
  - Apps sold outside the Mac App Store can open a web checkout in the browser.
  - Rules on linking to outside payment differ by country and change over time; check the current App Review Guidelines before release.

## Questions to settle in discovery

- What are people paying for: a monthly or yearly plan, one-time purchases, or both? Default: one monthly and one yearly plan. Why: it is the simplest setup, and every hosted checkout supports it.
- Is there already a payment provider account and a backend that can talk to it? Default: assume no, and plan for hosted checkout plus a small hosted backend. Why: fwos builds only the frontend, and payments always need a server to hold the secret key.
- Should there be a free trial, and does it need a card up front? Default: 14 days, no card. Why: more people try the app, and nobody is charged by surprise.
- Will the Mac app be sold in the Mac App Store? Default: yes, if Mac is a target. Why: it must then use in-app purchase, which changes how plans are set up and priced.
- What happens when a payment fails? Default: 7 days of full access with reminders, then paid features lock but data stays. Why: most failures are expired cards, and people fix them when reminded.

## Acceptance criteria starters

### AC-payments-1: Checkout uses the provider's page
- Given I am on the pricing page, when I choose a plan and press "Subscribe", then I am sent to the provider's hosted checkout and no card field is part of the app's own pages.
- Proven against: local

### AC-payments-2: Success is confirmed by the backend
- Given I opened the success page without paying, when it loads, then it shows my real plan status and no "Paid" message.
- Proven against: mock

### AC-payments-3: A test-mode payment turns the plan on
- Given the provider is in test mode, when I pay with a test card and return to the app, then my plan shows as active within 30 seconds.
- Proven against: real

### AC-payments-4: Cancelling keeps access until the period ends
- Given I am on a paid monthly plan, when I cancel, then the billing page shows the date my access ends and paid features still work until then.
- Proven against: mock

### AC-payments-5: Past due shows a way to fix it
- Given my renewal payment failed, when I open the app, then every screen shows a banner with the amount due, the date access stops, and a button to update my payment method.
- Proven against: mock

### AC-payments-6: Restore purchases on Mac
- Given I bought a plan in the Mac app on another computer, when I choose "Restore Purchases", then the plan becomes active without paying again.
- Proven against: real
