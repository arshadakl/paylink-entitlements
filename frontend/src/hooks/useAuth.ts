import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queries/queryKeys';
import type { SessionState } from '../types/api';

async function fetchSession(): Promise<SessionState> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    return { authenticated: false };
  }
  return res.json();
}

export function useSessionQuery() {
  return useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: fetchSession,
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (credentials: { username: string; password: string }) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(credentials),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorData.error?.message || 'Login failed');
      }

      return res.json() as Promise<{ success: boolean; username: string }>;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.summary });
    },
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (!res.ok) {
        throw new Error('Logout failed');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.auth.me, { authenticated: false });
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}
