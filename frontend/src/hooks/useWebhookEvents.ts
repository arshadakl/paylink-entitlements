import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../queries/queryKeys';
import type { WebhookEvent } from '../types/api';

async function fetchWebhookEvents(limit = 25): Promise<{ success: boolean; data: WebhookEvent[] }> {
  const res = await fetch(`/api/admin/webhook-events?limit=${limit}`);
  if (!res.ok) {
    throw new Error('Failed to fetch webhook events');
  }
  return res.json();
}

export function useWebhookEventsList(limit = 25) {
  return useQuery({
    queryKey: queryKeys.webhookEvents.list({ limit }),
    queryFn: () => fetchWebhookEvents(limit),
  });
}
