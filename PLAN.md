# Implementation Plan: Razorpay Payment Verification and Google Drive Access Automation

## 1. Role and objective

Act as a senior full-stack engineer specializing in Cloudflare Workers, serverless architecture, TypeScript, D1, Queues, Razorpay webhooks, Google Drive API, and application security.

Build a lightweight, secure, production-oriented MVP that automatically grants Google Drive folder access after successful Razorpay Payment Link payments.

The application must include:

- A React admin dashboard.
- Cloudflare Workers for the backend.
- Cloudflare D1 as the primary database.
- Cloudflare Queues for asynchronous access granting.
- A reliable retry and recovery mechanism.
- Google Drive API integration.
- Product-to-Payment-Link-to-folder mapping.
- Secure authentication for all admin functions.
- Deployment and configuration documentation.

The application's primary purpose is digital product delivery. For example, a customer pays ₹99 for an Excel course using one Razorpay Payment Link, and the system automatically grants the customer's email address Viewer access to the corresponding Google Drive folder.

Another Payment Link may correspond to a React course or a template bundle. Each link must always resolve to its configured product and correct folder.

Build the actual application, not just a demonstration or a set of code snippets.

Before changing anything, inspect the existing repository, package manager, project structure, available configuration, and current implementation. Preserve useful existing code. If no project exists, initialize one using the architecture below.

Do not stop to ask for routine decisions. Make sensible implementation choices, document them, and complete the work in small, verifiable stages.

---

## 2. Mandatory architectural constraints

### 2.1 Cloudflare-first design

Use the following stack:

- Frontend: React, Vite, TypeScript.
- API: Cloudflare Workers and Hono, or a minimal native Worker router if Hono adds unnecessary complexity.
- Database: Cloudflare D1.
- Asynchronous processing: Cloudflare Queues.
- Validation: Zod or another lightweight TypeScript validation library.
- Migrations: SQL migration files managed through Wrangler.
- Tests: Vitest with mocked external APIs and webhook fixtures.
- Static assets: Cloudflare Workers Static Assets, with the frontend and API preferably served from the same origin.

Use TypeScript strict mode.

Avoid introducing services that require a permanently running server. Do not use Express on a Node.js server, MongoDB Atlas, Redis, a VPS, external workflow automation services, or an independently hosted database.

Do not add Durable Objects, R2, KV, Workflow, or other services unless a demonstrated requirement justifies them.

Keep the architecture understandable for one developer to maintain.

### 2.2 Strict Free-tier optimization

Design around these current Workers Free constraints:

- HTTP request CPU limit: 10 ms per invocation.
- Cron Trigger CPU limit: 10 ms per invocation.
- Workers requests: 100,000 per day.
- D1: 5 million rows read per day.
- D1: 100,000 rows written per day.
- D1 database size: 500 MB per database on Free.
- Queues: 10,000 operations per day across the account.
- Queues message retention: 24 hours on Free.

Verify current limits against the official documentation before final deployment.

The application must not require paid-plan features to function.

Optimization requirements:

1. Keep the webhook handler CPU-light.
2. Never call the Google Drive API synchronously from the webhook handler.
3. Keep external work asynchronous and I/O-driven.
4. Avoid expensive synchronous cryptography, large dependency bundles, large JSON transformations, and unnecessary loops.
5. Never scan all transactions to generate dashboard statistics.
6. Index every frequently queried mapping, payment status, email, and job status.
7. Use prepared SQL statements and batch related database operations.
8. Keep Queue messages very small; carry identifiers rather than entire payment payloads.
9. Keep retry operations bounded.
10. Never assume free-tier quotas are unlimited or that exceeding D1 limits will fail gracefully. D1 quota exhaustion must be handled without falsely reporting payment fulfillment as complete.

A normal successful Queue message generally accounts for a write, read, and delete operation. Budget approximately three Queue operations per successful grant, before retries or dead-letter processing.

---

## 3. High-level architecture

Implement this flow:

Customer
→ Razorpay Payment Link
→ Razorpay `payment_link.paid` webhook
→ Cloudflare Worker
→ Verify HMAC-SHA256 signature
→ Resolve Razorpay Payment Link ID against D1
→ Validate payment and product mapping
→ Save payment and access-job records in D1
→ Send a small Queue message
→ Queue consumer
→ Claim the access-grant job
→ Obtain Google API credentials
→ Check existing Google Drive permissions
→ Create Viewer permission when needed
→ Update D1 with the result
→ Display the outcome in the dashboard.

