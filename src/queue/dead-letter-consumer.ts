import type { WorkerEnv } from '@/config/env';
import type { GrantQueueMessage } from '@/types';
import { grantsRepository } from '@/repositories/grants.repository';
import { jobsRepository } from '@/repositories/jobs.repository';
import { paymentsRepository } from '@/repositories/payments.repository';

export const deadLetterConsumer = {
  /**
   * Processes messages arriving at the dead-letter queue (drive-access-grants-dlq)
   * after exhausting all automatic retry attempts.
   * Escalates the grant to manual_review and creates an audit log entry.
   */
  async processBatch(
    batch: MessageBatch<GrantQueueMessage>,
    env: WorkerEnv
  ): Promise<void> {
    const now = new Date().toISOString();

    for (const message of batch.messages) {
      const { grantId, outboxJobId } = message.body;

      if (!grantId || !outboxJobId) {
        message.ack();
        continue;
      }

      try {
        console.warn(`[DLQConsumer] Message exhausted retries. Grant ID: ${grantId}, Job ID: ${outboxJobId}`);

        // 1. Mark Outbox Job as manual_review
        await jobsRepository.markFailed(
          env.DB,
          outboxJobId,
          'MAX_RETRIES_EXCEEDED_DLQ',
          'manual_review'
        );

        // 2. Mark Access Grant as manual_review
        await grantsRepository.markFailed(
          env.DB,
          grantId,
          'MAX_RETRIES_EXCEEDED_DLQ',
          true
        );

        // 3. Mark associated Payment as manual_review
        const grant = await grantsRepository.findById(env.DB, grantId);
        if (grant) {
          await paymentsRepository.updateAccessStatusByProductAndEmail(
            env.DB,
            grant.product_id,
            grant.normalized_email,
            'manual_review'
          );
        }

        // 4. Log to admin audit logs
        await env.DB
          .prepare(
            `INSERT INTO admin_audit_logs (
              id, admin_user, action, target_entity, target_id, details_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            crypto.randomUUID(),
            'system:dlq',
            'EXHAUSTED_RETRIES_ESCALATED_TO_MANUAL_REVIEW',
            'access_grant',
            grantId,
            JSON.stringify({
              outboxJobId,
              timestamp: now,
              reason: 'Message exceeded maximum delivery retries in Cloudflare Queue',
            }),
            now
          )
          .run();

        // 5. Acknowledge message from DLQ
        message.ack();
      } catch (dlqErr) {
        console.error('[DLQConsumer] Error processing DLQ message:', dlqErr);
        // Acknowledge anyway to prevent DLQ poison loops
        message.ack();
      }
    }
  },
};
