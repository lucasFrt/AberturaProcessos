import type { CookieOptions, Response } from 'express';

import { env } from '@/config/env';

const REFRESH_TOKEN_COOKIE = 'refreshToken';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    path: `${env.API_PREFIX}/auth`,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

/**
 * `Path` restrito a `/api/v1/auth` (docs/06): o cookie só é enviado nas
 * rotas que precisam dele, reduzindo a superfície de exposição.
 */
export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions());
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: `${env.API_PREFIX}/auth` });
}

export function getRefreshTokenFromCookie(cookies: unknown): string | null {
  if (typeof cookies !== 'object' || cookies === null) return null;
  const value = (cookies as Record<string, unknown>)[REFRESH_TOKEN_COOKIE];
  return typeof value === 'string' ? value : null;
}
