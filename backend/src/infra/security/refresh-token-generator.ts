import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_BYTES = 64;

/**
 * O refresh token não é JWT: é uma string opaca aleatória (docs/06, tabela
 * "Estratégia de tokens"). Só o hash SHA-256 é persistido — um dump do
 * banco não permite sequestrar sessões.
 */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
