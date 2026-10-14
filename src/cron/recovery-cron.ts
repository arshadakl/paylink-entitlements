import type { WorkerEnv } from '@/config/env';
import type { GrantQueueMessage } from '@/types';
import { jobsRepository } from '@/repositories/jobs.repository';
import { grantsRepository } from '@/repositories/grants.repository';

export interface RecoveryCronStats {
  scannedCount: number;
  enqueuedCount: number;
  staleLeasesResetCount: number;
  escalatedToManualReviewCount: number;
}

export const recoveryCron = {
  /**
   * Bounded scheduled recovery handler running every 1 minute (* * * * *).
   * Strictly stays under 10 ms CPU by querying small, indexed batches (LIMIT 10)
   * and performing asynchronous I/O.
   */
  async run(env: WorkerEnv): Promise<RecoveryCronStats> {
    const stats: RecoveryCronStats = {
      scannedCount: 0,
      enqueuedCount: 0,
      staleLeasesResetCount: 0,
      escalatedToManualReviewCount: 0,
    };

    const now = new Date().toISOString();

    // 1. Reset stale leases on outbox jobs stuck in 'processing' where lease has expired
    try {
      const staleResult = await env.DB
        .prepare(
          `UPDATE outbox_jobs 
           SET status = 'retry', lease_until = NULL, updated_at = ?
           WHERE status = 'processing' 
             AND lease_until IS NOT NULL 
             AND lease_until < ?`
        )
        .bind(now, now)
        .run();

      stats.staleLeasesResetCount = staleResult.meta.changes;
    } catch (err) {
      console.error('[RecoveryCron] Error resetting stale leases:', err);
    }

    // 2. Query small, bounded batch of pending or retryable outbox jobs (max 10)
    // Uses index: idx_outbox_jobs_status_next
    const eligibleJobs = await jobsRepository.listEligiblePending(env.DB, 10);
    stats.scannedCount = eligibleJobs.length;

    if (eligibleJobs.length === 0) {
      return stats;
    }

    console.log(`[RecoveryCron] Found ${eligibleJobs.length} eligible jobs to process/re-enqueue.`);

    // 3. Process eligible jobs
    for (const job of eligibleJobs) {
      // Guard against infinite retry loops
      if (job.attempt_count >= 5) {
        await jobsRepository.markFailed(
          env.DB,
          job.id,
          'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
          'manual_review'
        );
        await grantsRepository.markFailed(
          env.DB,
          job.grant_id,
          'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
          true
        );
        stats.escalatedToManualReviewCount++;
        continue;
      }

      try {
        // Enqueue minimal message payload to Cloudflare Queue
        const payload: GrantQueueMessage = {
          grantId: job.grant_id,
          outboxJobId: job.id,
        };

        await env.GRANT_QUEUE.send(payload);

        // Mark as queued in D1 with updated dispatched_at
        await jobsRepository.markQueued(env.DB, job.id);
        stats.enqueuedCount++;
      } catch (enqueueErr) {
        console.error(`[RecoveryCron] Failed to re-enqueue job ${job.id}:`, enqueueErr);
        // Job remains in pending/retry status for the next cron iteration
      }
    }

    return stats;
  },
};
