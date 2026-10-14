import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(): void;
    all(): unknown[];
  };
}

describe('D1 Migration Schema & Constraints', () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    const sqlPath = path.resolve(process.cwd(), 'migrations/0001_initial_schema.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    db.exec(sqlContent);
  });

  it('should create all required tables', () => {
    const query = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
    );
    const tables = query.all().map((row: unknown) => (row as { name: string }).name);

    expect(tables).toEqual([
      'access_grants',
      'admin_audit_logs',
      'outbox_jobs',
      'payment_link_mappings',
      'payments',
      'products',
      'webhook_events',
    ]);
  });

  it('should enforce unique constraints on payment_link_mappings', () => {
    // Insert product first
    db.prepare(`
      INSERT INTO products (id, name, drive_folder_id, expected_amount_paise, created_at, updated_at)
      VALUES ('prod_1', 'Excel Course', 'folder_123', 9900, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `).run();

    // Map link to product
    db.prepare(`
      INSERT INTO payment_link_mappings (razorpay_link_id, product_id, created_at)
      VALUES ('plink_abc', 'prod_1', '2026-01-01T00:00:00Z')
    `).run();

    // Duplicate razorpay_link_id should throw UNIQUE constraint failure
    expect(() => {
      db.prepare(`
        INSERT INTO payment_link_mappings (razorpay_link_id, product_id, created_at)
        VALUES ('plink_abc', 'prod_1', '2026-01-01T00:00:00Z')
      `).run();
    }).toThrow();
  });

  it('should enforce unique constraint on (drive_folder_id, normalized_email) in access_grants', () => {
    // Insert product
    db.prepare(`
      INSERT INTO products (id, name, drive_folder_id, expected_amount_paise, created_at, updated_at)
      VALUES ('prod_1', 'Excel Course', 'folder_123', 9900, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `).run();

    // Insert first grant
    db.prepare(`
      INSERT INTO access_grants (id, product_id, drive_folder_id, buyer_email, normalized_email, status, created_at, updated_at)
      VALUES ('grant_1', 'prod_1', 'folder_123', 'Buyer@Example.com', 'buyer@example.com', 'granted', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `).run();

    // Second grant for same folder & normalized email must fail
    expect(() => {
      db.prepare(`
        INSERT INTO access_grants (id, product_id, drive_folder_id, buyer_email, normalized_email, status, created_at, updated_at)
        VALUES ('grant_2', 'prod_1', 'folder_123', 'other@example.com', 'buyer@example.com', 'pending', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
      `).run();
    }).toThrow();
  });

  it('should enforce dedupe_key uniqueness on outbox_jobs', () => {
    // Insert product and grant
    db.prepare(`
      INSERT INTO products (id, name, drive_folder_id, expected_amount_paise, created_at, updated_at)
      VALUES ('prod_1', 'Excel Course', 'folder_123', 9900, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `).run();

    db.prepare(`
      INSERT INTO access_grants (id, product_id, drive_folder_id, buyer_email, normalized_email, status, created_at, updated_at)
      VALUES ('grant_1', 'prod_1', 'folder_123', 'buyer@example.com', 'buyer@example.com', 'pending', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `).run();

    // Insert outbox job
    db.prepare(`
      INSERT INTO outbox_jobs (id, job_type, grant_id, dedupe_key, status, created_at, updated_at)
      VALUES ('job_1', 'grant_access', 'grant_1', 'grant_1:grant_access', 'pending', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `).run();

    // Duplicate dedupe_key must throw
    expect(() => {
      db.prepare(`
        INSERT INTO outbox_jobs (id, job_type, grant_id, dedupe_key, status, created_at, updated_at)
        VALUES ('job_2', 'grant_access', 'grant_1', 'grant_1:grant_access', 'pending', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
      `).run();
    }).toThrow();
  });

  it('should enforce foreign key constraint between product_id and products table', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO payment_link_mappings (razorpay_link_id, product_id, created_at)
        VALUES ('plink_xyz', 'non_existent_product', '2026-01-01T00:00:00Z')
      `).run();
    }).toThrow();
  });

  it('should utilize index for outbox jobs recovery query', () => {
    const explain = db.prepare(`
      EXPLAIN QUERY PLAN
      SELECT id, grant_id, status FROM outbox_jobs
      WHERE status IN ('pending', 'retry') AND next_attempt_at <= '2026-01-01T00:00:00Z'
      LIMIT 10
    `).all() as { detail: string }[];

    const planDetail = explain.map((row) => row.detail).join(' ');
    expect(planDetail).toContain('idx_outbox_jobs_status_next');
  });
});
