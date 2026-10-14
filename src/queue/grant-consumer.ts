import type { WorkerEnv } from '@/config/env';
import type { GrantQueueMessage } from '@/types';
import { grantsRepository } from '@/repositories/grants.repository';
import { jobsRepository } from '@/repositories/jobs.repository';
import { paymentsRepository } from '@/repositories/payments.repository';
import { googleDriveService, GoogleDriveError } from '@/services/google-drive-service';

export const grantConsumer = {
  /**
   * Processes a batch of drive-access-grants queue messages.
   * Strictly keeps CPU execution under 10 ms by doing only asynchronous I/O and lean database updates.
   */
  async processBatch(
    batch: MessageBatch<GrantQueueMessage>,
    env: WorkerEnv
  ): Promise<void> {
    for (const message of batch.messages) {
      await this.processSingleMessage(message, env);
    }
  },

  async processSingleMessage(
    message: Message<GrantQueueMessage>,
    env: WorkerEnv
  ): Promise<void> {
    const { grantId, outboxJobId } = message.body;

    if (!grantId || !outboxJobId) {
      console.warn('[GrantConsumer] Invalid queue message format. Acknowledging to discard:', message.body);
      message.ack();
      return;
    }

    try {
      // 1. Fetch grant record
      const grant = await grantsRepository.findById(env.DB, grantId);
      if (!grant) {
        console.warn(`[GrantConsumer] Grant with ID ${grantId} not found in database. Acknowledging.`);
        message.ack();
        return;
      }

      // 2. Pre-flight Idempotency Check
      // If already granted, acknowledge immediately without calling Google Drive
      if (grant.status === 'granted') {
        await jobsRepository.markCompleted(env.DB, outboxJobId);
        message.ack();
        return;
      }

      // 3. Acquire Database-Backed Lease to coordinate concurrent deliveries
      const leaseAcquired = await grantsRepository.acquireLease(env.DB, grantId, 60);
      if (!leaseAcquired) {
        console.warn(`[GrantConsumer] Lease conflict on grant ${grantId}. Retrying later.`);
        message.retry({ delaySeconds: 15 });
        return;
      }

      // 4. Execute Google Drive Provisioning
      const permResult = await googleDriveService.grantFolderReaderAccess(
        env,
        grant.drive_folder_id,
        grant.normalized_email
      );

      // 5. Mark Grant & Payments Completed
      await grantsRepository.markGranted(env.DB, grantId, permResult.permissionId);
      await jobsRepository.markCompleted(env.DB, outboxJobId);
      await paymentsRepository.updateAccessStatusByProductAndEmail(
        env.DB,
        grant.product_id,
        grant.normalized_email,
        'granted'
      );

      // 6. Acknowledge Queue Message
      message.ack();
    } catch (err: unknown) {
      console.error(`[GrantConsumer] Error processing grant ${grantId}:`, err);

      const isPermanent =
        err instanceof GoogleDriveError ? !err.isTransient : false;
      const errorCode =
        err instanceof GoogleDriveError ? err.code : 'UNEXPECTED_GRANT_ERROR';

      const failureResult = await grantsRepository.markFailed(
        env.DB,
        grantId,
        errorCode,
        isPermanent
      );

      await jobsRepository.markFailed(
        env.DB,
        outboxJobId,
        errorCode,
        failureResult.status === 'manual_review' ? 'manual_review' : 'retry',
        failureResult.nextAttemptAt
      );

      if (failureResult.status === 'manual_review') {
        // Escalate associated payments to manual review
        const grant = await grantsRepository.findById(env.DB, grantId);
        if (grant) {
          await paymentsRepository.updateAccessStatusByProductAndEmail(
            env.DB,
            grant.product_id,
            grant.normalized_email,
            'manual_review'
          );
        }

        // Acknowledge message so it doesn't loop forever on a permanent failure
        message.ack();
      } else {
        // Transient error: retry message with exponential backoff delay
        const attempts = message.attempts ?? 1;
        const delaySeconds = Math.min(15 * Math.pow(2, attempts - 1), 300);
        message.retry({ delaySeconds });
      }
    }
  },
};
