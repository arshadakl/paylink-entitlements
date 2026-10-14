import type { WebhookEvent, WebhookProcessingStatus } from '@/types';

export const webhooksRepository = {
  async findById(db: D1Database, eventId: string): Promise<WebhookEvent | null> {
    return db
      .prepare('SELECT * FROM webhook_events WHERE event_id = ?')
      .bind(eventId)
      .first<WebhookEvent>();
  },

  createStmt(db: D1Database, event: WebhookEvent): D1PreparedStatement {
    return db
      .prepare(
        `INSERT INTO webhook_events (
          event_id, event_type, razorpay_link_id, razorpay_payment_id,
          received_at, processing_status, reason_code, payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        event.event_id,
        event.event_type,
        event.razorpay_link_id,
        event.razorpay_payment_id,
        event.received_at,
        event.processing_status,
        event.reason_code,
        event.payload_hash
      );
  },

  async create(db: D1Database, event: WebhookEvent): Promise<void> {
    await this.createStmt(db, event).run();
  },

  async updateStatus(
    db: D1Database,
    eventId: string,
    status: WebhookProcessingStatus,
    reasonCode: string | null = null
  ): Promise<void> {
    await db
      .prepare(
        'UPDATE webhook_events SET processing_status = ?, reason_code = ? WHERE event_id = ?'
      )
      .bind(status, reasonCode, eventId)
      .run();
  },

  async listRecent(
    db: D1Database,
    limit: number = 25
  ): Promise<WebhookEvent[]> {
    const result = await db
      .prepare('SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT ?')
      .bind(limit)
      .all<WebhookEvent>();
    return result.results;
  },
};
