import { describe, it, expect } from 'vitest';
import worker from '../../src/index';

describe('Worker Health Route', () => {
  it('should return 200 and ok status for GET /api/health', async () => {
    const request = new Request('http://localhost/api/health', {
      method: 'GET',
    });

    const env = {
      DB: {} as unknown as D1Database,
      GRANT_QUEUE: {} as unknown as Queue,
      RAZORPAY_WEBHOOK_SECRET: 'test_secret',
      ADMIN_SESSION_SECRET: '01234567890123456789012345678901',
    };

    const ctx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;

    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);

    const body = await response.json() as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('paylink-entitlements');
  });
});
