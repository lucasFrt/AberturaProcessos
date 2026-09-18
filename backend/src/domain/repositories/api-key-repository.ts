import type { ApiKey, ApiKeyWithUser, CreateApiKeyData } from '@/domain/entities/api-key';

export interface ApiKeyRepository {
  create(data: CreateApiKeyData): Promise<ApiKeyWithUser>;
  findById(id: string): Promise<ApiKeyWithUser | null>;
  /** Inclui chaves revogadas — quem chama decide o que fazer com `revokedAt`. */
  findByKeyHash(keyHash: string): Promise<ApiKey | null>;
  /** Todas as chaves (ativas e revogadas), mais recentes primeiro. */
  listAll(): Promise<ApiKeyWithUser[]>;
  revoke(id: string): Promise<void>;
  /**
   * Atualiza `lastUsedAt`. Chamado a cada requisição autenticada por chave;
   * a implementação pode aplicar throttle para não gerar um UPDATE por
   * requisição.
   */
  touchLastUsed(id: string, at: Date): Promise<void>;
}