Use D1 as the source of truth. Queue messages are instructions to process a durable database record, not the authoritative payment record.

Implement a scheduled recovery mechanism that finds jobs that were never enqueued or that stopped progressing. It must use bounded, indexed SQL queries and avoid processing the full database on every run.

Do not rely solely on Razorpay retrying a failed webhook to recover all access jobs.

---

## 4. Repository and project structure

Use a clear structure similar to the following:

```text
project/
├── src/
│   ├── index.ts
│   ├── config/
│   │   └── env.ts
│   ├── routes/
│   │   ├── webhook.routes.ts
│   │   ├── admin.routes.ts
│   │   ├── auth.routes.ts
│   │   └── health.routes.ts
│   ├── services/
│   │   ├── razorpay-verification.ts
│   │   ├── payment-service.ts
│   │   ├── product-mapping-service.ts
│   │   ├── google-drive-service.ts
│   │   ├── access-grant-service.ts
│   │   └── recovery-service.ts
│   ├── repositories/
│   │   ├── products.repository.ts
│   │   ├── payments.repository.ts
│   │   ├── webhooks.repository.ts
│   │   ├── grants.repository.ts
│   │   └── jobs.repository.ts
│   ├── queue/
│   │   ├── grant-consumer.ts
│   │   └── dead-letter-consumer.ts
│   ├── cron/
│   │   └── recovery-cron.ts
│   ├── middleware/
│   │   ├── admin-auth.ts
│   │   ├── csrf.ts
│   │   └── error-handler.ts
│   └── types/
│       └── index.ts
├── frontend/
│   └── src/
│       ├── app/
│       ├── components/
│       ├── pages/
│       ├── hooks/
│       ├── lib/
│       └── types/
├── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── fixtures/
│   └── e2e/
├── public/
├── wrangler.jsonc
├── package.json
├── tsconfig.json
├── .gitignore
├── .dev.vars.example
└── README.md
```

Adapt the structure when justified. Do not create empty abstractions or unnecessary files merely to match this example.

Keep backend secrets and Google credential handling exclusively on the server side.

---

## 5. D1 database design

Use SQL migrations, explicit foreign keys, unique constraints, and indexes.

### 5.1 Products table

Store the deliverable configuration.

Required fields:

- `id`: application-generated UUID or stable identifier.
- `name`: product name.
- `description`: optional description.
- `drive_folder_id`: exact Google Drive folder ID.
- `expected_amount_paise`: integer amount in the smallest currency unit.
- `currency`: default `INR`.
- `active`: Boolean/integer flag.
- `created_at`.
- `updated_at`.

Store ₹99 as `9900`, not as a floating-point value.

Use integer arithmetic for payment validation.

Deactivating a product must prevent new automatic grants, without deleting historical payment records.

### 5.2 Payment Link mappings table

Maintain a separate table linking Razorpay identifiers to products.

Required fields:

- `razorpay_link_id`: primary key or unique identifier.
- `product_id`: foreign key to products.
- `active`.
- `created_at`.

Support multiple distinct Razorpay Payment Link IDs for one product if needed.

A particular Payment Link ID must never map to multiple products.

The application must resolve a payment using the exact identifier `payload.payment_link.entity.id`.

Never determine the product from the buyer's email, amount alone, description, or frontend URL.

### 5.3 Webhook events table

Record received events and their handling results.

Required fields:

- `event_id`: unique event ID, preferably from the `x-razorpay-event-id` header.
- `event_type`.
- `razorpay_link_id`.
- `razorpay_payment_id`.
- `received_at`.
- `processing_status`.
- `reason_code`.
- `payload_hash`, optional.

Do not store entire webhook bodies by default. Avoid logging or persisting unnecessary personal data.

Support statuses such as:

- `received`
- `processed`
- `ignored`
- `unmapped`
- `manual_review`
- `failed`

Duplicate webhook event IDs must not create duplicate payments or grants.

### 5.4 Payments table

Required fields:

- `razorpay_payment_id`: unique identifier.
- `razorpay_link_id`.
- `product_id`, nullable for unmatched payments.
- `buyer_email`, nullable until resolved.
- `normalized_email`, nullable until resolved.
- `amount_paise`.
- `currency`.
- `payment_status`.
- `access_status`.
- `created_at`.
- `updated_at`.

Use separate payment and access states. A payment can be confirmed even when Google Drive access is still pending.

Possible access states:

- `pending`
- `queued`
- `processing`
- `granted`
- `failed`
- `manual_review`

Do not mark access as granted merely because payment succeeded or a Queue message was sent.

### 5.5 Access grants table

