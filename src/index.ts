import { Hono } from 'hono';
import type { WorkerEnv } from './config/env';
import { healthRouter } from './routes/health.routes';

const app = new Hono<{ Bindings: WorkerEnv }>();

// API routes mounted under /api
app.route('/api', healthRouter);

// Cloudflare Worker export with fetch, queue, and scheduled (cron) handlers
export default {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> | Response {
    const url = new URL(request.url);

    // If request is for /api/*, handle via Hono router
    if (url.pathname.startsWith('/api')) {
      return app.fetch(request, env, ctx);
    }

    // Otherwise, let Cloudflare Workers Static Assets serve the frontend
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Paylink Entitlements Worker is active.', {
      headers: { 'Content-Type': 'text/plain' },
    });
  },

  async queue(batch: MessageBatch<unknown>, _env: WorkerEnv): Promise<void> {
    // Queue consumer logic will be implemented in Phase 5
    console.log(`[Queue] Received batch of ${batch.messages.length} messages`);
  },

  async scheduled(controller: ScheduledController, _env: WorkerEnv, _ctx: ExecutionContext): Promise<void> {
    // Scheduled recovery cron will be implemented in Phase 5
    console.log(`[Cron] Scheduled trigger executed at ${controller.scheduledTime}`);
  },
};
