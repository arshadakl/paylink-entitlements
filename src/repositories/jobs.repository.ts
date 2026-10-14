import type { OutboxJob, OutboxJobStatus } from '@/types';

export const jobsRepository = {
  async findById(db: D1Database, id: string): Promise<OutboxJob | null> {
    return db
      .prepare('SELECT * FROM outbox_jobs WHERE id = ?')
      .bind(id)
      .first<OutboxJob>();
  },

  async findByGrantId(db: D1Database, grantId: string): Promise<OutboxJob | null> {
    return db
      .prepare('SELECT * FROM outbox_jobs WHERE grant_id = ?')
      .bind(grantId)
      .first<OutboxJob>();
  },

  createStmt(db: D1Database, job: OutboxJob): D1PreparedStatement {
    return db
      .prepare(
        `INSERT INTO outbox_jobs (
          id, job_type, grant_id, dedupe_key, status, attempt_count,
          next_attempt_at, last_attempt_at, dispatched_at, lease_until,
          last_error_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        job.id,
        job.job_type,
        job.grant_id,
        job.dedupe_key,
        job.status,
        job.attempt_count,
        job.next_attempt_at,
        job.last_attempt_at,
        job.dispatched_at,
        job.lease_until,
        job.last_error_code,
        job.created_at,
        job.updated_at
      );
  },

  async create(db: D1Database, job: OutboxJob): Promise<void> {
    await this.createStmt(db, job).run();
  },

  async markQueued(db: D1Database, id: string): Promise<void> {
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE outbox_jobs 
         SET status = 'queued', dispatched_at = ?, updated_at = ? 
         WHERE id = ?`
      )
      .bind(now, now, id)
      .run();
  },

  async markCompleted(db: D1Database, id: string): Promise<void> {
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE outbox_jobs 
         SET status = 'completed', lease_until = NULL, last_error_code = NULL, updated_at = ? 
         WHERE id = ?`
      )
      .bind(now, id)
      .run();
  },

  async markFailed(
    db: D1Database,
    id: string,
    errorCode: string,
    status: OutboxJobStatus = 'retry',
    nextAttemptAt: string | null = null
  ): Promise<void> {
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE outbox_jobs 
         SET status = ?, next_attempt_at = ?, lease_until = NULL, last_error_code = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(status, nextAttemptAt, errorCode, now, id)
      .run();
  },

  /**
   * Bounded query for the 1-minute recovery cron.
   * Leverages idx_outbox_jobs_status_next to find at most `limit` (default 10) jobs
   * that are either 'pending' or 'retry' whose next_attempt_at is due.
   */
  async listEligiblePending(
    db: D1Database,
    limit: number = 10
  ): Promise<OutboxJob[]> {
    const now = new Date().toISOString();
    const result = await db
      .prepare(
        `SELECT * FROM outbox_jobs
         WHERE status IN ('pending', 'retry') 
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           AND (lease_until IS NULL OR lease_until < ?)
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .bind(now, now, limit)
      .all<OutboxJob>();

    return result.results;
  },
};
