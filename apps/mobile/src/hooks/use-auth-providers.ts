import { useQuery } from '@tanstack/react-query';
import { authProvidersResponseSchema } from '@chatofy/types';
import { api } from '@/clients/api-client';

/**
 * Smoke-path query: fetches the active auth provider through the shared client.
 * The response is contract-validated inside apiFetch; the hook's data type is
 * inferred as AuthProvidersResponse with no manual annotation.
 */
export function useAuthProviders() {
  return useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: () => api.apiFetch('/auth/providers', authProvidersResponseSchema),
  });
}
