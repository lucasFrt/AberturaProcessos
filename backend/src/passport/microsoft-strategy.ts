import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import type OAuth2Strategy from 'passport-oauth2';

import { AppError } from '@/domain/errors/app-error';
import type { SocialAuthService, SocialLoginResult } from '@/services/social-auth-service';

export interface MicrosoftStrategyConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  tenantId: string;
}

/**
 * `passport-microsoft` não publica um tipo `Profile` próprio (a lib monta o
 * objeto manualmente a partir da resposta do Graph API — ver
 * `lib/strategy.js`), então o formato é declarado aqui a partir do que a
 * lib efetivamente devolve.
 */
export interface MicrosoftProfile {
  provider: 'microsoft';
  id: string;
  displayName?: string;
  emails?: Array<{ type: string; value: string }>;
}

/**
 * Traduz o profile do `passport-microsoft` para o formato de entrada do
 * `SocialAuthService` (docs/06, seção "Login social" › Microsoft). O Graph
 * API não expõe uma flag explícita de "e-mail verificado" como o Google —
 * qualquer e-mail vindo da conta corporativa/Microsoft é tratado como
 * verificado, já que a autenticação em si já validou a conta no provedor.
 */
function toSocialProfile(profile: MicrosoftProfile): {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
} {
  const email = profile.emails?.[0]?.value ?? '';

  return {
    providerUserId: profile.id,
    email,
    emailVerified: Boolean(email),
    name: profile.displayName || email || 'Usuário Microsoft',
  };
}

export function buildMicrosoftStrategy(
  config: MicrosoftStrategyConfig,
  socialAuthService: SocialAuthService,
): MicrosoftStrategy {
  return new MicrosoftStrategy(
    {
      clientID: config.clientId,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackUrl,
      tenant: config.tenantId,
      scope: ['openid', 'profile', 'email', 'User.Read'],
    },
    (
      _accessToken: string,
      _refreshToken: string,
      profile: MicrosoftProfile,
      done: OAuth2Strategy.VerifyCallback,
    ) => {
      void handleVerify(profile, socialAuthService, done);
    },
  );
}

async function handleVerify(
  profile: MicrosoftProfile,
  socialAuthService: SocialAuthService,
  done: OAuth2Strategy.VerifyCallback,
): Promise<void> {
  try {
    const social = toSocialProfile(profile);
    if (!social.email) {
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        'A Microsoft não retornou um e-mail para esta conta.',
        400,
      );
    }

    const result: SocialLoginResult = await socialAuthService.loginOrRegister(
      { provider: 'MICROSOFT', ...social },
      { userAgent: null, ipAddress: null },
    );
    done(null, result);
  } catch (error) {
    done(error);
  }
}