Required fields:

- `id`.
- `product_id`.
- `drive_folder_id`.
- `buyer_email`.
- `normalized_email`.
- `status`.
- `permission_id`, nullable.
- `attempt_count`.
- `next_attempt_at`, nullable.
- `lease_until`, nullable.
- `last_error_code`, nullable.
- `last_attempt_at`, nullable.
- `granted_at`, nullable.
- `created_at`.
- `updated_at`.

Enforce uniqueness on `(drive_folder_id, normalized_email)`.

This prevents the same buyer from being granted the same folder multiple times by separate successful purchases or duplicate messages.

If the grant already exists and its status is `granted`, reuse the existing result instead of calling Google Drive again.

### 5.6 Durable outbox/jobs table

Implement a durable outbox for asynchronous work.

Required fields:

- `id`.
- `job_type`.
- `grant_id`.
- `dedupe_key`, unique.
- `status`.
- `attempt_count`.
- `next_attempt_at`.
- `last_attempt_at`.
- `dispatched_at`.
- `lease_until`.
- `last_error_code`.
- `created_at`.
- `updated_at`.

Useful statuses include:

- `pending`
- `queued`
- `processing`
- `completed`
- `retry`
- `manual_review`

Use a stable deduplication key for each grant job.

The database outbox must survive Queue send failures. An event must never be considered fully processed only because the webhook returned HTTP 200.

### 5.7 Indexes and quota optimization

At minimum, create indexes for:

- `payments.created_at`.
- `payments.access_status, payments.created_at`.
- `payments.normalized_email`.
- `payments.razorpay_link_id`.
- `webhook_events.event_type, received_at`.
- `access_grants.status, next_attempt_at`.
- `outbox_jobs.status, next_attempt_at`.
- `outbox_jobs.dispatched_at`.
- `products.active`.

Avoid indexes that provide no measurable query benefit.

Use `EXPLAIN QUERY PLAN` to validate critical queries.

Use SQLite-compatible SQL supported by D1. Test all migrations against local and remote D1.

Use atomic batches for logically related D1 changes. Do not assume a database transaction can also atomically publish a message to Cloudflare Queues.

---

## 6. Razorpay webhook security

Create the public endpoint:

`POST /api/webhooks/razorpay`

Configure it for the `payment_link.paid` event.

### 6.1 Signature verification

This is mandatory.

1. Read the exact raw request body.
2. Read `X-Razorpay-Signature`.
3. Compute HMAC-SHA256 using the Razorpay webhook secret and the raw body bytes.
4. Compare the received hexadecimal signature against the computed signature using a constant-time comparison.
5. Reject an invalid or missing signature.
6. Parse JSON only after successful signature verification.

Use the Web Crypto API. Avoid Node.js-only crypto packages or heavyweight dependencies.

Do not parse and re-serialize JSON before calculating the HMAC. This changes the signed message.

Reject oversized request bodies, malformed payloads, and unexpected structures safely.

Optional secret rotation should support a previous webhook secret for a controlled transition period, without logging secrets.

Official reference: https://razorpay.com/docs/webhooks/validate-test

### 6.2 Event idempotency

Razorpay can deliver duplicate webhook events.

Use both of these protections:

- Unique `x-razorpay-event-id` in `webhook_events`.
- Unique `razorpay_payment_id` in `payments`.

Never return early on a duplicate event without verifying that the required payment and grant job have already been durably recorded.

If an event is duplicated while its outbox job is still pending, recovery must continue to be possible.

A different event ID must not cause the same payment to be fulfilled twice.

### 6.3 Event and payment validation

Only process the `payment_link.paid` event in the automatic grant flow.

Extract and validate:

- `payload.payment_link.entity.id`.
- `payload.payment_link.entity.status`.
- `payload.payment_link.entity.amount`.
- `payload.payment_link.entity.amount_paid`.
- `payload.payment_link.entity.currency`.
- `payload.payment.entity.id`.
- `payload.payment.entity.status`.
- `payload.payment.entity.amount`.
- `payload.payment.entity.currency`.
- `payload.payment.entity.email`.
- `payload.payment.entity.captured`, where provided.

For the first version, require full payment of fixed-price links and disable partial-payment behavior in the intended product configuration.

Confirm that the link is paid, the payment is captured, the link maps to an active product, the configured price matches, and the currency is correct before scheduling an automatic grant.

Do not grant access for mismatched amounts, currencies, inactive products, incomplete payments, or ambiguous mappings.

If partial-payment support is added in the future, validate cumulative payment totals separately. Do not apply a full-price single-payment check incorrectly to partial payments.

