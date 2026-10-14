import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queries/queryKeys';
import type { PaymentWithProduct, PaginatedResult, PaymentFilters } from '../types/api';

async function fetchPayments(filters: PaymentFilters): Promise<PaginatedResult<PaymentWithProduct>> {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.access_status) params.set('access_status', filters.access_status);
  if (filters.product_id) params.set('product_id', filters.product_id);
  if (filters.normalized_email) params.set('normalized_email', filters.normalized_email);
  if (filters.razorpay_link_id) params.set('razorpay_link_id', filters.razorpay_link_id);

  const res = await fetch(`/api/admin/payments?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to fetch payments');
  }
  return res.json();
}

export function usePaymentsList(filters: PaymentFilters) {
  return useQuery({
    queryKey: queryKeys.payments.list(filters as Record<string, unknown>),
    queryFn: () => fetchPayments(filters),
  });
}

export function useResolveEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ paymentId, buyerEmail }: { paymentId: string; buyerEmail: string }) => {
      const res = await fetch(`/api/admin/payments/${paymentId}/resolve-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ buyer_email: buyerEmail }),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorData.error?.message || 'Failed to resolve buyer email');
      }

      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.summary });
      void queryClient.invalidateQueries({ queryKey: queryKeys.grants.all });
    },
  });
}
