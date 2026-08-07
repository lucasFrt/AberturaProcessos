import type { CreateRefreshTokenData, RefreshToken } from '@/domain/entities/refresh-token';

export interface RefreshTokenRepository {
  create(data: CreateRefreshTokenData): Promise<RefreshToken>;
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null>;
  markRevoked(id: string): Promise<void>;
  /** Reuso de token revogado indica vazamento: revoga toda a família (docs/06). */
  revokeAllByUserId(userId: string): Promise<void>;
}