### 6.4 Missing buyer email

The payment entity's email may be null in Razorpay webhook payloads, including for some payment methods.

Do not assume `payment_link.entity.customer.email` always identifies the person who just paid. A product-specific link may be reused by different customers.

If the actual buyer email cannot be established reliably:

1. Save the confirmed payment.
2. Set access to `manual_review`.
3. Do not create the Drive permission.
4. Show the payment in the dashboard with the reason.
5. Allow the authenticated administrator to enter and validate the buyer's email, audit the change, and initiate the grant.

Never invent or guess a buyer's email.

### 6.5 Webhook response policy

- Invalid signature: reject.
- Malformed request: reject safely.
- Valid unrelated event: acknowledge without fulfillment work.
- Verified successful payment persisted to D1: proceed with durable asynchronous processing.
- D1 persistence failure: return a retryable server error.
- Queue publication failure: preserve the outbox job and return a retryable error where appropriate.
- Unknown link mapping: store a reviewable record, grant nothing, and avoid an endless retry loop.
- Payment requiring manual review: store the details and acknowledge the verified event after persistence.

The exact HTTP response behavior must be covered by tests.

---

## 7. Durable Queue publishing and recovery

Create a queue named `drive-access-grants`, plus a dead-letter queue such as `drive-access-grants-dlq`.

The Queue payload should be minimal:

```json
{
  "grantId": "grant_uuid",
  "outboxJobId": "job_uuid"
}
```

Never include Google tokens, private keys, full webhook payloads, or unnecessary personal information in Queue messages.

### 7.1 Webhook-to-Queue process

After signature verification and product resolution:

1. Validate the payment.
2. Use a D1 batch to persist the event, payment, access-grant record, and outbox job.
3. Commit the D1 changes.
4. Publish a grant message to the Queue.
5. Mark the outbox job as queued only after Queue publication succeeds.
6. Return the appropriate HTTP response.

If publishing fails, preserve the outbox job as pending/retryable. A subsequent duplicate webhook or the scheduled recovery process must be able to publish it.

If publishing succeeds but updating D1 fails, the job may be published again. This is acceptable only because the Queue consumer is idempotent.

Never attempt to solve the D1-to-Queue atomicity gap by assuming both systems support one shared transaction.

### 7.2 Scheduled recovery

Implement one bounded Cron Trigger, preferably running every minute.

For each invocation:

- Select a small batch, initially no more than 10 eligible outbox jobs.
- Use indexed queries.
- Enqueue pending jobs.
- Detect stale jobs that have stopped progressing.
- Retry only when eligible.
- Stop after a fixed amount of work.
- Never load the entire payments table.
- Never call Google Drive for every payment during the recovery scan.

Keep the Cron execution well below the Free 10 ms CPU limit by doing minimal JavaScript work. Network and database waiting do not count as CPU time, but parsing and looping do.

Use the database as the durable recovery mechanism; Queue messages expire after 24 hours on Free, so Queue retention alone is insufficient.

Recovery attempts must be bounded. Eventually mark persistently failing grants as `manual_review` and make them visible in the dashboard.

### 7.3 Consumer retry configuration

Start with:

- A small batch size, such as 1–5 messages.
- Conservative consumer concurrency, initially 1.
- A bounded maximum retry count, such as 5.
- A configured dead-letter queue.
- Explicit D1 state transitions.
- Retryable failures separated from permanent configuration errors.

Tune based on actual execution and API response times. Do not assume the Queue's existence guarantees Google Drive delivery.

Provide an administrator action to retry a failed or dead-lettered job safely.

---

## 8. Google Drive API integration

Implement a dedicated Google Drive service.

Use Google Drive API v3 to grant Viewer access to a folder, not to share the folder publicly.

The underlying operation is:

`POST https://www.googleapis.com/drive/v3/files/{folderId}/permissions`

Example request body:

```json
{
  "type": "user",
  "role": "reader",
  "emailAddress": "buyer@example.com"
}
```

Use the `reader` role, which corresponds to Viewer access.

Official reference: https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create

### 8.1 Authentication selection

Choose and document an authentication method suitable for the account that controls the folders.

Preferred candidates:

- A Google service account that has explicitly been given sufficient sharing permissions on each configured folder.
- OAuth 2.0 using the folder-owning user's refresh token, when appropriate.

Validate the chosen method against an actual test folder before treating the integration as complete. A token that can read a folder is not necessarily authorized to share it.

Do not assume service-account access works automatically. If it lacks sharing authority, return a clear configuration error.

