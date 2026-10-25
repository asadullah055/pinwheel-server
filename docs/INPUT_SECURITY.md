# API input security

All mounted API routes declare body, query and path contracts in `src/middleware/inputValidation.js`. JSON bodies must use `application/json`; upload forms must use `multipart/form-data`. URL-encoded mutations are not supported. Unknown fields, repeated scalar query/form fields, selector objects, dotted/bracketed keys, prototype-related keys, oversized input and unsupported nested shapes are rejected before business processing. Plain text supports Unicode and normal punctuation; passwords are never HTML-sanitized.

Multipart schemas live in `src/utils/formSchemas.js`. Product create and update share numeric, discount, attribute, variant and image rules. Variant attributes must match declared product attributes; supplied IDs must refer to existing variants on that product. Categories and brands selected for creation or reassignment must exist and be active. MongoDB schema validators provide a second check for variant numbers.

## Limits

| Input | Application limit |
| --- | --- |
| JSON body | 128 KiB |
| Multipart text fields | 40 fields, 512 KiB total |
| Nested objects | 8 levels; bounded node/array counts |
| Price/shipping amount | Finite, 0–100,000,000, at most two decimal places; price must be positive |
| Product stock | Integer, 0–1,000,000 |
| Order quantity / items | Integer, 1–1,000 per item; at most 100 items |
| Product variants / attributes | At most 500 variants, 10 attribute names and 100 values per attribute |
| Product images | At most 8; 500 KiB per image |
| Logo/banner/identity file | 5 MiB each; only the declared file fields are accepted |
| Raster formats | JPEG, PNG, WebP; 16 million input pixels, sides at most 8,000 pixels, one frame |
| Identity PDFs | At most 10 pages; rejected if encrypted or containing detected scripts, forms, attachments or external actions |
| List pagination | Page 1–10,000, limit 1–100; storefront controller additionally caps its results at 48 |

Hosting limits may be stricter than application limits. Raster uploads are decoded and rewritten to WebP, with bounded dimensions and no original metadata. PDFs are checked and rebuilt in a separate worker with a five-second deadline and a 64 MiB V8 heap budget. This does not constitute antivirus scanning or a guarantee against every malicious PDF/reader vulnerability.

## HTML, URLs and database queries

DOMPurify sanitizes description/highlight HTML before storage. The dashboard sanitizes editor values and the storefront sanitizes rendered HTML, including legacy records. Only the explicit formatting tags and attributes are kept; scripts, event handlers, SVG, embedded images/frames, arbitrary styles and active URL schemes are removed. Plain-text fields reject HTML/control characters instead of being treated as HTML.

Database filters are built by the server from validated scalars. Product/brand/category duplicate-name regexes escape user text. Input objects cannot supply MongoDB operators. Blanket `sanitizeFilter` was deliberately not enabled globally because the application itself uses legitimate MongoDB operators; schemas and explicit query construction enforce the trust boundary. Production Mongoose queries use a ten-second maximum execution time.

Banner destinations accept HTTPS URLs without credentials or internal paths. New gallery image URLs must belong to an `UploadAsset` recorded by the same account. Previously stored images can be retained on their existing product; legacy Cloudinary HTTP URLs are upgraded to HTTPS. Arbitrary external image URLs are rejected.

## Upload and checkout protocol changes

Deploy the server, dashboard and storefront changes together.

- The dashboard now posts one image to `/api/product/images`; the server validates, rewrites and uploads it, records ownership, and returns its URL. The old `/api/product/image-signature` returns `410` and no longer issues reusable direct-upload signatures. Successful and rejected form processing clean up temporary files.
- Checkout requests with `checkoutRequestId` must include a random 32-byte hex `checkoutAccessToken`. The storefront persists it with the retry ID in session storage. The database stores only its SHA-256 digest. Knowing a checkout ID alone cannot disclose the order/invoice token. Existing guest orders without this digest cannot be recovered through the idempotency path; their existing invoice/payment access tokens still work.
- Malformed input returns controlled `400`, unsupported content types `415`, excessive payloads `413`, and rate limits `429` with `Retry-After`. Field validation messages do not disclose database casting/stack details. Unexpected failures return a generic server error.

## Abuse controls

MongoDB `RequestLimit` counters are shared across serverless instances and have a TTL index. Keys hash identities instead of storing IPs/emails directly. Limits are 600 API requests/minute/IP, 30 authentication requests per endpoint/15 minutes/IP and account email, 20 checkouts/15 minutes/IP, 20 invoice requests/minute/IP, and 60 upload/form requests/15 minutes/IP. Multipart processing also has an account quota of 120 requests/15 minutes, which cannot be bypassed by changing IPs. Store failures fail closed. Adjust these explicit business limits in code after observing legitimate traffic.

Vercel deployments trust one managed proxy hop; direct deployments do not trust arbitrary forwarding headers. When moving to another reverse proxy, configure its trusted addresses and header overwriting before relying on IP quotas. Helmet adds API security headers. CORS and origin checks remain separate from input validation and authorization.

`UploadAsset` and `RequestLimit` are new collections; normal Mongoose initialization creates their indexes. No existing production records were rewritten. No deployment or live payment/email/upload was performed during local verification.

## Verification

The backend suite covers boundary rejection, NoSQL/prototype payloads, rich-text sanitization, multipart number parsing, real image decoding, PDF active content, owned uploads, checkout access, concurrent rate counters and existing authentication/inventory/payment behavior. Tests use disposable local MongoDB replica sets and mocked external services. Also run both frontend builds, dashboard utility tests, targeted lint and `security-review/browser-smoke.cjs` before deployment.

Local results on 25 October 2026: 99 backend tests and 14 dashboard utility tests passed; both production builds passed; the browser smoke check passed without page errors; all three dependency audits reported zero known vulnerabilities. Targeted lint passed with the dashboard's existing missing-prop-types rule excluded; the storefront retains its pre-existing effect/state warning. Vite also reports its existing large-bundle warning. These checks do not exercise real Cloudinary, SMTP, bKash or a Linux/Vercel deployment.
