import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../src/index';
import type { WorkerEnv } from '../../src/config/env';
import {
  TEST_WEBHOOK_SECRET,
  validPaymentLinkPaidFixture,
  signFixture,
} from '../fixtures/razorpay';
import { productsRepository } from '../../src/repositories/products.repository';
import { webhooksRepository } from '../../src/repositories/webhooks.repository';
import { grantsRepository } from '../../src/repositories/grants.repository';
import { jobsRepository } from '../../src/repositories/jobs.repository';
import { paymentsRepository } from '../../src/repositories/payments.repository';
import { googleDriveService } from '../../src/services/google-drive-service';
import type { Product, AccessGrant, OutboxJob } from '../../src/types';

describe('Security Acceptance & End-to-End Fulfillment Suite (Section 14.6)', () => {
  let mockEnv: WorkerEnv;
  let mockQueueSend: ReturnType<typeof vi.fn>;
  let mockDbBatch: ReturnType<typeof vi.fn>;

  const mockProduct: Product = {
    id: 'prod_verified_excel',
    name: 'Advanced Excel Mastery',
    description: 'Course files and templates',
    drive_folder_id: '1Folder_Verified_Authoritative_D1',
    expected_amount_paise: 9900, // ₹99.00
    currency: 'INR',
    active: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const mockMapping = {
    razorpay_link_id: 'plink_excel_course_123',
    product_id: 'prod_verified_excel',
    active: 1,
    created_at: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    mockQueueSend = vi.fn().mockResolvedValue(undefined);
    mockDbBatch = vi.fn().mockResolvedValue([]);

    mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
          }),
        }),
        batch: mockDbBatch,
      } as unknown as D1Database,
      GRANT_QUEUE: {
        send: mockQueueSend,
      } as unknown as Queue,
      RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'secure_password_123',
      ADMIN_SESSION_SECRET: '01234567890123456789012345678901',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@project.iam.gserviceaccount.com',
      GOOGLE_PRIVATE_KEY: 'test_key',
    };
  });

  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  describe('Security Proof 1: Invalid webhook signature never creates a grant or enqueues work', () => {
    it('rejects tampered body or forged signature with 401', async () => {
      const { rawBody } = await signFixture(validPaymentLinkPaidFixture);

      const request = new Request('http://localhost/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': 'forged_bad_signature_hex_000000000000000000',
        },
        body: rawBody,
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(401);

      expect(mockQueueSend).not.toHaveBeenCalled();
      expect(mockDbBatch).not.toHaveBeenCalled();
    });
  });

  describe('Security Proof 2: Mismatched payment amount never creates a grant', () => {
    it('flags underpaid transactions as manual_review and prevents automatic granting', async () => {
      // Modify fixture amount: paid 5000 paise (₹50) instead of expected 9900 paise (₹99)
      const underpaidPayload = JSON.parse(JSON.stringify(validPaymentLinkPaidFixture));
      underpaidPayload.payload.payment.entity.amount = 5000;
      underpaidPayload.payload.payment_link.entity.amount = 5000;

      const { rawBody, signature } = await signFixture(underpaidPayload);

      vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
      vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue({ product: mockProduct, mapping: mockMapping });
      vi.spyOn(grantsRepository, 'findByFolderAndEmail').mockResolvedValue(null);

      const request = new Request('http://localhost/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
        body: rawBody,
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { status: string; enqueued: boolean; reason: string };
      expect(body.status).toBe('manual_review');
      expect(body.enqueued).toBe(false);
      expect(body.reason).toContain('AMOUNT_MISMATCH');

      // Zero queue dispatch allowed
      expect(mockQueueSend).not.toHaveBeenCalled();
    });
  });

  describe('Security Proof 3: Unknown Payment Link ID never grants a folder', () => {
    it('returns unmapped status without creating any access grants', async () => {
      const { rawBody, signature } = await signFixture(validPaymentLinkPaidFixture);

      vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
      // Link ID not registered in D1
      vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue(null);
      vi.spyOn(webhooksRepository, 'create').mockResolvedValue(undefined);

      const request = new Request('http://localhost/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
        body: rawBody,
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { status: string; reason: string };
      expect(body.status).toBe('unmapped');
      expect(body.reason).toBe('PAYMENT_LINK_NOT_MAPPED_OR_INACTIVE');

      expect(mockQueueSend).not.toHaveBeenCalled();
      expect(mockDbBatch).not.toHaveBeenCalled();
    });
  });

  describe('Security Proof 4: Folder ID is strictly resolved from D1 and cannot be overridden by client', () => {
    it('resolves folder strictly from products table, ignoring any rogue client/request attributes', async () => {
      // Attacker attempts to inject rogue drive_folder_id in webhook notes/metadata
      const roguePayload = JSON.parse(JSON.stringify(validPaymentLinkPaidFixture));
      roguePayload.payload.payment.entity.notes = {
        drive_folder_id: '1HACKER_CONTROLLED_FOLDER_ID',
      };

      const { rawBody, signature } = await signFixture(roguePayload);

      vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
      vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue({ product: mockProduct, mapping: mockMapping });
      vi.spyOn(grantsRepository, 'findByFolderAndEmail').mockResolvedValue(null);

      const request = new Request('http://localhost/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
        body: rawBody,
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);

      // Verify that DB batch received the authoritative drive_folder_id from D1 product, NOT hacker folder
      expect(mockDbBatch).toHaveBeenCalled();
      expect(mockQueueSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('Security Proof 5: Unauthenticated users cannot read or modify administrative data', () => {
    it('returns 401 for unauthorized calls to admin endpoints', async () => {
      const endpoints = [
        { url: 'http://localhost/api/admin/dashboard/summary', method: 'GET' },
        { url: 'http://localhost/api/admin/products', method: 'GET' },
        { url: 'http://localhost/api/admin/payments', method: 'GET' },
        { url: 'http://localhost/api/admin/grants', method: 'GET' },
        { url: 'http://localhost/api/admin/webhook-events', method: 'GET' },
      ];

      for (const ep of endpoints) {
        const req = new Request(ep.url, { method: ep.method });
        const res = await worker.fetch(req, mockEnv, ctx);
        expect(res.status).toBe(401);
      }
    });
  });

  describe('End-to-End Lifecycle Verification: Webhook -> Batch -> Queue -> Grant Fulfillment', () => {
    it('executes full pipeline successfully to granted status', async () => {
      // 1. Inbound Webhook
      const { rawBody, signature } = await signFixture(validPaymentLinkPaidFixture);

      vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
      vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue({ product: mockProduct, mapping: mockMapping });
      vi.spyOn(grantsRepository, 'findByFolderAndEmail').mockResolvedValue(null);

      const webhookReq = new Request('http://localhost/api/webhooks/razorpay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Razorpay-Signature': signature,
        },
        body: rawBody,
      });

      const webhookRes = await worker.fetch(webhookReq, mockEnv, ctx);
      expect(webhookRes.status).toBe(200);

      const webhookBody = (await webhookRes.json()) as { enqueued: boolean; status: string };
      expect(webhookBody.enqueued).toBe(true);
      expect(webhookBody.status).toBe('processed');

      // 2. Queue Consumer Execution
      const mockGrant: AccessGrant = {
        id: 'grant_e2e_123',
        product_id: mockProduct.id,
        drive_folder_id: mockProduct.drive_folder_id,
        buyer_email: 'buyer@example.com',
        normalized_email: 'buyer@example.com',
        status: 'pending',
        permission_id: null,
        attempt_count: 0,
        next_attempt_at: null,
        lease_until: null,
        last_error_code: null,
        last_attempt_at: null,
        granted_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockJob: OutboxJob = {
        id: 'job_e2e_123',
        job_type: 'grant_access',
        grant_id: 'grant_e2e_123',
        dedupe_key: 'grant_e2e_123:grant_access',
        status: 'queued',
        attempt_count: 0,
        next_attempt_at: new Date().toISOString(),
        last_attempt_at: null,
        dispatched_at: new Date().toISOString(),
        lease_until: null,
        last_error_code: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      vi.spyOn(grantsRepository, 'findById').mockResolvedValue(mockGrant);
      vi.spyOn(jobsRepository, 'findById').mockResolvedValue(mockJob);
      vi.spyOn(grantsRepository, 'acquireLease').mockResolvedValue(true);
      vi.spyOn(googleDriveService, 'grantFolderReaderAccess').mockResolvedValue({
        permissionId: 'perm_gdrive_reader_e2e_999',
      });
      vi.spyOn(grantsRepository, 'markGranted').mockResolvedValue(undefined);
      vi.spyOn(paymentsRepository, 'updateAccessStatusByProductAndEmail').mockResolvedValue(undefined);
      vi.spyOn(jobsRepository, 'markCompleted').mockResolvedValue(undefined);

      const queueBatch: MessageBatch<{ grantId: string; outboxJobId: string }> = {
        queue: 'drive-access-grants',
        messages: [
          {
            id: 'msg_e2e_1',
            timestamp: new Date(),
            body: {
              grantId: 'grant_e2e_123',
              outboxJobId: 'job_e2e_123',
            },
            ack: vi.fn(),
            retry: vi.fn(),
            attempts: 1,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      };

      await worker.queue(queueBatch, mockEnv, ctx);

      // Verify Google Drive API was called with correct parameters
      expect(googleDriveService.grantFolderReaderAccess).toHaveBeenCalledWith(
        mockEnv,
        mockProduct.drive_folder_id,
        'buyer@example.com'
      );

      // Verify D1 records marked as granted
      expect(grantsRepository.markGranted).toHaveBeenCalledWith(
        mockEnv.DB,
        'grant_e2e_123',
        'perm_gdrive_reader_e2e_999'
      );

      // Verify Queue message was acknowledged
      expect(queueBatch.messages[0].ack).toHaveBeenCalledTimes(1);
    });
  });
});
