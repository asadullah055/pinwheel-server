# bKash automatic checkout

Checkout offers Cash on Delivery and bKash. bKash supports full payment (products plus delivery) or a fixed Tk 100 advance, with the rest due on delivery. For totals below Tk 100, only full payment is available. Prices and delivery charges are checked on the server before any payment starts.

## Obtain access

A merchant phone number alone cannot enable this integration. Apply for online payment gateway access for the intended merchant account through [bKash Online Business](https://www.bkash.com/en/business/online-business). Obtain sandbox credentials and complete bKash's testing/onboarding requirements before requesting live credentials. Payments go to the merchant account associated with those credentials; a phone number supplied by a customer cannot change the recipient.

This implementation uses the current **v2 Tokenized Checkout Without Agreement** API. Ask bKash for v2 access. Older v1.2.0-beta credentials/endpoints are not interchangeable.

## Server configuration

Set these only in the server's `.env` or hosting environment. Never use `NEXT_PUBLIC_` variables for credentials or put them in the dashboard.

```dotenv
BKASH_ENV=sandbox
BKASH_APP_KEY=<provided by bKash>
BKASH_APP_SECRET=<provided by bKash>
BKASH_USERNAME=<provided by bKash>
BKASH_PASSWORD=<provided by bKash>
BKASH_CALLBACK_URL=https://your-api.example/api/order/bkash/callback
STOREFRONT_URL=https://your-store.example
```

For local sandbox work, `http://localhost:8000/api/order/bkash/callback` and `http://localhost:3000` are supported. Use the actual server port. Register/allow the callback and domains with bKash as required for your account. Live URLs must use HTTPS. Set `BKASH_ENV=live` only after successful sandbox tests and replacing all four credentials with the matching production credentials.

Keep the existing `NEXT_PUBLIC_API_URL` on the storefront pointing to this API. No additional client secret or merchant number is required. Missing credentials leave COD usable and display bKash as temporarily unavailable.

The Vercel function budget is 120 seconds to allow authentication, Execute and fallback Query (up to 30 seconds each). Enable Fluid compute or use a plan/runtime that permits this duration; see [Vercel duration configuration](https://vercel.com/docs/functions/configuring-functions/duration).

On deployments where MongoDB automatic indexes are disabled, run `Order.createIndexes()` during a controlled migration before enabling bKash. This adds the unique sparse checkout request ID and unique partial transaction ID indexes without dropping other indexes. Do not run `syncIndexes()` against production automatically.

## Behavior and recovery

- Creating a bKash order reserves inventory and sets the order/items to `Awaiting Payment`. It does not count as paid or send confirmation emails yet.
- The server creates the payment with its own calculated amount. The customer enters their wallet, OTP and PIN only on bKash's hosted page.
- Callback state, signature, payment ID, currency, intent, invoice reference, amount and transaction ID are checked. Only a server Execute response or Query response reporting `Completed` credits the order. Advance orders become `Partially Paid`; full payments become `Paid`.
- An execution is recorded before calling the provider and is never repeated for the same payment ID. Query reconciles timeouts. Repeated callbacks cannot credit the order or queue emails twice.
- The confirmation page can query payment status or resume/retry the same order. Checkout uses a persisted random request ID to recover if its initial response is lost. Do not create another order just because a callback or request timed out.
- Token grant/refresh results are persisted in the `PaymentToken` collection and protected with a database lease across serverless instances. The service reuses tokens and refreshes near expiry. Authentication failures retain a 30-minute cooldown to respect the provider's token limits; after fixing credentials, wait for that cooldown or clear only the relevant cached token record with administrative access.
- Unpaid bKash orders cannot move into fulfillment. Stock remains reserved until payment or whole-order cancellation by an admin. Once a payment session exists, wait for its 24-hour validity period to expire before cancelling. Monitor `Awaiting Payment` orders and cancel abandoned expired orders in the dashboard to release their stock. There is no background expiry worker in this repository.
- The integration does not implement refunds. Use the merchant's bKash process for refunds before marking an order refunded.

## Verification

Run `npm test` in `server`, then build the storefront and dashboard. Automated gateway tests mock the provider and database; they do not transfer funds or replace bKash's required sandbox certification.

Before live activation test real sandbox credentials for full payment, Tk 100 advance, cancellation, failed OTP/PIN, duplicate callbacks, browser refresh, Execute timeout/Query recovery, and retry after a failed session. Confirm the merchant recipient in bKash's checkout, the charged amount, transaction ID, dashboard totals and invoice.

Official references: [without agreement flow](https://developer.bka.sh/docs/tokenized-without-agreement), [Create](https://developer.bka.sh/docs/create-payment-3), [Execute](https://developer.bka.sh/docs/execute-payment-4), [Query](https://developer.bka.sh/docs/query-payment), [token management](https://developer.bka.sh/docs/token-managment-v2).
