import { api } from '@/shared/api/http-client';

/**
 * Chaves de API de contas de serviço (docs/05, "Chaves de API"; docs/13,
 * decisão 2). Só ADMIN. O segredo (`key`) só existe na resposta do POST.
 */
export interface ApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  user: { id: string; name: string; email: string; role: string; status: string };
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreatedApiKeyDto extends ApiKeyDto {
  key: string;
}

export async function listApiKeys(): Promise<ApiKeyDto[]> {
  const { data } = await api.get<{ data: ApiKeyDto[] }>('/api-keys');
  return data.data;
}

export async function createApiKey(payload: {
  name: string;
  userId: string;
}): Promise<CreatedApiKeyDto> {
  const { data } = await api.post<CreatedApiKeyDto>('/api-keys', payload);
  return data;
}

export async function revokeApiKey(id: string): Promise<void> {
  await api.delete(`/api-keys/${id}`);
}
