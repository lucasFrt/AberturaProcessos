import type { ApiKey, ApiKeyWithUser, CreateApiKeyData } from '@/domain/entities/api-key';
import type { ApiKeyRepository } from '@/domain/repositories/api-key-repository';
import type { UserRepository } from '@/domain/repositories/user-repository';

let idCounter = 0;

/**
 * Recebe o `UserRepository` em memória para montar `user` em
 * `ApiKeyWithUser`, como o join do Prisma faz — sem isso o fake teria que
 * inventar dados do usuário e o service testaria contra um fantasma.
 */
export class InMemoryApiKeyRepository implements ApiKeyRepository {
  readonly items: ApiKey[] = [];
  readonly touches: { id: string; at: Date }[] = [];

  constructor(private readonly userRepository: UserRepository) {}

  private async withUser(apiKey: ApiKey): Promise<ApiKeyWithUser> {
    const user = await this.userRepository.findById(apiKey.userId);
    if (!user) {
      throw new Error(`Fake: usuário ${apiKey.userId} não existe.`);
    }
    return {
      ...apiKey,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    };
  }

  async create(data: CreateApiKeyData): Promise<ApiKeyWithUser> {
    idCounter += 1;
    const apiKey: ApiKey = {
      id: `apikey-${idCounter}`,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: new Date(),
      ...data,
    };
    this.items.push(apiKey);
    return this.withUser(apiKey);
  }

  async findById(id: string): Promise<ApiKeyWithUser | null> {
    const apiKey = this.items.find((item) => item.id === id);
    return apiKey ? this.withUser(apiKey) : null;
  }

  async findByKeyHash(keyHash: string): Promise<ApiKey | null> {
    return this.items.find((item) => item.keyHash === keyHash) ?? null;
  }

  async listAll(): Promise<ApiKeyWithUser[]> {
    const sorted = [...this.items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.all(sorted.map((item) => this.withUser(item)));
  }

  async revoke(id: string): Promise<void> {
    const apiKey = this.items.find((item) => item.id === id);
    if (apiKey) apiKey.revokedAt = new Date();
  }

  async touchLastUsed(id: string, at: Date): Promise<void> {
    this.touches.push({ id, at });
    const apiKey = this.items.find((item) => item.id === id);
    if (apiKey) apiKey.lastUsedAt = at;
  }
}
