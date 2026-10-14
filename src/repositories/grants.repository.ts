import type { AccessGrant, GrantStatus } from '@/types';

export const grantsRepository = {
  async findById(db: D1Database, id: string): Promise<AccessGrant | null> {
    return db
      .prepare('SELECT * FROM access_grants WHERE id = ?')
      .bind(id)
      .first<AccessGrant>();
  },

  async findByFolderAndEmail(
    db: D1Database,
    folderId: string,
    normalizedEmail: string
  ): Promise<AccessGrant | null> {
    return db
      .prepare('SELECT * FROM access_grants WHERE drive_folder_id = ? AND normalized_email = ?')
      .bind(folderId, normalizedEmail)
      .first<AccessGrant>();
  },

  createStmt(db: D1Database, grant: AccessGrant): D1PreparedStatement {
    return db
      .prepare(
        `INSERT INTO access_grants (
          id, product_id, drive_folder_id, buyer_email, normalized_email, status,
          permission_id, attempt_count, next_attempt_at, lease_until, last_error_code,
          last_attempt_at, granted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        grant.id,
        grant.product_id,
        grant.drive_folder_id,
        grant.buyer_email,
        grant.normalized_email,
        grant.status,
        grant.permission_id,
        grant.attempt_count,
        grant.next_attempt_at,
        grant.lease_until,
        grant.last_error_code,
        grant.last_attempt_at,
        grant.granted_at,
        grant.created_at,
        grant.updated_at
      );
  },

  async create(db: D1Database, grant: AccessGrant): Promise<void> {
    await this.createStmt(db, grant).run();
  },

  async acquireLease(
    db: D1Database,
    grantId: string,
    leaseSeconds: number = 60
  ): Promise<boolean> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
    const nowIso = now.toISOString();

    const result = await db
      .prepare(
        `UPDATE access_grants 
         SET lease_until = ?, last_attempt_at = ?, attempt_count = attempt_count + 1, updated_at = ?
         WHERE id = ? 
           AND status != 'granted'
           AND (lease_until IS NULL OR lease_until < ?)`
      )
      .bind(leaseUntil, nowIso, nowIso, grantId, nowIso)
      .run();

    return result.meta.changes > 0;
  },

  async markGranted(
    db: D1Database,
    grantId: string,
    permissionId: string
  ): Promise<void> {
    const now = new Date().toISOString();
    await db
      .prepare(
        `UPDATE access_grants 
         SET status = 'granted', permission_id = ?, granted_at = ?, lease_until = NULL, last_error_code = NULL, updated_at = ?
         WHERE id = ?`
      )
      .bind(permissionId, now, now, grantId)
      .run();
  },

  async markFailed(
    db: D1Database,
    grantId: string,
    errorCode: string,
    isPermanent: boolean = false,
    maxAttempts: number = 5
  ): Promise<{ status: GrantStatus; nextAttemptAt: string | null }> {
    const now = new Date();
    const grant = await this.findById(db, grantId);
    const attempts = (grant?.attempt_count ?? 1);

    let nextStatus: GrantStatus = 'pending';
    let nextAttemptAt: string | null = null;

    if (isPermanent || attempts >= maxAttempts) {
      nextStatus = 'manual_review';
    } else {
      // Exponential backoff: 30s * 2^(attempts-1)
      const delayMs = Math.min(30 * 1000 * Math.pow(2, attempts - 1), 3600 * 1000);
      nextAttemptAt = new Date(now.getTime() + delayMs).toISOString();
    }

    await db
      .prepare(
        `UPDATE access_grants 
         SET status = ?, next_attempt_at = ?, lease_until = NULL, last_error_code = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(nextStatus, nextAttemptAt, errorCode, now.toISOString(), grantId)
      .run();

    return { status: nextStatus, nextAttemptAt };
  },

  async listPaginated(
    db: D1Database,
    page: number = 1,
    limit: number = 25
  ): Promise<{ data: AccessGrant[]; total: number; totalPages: number }> {
    const offset = (page - 1) * limit;
    const countRow = await db
      .prepare('SELECT COUNT(*) as total FROM access_grants')
      .first<{ total: number }>();
    const total = countRow?.total ?? 0;

    const result = await db
      .prepare('SELECT * FROM access_grants ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .bind(limit, offset)
      .all<AccessGrant>();

    return {
      data: result.results,
      total,
      totalPages: Math.ceil(total / limit),
    };
  },
};