If OAuth is used, document refresh-token storage, consent-screen publishing status, revocation, and reauthorization. External OAuth applications left in Google's Testing status can receive refresh tokens that expire after seven days for scopes beyond basic profile scopes.

References:

- https://developers.google.com/identity/protocols/oauth2/
- https://developers.google.com/workspace/drive/api/guides/manage-sharing

### 8.2 Credentials

Store all credentials as Cloudflare secrets.

For example:

- `GOOGLE_SERVICE_ACCOUNT_JSON`, if using a service account.
- Or `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` if using OAuth.
- `RAZORPAY_WEBHOOK_SECRET`.
- Appropriate administrator authentication secrets.

Do not store credentials in D1, the React frontend, Git, build output, request logs, or Queue messages.

For service-account authentication, use short-lived Google access tokens obtained from the service account's signed JWT assertion. Cache the in-memory imported signing key and access token when safely possible, with token expiry checks.

Do not make unnecessary token requests.

Use the minimum authorization scope that actually permits sharing existing folders. Do not blindly select a narrower scope if it cannot access the resources the app must manage.

### 8.3 Folder validation

When the administrator registers a product folder:

- Accept a Google Drive folder URL or folder ID.
- Extract and validate the folder ID server-side.
- Fetch folder metadata using the selected Google credentials.
- Confirm it is a folder, not a file.
- Confirm it can be accessed and shared.
- Store only the validated folder ID.
- Never accept a caller-supplied folder ID as authority to grant access without resolving it through the configured product mapping.

Display helpful setup errors for missing access or invalid folders.

Warn the administrator that permissions granted on a parent folder can propagate to child items. Keep each product folder isolated and ensure buyers do not inherit access from a broadly shared ancestor.

### 8.4 Idempotent permission creation

A Queue retry must not blindly create permissions repeatedly.

Implement the following approach:

1. Load the grant record from D1.
2. If the grant is already completed, acknowledge the message without repeating the operation.
3. Acquire a database-backed processing lease.
4. Obtain a valid Google access token.
5. List the relevant folder's permissions, with pagination where necessary.
6. Check whether the normalized buyer email already has sufficient access.
7. If the permission already exists, treat the grant as successful.
8. Otherwise, create a user permission with the `reader` role.
9. If the request times out, check the permission again before attempting another creation.
10. Save the permission ID if available.
11. Mark the grant and related payment as granted.
12. Acknowledge the Queue message.

Handle concurrent duplicates safely. Do not allow the same grant to be processed concurrently without coordination.

Send a Google Drive notification email where appropriate and supported. Do not promise that every email provider or folder-sharing policy will behave identically.

### 8.5 Google API error handling

Classify errors:

- Invalid/revoked credentials: configuration failure requiring administrator attention.
- Missing folder or insufficient sharing permission: configuration/manual review.
- Invalid recipient email: manual review.
- Rate limiting or transient 5xx: retry with backoff.
- Timeout with an uncertain outcome: reconcile existing permission before retrying.
- Existing sufficient permission: mark granted without another create operation.

Store a safe error code and short sanitized explanation. Do not store access tokens, credential JSON, or raw API responses containing unnecessary personal data.

Never leave a paid transaction incorrectly labeled as unpaid because Drive sharing failed.

---

## 9. Admin dashboard functionality

Build a compact, responsive dashboard. Do not overengineer the visual layer or add heavy charting libraries.

### 9.1 Dashboard overview

Display:

- Total successful payments.
- Gross captured revenue in integer paise, formatted as INR.
- Successfully granted accesses.
- Pending jobs.
- Failed jobs.
- Manual-review items.

Clearly distinguish successful payment revenue from any refund-adjusted net figure. The first version may display gross successful payment revenue and should label it accurately.

### 9.2 Product management

Administrator can:

- Create a product.
- Update name and expected amount.
- Configure a Google Drive folder.
- Add or disable Razorpay Payment Link mappings.
- Activate or deactivate a product.
- Inspect the product's mapped link IDs and folder.
- Validate folder access.

Prevent duplicate mappings and unsafe configuration changes.

Archive products with payment history rather than deleting historical records.

### 9.3 Payments table

Display paginated transactions with:

- Payment ID.
- Payment Link ID.
- Product name.
- Buyer email, if available.
- Amount and currency.
- Payment state.
- Drive access state.
- Transaction time.
- Last failure reason.

Add filters by product, email, payment ID, and access state.

Use server-side pagination and parameterized queries. Return a maximum of about 25 rows per page initially.

