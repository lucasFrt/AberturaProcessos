import type {
  AccessTokenPayload,
  TokenService,
  VerifiedAccessTokenPayload,
} from '@/infra/security/token-service';

/** Serializa o payload em JSON — evita depender de assinatura JWT real nos testes unitários. */
export class FakeTokenService implements TokenService {
  signAccessToken(payload: AccessTokenPayload): string {
    return JSON.stringify({ ...payload, iat: 0, exp: 9999999999 });
  }

  verifyAccessToken(token: string): VerifiedAccessTokenPayload {
    return JSON.parse(token) as VerifiedAccessTokenPayload;
  }
}
