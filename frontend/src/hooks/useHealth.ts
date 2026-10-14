import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../queries/queryKeys';

export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.statusText}`);
  }
  return response.json();
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
  });
}
