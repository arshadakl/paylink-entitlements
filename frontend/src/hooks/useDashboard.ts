import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../queries/queryKeys';
import type { DashboardMetrics } from '../types/api';

async function fetchDashboardSummary(): Promise<DashboardMetrics> {
  const res = await fetch('/api/admin/dashboard/summary');
  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(errorData.error?.message || 'Failed to fetch dashboard metrics');
  }
  const json = (await res.json()) as { success: boolean; data: DashboardMetrics };
  return json.data;
}

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard.summary,
    queryFn: fetchDashboardSummary,
    refetchInterval: 30000, // Background refresh every 30 seconds
  });
}
