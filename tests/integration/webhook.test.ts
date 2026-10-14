import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../src/index';
import type { WorkerEnv } from '../../src/config/env';
import {
  TEST_WEBHOOK_SECRET,
  TEST_PREVIOUS_SECRET,
  validPaymentLinkPaidFixture,
  missingEmailPaymentLinkPaidFixture,
  unrelatedEventFixture,
  signFixture,
} from '../fixtures/razorpay';
import { productsRepository } from '../../src/repositories/products.repository';
import { webhooksRepository } from '../../src/repositories/webhooks.repository';
import { grantsRepository } from '../../src/repositories/grants.repository';
import { jobsRepository } from '../../src/repositories/jobs.repository';
import { paymentsRepository } from '../../src/repositories/payments.repository';

describe('POST /api/webhooks/razorpay Integration', () => {
  let mockEnv: WorkerEnv;
  let mockQueueSend: ReturnType<typeof vi.fn>;
  let mockDbBatch: ReturnType<typeof vi.fn>;

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
          }),
        }),
        batch: mockDbBatch,
      } as unknown as D1Database,
      GRANT_QUEUE: {
        send: mockQueueSend,
      } as unknown as Queue,
      RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
      RAZORPAY_WEBHOOK_SECRET_PREVIOUS: TEST_PREVIOUS_SECRET,
      ADMIN_SESSION_SECRET: '01234567890123456789012345678901',
    };
  });

  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  it('should return 401 if X-Razorpay-Signature header is missing', async () => {
    const request = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPaymentLinkPaidFixture),
    });

    const response = await worker.fetch(request, mockEnv, ctx);
    expect(response.status).toBe(401);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_SIGNATURE');
  });

  it('should return 401 if X-Razorpay-Signature is invalid or tampered', async () => {
    const { rawBody } = await signFixture(validPaymentLinkPaidFixture);

    const request = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': '0000000000000000000000000000000000000000000000000000000000000000',
      },
      body: rawBody,
    });

    const response = await worker.fetch(request, mockEnv, ctx);
    expect(response.status).toBe(401);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('should return 400 if payload is malformed JSON', async () => {
    const malformedBody = '{"not_json": ';
    const { signature } = await signFixture(malformedBody);

    const request = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': signature,
      },
      body: malformedBody,
    });

    const response = await worker.fetch(request, mockEnv, ctx);
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MALFORMED_JSON');
  });

  it('should return 413 if payload exceeds 100 KB limit', async () => {
    const largeBody = 'a'.repeat(101 * 1024);

    const request = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': 'fake_sig',
      },
      body: largeBody,
    });

    const response = await worker.fetch(request, mockEnv, ctx);
    expect(response.status).toBe(413);

    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('should process valid payment_link.paid event and enqueue grant message', async () => {
    const { rawBody, signature } = await signFixture(validPaymentLinkPaidFixture);

    vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
    vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue({
      product: {
        id: 'prod_excel',
        name: 'Excel Mastery',
        description: 'Excel course',
        drive_folder_id: 'drive_folder_123',
        expected_amount_paise: 9900,
        currency: 'INR',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      mapping: {
        razorpay_link_id: 'plink_excel_course_123',
        product_id: 'prod_excel',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    vi.spyOn(grantsRepository, 'findByFolderAndEmail').mockResolvedValue(null);
    vi.spyOn(jobsRepository, 'markQueued').mockResolvedValue(undefined);
    vi.spyOn(paymentsRepository, 'updateAccessStatus').mockResolvedValue(undefined);

    const request = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': signature,
        'X-Razorpay-Event-Id': 'evt_pay_success_123',
      },
      body: rawBody,
    });

    const response = await worker.fetch(request, mockEnv, ctx);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      status: string;
      paymentId: string;
      enqueued: boolean;
    };

    expect(body.success).toBe(true);
    expect(body.status).toBe('processed');
    expect(body.paymentId).toBe('pay_excel_purchase_456');
    expect(body.enqueued).toBe(true);

    expect(mockDbBatch).toHaveBeenCalledTimes(1);
    expect(mockQueueSend).toHaveBeenCalledTimes(1);
    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        grantId: expect.any(String),
        outboxJobId: expect.any(String),
      })
    );
  });

  it('should authenticate successfully using previous secret during secret rotation', async () => {
    const { rawBody, signature } = await signFixture(validPaymentLinkPaidFixture, TEST_PREVIOUS_SECRET);

    vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
    vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue({
      product: {
        id: 'prod_excel',
        name: 'Excel Mastery',
        description: 'Excel course',
        drive_folder_id: 'drive_folder_123',
        expected_amount_paise: 9900,
        currency: 'INR',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      mapping: {
        razorpay_link_id: 'plink_excel_course_123',
        product_id: 'prod_excel',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    vi.spyOn(grantsRepository, 'findByFolderAndEmail').mockResolvedValue(null);
    vi.spyOn(jobsRepository, 'markQueued').mockResolvedValue(undefined);
    vi.spyOn(paymentsRepository, 'updateAccessStatus').mockResolvedValue(undefined);

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

    const body = (await response.json()) as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('processed');
  });

  it('should flag manual_review and not enqueue grant when buyer email is null', async () => {
    const { rawBody, signature } = await signFixture(missingEmailPaymentLinkPaidFixture);

    vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
    vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue({
      product: {
        id: 'prod_excel',
        name: 'Excel Mastery',
        description: 'Excel course',
        drive_folder_id: 'drive_folder_123',
        expected_amount_paise: 9900,
        currency: 'INR',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      mapping: {
        razorpay_link_id: 'plink_excel_course_123',
        product_id: 'prod_excel',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
    });

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

    const body = (await response.json()) as {
      success: boolean;
      status: string;
      reason: string;
      enqueued: boolean;
    };

    expect(body.success).toBe(true);
    expect(body.status).toBe('manual_review');
    expect(body.reason).toBe('MISSING_BUYER_EMAIL');
    expect(body.enqueued).toBe(false);

    expect(mockQueueSend).not.toHaveBeenCalled();
    expect(mockDbBatch).toHaveBeenCalledTimes(1);
  });

  it('should acknowledge unrelated event safely with status ignored', async () => {
    const { rawBody, signature } = await signFixture(unrelatedEventFixture);

    vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
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

    const body = (await response.json()) as {
      success: boolean;
      status: string;
      reason: string;
    };

    expect(body.success).toBe(true);
    expect(body.status).toBe('ignored');
    expect(body.reason).toBe('UNRELATED_EVENT_TYPE');
    expect(mockQueueSend).not.toHaveBeenCalled();
  });

  it('should return 200 with unmapped status when link ID is not registered', async () => {
    const { rawBody, signature } = await signFixture(validPaymentLinkPaidFixture);

    vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
    vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue(null); // unmapped
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

    const body = (await response.json()) as {
      success: boolean;
      status: string;
      reason: string;
    };

    expect(body.success).toBe(true);
    expect(body.status).toBe('unmapped');
    expect(body.reason).toBe('PAYMENT_LINK_NOT_MAPPED_OR_INACTIVE');
    expect(mockQueueSend).not.toHaveBeenCalled();
  });

  it('should handle duplicate webhook delivery idempotently without re-dispatching', async () => {
    const { rawBody, signature } = await signFixture(validPaymentLinkPaidFixture);

    // Mock existing event in database
    vi.spyOn(webhooksRepository, 'findById').mockResolvedValue({
      event_id: 'evt_duplicate_999',
      event_type: 'payment_link.paid',
      razorpay_link_id: 'plink_excel_course_123',
      razorpay_payment_id: 'pay_excel_purchase_456',
      received_at: '2026-01-01T00:00:00Z',
      processing_status: 'processed',
      reason_code: null,
      payload_hash: 'some_hash',
    });

    const request = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Razorpay-Signature': signature,
        'X-Razorpay-Event-Id': 'evt_duplicate_999',
      },
      body: rawBody,
    });

    const response = await worker.fetch(request, mockEnv, ctx);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      success: boolean;
      status: string;
      reason: string;
      enqueued: boolean;
    };

    expect(body.success).toBe(true);
    expect(body.status).toBe('processed');
    expect(body.reason).toBe('DUPLICATE_EVENT_ID');
    expect(body.enqueued).toBe(false);

    // Queue send and DB batch should NOT be called again
    expect(mockQueueSend).not.toHaveBeenCalled();
    expect(mockDbBatch).not.toHaveBeenCalled();
  });
});
