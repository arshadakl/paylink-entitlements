export const queryKeys = {
  health: ['health'] as const,
  auth: {
    me: ['auth', 'me'] as const,
  },
  dashboard: {
    summary: ['dashboard', 'summary'] as const,
  },
  products: {
    all: ['products'] as const,
    list: () => [...queryKeys.products.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.products.all, 'detail', id] as const,
  },
  payments: {
    all: ['payments'] as const,
    list: (filters?: Record<string, unknown>) => [...queryKeys.payments.all, 'list', filters] as const,
    detail: (id: string) => [...queryKeys.payments.all, 'detail', id] as const,
  },
  grants: {
    all: ['grants'] as const,
    list: (filters?: Record<string, unknown>) => [...queryKeys.grants.all, 'list', filters] as const,
    detail: (id: string) => [...queryKeys.grants.all, 'detail', id] as const,
  },
  webhookEvents: {
    all: ['webhookEvents'] as const,
    list: (filters?: Record<string, unknown>) => [...queryKeys.webhookEvents.all, 'list', filters] as const,
  },
};
