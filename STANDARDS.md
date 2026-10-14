# Code Quality and Architecture Standards

This document establishes the mandatory standards, naming conventions, and architectural principles for both the **Cloudflare Worker backend** and the **React (Vite) frontend** across the lifetime of the `paylink-entitlements` project.

---

## 1. Single-Deployment Architecture Overview

- **Host**: Cloudflare Worker with **Workers Static Assets** (`assets = { directory: "./frontend/dist" }`).
- **Routing**:
  - `/api/*`: Handled by Hono API routes running on Cloudflare Workers edge.
  - Non-API routes / Static assets: Cloudflare Worker Static Assets serves JS, CSS, fonts, and falls back to `index.html` for client-side React SPA routing.
- **Benefits**:
  - Zero CORS overhead or configuration drift.
  - Same-origin authentication cookies (`HttpOnly`, `Secure`, `SameSite=Strict`).
  - Single atomic deployment via Wrangler (`npm run deploy`).

---

## 2. Frontend Standards (React, TypeScript & TanStack Query)

### 2.1 TanStack Query (React Query v5) Best Practices
- **Server State vs. Client State**: All remote data fetching, caching, synchronization, and server updates **must** go through TanStack Query (`useQuery`, `useMutation`).
- **Query Key Factories**: Never hardcode string arrays in components. Define centralized, strongly-typed query key factories:
  ```typescript
  export const queryKeys = {
    products: {
      all: ['products'] as const,
      lists: () => [...queryKeys.products.all, 'list'] as const,
      detail: (id: string) => [...queryKeys.products.all, 'detail', id] as const,
    },
    payments: {
      all: ['payments'] as const,
      list: (filters: PaymentFilterParams) => [...queryKeys.payments.all, 'list', filters] as const,
      detail: (id: string) => [...queryKeys.payments.all, 'detail', id] as const,
    },
  };
  ```
- **Custom Hooks Encapsulation**: Components must not call raw `useQuery` directly. Wrap each query and mutation in a descriptive custom hook (e.g., `useProducts()`, `usePayments(filters)`, `useRetryGrant()`).
- **Mutations & Invalidation**: Every mutation must specify `onSuccess` cache invalidation using `queryClient.invalidateQueries({ queryKey: ... })` to ensure the UI stays synchronized with D1.

### 2.2 Prohibiting Unwanted `useEffect`
Following the modern React 19 / industry standard guidelines:
- **NO `useEffect` for Data Fetching**: Always use TanStack Query.
- **NO `useEffect` for Transforming or Deriving State**: Derive values during render:
  ```typescript
  // ❌ BAD
  const [total, setTotal] = useState(0);
  useEffect(() => { setTotal(items.reduce(...)); }, [items]);

  // ✅ GOOD
  const total = useMemo(() => items.reduce(...), [items]); // or simply calculate directly if inexpensive
  ```
- **NO `useEffect` for User Actions**: Handle actions in event handlers (`onClick`, `onSubmit`), not by syncing state into an effect.
- **Allowed Uses of `useEffect`**: Only for true synchronization with external non-React systems (e.g., setting document title, setting up global window listeners or keyboard shortcuts, integrating third-party DOM widgets).

### 2.3 Strict Naming Conventions
- **Files & Directories**:
  - React Components: **PascalCase** (`ProductCard.tsx`, `PaymentTable.tsx`, `ConfirmDialog.tsx`).
  - Hooks: **camelCase** with `use` prefix (`useProducts.ts`, `useAuth.ts`, `useDebounce.ts`).
  - Utilities / Services: **camelCase** (`formatCurrency.ts`, `apiClient.ts`).
  - Types / Contracts: **camelCase** with `.types.ts` (`product.types.ts`, `api.types.ts`).
  - Constants: **camelCase** or **SCREAMING_SNAKE_CASE** (`constants.ts`, `queryKeys.ts`).
- **Variables & Functions**:
  - Booleans: Must use descriptive prefixes like `is`, `has`, `should`, `can` (e.g., `isLoading`, `hasError`, `canRetry`, `isActive`).
  - Event Handlers: Named with `handle` prefix in components (`handleSubmit`, `handleRetry`, `handleFilterChange`) and `on` prefix for props (`onSuccess`, `onClose`, `onSelect`).
  - Types & Interfaces: **PascalCase**, noun phrases, no Hungarian notation (e.g., `Product`, `PaymentSummary`, `CreateProductInput`; avoid `IProduct`).

### 2.4 UI & UX Standards
- **Component States**: Every view must explicitly handle 4 states:
  1. `Loading` (skeleton / spinner)
  2. `Empty` (helpful callout when list is 0)
  3. `Error` (human-readable error message with retry button)
  4. `Success` (clean data presentation)
