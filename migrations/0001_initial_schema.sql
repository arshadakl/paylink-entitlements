-- Migration 0001: Initial Schema for Paylink Entitlements
-- Designed for Cloudflare D1 (SQLite) with strict foreign keys, unique constraints, and high-performance indexes.

-- 1. Products Catalog
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  drive_folder_id TEXT NOT NULL,
  expected_amount_paise INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. Payment Link Mappings (Maps Razorpay Link IDs to Products)
CREATE TABLE IF NOT EXISTS payment_link_mappings (
  razorpay_link_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- 3. Webhook Events (Idempotency and Audit Trail)
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  razorpay_link_id TEXT,
  razorpay_payment_id TEXT,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL,
  reason_code TEXT,
  payload_hash TEXT
);

-- 4. Payments Record
CREATE TABLE IF NOT EXISTS payments (
  razorpay_payment_id TEXT PRIMARY KEY,
  razorpay_link_id TEXT NOT NULL,
  product_id TEXT,
  buyer_email TEXT,
  normalized_email TEXT,
  amount_paise INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_status TEXT NOT NULL,
  access_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- 5. Access Grants (Durable Record of Google Drive Folder Sharing)
-- UNIQUE(drive_folder_id, normalized_email) guarantees a customer cannot receive duplicate grants for the same folder
CREATE TABLE IF NOT EXISTS access_grants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  drive_folder_id TEXT NOT NULL,
  buyer_email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  status TEXT NOT NULL,
  permission_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  lease_until TEXT,
  last_error_code TEXT,
  last_attempt_at TEXT,
  granted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(drive_folder_id, normalized_email),
  FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
);

-- 6. Durable Outbox Jobs (Asynchronous Worker Tasks)
CREATE TABLE IF NOT EXISTS outbox_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  dispatched_at TEXT,
  lease_until TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (grant_id) REFERENCES access_grants (id) ON DELETE RESTRICT
);

-- 7. Admin Audit Logs
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user TEXT NOT NULL,
  action TEXT NOT NULL,
  target_entity TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);

-- ============================================================================
-- PERFORMANCE & QUOTA OPTIMIZATION INDEXES
-- Critical for staying within Cloudflare Free Tier D1 and <10ms CPU limits
-- ============================================================================

-- Payments: Index for admin dashboard pagination, filtering, and customer lookups
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_access_status ON payments (access_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_normalized_email ON payments (normalized_email);
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_link_id ON payments (razorpay_link_id);

-- Webhook Events: Fast check for idempotency and duplicate delivery
CREATE INDEX IF NOT EXISTS idx_webhook_events_type_received ON webhook_events (event_type, received_at DESC);

-- Access Grants: Bounded queries for pending/processing grants
CREATE INDEX IF NOT EXISTS idx_access_grants_status_next ON access_grants (status, next_attempt_at);

-- Outbox Jobs: Powers the 1-minute recovery cron (SELECT ... WHERE status IN ('pending', 'retry') AND next_attempt_at <= ? LIMIT 10)
CREATE INDEX IF NOT EXISTS idx_outbox_jobs_status_next ON outbox_jobs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_jobs_dispatched ON outbox_jobs (dispatched_at);

-- Product Catalog: Lookup active products and mappings
CREATE INDEX IF NOT EXISTS idx_products_active ON products (active);
CREATE INDEX IF NOT EXISTS idx_payment_link_mappings_product ON payment_link_mappings (product_id);
