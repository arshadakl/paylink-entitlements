import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queries/queryKeys';
import type { AccessGrant, PaginatedResult } from '../types/api';

export interface GrantFilters {
  page?: number;
  limit?: number;
}

async function fetchGrants(filters?: GrantFilters): Promise<PaginatedResult<AccessGrant>> {
  const params = new URLSearchParams();
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.limit) params.set('limit', String(filters.limit));

  const res = await fetch(`/api/admin/grants?${params.toString()}`);
  if (!res.ok) {
    throw new Error('Failed to fetch access grants');
  }
  return res.json();
}

export function useGrantsList(filters?: GrantFilters) {
  return useQuery({
    queryKey: queryKeys.grants.list(filters as Record<string, unknown>),
    queryFn: () => fetchGrants(filters),
  });
}

export function useRetryGrant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (grantId: string) => {
      const res = await fetch(`/api/admin/grants/${grantId}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorData.error?.message || 'Failed to trigger grant retry');
      }

      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.grants.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.summary });
    },
  });
}