- **Formatting**:
  - Currency: Always format Indian Rupees (INR) from integer paise using `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
  - Dates: Standard localized ISO date-time display with clear relative/absolute formatting.
- **Accessibility & Design**: Semantic HTML elements (`<main>`, `<nav>`, `<table>`, `<dialog>`), keyboard accessibility, clear focus states, contrast-compliant modern design.

---

## 3. Backend Standards (Cloudflare Workers, Hono, D1, Queues)

### 3.1 Strict Free-Tier CPU Budget (< 10 ms CPU)
- **Zero Heavy Cryptography**: Use native browser/Worker `crypto.subtle` (Web Crypto API) for HMAC-SHA256 signature verification and SHA-256 digests. Never import Node.js heavy polyfills or bulky crypto libraries.
- **Streamlined Webhook Ingestion**:
  1. Read raw body once (`await c.req.raw.text()`).
  2. Verify HMAC signature in constant time.
  3. Parse JSON once.
  4. Lookup Payment Link ID in D1 via indexed query.
  5. Commit batch to D1 (webhook event + payment record + outbox job + access grant).
  6. Enqueue small queue message `{ grantId, outboxJobId }`.
  7. Return HTTP 200/accepted response.
- **Never Call Google Drive from the Webhook**: Drive API calls happen exclusively inside the Queue consumer or background recovery.

### 3.2 Modular Backend Architecture
- `src/config/`: Typed environment schema, validated with Zod.
- `src/routes/`: Thin Hono controllers handling HTTP routing, parsing, and status codes.
- `src/services/`: Pure business logic (Razorpay verification, Payment processing, Google Drive API client, Access grant coordination, Recovery runner).
- `src/repositories/`: D1 database abstraction using prepared statements and atomic batching (`db.batch([...])`). No raw SQL string concatenations.
- `src/queue/`: Cloudflare Queue consumer with leasing, idempotency checks, and dead-letter handling.
- `src/cron/`: Bounded, indexed scheduled task for recovering pending/stale outbox jobs without full-table scans.
- `src/middleware/`: Admin authentication, CSRF validation, secure headers, and global error handling.

### 3.3 Database Integrity (D1)
- **Strict Typing**: All amounts stored in integer paise (`expected_amount_paise`, `amount_paise`).
- **Source of Truth**: D1 is the authoritative state. Queue messages are transient delivery triggers.
- **Deduplication Constraints**:
  - `webhook_events.event_id` is UNIQUE.
  - `payments.razorpay_payment_id` is UNIQUE.
  - `payment_link_mappings.razorpay_link_id` is UNIQUE.
  - `access_grants (drive_folder_id, normalized_email)` is UNIQUE.
  - `outbox_jobs.dedupe_key` is UNIQUE.

### 3.4 Google Drive Integration
- **Server-Side Authentication**: Service account JWT with RS256 using `crypto.subtle` (or OAuth 2.0 refresh flow).
- **Least Privilege**: Folder Viewer role (`role: 'reader'`).
- **Idempotency**: Before attempting creation, check existing permissions for the normalized email to prevent duplicate grants or error loops.

---

## 4. Code Quality & Testing Requirements

- **Type Safety**: TypeScript strict mode enabled (`"strict": true`, `"noImplicitAny": true`, `"exactOptionalPropertyTypes": true`).
- **Tests**:
  - Unit tests with Vitest for signature verification, payment link mapping, D1 batch construction, and data transformers.
  - Mocked tests for Google Drive API and Queue consumers.
  - Realistic fixtures for Razorpay webhooks (including `email: null` scenario).
- **Linting & Formatting**: Clean code without unused imports, dead variables, or unhandled promise rejections.

---

## 5. Git & Conventional Commits Specification (v1.0.0)

All commit messages in this repository **MUST** strictly follow the [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) specification.

### 5.1 Commit Message Structure
```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### 5.2 Structural Elements & Types
- **`feat`**: Introduces a new feature to the codebase (correlates with `MINOR` in Semantic Versioning).
- **`fix`**: Patches a bug in the codebase (correlates with `PATCH` in Semantic Versioning).
- **`docs`**: Documentation only changes (e.g., updating README or STANDARDS).
- **`style`**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc.).
- **`refactor`**: A code change that neither fixes a bug nor adds a feature.
- **`perf`**: A code change that improves performance (e.g., optimizing CPU time or D1 read/write budgets).
- **`test`**: Adding missing tests or correcting existing tests.
- **`build`**: Changes that affect the build system or external dependencies (e.g., Vite, Wrangler, npm packages).
- **`ci`**: Changes to CI configuration files and scripts.
- **`chore`**: Maintenance tasks, housekeeping, or repository configuration updates.
- **`revert`**: Reverts a previous commit.

### 5.3 Breaking Changes
- A breaking change **MUST** be indicated by:
  - An exclamation mark (`!`) right before the terminal colon: `feat(api)!: change webhook response schema`, OR
  - A footer starting with `BREAKING CHANGE: <description>` (correlates with `MAJOR` in Semantic Versioning).

### 5.4 Standard Scopes for This Repository
When adding an optional scope, choose from the standardized areas of the application:
- **Backend / Worker**:
  - `(worker)`: Core Worker routing or entry point
  - `(webhook)`: Razorpay webhook ingestion and HMAC verification
  - `(d1)`: Database migrations, repositories, queries, or batching
  - `(queue)`: Queue consumer, retry logic, or DLQ
  - `(cron)`: Scheduled recovery worker
  - `(drive)`: Google Drive API integration and authentication
  - `(auth)`: Admin authentication, sessions, CSRF, security headers
  - `(api)`: General admin API endpoints
- **Frontend**:
  - `(frontend)`: General frontend setup, routing, or layout
  - `(queries)`: TanStack Query hooks, query key factories, mutations
  - `(ui)`: UI components, design tokens, styling, dialogs
- **General**:
  - `(config)`: Wrangler configuration, environment bindings, tsconfig
  - `(deps)`: Dependency upgrades or additions
  - `(test)`: Test fixtures, Vitest suite, mock setup

### 5.5 Examples
```text
feat(webhook): add raw-body HMAC-SHA256 signature verification
```
```text
fix(queue): resolve race condition in lease acquisition for concurrent grants
```
```text
feat(api)!: standardize error response payload structure

BREAKING CHANGE: All API error responses now return `{ error: { code, message } }` instead of `{ message }`.
```
```text
refactor(frontend): replace useEffect with TanStack Query custom hook for payments list
```
```text
docs: add conventional commits guidelines to STANDARDS.md
```

