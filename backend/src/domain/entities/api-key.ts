/**
 * Chave de API de conta de serviço (docs/13, decisão 2). A chave em si
 * nunca é persistida — só `keyHash` (SHA-256) e `keyPrefix` para exibição.
 */
export interface ApiKey {
  id: string;
  name: string;
  keyHash: string;
  keyPrefix: string;
  userId: string;
  createdById: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Item de listagem para o ADMIN (docs/05, `GET /api-keys`): traz o usuário vinculado resumido. */
export interface ApiKeyWithUser extends ApiKey {
  user: { id: string; name: string; email: string; role: string; status: string };
}

export interface CreateApiKeyData {
  name: string;
  keyHash: string;
  keyPrefix: string;
  userId: string;
  createdById: string;
}
