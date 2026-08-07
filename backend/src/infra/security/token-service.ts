import jwt from 'jsonwebtoken';

import { env } from '@/config/env';
import type { AccessScopeKind, Role } from '@/domain/enums';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  organizationId: string | null;
  scope: AccessScopeKind;
}

export interface VerifiedAccessTokenPayload extends AccessTokenPayload {
  iat: number;
  exp: number;
}

/**
 * Interface + implementação padrão (docs/03-arquitetura.md). Emite e valida
 * apenas o access token — o refresh token não é JWT, é uma string opaca
 * gerada por `crypto.randomBytes` (docs/06, tabela "Estratégia de tokens").
 */
export interface TokenService {
  signAccessToken(payload: AccessTokenPayload): string;
  /** Lança se o token for inválido ou estiver expirado. */
  verifyAccessToken(token: string): VerifiedAccessTokenPayload;
}

function isAccessTokenPayload(value: unknown): value is AccessTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === 'string' &&
    typeof candidate.role === 'string' &&
    (candidate.organizationId === null || typeof candidate.organizationId === 'string') &&
    typeof candidate.scope === 'string'
  );
}

export class JwtTokenService implements TokenService {
  signAccessToken(payload: AccessTokenPayload): string {
    const options = { expiresIn: env.JWT_ACCESS_TTL, issuer: env.JWT_ISSUER };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, options as jwt.SignOptions);
  }

  verifyAccessToken(token: string): VerifiedAccessTokenPayload {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: env.JWT_ISSUER });

    if (!isAccessTokenPayload(decoded)) {
      throw new jwt.JsonWebTokenError('Payload do access token em formato inesperado.');
    }

    return decoded as VerifiedAccessTokenPayload;
  }
}