Avoid fetching all transactions to the frontend.

### 9.4 Grant management

Provide:

- A detail view for each grant.
- Attempt count and last attempt time.
- Safe error description.
- Retry action.
- Manual-review resolution for missing buyer email.
- A visible success timestamp.
- Confirmation when initiating an administrative retry.

Every manual change or retry should be authorized and recorded in an audit log.

A retry must reuse the existing grant rather than create a new grant identity.

### 9.5 Webhook event monitoring

Show recent event processing outcomes, including:

- Successfully processed events.
- Duplicate events.
- Unknown Payment Link mappings.
- Amount mismatches.
- Missing emails.
- Failed or malformed events.

Do not expose raw webhook requests or secrets in the dashboard.

### 9.6 UI principles

Keep it fast and practical:

- React with TypeScript.
- Reusable table, form, status, dialog, and metric components.
- Loading, empty, error, and success states.
- Server-side pagination.
- Good responsive layout.
- Accessible labels.
- No public admin endpoints.
- No unnecessary charts or large dependency bundles.

---

## 10. Admin authentication and application security

The webhook endpoint must remain publicly reachable for Razorpay, while all administrative operations require authentication.

Prefer Cloudflare Access when configured correctly for the deployment. If using Access, ensure the actual admin APIs are protected and the webhook route remains reachable without bypassing its signature validation.

If implementing application-level authentication:

- Support one initial administrator.
- Store the administrator credential securely; never hardcode a password.
- Use Web Crypto for appropriate password verification and signed or opaque sessions.
- Use an `HttpOnly`, `Secure`, appropriately `SameSite` cookie.
- Implement logout and session expiry.
- Add CSRF protection for cookie-authenticated state-changing requests.
- Rate-limit login attempts with bounded storage.
- Verify authorization in backend middleware, not only in React.
- Require authentication for product changes, folder mapping, manual email edits, retries, and payment inspection.
- Audit manual state changes.

Do not use a static frontend variable as an authentication secret.

If browser and API endpoints are on different origins, configure strict CORS. Prefer same-origin deployment to avoid unnecessary complexity.

Also implement:

- Secure response headers.
- Strict environment-variable validation at startup.
- Input validation for every administrative request.
- SQL prepared statements.
- Controlled error responses.
- Safe logging.
- No raw request-body logging.
- No leaked credentials in stack traces.

---

## 11. API contract

Implement a small, consistent API.

Public endpoints:

- `GET /api/health` — minimal service status.
- `POST /api/webhooks/razorpay` — signed Razorpay webhook.

Authenticated endpoints:

- `GET /api/admin/me`
- `GET /api/admin/dashboard/summary`
- `GET /api/admin/products`
- `POST /api/admin/products`
- `PATCH /api/admin/products/:id`
- `POST /api/admin/products/:id/payment-links`
- `DELETE /api/admin/payment-links/:linkId` or disable the mapping
- `GET /api/admin/payments`
- `GET /api/admin/payments/:id`
- `GET /api/admin/webhook-events`
- `GET /api/admin/grants`
- `POST /api/admin/grants/:id/retry`
- `POST /api/admin/payments/:id/resolve-email`
- Appropriate authentication endpoints if application-managed authentication is selected.

Use predictable JSON error objects containing a machine-readable code and a safe human-readable message.

Never return raw SQL errors, Google tokens, private keys, webhook secrets, or internal stack traces.

Do not create a generic endpoint that accepts arbitrary folder IDs and arbitrary email addresses and grants access. Every automatic grant must resolve to a configured product and a verified payment.

---

## 12. CPU and performance implementation rules

This section is mandatory.

### Webhook execution

- Read only the small webhook body.
- Use Web Crypto rather than a heavy cryptography library.
- Verify the HMAC over the original bytes.
- Parse only once, after verification.
- Validate only fields relevant to fulfillment.
- Resolve the mapping through an indexed primary-key lookup.
- Use a small number of prepared D1 statements.
- Use D1 batch transactions for associated persistence.
- Publish a tiny Queue message.
- Never enumerate all products or payments.
- Never call Google Drive from this request.
- Never use unbounded retries or `while` loops.
- Keep ordinary valid requests comfortably below 10 ms of CPU.

### Queue consumer execution

- Process a small batch.
- Deserialize a tiny message.
- Load one grant and its associated product.
- Acquire a lease.
- Make only necessary Google API calls.
- Avoid repeating permission-list requests when the D1 record already says the grant is complete.
- Keep network waits asynchronous.
- Update only the affected rows.
- Retry transient errors, not permanent configuration failures.

