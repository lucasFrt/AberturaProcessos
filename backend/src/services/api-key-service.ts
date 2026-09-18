import type { ApiKeyWithUser } from '@/domain/entities/api-key';
import { NotFoundError, ValidationError } from '@/domain/errors/app-error';
import type { ApiKeyRepository } from '@/domain/repositories/api-key-repository';
import type { UserRepository } from '@/domain/repositories/user-repository';
import {
  apiKeyDisplayPrefix,
  generateApiKey,
  hashApiKey,
} from '@/infra/security/api-key-generator';

export interface ApiKeyServiceDeps {
  apiKeyRepository: ApiKeyRepository;
  userRepository: UserRepository;
}

export interface CreateApiKeyInput {
  name: string;
  userId: string;
}

/** Resultado da criação: o único momento em que `plainKey` existe fora do cliente. */
export interface CreatedApiKey {
  apiKey: ApiKeyWithUser;
  plainKey: string;
}

/**
 * Chaves de API para contas de serviço (docs/13, decisão 2; docs/05,
 * "Chaves de API"). A chave é vinculada a um usuário interno ativo — o
 * agente que a usa age como esse usuário, o que preserva a autoria no
 * histórico sem criar papel novo.
 */
export class ApiKeyService {
  constructor(private readonly deps: ApiKeyServiceDeps) {}

  async create(createdById: string, input: CreateApiKeyInput): Promise<CreatedApiKey> {
    const user = await this.deps.userRepository.findById(input.userId);
    if (!user) {
      throw new NotFoundError('NOT_FOUND', 'Usuário não encontrado.');
    }
    // Chave para CLIENT abriria um canal de escrita automatizado fora do
    // escopo que o ADMIN configurou para pessoas; contas de serviço são
    // sempre internas (docs/13, decisão 2).
    if (user.role !== 'OPERATIONAL' && user.role !== 'ADMIN') {
      throw new ValidationError(
        'A chave de API precisa ser vinculada a um usuário interno (OPERATIONAL ou ADMIN).',
      );
    }
    if (user.status !== 'ACTIVE') {
      throw new ValidationError('O usuário vinculado precisa estar ativo.');
    }

    const plainKey = generateApiKey();
    const apiKey = await this.deps.apiKeyRepository.create({
      name: input.name,
      keyHash: hashApiKey(plainKey),
      keyPrefix: apiKeyDisplayPrefix(plainKey),
      userId: user.id,
      createdById,
    });

    return { apiKey, plainKey };
  }

  async list(): Promise<ApiKeyWithUser[]> {
    return this.deps.apiKeyRepository.listAll();
  }

  /** Revogar chave já revogada é no-op (idempotente), como o logout. */
  async revoke(id: string): Promise<void> {
    const apiKey = await this.deps.apiKeyRepository.findById(id);
    if (!apiKey) {
      throw new NotFoundError('NOT_FOUND', 'Chave de API não encontrada.');
    }
    if (apiKey.revokedAt) {
      return;
    }
    await this.deps.apiKeyRepository.revoke(id);
  }
}
