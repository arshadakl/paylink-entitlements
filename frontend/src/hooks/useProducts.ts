import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queries/queryKeys';
import type {
  ProductWithLinks,
  CreateProductInput,
  UpdateProductInput,
  FolderValidationResult,
} from '../types/api';

async function fetchProducts(): Promise<ProductWithLinks[]> {
  const res = await fetch('/api/admin/products');
  if (!res.ok) {
    throw new Error('Failed to fetch products');
  }
  const json = (await res.json()) as { success: boolean; data: ProductWithLinks[] };
  return json.data;
}

export function useProductsList() {
  return useQuery({
    queryKey: queryKeys.products.list(),
    queryFn: fetchProducts,
  });
}

export function useValidateFolder() {
  return useMutation({
    mutationFn: async (folderInput: string): Promise<FolderValidationResult> => {
      const res = await fetch('/api/admin/products/validate-folder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ folderInput }),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorData.error?.message || 'Folder validation failed');
      }

      const json = (await res.json()) as { success: boolean; data: FolderValidationResult };
      return json.data;
    },
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productData: CreateProductInput) => {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(productData),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorData.error?.message || 'Failed to create product');
      }

      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateProductInput }) => {
      const res = await fetch(`/api/admin/products/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorData.error?.message || 'Failed to update product');
      }

      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}

export function useAddPaymentLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ productId, linkId }: { productId: string; linkId: string }) => {
      const res = await fetch(`/api/admin/products/${productId}/payment-links`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ razorpay_link_id: linkId }),
      });

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(errorData.error?.message || 'Failed to add payment link');
      }

      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}

export function useDisablePaymentLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (linkId: string) => {
      const res = await fetch(`/api/admin/payment-links/${linkId}`, {
        method: 'DELETE',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!res.ok) {
        throw new Error('Failed to disable payment link');
      }

      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}
