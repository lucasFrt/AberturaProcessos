import { createHash, randomBytes } from 'node:crypto';

const API_KEY_BYTES = 32;
/** Prefixo fixo para a chave ser reconhecível em logs e em segredos vazados (`apk_...`). */
const API_KEY_PREFIX = 'apk_';
/** Quantos caracteres da chave ficam gravados em claro para exibição na lista (docs/13). */
const DISPLAY_PREFIX_LENGTH = 12;

/**
 * Mesmo tratamento do refresh token (docs/06): string opaca aleatória, só
 * o hash SHA-256 é persistido. `apk_` + 32 bytes em base64url ≈ 47
 * caracteres.
 */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('base64url')}`;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, DISPLAY_PREFIX_LENGTH);
}
