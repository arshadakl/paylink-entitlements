// Domain Types and Database Entity Models

export type WebhookProcessingStatus =
  | 'received'
  | 'processed'
  | 'ignored'
  | 'unmapped'
  | 'manual_review'
  | 'failed';

export type PaymentStatus =
  | 'created'
  | 'authorized'
  | 'captured'
  | 'refunded'
  | 'failed';

export type AccessStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'granted'
  | 'failed'
  | 'manual_review';

export type GrantStatus =
  | 'pending'
  | 'processing'
  | 'granted'
  | 'failed'
  | 'manual_review';

export type OutboxJobStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'retry'
  | 'manual_review';

export type OutboxJobType = 'grant_access';

// Database Models

export interface Product {
  id: string;
  name: string;
  description: string | null;
  drive_folder_id: string;
  expected_amount_paise: number;
  currency: string;
  active: number; // 1 for active, 0 for inactive
  created_at: string;
  updated_at: string;
}

export interface PaymentLinkMapping {
  razorpay_link_id: string;
  product_id: string;
  active: number; // 1 for active, 0 for inactive
  created_at: string;
}

export interface WebhookEvent {
  event_id: string;
  event_type: string;
  razorpay_link_id: string | null;
  razorpay_payment_id: string | null;
  received_at: string;
  processing_status: WebhookProcessingStatus;
  reason_code: string | null;
  payload_hash: string | null;
}

export interface Payment {
  razorpay_payment_id: string;
  razorpay_link_id: string;
  product_id: string | null;
  buyer_email: string | null;
  normalized_email: string | null;
  amount_paise: number;
  currency: string;
  payment_status: PaymentStatus;
  access_status: AccessStatus;
  created_at: string;
  updated_at: string;
}

export interface AccessGrant {
  id: string;
  product_id: string;
  drive_folder_id: string;
  buyer_email: string;
  normalized_email: string;
  status: GrantStatus;
  permission_id: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_until: string | null;
  last_error_code: string | null;
  last_attempt_at: string | null;
  granted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutboxJob {
  id: string;
  job_type: OutboxJobType;
  grant_id: string;
  dedupe_key: string;
  status: OutboxJobStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  dispatched_at: string | null;
  lease_until: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminAuditLog {
  id: string;
  admin_user: string;
  action: string;
  target_entity: string;
  target_id: string;
  details_json: string | null;
  created_at: string;
}

// Queue Message Payload (Minimal to stay within free-tier budget and protect secrets)
export interface GrantQueueMessage {
  grantId: string;
  outboxJobId: string;
}
