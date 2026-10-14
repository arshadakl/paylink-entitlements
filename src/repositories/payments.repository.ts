import type { Payment, AccessStatus } from '@/types';

export interface PaymentListFilters {
  page?: number;
  limit?: number;
  access_status?: AccessStatus;
  product_id?: string;
  normalized_email?: string;
  razorpay_link_id?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaymentWithProduct extends Payment {
  product_name: string | null;
}

export const paymentsRepository = {
  async findById(db: D1Database, paymentId: string): Promise<Payment | null> {
    return db
      .prepare('SELECT * FROM payments WHERE razorpay_payment_id = ?')
      .bind(paymentId)
      .first<Payment>();
  },

  createStmt(db: D1Database, payment: Payment): D1PreparedStatement {
    return db
      .prepare(
        `INSERT INTO payments (
          razorpay_payment_id, razorpay_link_id, product_id, buyer_email, normalized_email,
          amount_paise, currency, payment_status, access_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        payment.razorpay_payment_id,
        payment.razorpay_link_id,
        payment.product_id,
        payment.buyer_email,
        payment.normalized_email,
        payment.amount_paise,
        payment.currency,
        payment.payment_status,
        payment.access_status,
        payment.created_at,
        payment.updated_at
      );
  },

  async create(db: D1Database, payment: Payment): Promise<void> {
    await this.createStmt(db, payment).run();
  },

  async updateAccessStatus(
    db: D1Database,
    paymentId: string,
    status: AccessStatus
  ): Promise<void> {
    await db
      .prepare('UPDATE payments SET access_status = ?, updated_at = ? WHERE razorpay_payment_id = ?')
      .bind(status, new Date().toISOString(), paymentId)
      .run();
  },

  async resolveBuyerEmail(
    db: D1Database,
    paymentId: string,
    buyerEmail: string,
    normalizedEmail: string,
    newStatus: AccessStatus = 'pending'
  ): Promise<void> {
    await db
      .prepare(
        `UPDATE payments 
         SET buyer_email = ?, normalized_email = ?, access_status = ?, updated_at = ? 
         WHERE razorpay_payment_id = ?`
      )
      .bind(buyerEmail, normalizedEmail, newStatus, new Date().toISOString(), paymentId)
      .run();
  },

  async listPaginated(
    db: D1Database,
    filters: PaymentListFilters = {}
  ): Promise<PaginatedResult<PaymentWithProduct>> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(50, Math.max(1, filters.limit ?? 25));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const values: (string | number)[] = [];

    if (filters.access_status) {
      whereClauses.push('p.access_status = ?');
      values.push(filters.access_status);
    }
    if (filters.product_id) {
      whereClauses.push('p.product_id = ?');
      values.push(filters.product_id);
    }
    if (filters.normalized_email) {
      whereClauses.push('p.normalized_email = ?');
      values.push(filters.normalized_email);
    }
    if (filters.razorpay_link_id) {
      whereClauses.push('p.razorpay_link_id = ?');
      values.push(filters.razorpay_link_id);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Count query
    const countRow = await db
      .prepare(`SELECT COUNT(*) as total FROM payments p ${whereSql}`)
      .bind(...values)
      .first<{ total: number }>();
    const total = countRow?.total ?? 0;

    // Paginated list query joined with products table to display product name
    const querySql = `
      SELECT 
        p.*, 
        pr.name AS product_name 
      FROM payments p
      LEFT JOIN products pr ON pr.id = p.product_id
      ${whereSql}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const result = await db
      .prepare(querySql)
      .bind(...values, limit, offset)
      .all<PaymentWithProduct>();

    return {
      data: result.results,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async getDashboardMetrics(db: D1Database): Promise<{
    totalSuccessfulPayments: number;
    grossRevenuePaise: number;
    grantedAccessCount: number;
    pendingAccessCount: number;
    failedAccessCount: number;
    manualReviewCount: number;
  }> {
    const row = await db
      .prepare(
        `SELECT
          COUNT(CASE WHEN payment_status = 'captured' THEN 1 END) as total_successful_payments,
          COALESCE(SUM(CASE WHEN payment_status = 'captured' THEN amount_paise ELSE 0 END), 0) as gross_revenue_paise,
          COUNT(CASE WHEN access_status = 'granted' THEN 1 END) as granted_count,
          COUNT(CASE WHEN access_status IN ('pending', 'queued', 'processing') THEN 1 END) as pending_count,
          COUNT(CASE WHEN access_status = 'failed' THEN 1 END) as failed_count,
          COUNT(CASE WHEN access_status = 'manual_review' THEN 1 END) as manual_review_count
        FROM payments`
      )
      .first<{
        total_successful_payments: number;
        gross_revenue_paise: number;
        granted_count: number;
        pending_count: number;
        failed_count: number;
        manual_review_count: number;
      }>();

    return {
      totalSuccessfulPayments: row?.total_successful_payments ?? 0,
      grossRevenuePaise: row?.gross_revenue_paise ?? 0,
      grantedAccessCount: row?.granted_count ?? 0,
      pendingAccessCount: row?.pending_count ?? 0,
      failedAccessCount: row?.failed_count ?? 0,
      manualReviewCount: row?.manual_review_count ?? 0,
    };
  },
};
