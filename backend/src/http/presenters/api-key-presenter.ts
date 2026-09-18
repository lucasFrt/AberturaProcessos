import type { ApiKeyWithUser } from '@/domain/entities/api-key';
import type { CreatedApiKey } from '@/services/api-key-service';

interface ApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  user: { id: string; name: string; email: string; role: string; status: string };
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Campo a campo — `keyHash` nunca sai daqui (docs/06, checklist de segurança). */
export function presentApiKey(apiKey: ApiKeyWithUser): ApiKeyDto {
  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    user: {
      id: apiKey.user.id,
      name: apiKey.user.name,
      email: apiKey.user.email,
      role: apiKey.user.role,
      status: apiKey.user.status,
    },
    lastUsedAt: apiKey.lastUsedAt ? apiKey.lastUsedAt.toISOString() : null,
    revokedAt: apiKey.revokedAt ? apiKey.revokedAt.toISOString() : null,
    createdAt: apiKey.createdAt.toISOString(),
  };
}

interface CreatedApiKeyDto extends ApiKeyDto {
  /** Só existe nesta resposta (docs/05, `POST /api-keys`). */
  key: string;
}

export function presentCreatedApiKey(created: CreatedApiKey): CreatedApiKeyDto {
  return { ...presentApiKey(created.apiKey), key: created.plainKey };
}
