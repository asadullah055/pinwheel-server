# Admin overview

`GET /api/dashboard/overview?range=7d` requires an authenticated admin session.
Supported ranges are `today`, `7d`, `30d`, and `month`; the default is `7d`.
The dashboard frontend and this backend endpoint need to be deployed together.

## Reporting rules

- Calendar boundaries and daily buckets use `Asia/Dhaka`. The current window ends
  at request time. The comparison uses the same elapsed portion of the previous
  window, clipped to the previous month's length for `month`.
- Product sales sum item price × quantity. Item statuses take precedence over the
  whole-order status. Cancelled, Returned, Refunded, Failed and Awaiting Payment
  items are excluded. Shipping is excluded.
- Average order sale divides product sales by the number of orders with positive
  eligible sales. Total orders includes every status in the selected window.
- Recorded payments sum stored `paidAmount` on orders placed in the window. They
  are neither payments received by transaction date nor net revenue after refunds.
- Outstanding balances use `payableAmount - paidAmount`, floored at zero, for
  orders whose whole-order status is not one of the excluded statuses above.
- Buyer counts group normalized email, then account ID, then phone; anonymous
  orders count separately. These are order-derived identities, not registrations.
- Rankings use the same eligible item statuses as product sales. Removed products
  and sellers retain their historical sales totals.
- Catalog and seller totals, stock alerts and operational attention counts cover
  all time. New seller counts use the selected reporting window. Published products
  with 1–5 units across available variants are low stock; zero available units
  means out of stock. Disabled variants do not contribute available stock.
- Email verification is not seller approval. Unpublished products are not assumed
  to be pending approval. Commission, settlement and refund amounts are not
  estimated because the current data models do not contain those ledgers.

Only aggregate counts and explicitly projected public listing/order fields leave
the endpoint. User passwords, banking fields and payment gateway metadata are
never returned. Responses use `Cache-Control: no-store`.

## Checks

Run `npm test` in `server` for period boundaries, missing-day chart data, role
isolation, empty reports, error propagation and the existing payment tests.
Run `npm run build` in `dashboard` for the production frontend build.

## Seller overview

`GET /api/dashboard/seller-overview?range=7d` uses the same date ranges and
requires a seller session plus an existing seller account. The scope always comes
from the signed session identity; query-string seller IDs do not change it.

- Each order is reduced to that seller's items before metrics, rankings, status
  summaries, recent orders or all-time tasks are calculated. A recorded item
  seller takes precedence over current product ownership. Current ownership is
  used only for legacy items without a recorded seller.
- Order counts count each matching order once. A single status across the seller's
  items becomes the summary; multiple statuses become `Mixed`. Status-card links
  use `summary=1` so order-list counts match. Operational tasks instead match any
  of the seller's items in the given status.
- Product sales and units sold use the admin exclusion rules. Delivered product
  value includes Delivered and Completed items. Neither figure is a paid amount
  or a payout balance. Recent orders show all the seller's product values,
  including cancelled items, with the seller's own status summary.
- The endpoint does not return whole-order payments, shipping charges, banking
  details, other sellers' items, or commission/payout estimates. Historical sales
  survive product deletion or transfer; current listing names and edit links are
  exposed only for products still owned by the seller.
- Seller catalog and stock alerts are scoped by `creator`. Frontend overview
  caches are keyed by the account as well as the period and discarded on unmount.
