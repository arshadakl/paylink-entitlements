import { computeHmacSha256Hex } from '../../src/services/razorpay-verification';

export const TEST_WEBHOOK_SECRET = 'rzp_test_secret_phase4_12345';
export const TEST_PREVIOUS_SECRET = 'rzp_test_previous_phase4_67890';

export interface RazorpayWebhookFixtureOptions {
  eventId?: string;
  linkId?: string;
  paymentId?: string;
  email?: string | null;
  amountPaise?: number;
  currency?: string;
  paymentStatus?: string;
  linkStatus?: string;
  captured?: boolean;
}

export function createPaymentLinkPaidFixture(options: RazorpayWebhookFixtureOptions = {}) {
  const amount = options.amountPaise ?? 9900;
  return {
    entity: 'event',
    account_id: 'acc_test_123456',
    event: 'payment_link.paid',
    contains: ['payment_link', 'payment'],
    payload: {
      payment_link: {
        entity: {
          id: options.linkId ?? 'plink_excel_course_123',
          amount,
          amount_paid: amount,
          currency: options.currency ?? 'INR',
          status: options.linkStatus ?? 'paid',
          short_url: 'https://rzp.io/i/testlink',
          customer: {
            name: 'John Doe',
            email: options.email ?? 'buyer@example.com',
            contact: '+919876543210',
          },
        },
      },
      payment: {
        entity: {
          id: options.paymentId ?? 'pay_excel_purchase_456',
          amount,
          currency: options.currency ?? 'INR',
          status: options.paymentStatus ?? 'captured',
          order_id: null,
          invoice_id: null,
          international: false,
          method: 'upi',
          amount_refunded: 0,
          refund_status: null,
          captured: options.captured ?? true,
          description: 'Payment for Excel Course',
          card_id: null,
          bank: null,
          wallet: null,
          vpa: 'buyer@upi',
          email: options.email !== undefined ? options.email : 'buyer@example.com',
          contact: '+919876543210',
          fee: 198,
          tax: 0,
          error_code: null,
          error_description: null,
          created_at: 1700000000,
        },
      },
    },
    created_at: 1700000001,
  };
}

export const validPaymentLinkPaidFixture = createPaymentLinkPaidFixture();

export const missingEmailPaymentLinkPaidFixture = createPaymentLinkPaidFixture({
  paymentId: 'pay_missing_email_789',
  email: null, // Razorpay known behavior for certain checkout methods
});

export const amountMismatchFixture = createPaymentLinkPaidFixture({
  paymentId: 'pay_mismatch_amount_999',
  amountPaise: 4900, // Expected 9900, but only 4900 was paid
});

export const currencyMismatchFixture = createPaymentLinkPaidFixture({
  paymentId: 'pay_mismatch_currency_888',
  currency: 'USD',
});

export const unrelatedEventFixture = {
  entity: 'event',
  account_id: 'acc_test_123456',
  event: 'order.paid',
  contains: ['order'],
  payload: {
    order: {
      entity: {
        id: 'order_abc123',
        amount: 9900,
        currency: 'INR',
        status: 'paid',
      },
    },
  },
  created_at: 1700000000,
};

export async function signFixture(
  payload: unknown,
  secret: string = TEST_WEBHOOK_SECRET
): Promise<{ rawBody: string; signature: string }> {
  const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = await computeHmacSha256Hex(rawBody, secret);
  return { rawBody, signature };
}
