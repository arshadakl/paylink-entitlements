import { Hono } from 'hono';
import type { WorkerEnv } from '@/config/env';

export const healthRouter = new Hono<{ Bindings: WorkerEnv }>();

healthRouter.get('/health', async (c) => {
  return c.json({
    status: 'ok',
    service: 'paylink-entitlements',
    timestamp: new Date().toISOString(),
  });
});