### Cron execution

- Run one scheduled recovery handler.
- Query only a small bounded batch of eligible jobs.
- Use indexed status and scheduling fields.
- Avoid scanning the full tables.
- Limit per-run iterations.
- Make re-enqueueing idempotent.

### Dashboard execution

- Aggregate via SQL rather than JavaScript.
- Use paginated endpoints.
- Fetch only required fields.
- Do not return the entire payment table.
- Avoid repeated refetching and unnecessary rerenders.

### Bundle optimization

- Keep Worker dependencies light.
- Use Workers-compatible packages.
- Avoid importing browser-only modules into the Worker.
- Avoid Node.js built-ins that require unnecessary compatibility shims.
- Inspect the production bundle.
- Do not add dependencies that are not justified by a concrete requirement.

---

## 13. Environment configuration

Define typed Cloudflare bindings for:

- `DB`: D1 database.
- `GRANT_QUEUE`: Queue producer.
- Optional `RAZORPAY_WEBHOOK_SECRET_PREVIOUS`.
- Required `RAZORPAY_WEBHOOK_SECRET`.
- Google credential secrets appropriate to the chosen authentication method.
- Required administrator authentication settings.

Use Wrangler bindings for D1 and Queues rather than connecting through public database endpoints.

Store production secrets with `wrangler secret put`. Keep development secrets in `.dev.vars`, exclude that file from Git, and provide only placeholder names in `.dev.vars.example`.

Do not include usable secrets in examples, screenshots, logs, or documentation.

The deployment guide must include commands for:

- Installing dependencies.
- Local development.
- Applying local migrations.
- Creating the remote D1 database.
- Applying remote migrations.
- Creating Queue and dead-letter Queue resources.
- Configuring bindings and Cron Trigger.
- Adding secrets.
- Building and testing.
- Deploying to Cloudflare.
- Checking logs and troubleshooting failures.

Do not invent account IDs, domain names, real Payment Link IDs, or Google folder IDs.

Use placeholders in examples and explain how to obtain the correct values.

---

## 14. Testing requirements

Do not declare the project finished merely because it compiles.

### 14.1 Webhook unit tests

Test:

- Valid signature.
- Invalid signature.
- Missing signature.
- Modified body after signing.
- Malformed JSON.
- Unexpected payload schema.
- Correct `payment_link.paid` processing.
- Unrelated events are ignored safely.
- Missing or malformed buyer email.
- Unknown Payment Link ID.
- Inactive product.
- Wrong payment amount.
- Wrong currency.
- Payment not captured.
- Link not fully paid.
- Duplicate event ID.
- Different event IDs for the same payment.
- D1 failure.
- Queue publication failure.
- Repeated dispatch.
- Manual-review payment.

Include realistic Razorpay fixture payloads, including a case where `payment.entity.email` is null.

### 14.2 D1 tests

Test migrations and constraints for:

- Unique Payment Link mapping.
- Unique payment ID.
- Unique event ID.
- Unique folder/email grant.
- Valid product foreign keys.
- Product archival.
- Atomic event/payment/outbox persistence.
- Bounded retry counts.
- Correct payment and access states.
- Indexed pagination and filters.

Use local D1 or an appropriate D1 test harness.

### 14.3 Queue and recovery tests

Test:

- Successful grant.
- Duplicate Queue delivery.
- Already-granted permission.
- Temporary Google API failure.
- Authentication failure.
- Missing folder.
- Invalid email.
- Queue publication failure.
- Stale job recovery.
- Outbox state-update failure after successful publication.
- Consumer failure and retry.
- Dead-letter processing.
- Manual retry.
- Queue message expiry and durable recovery.
- Concurrent duplicate messages.

The expected behavior is that payment remains recorded and no customer receives access to an unrelated folder.

### 14.4 Google Drive tests

Mock the Google token service and Drive API for ordinary automated tests.

Verify:

- Token acquisition or refresh.
- Correct folder ID.
- Correct `reader` permission role.
- Correct buyer email.
- Existing permission detection.
- Idempotent retries after uncertain outcomes.
- Transient API response handling.
- Permission errors.
- Permission ID persistence.
- No secrets in logs.

Provide a documented optional live integration test using a dedicated test folder and test recipient.

Never run automated tests against real customer folders or real buyers.

### 14.5 Frontend tests

Cover:

- Admin authentication.
- Product creation and editing.
- Payment Link mapping.
- Form validation.
- Dashboard loading and empty states.
- Payment filtering and pagination.
- Retry confirmation.
- Manual email resolution.
- Error feedback.
- Unauthorized API responses.

