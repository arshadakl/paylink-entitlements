import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  timingSafeEqual,
  computeHmacSha256Hex,
  verifyRazorpaySignature,
  hashPayloadSha256,
} from '../../src/services/razorpay-verification';
import {
  normalizeEmail,
  isValidEmail,
  paymentService,
  razorpayPaymentLinkPaidPayloadSchema,
} from '../../src/services/payment-service';
import { productsRepository } from '../../src/repositories/products.repository';
import { webhooksRepository } from '../../src/repositories/webhooks.repository';
import { grantsRepository } from '../../src/repositories/grants.repository';
import { jobsRepository } from '../../src/repositories/jobs.repository';
import { paymentsRepository } from '../../src/repositories/payments.repository';

describe('Razorpay Web Crypto Verification Service', () => {
  const testSecret = 'rzp_test_secret_1234567890';
  const previousSecret = 'rzp_old_secret_0987654321';
  const rawBody = JSON.stringify({ event: 'payment_link.paid', test: true });

  it('timingSafeEqual should securely compare identical and different strings', () => {
    expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqual('abcdef', 'abcde')).toBe(false);
  });

  it('computeHmacSha256Hex should produce valid 64-character hex signature', async () => {
    const signature = await computeHmacSha256Hex(rawBody, testSecret);
    expect(signature).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(signature)).toBe(true);
  });

  it('verifyRazorpaySignature should verify valid signature with primary secret', async () => {
    const signature = await computeHmacSha256Hex(rawBody, testSecret);
    const result = await verifyRazorpaySignature(rawBody, signature, testSecret);
    expect(result.isValid).toBe(true);
    expect(result.usedSecret).toBe('primary');
  });

  it('verifyRazorpaySignature should reject tampered body', async () => {
    const signature = await computeHmacSha256Hex(rawBody, testSecret);
    const tamperedBody = rawBody + ' ';
    const result = await verifyRazorpaySignature(tamperedBody, signature, testSecret);
    expect(result.isValid).toBe(false);
    expect(result.usedSecret).toBe('none');
  });

  it('verifyRazorpaySignature should reject missing or invalid signature', async () => {
    expect((await verifyRazorpaySignature(rawBody, null, testSecret)).isValid).toBe(false);
    expect((await verifyRazorpaySignature(rawBody, 'invalid_sig', testSecret)).isValid).toBe(false);
  });

  it('verifyRazorpaySignature should fall back to previous secret when primary fails', async () => {
    const signature = await computeHmacSha256Hex(rawBody, previousSecret);
    const result = await verifyRazorpaySignature(rawBody, signature, testSecret, previousSecret);
    expect(result.isValid).toBe(true);
    expect(result.usedSecret).toBe('previous');
  });

  it('hashPayloadSha256 should return 64-character hex digest', async () => {
    const hash = await hashPayloadSha256(rawBody);
    expect(hash).toHaveLength(64);
  });
});

describe('Payment Service & Email Normalization', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizeEmail should lowercase and trim whitespace', () => {
    expect(normalizeEmail('  Buyer+Course@EXAMPLE.com  ')).toBe('buyer+course@example.com');
  });

  it('isValidEmail should validate RFC-compliant email formats', () => {
    expect(isValidEmail('buyer@example.com')).toBe(true);
    expect(isValidEmail('buyer+test@sub.example.co.in')).toBe(true);
    expect(isValidEmail('invalid-email')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('razorpayPaymentLinkPaidPayloadSchema should parse valid fixture', () => {
    const fixture = {
      entity: 'event',
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'plink_test123',
            amount: 9900,
            amount_paid: 9900,
            currency: 'INR',
            status: 'paid',
          },
        },
        payment: {
          entity: {
            id: 'pay_test456',
            amount: 9900,
            currency: 'INR',
            status: 'captured',
            email: 'buyer@example.com',
            captured: true,
          },
        },
      },
    };

    const parsed = razorpayPaymentLinkPaidPayloadSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
  });

  it('processPaymentLinkPaid should handle missing buyer email by flagging manual_review', async () => {
    const payloadWithoutEmail = {
      entity: 'event',
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'plink_test123',
            amount: 9900,
            amount_paid: 9900,
            currency: 'INR',
            status: 'paid',
          },
        },
        payment: {
          entity: {
            id: 'pay_test456',
            amount: 9900,
            currency: 'INR',
            status: 'captured',
            email: null, // missing email
            captured: true,
          },
        },
      },
    };

    vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
    vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue({
      product: {
        id: 'prod_1',
        name: 'Excel Course',
        description: 'Excel course',
        drive_folder_id: 'folder_abc',
        expected_amount_paise: 9900,
        currency: 'INR',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      mapping: {
        razorpay_link_id: 'plink_test123',
        product_id: 'prod_1',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
    });

    const batchMock = vi.fn().mockResolvedValue([]);
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        }),
      }),
      batch: batchMock,
    } as unknown as D1Database;

    const mockQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;

    const result = await paymentService.processPaymentLinkPaid(
      mockDb,
      mockQueue,
      'evt_test123',
      payloadWithoutEmail,
      'fake_hash'
    );

    expect(result.status).toBe('manual_review');
    expect(result.reasonCode).toBe('MISSING_BUYER_EMAIL');
    expect(result.enqueued).toBe(false);
    expect(mockQueue.send).not.toHaveBeenCalled();
    expect(batchMock).toHaveBeenCalledTimes(1);
  });

  it('processPaymentLinkPaid should process valid payment, execute D1 batch, and enqueue grant message', async () => {
    const validPayload = {
      entity: 'event',
      event: 'payment_link.paid',
      payload: {
        payment_link: {
          entity: {
            id: 'plink_test123',
            amount: 9900,
            amount_paid: 9900,
            currency: 'INR',
            status: 'paid',
          },
        },
        payment: {
          entity: {
            id: 'pay_test456',
            amount: 9900,
            currency: 'INR',
            status: 'captured',
            email: 'buyer@example.com',
            captured: true,
          },
        },
      },
    };

    vi.spyOn(webhooksRepository, 'findById').mockResolvedValue(null);
    vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValue({
      product: {
        id: 'prod_1',
        name: 'Excel Course',
        description: 'Excel course',
        drive_folder_id: 'folder_abc',
        expected_amount_paise: 9900,
        currency: 'INR',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      mapping: {
        razorpay_link_id: 'plink_test123',
        product_id: 'prod_1',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    vi.spyOn(grantsRepository, 'findByFolderAndEmail').mockResolvedValue(null);
    vi.spyOn(jobsRepository, 'markQueued').mockResolvedValue(undefined);
    vi.spyOn(paymentsRepository, 'updateAccessStatus').mockResolvedValue(undefined);

    const batchMock = vi.fn().mockResolvedValue([]);
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        }),
      }),
      batch: batchMock,
    } as unknown as D1Database;

    const mockQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue;

    const result = await paymentService.processPaymentLinkPaid(
      mockDb,
      mockQueue,
      'evt_valid_123',
      validPayload,
      'fake_hash'
    );

    expect(result.status).toBe('processed');
    expect(result.paymentId).toBe('pay_test456');
    expect(result.enqueued).toBe(true);
    expect(batchMock).toHaveBeenCalledTimes(1);
    expect(mockQueue.send).toHaveBeenCalledTimes(1);
    expect(mockQueue.send).toHaveBeenCalledWith(
      expect.objectContaining({
        grantId: expect.any(String),
        outboxJobId: expect.any(String),
      })
    );
  });
});
