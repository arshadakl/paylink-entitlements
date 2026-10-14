import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../src/index';
import type { WorkerEnv } from '../../src/config/env';
import { createSessionToken, SESSION_COOKIE_NAME } from '../../src/middleware/admin-auth';
import { productsRepository } from '../../src/repositories/products.repository';
import { paymentsRepository } from '../../src/repositories/payments.repository';
import { grantsRepository } from '../../src/repositories/grants.repository';
import { jobsRepository } from '../../src/repositories/jobs.repository';
import { googleDriveService } from '../../src/services/google-drive-service';
import type { Payment, AccessGrant, OutboxJob } from '../../src/types';

describe('Admin Authentication & Management API Integration', () => {
  let mockEnv: WorkerEnv;
  let mockQueueSend: ReturnType<typeof vi.fn>;
  let validAdminCookie: string;

  beforeEach(async () => {
    vi.restoreAllMocks();

    mockQueueSend = vi.fn().mockResolvedValue(undefined);

    mockEnv = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
          }),
        }),
        batch: vi.fn().mockResolvedValue([]),
      } as unknown as D1Database,
      GRANT_QUEUE: {
        send: mockQueueSend,
      } as unknown as Queue,
      RAZORPAY_WEBHOOK_SECRET: 'test_secret',
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'secure_admin_password_123',
      ADMIN_SESSION_SECRET: '01234567890123456789012345678901',
    };

    const token = await createSessionToken('admin', mockEnv.ADMIN_SESSION_SECRET);
    validAdminCookie = `${SESSION_COOKIE_NAME}=${token}`;
  });

  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  describe('Security Headers', () => {
    it('should include standard security headers on all responses', async () => {
      const request = new Request('http://localhost/api/health');
      const response = await worker.fetch(request, mockEnv, ctx);

      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    });
  });

  describe('Authentication Lifecycle (/api/auth)', () => {
    it('should reject invalid login credentials with 401', async () => {
      const request = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'wrong_password' }),
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should authenticate valid credentials and set HttpOnly session cookie', async () => {
      const request = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'admin',
          password: 'secure_admin_password_123',
        }),
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);

      const setCookieHeader = response.headers.get('Set-Cookie');
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader).toContain(SESSION_COOKIE_NAME);
      expect(setCookieHeader).toContain('HttpOnly');
      expect(setCookieHeader).toContain('SameSite=Strict');

      const body = (await response.json()) as { success: boolean; username: string };
      expect(body.success).toBe(true);
      expect(body.username).toBe('admin');
    });

    it('GET /api/auth/me should return authenticated state with valid cookie', async () => {
      const request = new Request('http://localhost/api/auth/me', {
        headers: { Cookie: validAdminCookie },
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { authenticated: boolean; username?: string };
      expect(body.authenticated).toBe(true);
      expect(body.username).toBe('admin');
    });

    it('POST /api/auth/logout should clear the session cookie', async () => {
      const request = new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: validAdminCookie },
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toContain('Max-Age=0');
    });
  });

  describe('Protected Admin Routes Guard', () => {
    it('should reject unauthenticated access to /api/admin/dashboard/summary with 401', async () => {
      const request = new Request('http://localhost/api/admin/dashboard/summary');
      const response = await worker.fetch(request, mockEnv, ctx);

      expect(response.status).toBe(401);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should allow access to /api/admin/dashboard/summary with valid session cookie', async () => {
      vi.spyOn(paymentsRepository, 'getDashboardMetrics').mockResolvedValue({
        totalSuccessfulPayments: 42,
        grossRevenuePaise: 415800,
        grantedAccessCount: 40,
        pendingAccessCount: 1,
        failedAccessCount: 0,
        manualReviewCount: 1,
      });

      const request = new Request('http://localhost/api/admin/dashboard/summary', {
        headers: { Cookie: validAdminCookie },
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        success: boolean;
        data: { totalSuccessfulPayments: number; grossRevenuePaise: number };
      };

      expect(body.success).toBe(true);
      expect(body.data.totalSuccessfulPayments).toBe(42);
      expect(body.data.grossRevenuePaise).toBe(415800);
    });
  });

  describe('Product Management', () => {
    it('should validate folder and create a new product', async () => {
      vi.spyOn(googleDriveService, 'validateFolder').mockResolvedValue({
        id: 'folder_valid_123',
        name: 'Advanced React Course',
        mimeType: 'application/vnd.google-apps.folder',
        canShare: true,
      });

      vi.spyOn(productsRepository, 'create').mockResolvedValue(undefined);

      const request = new Request('http://localhost/api/admin/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validAdminCookie,
        },
        body: JSON.stringify({
          name: 'Advanced React Course',
          drive_folder_id: 'folder_valid_123',
          expected_amount_paise: 19900,
          currency: 'INR',
        }),
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        success: boolean;
        data: { id: string; name: string; expected_amount_paise: number };
      };

      expect(body.success).toBe(true);
      expect(body.data.name).toBe('Advanced React Course');
      expect(body.data.expected_amount_paise).toBe(19900);
      expect(productsRepository.create).toHaveBeenCalled();
    });

    it('should map a payment link to product and prevent duplicate link mapping', async () => {
      vi.spyOn(productsRepository, 'findById').mockResolvedValue({
        id: 'prod_react',
        name: 'React Course',
        description: null,
        drive_folder_id: 'folder_123',
        expected_amount_paise: 9900,
        currency: 'INR',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });

      // 1. First mapping succeeds
      vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValueOnce(null);
      vi.spyOn(productsRepository, 'addLinkMapping').mockResolvedValue(undefined);

      const req1 = new Request('http://localhost/api/admin/products/prod_react/payment-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validAdminCookie,
        },
        body: JSON.stringify({ razorpay_link_id: 'plink_react_123' }),
      });

      const res1 = await worker.fetch(req1, mockEnv, ctx);
      expect(res1.status).toBe(200);

      // 2. Duplicate mapping returns 409 Conflict
      vi.spyOn(productsRepository, 'findByPaymentLinkId').mockResolvedValueOnce({
        product: { id: 'prod_react', name: 'React Course' } as unknown as any,
        mapping: { razorpay_link_id: 'plink_react_123', product_id: 'prod_react', active: 1, created_at: '' },
      });

      const req2 = new Request('http://localhost/api/admin/products/prod_react/payment-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: validAdminCookie,
        },
        body: JSON.stringify({ razorpay_link_id: 'plink_react_123' }),
      });

      const res2 = await worker.fetch(req2, mockEnv, ctx);
      expect(res2.status).toBe(409);
      const body2 = (await res2.json()) as { error: { code: string } };
      expect(body2.error.code).toBe('LINK_ALREADY_MAPPED');
    });
  });

  describe('Payments & Email Resolution', () => {
    it('POST /api/admin/payments/:id/resolve-email should update payment and enqueue grant job', async () => {
      const mockPayment: Payment = {
        razorpay_payment_id: 'pay_missing_email_123',
        razorpay_link_id: 'plink_course_123',
        product_id: 'prod_course',
        buyer_email: null,
        normalized_email: null,
        amount_paise: 9900,
        currency: 'INR',
        payment_status: 'captured',
        access_status: 'manual_review',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      vi.spyOn(paymentsRepository, 'findById').mockResolvedValue(mockPayment);
      vi.spyOn(productsRepository, 'findById').mockResolvedValue({
        id: 'prod_course',
        name: 'Excel Course',
        description: null,
        drive_folder_id: 'folder_drive_123',
        expected_amount_paise: 9900,
        currency: 'INR',
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });
      vi.spyOn(grantsRepository, 'findByFolderAndEmail').mockResolvedValue(null);
      vi.spyOn(grantsRepository, 'create').mockResolvedValue(undefined);
      vi.spyOn(jobsRepository, 'create').mockResolvedValue(undefined);
      vi.spyOn(jobsRepository, 'markQueued').mockResolvedValue(undefined);
      vi.spyOn(paymentsRepository, 'resolveBuyerEmail').mockResolvedValue(undefined);
      vi.spyOn(paymentsRepository, 'updateAccessStatus').mockResolvedValue(undefined);

      const request = new Request(
        'http://localhost/api/admin/payments/pay_missing_email_123/resolve-email',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: validAdminCookie,
          },
          body: JSON.stringify({ buyer_email: 'buyer_corrected@example.com' }),
        }
      );

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);

      expect(paymentsRepository.resolveBuyerEmail).toHaveBeenCalledWith(
        mockEnv.DB,
        'pay_missing_email_123',
        'buyer_corrected@example.com',
        'buyer_corrected@example.com',
        'pending'
      );
      expect(mockQueueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          grantId: expect.any(String),
          outboxJobId: expect.any(String),
        })
      );
    });
  });

  describe('Grants Management & Manual Retry', () => {
    it('POST /api/admin/grants/:id/retry should re-queue grant for retry', async () => {
      const mockGrant: AccessGrant = {
        id: 'grant_retry_123',
        product_id: 'prod_1',
        drive_folder_id: 'folder_1',
        buyer_email: 'buyer@example.com',
        normalized_email: 'buyer@example.com',
        status: 'manual_review',
        permission_id: null,
        attempt_count: 5,
        next_attempt_at: null,
        lease_until: null,
        last_error_code: 'RATE_LIMITED',
        last_attempt_at: null,
        granted_at: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      vi.spyOn(grantsRepository, 'findById').mockResolvedValue(mockGrant);
      vi.spyOn(jobsRepository, 'findByGrantId').mockResolvedValue({
        id: 'job_retry_123',
        grant_id: 'grant_retry_123',
      } as OutboxJob);
      vi.spyOn(jobsRepository, 'markQueued').mockResolvedValue(undefined);
      vi.spyOn(paymentsRepository, 'updateAccessStatusByProductAndEmail').mockResolvedValue(undefined);

      const request = new Request('http://localhost/api/admin/grants/grant_retry_123/retry', {
        method: 'POST',
        headers: { Cookie: validAdminCookie },
      });

      const response = await worker.fetch(request, mockEnv, ctx);
      expect(response.status).toBe(200);

      expect(mockQueueSend).toHaveBeenCalledWith({
        grantId: 'grant_retry_123',
        outboxJobId: 'job_retry_123',
      });
      expect(jobsRepository.markQueued).toHaveBeenCalledWith(mockEnv.DB, 'job_retry_123');
    });
  });
});