### 14.6 Security acceptance tests

Prove that:

- An invalid webhook signature never creates a grant.
- A payment with a mismatched amount never creates a grant.
- An unknown Payment Link ID never grants a folder.
- A browser cannot change the folder ID used for a paid transaction.
- Unauthenticated users cannot read or modify administrative data.
- Duplicate webhook and Queue delivery do not create duplicate grants.
- All grant operations use the folder resolved from the database mapping.

---

## 15. Monitoring, logging, and failure visibility

Record structured, sanitized logs containing identifiers and status codes.

Useful fields:

- Correlation ID.
- Webhook event ID.
- Razorpay payment ID.
- Razorpay Payment Link ID.
- Product ID.
- Grant ID.
- Outbox job ID.
- Duration.
- Result status.
- Sanitized error code.

Do not log entire request bodies, buyer email unless operationally necessary, OAuth tokens, service-account JSON, private keys, or webhook secrets.

Use the Cloudflare dashboard for CPU, request, D1 and Queue metrics.

Create dashboard visibility for:

- Pending access grants.
- Retryable failures.
- Dead-lettered jobs.
- Manual-review items.
- Oldest pending job.
- Jobs that have exceeded the allowed retry count.

Document the manual recovery procedure.

The product must not silently mark access as granted when Google Drive returns a failure.

---

## 16. Implementation phases

Execute these phases in order.

### Phase 1 — Repository assessment

Inspect the repository, dependencies, available bindings, configuration and existing code. Document the implementation plan briefly and start building immediately.

### Phase 2 — Foundation

Set up TypeScript, Worker entry point, frontend build, Wrangler configuration, environments, D1 binding and local development.

### Phase 3 — Data model

Create SQL migrations, indexes, unique constraints, seed fixtures and repository functions. Test the schema against D1.

### Phase 4 — Webhook verification

Implement raw-body HMAC verification, payload validation, event idempotency, Payment Link mapping, payment validation and safe review handling.

### Phase 5 — Durable processing

Implement atomic D1 persistence, grant deduplication, outbox creation, Queue dispatch, Queue consumer and scheduled recovery.

### Phase 6 — Google Drive

Implement the chosen authentication method, folder validation, permission listing, Viewer permission creation, duplicate handling and retry logic.

### Phase 7 — Dashboard and security

Implement authentication, products, Payment Link mappings, payments table, grant management, webhook history, audit logging and dashboard summary.

### Phase 8 — Automated tests

Add and run unit, integration and frontend tests. Fix failures before deployment.

### Phase 9 — Production readiness

Review secret handling, quota optimization, API response behavior, retry logic, D1 constraints, bundle size and Cloudflare configuration.

### Phase 10 — Deployment

Prepare remote resources and deployment instructions. Never deploy production code or modify live resources without the required credentials and authorization.

If credentials are unavailable, finish the implementation and provide the exact remaining setup commands instead of pretending deployment succeeded.

---

## 17. Definition of done

The implementation is complete only when:

1. An administrator can register multiple products.
2. Each product can map to one or more known Razorpay Payment Link IDs.
3. Each product has a validated Google Drive folder mapping.
4. A valid `payment_link.paid` webhook is verified against the original raw body.
5. A paid transaction resolves to the correct product using the exact Payment Link ID.
6. Invalid, duplicated, incomplete or ambiguous payments cannot trigger incorrect grants.
7. Missing buyer emails go to manual review.
8. Payments and outbox jobs are durably stored in D1.
9. Google Drive work happens in the Queue consumer.
10. Viewer permission creation is idempotent.
11. Failed jobs can be retried without duplicating access.
12. The dashboard shows correct payment and access states.
13. All administrative APIs require authentication.
14. D1 and Queue operations remain bounded.
15. The webhook and Cron code are optimized for Free-tier CPU constraints.
16. The recovery process covers failed publication, stale jobs and expired Queue messages.
17. All automated tests pass.
18. The README documents setup, secrets, migrations, webhooks, Google Drive authorization, deployment, testing, and failure recovery.

Before finishing, provide a concise engineering report containing:

- What was implemented.
- Architecture and key decisions.
- Changed and added files.
- Database migrations.
- Test results.
- Build and type-check results.
- Cloudflare resource requirements.
- Required secrets and manual setup.
- Remaining limitations.
- Exact deployment commands.

Do not claim a live integration has been verified unless it was actually tested.

Prioritize payment integrity, correct folder mapping, durable recovery, security and low CPU usage over extra features or visual polish.