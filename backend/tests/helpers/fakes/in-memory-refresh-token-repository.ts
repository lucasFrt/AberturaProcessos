import type { CreateRefreshTokenData, RefreshToken } from '@/domain/entities/refresh-token';
import type { RefreshTokenRepository } from '@/domain/repositories/refresh-token-repository';

let idCounter = 0;

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  readonly items: RefreshToken[] = [];

  async create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    idCounter += 1;
    const token: RefreshToken = {
      id: `refresh-${idCounter}`,
      revokedAt: null,
      createdAt: new Date(),
      ...data,
    };
    this.items.push(token);
    return token;
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.items.find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async markRevoked(id: string): Promise<void> {
    const token = this.items.find((item) => item.id === id);
    if (token) token.revokedAt = new Date();
  }

  async revokeAllByUserId(userId: string): Promise<void> {
    for (const token of this.items) {
      if (token.userId === userId && !token.revokedAt) {
        token.revokedAt = new Date();
      }
    }
  }
}
