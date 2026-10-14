import { z } from 'zod';
import type { 
  WebhookEvent, 
  Payment, 
  AccessGrant, 
  OutboxJob, 
  GrantQueueMessage,
  PaymentStatus,
  AccessStatus 
} from '@/types';
import { productsRepository } from '@/repositories/products.repository';
import { paymentsRepository } from '@/repositories/payments.repository';
import { grantsRepository } from '@/repositories/grants.repository';
import { jobsRepository } from '@/repositories/jobs.repository';
import { webhooksRepository } from '@/repositories/webhooks.repository';

// Schema for Razorpay payment_link.paid webhook payload
export const razorpayPaymentLinkPaidPayloadSchema = z.object({
  entity: z.literal('event'),
  account_id: z.string().optional(),
  event: z.string(),
  contains: z.array(z.string()).optional(),
  payload: z.object({
    payment_link: z.object({
      entity: z.object({
        id: z.string(),
        amount: z.number().int(),
        amount_paid: z.number().int(),
        currency: z.string(),
        status: z.string(),
      }),
    }),
    payment: z.object({
      entity: z.object({
        id: z.string(),
        amount: z.number().int(),
        currency: z.string(),
        status: z.string(),
        email: z.string().nullable().optional(),
        captured: z.boolean().optional(),
      }),
    }),
  }),
});

export type RazorpayPaymentLinkPaidPayload = z.infer<typeof razorpayPaymentLinkPaidPayloadSchema>;

export interface ProcessWebhookResult {
  status: 'processed' | 'ignored' | 'unmapped' | 'manual_review' | 'failed';
  reasonCode?: string;
  paymentId?: string;
  grantId?: string;
  outboxJobId?: string;
  enqueued: boolean;
}

