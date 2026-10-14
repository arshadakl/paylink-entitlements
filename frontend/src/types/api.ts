// Frontend API Domain Contracts

export interface SessionState {
  authenticated: boolean;
  username?: string;
}

export interface DashboardMetrics {
  totalSuccessfulPayments: number;
  grossRevenuePaise: number;
  grantedAccessCount: number;
  pendingAccessCount: number;
  failedAccessCount: number;
  manualReviewCount: number;
}

export interface PaymentLinkMapping {
  razorpay_link_id: string;
  product_id: string;
  active: number;
  created_at: string;
}

export interface ProductWithLinks {
  id: string;
  name: string;
  description: string | null;
  drive_folder_id: string;
  expected_amount_paise: number;
  currency: string;
  active: number;
  created_at: string;
  updated_at: string;
  links: PaymentLinkMapping[];
}

export interface CreateProductInput {
  name: string;
  description?: string | null;
  drive_folder_id: string;
  expected_amount_paise: number;
  currency?: string;
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  drive_folder_id?: string;
  expected_amount_paise?: number;
  active?: number;
}

export interface FolderValidationResult {
  id: string;
  name: string;
  mimeType: string;
  canShare: boolean;
}

export type AccessStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'granted'
  | 'failed'
  | 'manual_review';

export interface PaymentWithProduct {
  razorpay_payment_id: string;
  razorpay_link_id: string;
  product_id: string | null;
  product_name: string | null;
  buyer_email: string | null;
  normalized_email: string | null;
  amount_paise: number;
  currency: string;
  payment_status: string;
  access_status: AccessStatus;
  created_at: string;
  updated_at: string;
}

export interface PaymentFilters {
  page?: number;
  limit?: number;
  access_status?: AccessStatus | '';
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

export interface AccessGrant {
  id: string;
  product_id: string;
  drive_folder_id: string;
  buyer_email: string;
  normalized_email: string;
  status: 'pending' | 'processing' | 'granted' | 'failed' | 'manual_review';
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

export interface WebhookEvent {
  event_id: string;
  event_type: string;
  razorpay_link_id: string | null;
  razorpay_payment_id: string | null;
  received_at: string;
  processing_status: 'received' | 'processed' | 'ignored' | 'unmapped' | 'manual_review' | 'failed';
  reason_code: string | null;
  payload_hash: string | null;
}
