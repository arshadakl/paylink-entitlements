import { Hono } from 'hono';
import type { WorkerEnv } from './config/env';
import type { GrantQueueMessage } from './types';
import { healthRouter } from './routes/health.routes';
import { webhookRouter } from './routes/webhook.routes';
import { grantConsumer } from './queue/grant-consumer';
import { deadLetterConsumer } from './queue/dead-letter-consumer';
import { recoveryCron } from './cron/recovery-cron';

const app = new Hono<{ Bindings: WorkerEnv }>();

// API routes mounted under /api
app.route('/api', healthRouter);
app.route('/api/webhooks', webhookRouter);

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

  async queue(batch: MessageBatch<unknown>, env: WorkerEnv): Promise<void> {
    const queueName = batch.queue;
    console.log(`[Queue] Processing batch of ${batch.messages.length} messages from queue: ${queueName}`);

    if (queueName === 'drive-access-grants-dlq') {
      await deadLetterConsumer.processBatch(batch as MessageBatch<GrantQueueMessage>, env);
    } else {
      await grantConsumer.processBatch(batch as MessageBatch<GrantQueueMessage>, env);
    }
  },

  async scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    console.log(`[Cron] Scheduled trigger running at ${new Date(controller.scheduledTime).toISOString()}`);
    ctx.waitUntil(recoveryCron.run(env));
  },
};