/**
 * Normalizes email addresses: lowercase and trims whitespace.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validates buyer email syntax.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const paymentService = {
  /**
   * Processes a verified Razorpay payment_link.paid webhook event.
   * Commits all database changes in an atomic D1 batch and enqueues asynchronous grant processing.
   */
  async processPaymentLinkPaid(
    db: D1Database,
    queue: Queue<GrantQueueMessage>,
    eventId: string,
    rawPayload: unknown,
    payloadHash: string
  ): Promise<ProcessWebhookResult> {
    const now = new Date().toISOString();

    // 1. Idempotency Check: Verify if event has already been recorded
    const existingEvent = await webhooksRepository.findById(db, eventId);
    if (existingEvent) {
      return {
        status: existingEvent.processing_status,
        reasonCode: 'DUPLICATE_EVENT_ID',
        enqueued: false,
      };
    }

    // 2. Validate payload structure
    const parseResult = razorpayPaymentLinkPaidPayloadSchema.safeParse(rawPayload);
    if (!parseResult.success) {
      const event: WebhookEvent = {
        event_id: eventId,
        event_type: 'unknown',
        razorpay_link_id: null,
        razorpay_payment_id: null,
        received_at: now,
        processing_status: 'failed',
        reason_code: 'INVALID_PAYLOAD_SCHEMA',
        payload_hash: payloadHash,
      };
      await webhooksRepository.create(db, event);
      return {
        status: 'failed',
        reasonCode: 'INVALID_PAYLOAD_SCHEMA',
        enqueued: false,
      };
    }

    const { payment_link, payment } = parseResult.data.payload;
    const linkEntity = payment_link.entity;
    const paymentEntity = payment.entity;

    // 3. Verify event is payment_link.paid
    if (parseResult.data.event !== 'payment_link.paid') {
      const event: WebhookEvent = {
        event_id: eventId,
        event_type: parseResult.data.event,
        razorpay_link_id: linkEntity.id,
        razorpay_payment_id: paymentEntity.id,
        received_at: now,
        processing_status: 'ignored',
        reason_code: 'UNRELATED_EVENT_TYPE',
        payload_hash: payloadHash,
      };
      await webhooksRepository.create(db, event);
      return {
        status: 'ignored',
        reasonCode: 'UNRELATED_EVENT_TYPE',
        enqueued: false,
      };
    }

    // 4. Resolve Razorpay Payment Link ID to configured product
    const resolved = await productsRepository.findByPaymentLinkId(db, linkEntity.id);
    if (!resolved || !resolved.mapping.active) {
      const event: WebhookEvent = {
        event_id: eventId,
        event_type: 'payment_link.paid',
        razorpay_link_id: linkEntity.id,
        razorpay_payment_id: paymentEntity.id,
        received_at: now,
        processing_status: 'unmapped',
        reason_code: 'PAYMENT_LINK_NOT_MAPPED_OR_INACTIVE',
        payload_hash: payloadHash,
      };
      await webhooksRepository.create(db, event);
      return {
        status: 'unmapped',
        reasonCode: 'PAYMENT_LINK_NOT_MAPPED_OR_INACTIVE',
        enqueued: false,
      };
    }

    const { product } = resolved;

    // 5. Check product active status
    if (!product.active) {
      const event: WebhookEvent = {
        event_id: eventId,
        event_type: 'payment_link.paid',
        razorpay_link_id: linkEntity.id,
        razorpay_payment_id: paymentEntity.id,
        received_at: now,
        processing_status: 'manual_review',
        reason_code: 'PRODUCT_INACTIVE',
        payload_hash: payloadHash,
      };
      await webhooksRepository.create(db, event);
      return {
        status: 'manual_review',
        reasonCode: 'PRODUCT_INACTIVE',
        enqueued: false,
      };
    }

    // 6. Validate price, currency, and capture status
    const isAmountValid = paymentEntity.amount === product.expected_amount_paise;
    const isCurrencyValid = paymentEntity.currency.toUpperCase() === product.currency.toUpperCase();
    const isCaptured = paymentEntity.status === 'captured' || paymentEntity.captured === true;
    const isLinkPaid = linkEntity.status === 'paid' && linkEntity.amount_paid >= linkEntity.amount;

    if (!isAmountValid || !isCurrencyValid || !isCaptured || !isLinkPaid) {
      const reason = !isAmountValid
        ? 'AMOUNT_MISMATCH'
        : !isCurrencyValid
        ? 'CURRENCY_MISMATCH'
        : !isCaptured
        ? 'PAYMENT_NOT_CAPTURED'
        : 'LINK_NOT_FULLY_PAID';

      const event: WebhookEvent = {
        event_id: eventId,
        event_type: 'payment_link.paid',
        razorpay_link_id: linkEntity.id,
        razorpay_payment_id: paymentEntity.id,
        received_at: now,
        processing_status: 'manual_review',
        reason_code: reason,
        payload_hash: payloadHash,
      };

      const paymentRecord: Payment = {
        razorpay_payment_id: paymentEntity.id,
        razorpay_link_id: linkEntity.id,
        product_id: product.id,
        buyer_email: paymentEntity.email ?? null,
        normalized_email: paymentEntity.email ? normalizeEmail(paymentEntity.email) : null,
        amount_paise: paymentEntity.amount,
        currency: paymentEntity.currency,
        payment_status: paymentEntity.status as PaymentStatus,
        access_status: 'manual_review',
        created_at: now,
        updated_at: now,
      };

      await db.batch([
        webhooksRepository.createStmt(db, event),
        paymentsRepository.createStmt(db, paymentRecord),
      ]);

      return {
        status: 'manual_review',
        reasonCode: reason,
        paymentId: paymentEntity.id,
        enqueued: false,
      };
    }

    // 7. Check for Missing Buyer Email
    const rawEmail = paymentEntity.email;
    if (!rawEmail || !isValidEmail(rawEmail.trim())) {
      const event: WebhookEvent = {
        event_id: eventId,
        event_type: 'payment_link.paid',
        razorpay_link_id: linkEntity.id,
        razorpay_payment_id: paymentEntity.id,
        received_at: now,
        processing_status: 'manual_review',
        reason_code: 'MISSING_BUYER_EMAIL',
        payload_hash: payloadHash,
      };

      const paymentRecord: Payment = {
        razorpay_payment_id: paymentEntity.id,
        razorpay_link_id: linkEntity.id,
        product_id: product.id,
        buyer_email: null,
        normalized_email: null,
        amount_paise: paymentEntity.amount,
        currency: paymentEntity.currency,
        payment_status: 'captured',
        access_status: 'manual_review',
        created_at: now,
        updated_at: now,
      };

      await db.batch([
        webhooksRepository.createStmt(db, event),
        paymentsRepository.createStmt(db, paymentRecord),
      ]);

      return {
        status: 'manual_review',
        reasonCode: 'MISSING_BUYER_EMAIL',
        paymentId: paymentEntity.id,
        enqueued: false,
      };
    }

    const cleanEmail = rawEmail.trim();
    const normalized = normalizeEmail(cleanEmail);

    // 8. Check if Access Grant already exists for this folder & normalized email
    const existingGrant = await grantsRepository.findByFolderAndEmail(
      db,
      product.drive_folder_id,
      normalized
    );

    let grantId: string;
    let outboxJobId: string | undefined;
    let accessStatus: AccessStatus = 'pending';
    const batchStatements: D1PreparedStatement[] = [];

    const eventRecord: WebhookEvent = {
      event_id: eventId,
      event_type: 'payment_link.paid',
      razorpay_link_id: linkEntity.id,
      razorpay_payment_id: paymentEntity.id,
      received_at: now,
      processing_status: 'processed',
      reason_code: null,
      payload_hash: payloadHash,
    };
    batchStatements.push(webhooksRepository.createStmt(db, eventRecord));

    if (existingGrant && existingGrant.status === 'granted') {
      // Re-use existing granted state without duplicate Google Drive calls
      grantId = existingGrant.id;
      accessStatus = 'granted';

      const paymentRecord: Payment = {
        razorpay_payment_id: paymentEntity.id,
        razorpay_link_id: linkEntity.id,
        product_id: product.id,
        buyer_email: cleanEmail,
        normalized_email: normalized,
        amount_paise: paymentEntity.amount,
        currency: paymentEntity.currency,
        payment_status: 'captured',
        access_status: 'granted',
        created_at: now,
        updated_at: now,
      };
      batchStatements.push(paymentsRepository.createStmt(db, paymentRecord));

      await db.batch(batchStatements);

      return {
        status: 'processed',
        paymentId: paymentEntity.id,
        grantId,
        enqueued: false,
      };
    }

    // 9. Create New Grant & Outbox Job
    grantId = existingGrant ? existingGrant.id : crypto.randomUUID();
    outboxJobId = crypto.randomUUID();
    const dedupeKey = `${grantId}:grant_access`;

    const paymentRecord: Payment = {
      razorpay_payment_id: paymentEntity.id,
      razorpay_link_id: linkEntity.id,
      product_id: product.id,
      buyer_email: cleanEmail,
      normalized_email: normalized,
      amount_paise: paymentEntity.amount,
      currency: paymentEntity.currency,
      payment_status: 'captured',
      access_status: accessStatus,
      created_at: now,
      updated_at: now,
    };
    batchStatements.push(paymentsRepository.createStmt(db, paymentRecord));

    if (!existingGrant) {
      const grantRecord: AccessGrant = {
        id: grantId,
        product_id: product.id,
        drive_folder_id: product.drive_folder_id,
        buyer_email: cleanEmail,
        normalized_email: normalized,
        status: 'pending',
        permission_id: null,
        attempt_count: 0,
        next_attempt_at: now,
        lease_until: null,
        last_error_code: null,
        last_attempt_at: null,
        granted_at: null,
        created_at: now,
        updated_at: now,
      };
      batchStatements.push(grantsRepository.createStmt(db, grantRecord));
    }

    const outboxJob: OutboxJob = {
      id: outboxJobId,
      job_type: 'grant_access',
      grant_id: grantId,
      dedupe_key: dedupeKey,
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: now,
      last_attempt_at: null,
      dispatched_at: null,
      lease_until: null,
      last_error_code: null,
      created_at: now,
      updated_at: now,
    };
    batchStatements.push(jobsRepository.createStmt(db, outboxJob));

    // Commit atomic batch to D1
    await db.batch(batchStatements);

    // 10. Publish lightweight message to Cloudflare Queue
    let enqueued = false;
    try {
      await queue.send({
        grantId,
        outboxJobId,
      });
      // Mark outbox job as queued in D1 after successful send
      await jobsRepository.markQueued(db, outboxJobId);
      await paymentsRepository.updateAccessStatus(db, paymentEntity.id, 'queued');
      enqueued = true;
    } catch (queueError) {
      // If queue publishing fails, outbox job remains 'pending'
      // The 1-minute background recovery cron will dispatch it automatically
      console.error('[PaymentService] Failed to enqueue grant job. Preserving outbox job as pending:', queueError);
    }

    return {
      status: 'processed',
      paymentId: paymentEntity.id,
      grantId,
      outboxJobId,
      enqueued,
    };
  },
};
