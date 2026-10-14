import { Hono } from 'hono';
import type { WorkerEnv } from '@/config/env';
import {
  verifyRazorpaySignature,
  hashPayloadSha256,
} from '@/services/razorpay-verification';
import { paymentService } from '@/services/payment-service';

export const webhookRouter = new Hono<{ Bindings: WorkerEnv }>();

// Maximum acceptable webhook body size (100 KB) to defend against memory exhaustion
const MAX_WEBHOOK_BODY_BYTES = 100 * 1024;

webhookRouter.post('/razorpay', async (c) => {
  // 1. Read exact raw body text once
  const rawBody = await c.req.raw.text();

  if (rawBody.length > MAX_WEBHOOK_BODY_BYTES) {
    return c.json(
      {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Webhook request payload exceeds 100 KB limit',
        },
      },
      413
    );
  }

  // 2. Extract Razorpay signature header
  const signature = c.req.header('x-razorpay-signature');
  if (!signature || signature.trim().length === 0) {
    return c.json(
      {
        error: {
          code: 'MISSING_SIGNATURE',
          message: 'X-Razorpay-Signature header is missing',
        },
      },
      401
    );
  }

  // 3. Constant-time signature verification (supporting secret rotation)
  const verification = await verifyRazorpaySignature(
    rawBody,
    signature,
    c.env.RAZORPAY_WEBHOOK_SECRET,
    c.env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS
  );

  if (!verification.isValid) {
    return c.json(
      {
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Webhook HMAC-SHA256 signature verification failed',
        },
      },
      401
    );
  }

  // 4. Safe single-pass JSON parse (only after signature verification succeeded)
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(rawBody);
  } catch (_parseError) {
    return c.json(
      {
        error: {
          code: 'MALFORMED_JSON',
          message: 'Webhook payload is not valid JSON',
        },
      },
      400
    );
  }

  // 5. Extract event ID from headers or generate audit fallback
  const eventId =
    c.req.header('x-razorpay-event-id') ||
    (typeof parsedPayload === 'object' &&
    parsedPayload !== null &&
    'event_id' in parsedPayload &&
    typeof (parsedPayload as { event_id: unknown }).event_id === 'string'
      ? (parsedPayload as { event_id: string }).event_id
      : `evt_gen_${crypto.randomUUID()}`);

  // 6. Compute SHA-256 payload hash for compact audit storage
  const payloadHash = await hashPayloadSha256(rawBody);

  // 7. Process payment and coordinate atomic D1 persistence
  try {
    const result = await paymentService.processPaymentLinkPaid(
      c.env.DB,
      c.env.GRANT_QUEUE,
      eventId,
      parsedPayload,
      payloadHash
    );

    // If internal processing permanently failed (e.g. database error), return 500 for Razorpay retry
    if (result.status === 'failed' && result.reasonCode !== 'INVALID_PAYLOAD_SCHEMA') {
      return c.json(
        {
          error: {
            code: 'PERSISTENCE_FAILED',
            message: 'Failed to durably record payment event',
          },
        },
        500
      );
    }

    return c.json(
      {
        success: true,
        status: result.status,
        reason: result.reasonCode ?? null,
        paymentId: result.paymentId ?? null,
        enqueued: result.enqueued,
      },
      200
    );
  } catch (err) {
    console.error('[WebhookRoute] Unexpected error processing Razorpay event:', err);
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An error occurred while processing the payment event',
        },
      },
      500
    );
  }
});
