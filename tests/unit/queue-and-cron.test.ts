import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../../src/index';
import type { WorkerEnv } from '../../src/config/env';
import type { GrantQueueMessage, AccessGrant, OutboxJob } from '../../src/types';
import { grantConsumer } from '../../src/queue/grant-consumer';
import { deadLetterConsumer } from '../../src/queue/dead-letter-consumer';
import { recoveryCron } from '../../src/cron/recovery-cron';
import { grantsRepository } from '../../src/repositories/grants.repository';
import { jobsRepository } from '../../src/repositories/jobs.repository';
import { paymentsRepository } from '../../src/repositories/payments.repository';
import { googleDriveService, GoogleDriveError } from '../../src/services/google-drive-service';

describe('Queue Consumer & Scheduled Recovery Cron', () => {
  let mockEnv: WorkerEnv;
  let mockQueueSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
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
      ADMIN_SESSION_SECRET: '01234567890123456789012345678901',
    };
  });

  function createMockMessage(grantId: string, outboxJobId: string) {
    return {
      id: 'msg_123',
      body: { grantId, outboxJobId },
      attempts: 1,
      timestamp: new Date(),
      ack: vi.fn(),
      retry: vi.fn(),
    } as unknown as Message<GrantQueueMessage>;
  }

  describe('grantConsumer', () => {
    const mockGrant: AccessGrant = {
      id: 'grant_abc',
      product_id: 'prod_123',
      drive_folder_id: 'folder_xyz',
      buyer_email: 'buyer@example.com',
      normalized_email: 'buyer@example.com',
      status: 'pending',
      permission_id: null,
      attempt_count: 0,
      next_attempt_at: null,
      lease_until: null,
      last_error_code: null,
      last_attempt_at: null,
      granted_at: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    it('should provision access, mark records completed, and ack message on success', async () => {
      const msg = createMockMessage('grant_abc', 'job_xyz');

      vi.spyOn(grantsRepository, 'findById').mockResolvedValue(mockGrant);
      vi.spyOn(grantsRepository, 'acquireLease').mockResolvedValue(true);
      vi.spyOn(googleDriveService, 'grantFolderReaderAccess').mockResolvedValue({
        permissionId: 'perm_new_123',
        alreadyExisted: false,
      });
      vi.spyOn(grantsRepository, 'markGranted').mockResolvedValue(undefined);
      vi.spyOn(jobsRepository, 'markCompleted').mockResolvedValue(undefined);
      vi.spyOn(paymentsRepository, 'updateAccessStatusByProductAndEmail').mockResolvedValue(undefined);

      await grantConsumer.processSingleMessage(msg, mockEnv);

      expect(grantsRepository.acquireLease).toHaveBeenCalledWith(mockEnv.DB, 'grant_abc', 60);
      expect(googleDriveService.grantFolderReaderAccess).toHaveBeenCalledWith(
        mockEnv,
        'folder_xyz',
        'buyer@example.com'
      );
      expect(grantsRepository.markGranted).toHaveBeenCalledWith(mockEnv.DB, 'grant_abc', 'perm_new_123');
      expect(jobsRepository.markCompleted).toHaveBeenCalledWith(mockEnv.DB, 'job_xyz');
      expect(paymentsRepository.updateAccessStatusByProductAndEmail).toHaveBeenCalledWith(
        mockEnv.DB,
        'prod_123',
        'buyer@example.com',
        'granted'
      );
      expect(msg.ack).toHaveBeenCalled();
      expect(msg.retry).not.toHaveBeenCalled();
    });

    it('should acknowledge immediately without calling Drive if grant is already granted', async () => {
      const msg = createMockMessage('grant_abc', 'job_xyz');
      const alreadyGranted: AccessGrant = { ...mockGrant, status: 'granted' };

      vi.spyOn(grantsRepository, 'findById').mockResolvedValue(alreadyGranted);
      const driveSpy = vi.spyOn(googleDriveService, 'grantFolderReaderAccess');
      vi.spyOn(jobsRepository, 'markCompleted').mockResolvedValue(undefined);

      await grantConsumer.processSingleMessage(msg, mockEnv);

      expect(driveSpy).not.toHaveBeenCalled();
      expect(jobsRepository.markCompleted).toHaveBeenCalledWith(mockEnv.DB, 'job_xyz');
      expect(msg.ack).toHaveBeenCalled();
    });

    it('should retry message if lease acquisition fails due to concurrent worker', async () => {
      const msg = createMockMessage('grant_abc', 'job_xyz');

      vi.spyOn(grantsRepository, 'findById').mockResolvedValue(mockGrant);
      vi.spyOn(grantsRepository, 'acquireLease').mockResolvedValue(false); // lease locked

      await grantConsumer.processSingleMessage(msg, mockEnv);

      expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 15 });
      expect(msg.ack).not.toHaveBeenCalled();
    });

    it('should retry message on transient Google Drive API error', async () => {
      const msg = createMockMessage('grant_abc', 'job_xyz');

      vi.spyOn(grantsRepository, 'findById').mockResolvedValue(mockGrant);
      vi.spyOn(grantsRepository, 'acquireLease').mockResolvedValue(true);
      vi.spyOn(googleDriveService, 'grantFolderReaderAccess').mockRejectedValue(
        new GoogleDriveError('Rate limit exceeded', 'RATE_LIMITED', true, 429)
      );
      vi.spyOn(grantsRepository, 'markFailed').mockResolvedValue({
        status: 'pending',
        nextAttemptAt: '2026-01-01T00:01:00Z',
      });
      vi.spyOn(jobsRepository, 'markFailed').mockResolvedValue(undefined);

      await grantConsumer.processSingleMessage(msg, mockEnv);

      expect(grantsRepository.markFailed).toHaveBeenCalledWith(
        mockEnv.DB,
        'grant_abc',
        'RATE_LIMITED',
        false
      );
      expect(msg.retry).toHaveBeenCalled();
      expect(msg.ack).not.toHaveBeenCalled();
    });

    it('should escalate to manual_review and ack message on permanent error', async () => {
      const msg = createMockMessage('grant_abc', 'job_xyz');

      vi.spyOn(grantsRepository, 'findById').mockResolvedValue(mockGrant);
      vi.spyOn(grantsRepository, 'acquireLease').mockResolvedValue(true);
      vi.spyOn(googleDriveService, 'grantFolderReaderAccess').mockRejectedValue(
        new GoogleDriveError('Recipient email domain does not accept sharing', 'INVALID_RECIPIENT', false, 400)
      );
      vi.spyOn(grantsRepository, 'markFailed').mockResolvedValue({
        status: 'manual_review',
        nextAttemptAt: null,
      });
      vi.spyOn(jobsRepository, 'markFailed').mockResolvedValue(undefined);
      vi.spyOn(paymentsRepository, 'updateAccessStatusByProductAndEmail').mockResolvedValue(undefined);

      await grantConsumer.processSingleMessage(msg, mockEnv);

      expect(grantsRepository.markFailed).toHaveBeenCalledWith(
        mockEnv.DB,
        'grant_abc',
        'INVALID_RECIPIENT',
        true
      );
      expect(paymentsRepository.updateAccessStatusByProductAndEmail).toHaveBeenCalledWith(
        mockEnv.DB,
        'prod_123',
        'buyer@example.com',
        'manual_review'
      );
      // Permanent error: must ack to prevent dead-letter poison loops
      expect(msg.ack).toHaveBeenCalled();
      expect(msg.retry).not.toHaveBeenCalled();
    });
  });

  describe('deadLetterConsumer', () => {
    it('should mark exhausted jobs as manual_review, log audit, and ack from DLQ', async () => {
      const msg = createMockMessage('grant_exhausted', 'job_exhausted');
      const batch = {
        queue: 'drive-access-grants-dlq',
        messages: [msg],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch<GrantQueueMessage>;

      vi.spyOn(jobsRepository, 'markFailed').mockResolvedValue(undefined);
      vi.spyOn(grantsRepository, 'markFailed').mockResolvedValue({ status: 'manual_review', nextAttemptAt: null });
      vi.spyOn(grantsRepository, 'findById').mockResolvedValue({
        id: 'grant_exhausted',
        product_id: 'prod_123',
        normalized_email: 'buyer@example.com',
      } as AccessGrant);
      vi.spyOn(paymentsRepository, 'updateAccessStatusByProductAndEmail').mockResolvedValue(undefined);

      await deadLetterConsumer.processBatch(batch, mockEnv);

      expect(jobsRepository.markFailed).toHaveBeenCalledWith(
        mockEnv.DB,
        'job_exhausted',
        'MAX_RETRIES_EXCEEDED_DLQ',
        'manual_review'
      );
      expect(grantsRepository.markFailed).toHaveBeenCalledWith(
        mockEnv.DB,
        'grant_exhausted',
        'MAX_RETRIES_EXCEEDED_DLQ',
        true
      );
      expect(paymentsRepository.updateAccessStatusByProductAndEmail).toHaveBeenCalledWith(
        mockEnv.DB,
        'prod_123',
        'buyer@example.com',
        'manual_review'
      );
      expect(msg.ack).toHaveBeenCalled();
    });
  });

  describe('recoveryCron', () => {
    it('should query bounded batch, re-enqueue pending jobs, and mark them queued in D1', async () => {
      const mockJobs: OutboxJob[] = [
        {
          id: 'job_rec_1',
          job_type: 'grant_access',
          grant_id: 'grant_rec_1',
          dedupe_key: 'grant_rec_1:grant_access',
          status: 'pending',
          attempt_count: 0,
          next_attempt_at: '2026-01-01T00:00:00Z',
          last_attempt_at: null,
          dispatched_at: null,
          lease_until: null,
          last_error_code: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];

      vi.spyOn(jobsRepository, 'listEligiblePending').mockResolvedValue(mockJobs);
      vi.spyOn(jobsRepository, 'markQueued').mockResolvedValue(undefined);

      const stats = await recoveryCron.run(mockEnv);

      expect(jobsRepository.listEligiblePending).toHaveBeenCalledWith(mockEnv.DB, 10);
      expect(mockQueueSend).toHaveBeenCalledWith({
        grantId: 'grant_rec_1',
        outboxJobId: 'job_rec_1',
      });
      expect(jobsRepository.markQueued).toHaveBeenCalledWith(mockEnv.DB, 'job_rec_1');
      expect(stats.scannedCount).toBe(1);
      expect(stats.enqueuedCount).toBe(1);
    });

    it('should escalate jobs exceeding 5 attempts to manual_review', async () => {
      const exhaustedJob: OutboxJob = {
        id: 'job_too_many_attempts',
        job_type: 'grant_access',
        grant_id: 'grant_too_many',
        dedupe_key: 'grant_too_many:grant_access',
        status: 'retry',
        attempt_count: 5,
        next_attempt_at: '2026-01-01T00:00:00Z',
        last_attempt_at: null,
        dispatched_at: null,
        lease_until: null,
        last_error_code: 'RATE_LIMITED',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };

      vi.spyOn(jobsRepository, 'listEligiblePending').mockResolvedValue([exhaustedJob]);
      vi.spyOn(jobsRepository, 'markFailed').mockResolvedValue(undefined);
      vi.spyOn(grantsRepository, 'markFailed').mockResolvedValue({ status: 'manual_review', nextAttemptAt: null });

      const stats = await recoveryCron.run(mockEnv);

      expect(mockQueueSend).not.toHaveBeenCalled();
      expect(jobsRepository.markFailed).toHaveBeenCalledWith(
        mockEnv.DB,
        'job_too_many_attempts',
        'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
        'manual_review'
      );
      expect(grantsRepository.markFailed).toHaveBeenCalledWith(
        mockEnv.DB,
        'grant_too_many',
        'MAX_RECOVERY_ATTEMPTS_EXCEEDED',
        true
      );
      expect(stats.escalatedToManualReviewCount).toBe(1);
    });
  });

  describe('Worker Entry Point Routing', () => {
    it('should route drive-access-grants to grantConsumer', async () => {
      const msg = createMockMessage('g_1', 'j_1');
      const batch = {
        queue: 'drive-access-grants',
        messages: [msg],
      } as unknown as MessageBatch<GrantQueueMessage>;

      const grantConsumerSpy = vi.spyOn(grantConsumer, 'processBatch').mockResolvedValue(undefined);

      await worker.queue(batch, mockEnv);
      expect(grantConsumerSpy).toHaveBeenCalledWith(batch, mockEnv);
    });

    it('should route drive-access-grants-dlq to deadLetterConsumer', async () => {
      const msg = createMockMessage('g_dlq', 'j_dlq');
      const batch = {
        queue: 'drive-access-grants-dlq',
        messages: [msg],
      } as unknown as MessageBatch<GrantQueueMessage>;

      const dlqSpy = vi.spyOn(deadLetterConsumer, 'processBatch').mockResolvedValue(undefined);

      await worker.queue(batch, mockEnv);
      expect(dlqSpy).toHaveBeenCalledWith(batch, mockEnv);
    });

    it('should route scheduled cron trigger to recoveryCron.run', async () => {
      const waitUntilMock = vi.fn();
      const ctx = { waitUntil: waitUntilMock } as unknown as ExecutionContext;
      const controller = { scheduledTime: Date.now(), cron: '* * * * *' } as unknown as ScheduledController;

      const cronSpy = vi.spyOn(recoveryCron, 'run').mockResolvedValue({
        scannedCount: 0,
        enqueuedCount: 0,
        staleLeasesResetCount: 0,
        escalatedToManualReviewCount: 0,
      });

      await worker.scheduled(controller, mockEnv, ctx);
      expect(waitUntilMock).toHaveBeenCalled();
      expect(cronSpy).toHaveBeenCalledWith(mockEnv);
    });
  });
});
