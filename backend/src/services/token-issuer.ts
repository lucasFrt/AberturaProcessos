import type { User } from '@/domain/entities/user';
import type { RefreshTokenRepository } from '@/domain/repositories/refresh-token-repository';
import { generateRefreshToken, hashRefreshToken } from '@/infra/security/refresh-token-generator';
import type { TokenService } from '@/infra/security/token-service';

const REFRESH_TOKEN_TTL_DAYS_DEFAULT = 7;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface TokenIssuerDeps {
  tokenService: TokenService;
  refreshTokenRepository: RefreshTokenRepository;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
}

function parseAccessTokenTtlSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 15 * 60;

  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit as 's' | 'm' | 'h' | 'd'];
  return value * multiplier;
}

/**
 * Emissão de tokens compartilhada entre `AuthService` (login local, Tarefa
 * 4) e `SocialAuthService` (login social, Tarefa 5) — mesma regra, um único
 * lugar (docs/06, tabela "Estratégia de tokens").
 */
export class TokenIssuer {
  constructor(private readonly deps: TokenIssuerDeps) {}

  async issue(
    user: User,
    context: { userAgent: string | null; ipAddress: string | null },
  ): Promise<IssuedTokens> {
    // "scope" no payload é a configuração do usuário (ORGANIZATION | COMPANIES),
    // não o AccessScope resolvido (ALL | COMPANIES) — o token não carrega a
    // lista de CNPJs, que é sempre resolvida por requisição (docs/06).
    const accessToken = this.deps.tokenService.signAccessToken({
      sub: user.id,
      role: user.role,
      organizationId: user.organizationId,
      scope: user.accessScope,
    });

    const refreshToken = generateRefreshToken();
    const ttlDays = this.deps.refreshTokenTtlDays || REFRESH_TOKEN_TTL_DAYS_DEFAULT;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    await this.deps.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: parseAccessTokenTtlSeconds(this.deps.accessTokenTtl),
    };
  }
}
