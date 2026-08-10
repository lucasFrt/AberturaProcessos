import {
  Strategy as GoogleStrategy,
  type Profile,
  type VerifyCallback,
} from 'passport-google-oauth20';

import { AppError } from '@/domain/errors/app-error';
import type { SocialAuthService, SocialLoginResult } from '@/services/social-auth-service';

export interface GoogleStrategyConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

/**
 * Traduz o `Profile` do `passport-google-oauth20` para o formato de entrada
 * do `SocialAuthService` (docs/06, seção "Login social" › Google). Só o
 * primeiro e-mail verificado é considerado — sem e-mail verificado, a
 * resolução falha com `EMAIL_NOT_VERIFIED` (regra comum aos provedores).
 */
function toSocialProfile(profile: Profile): {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
} {
  const verifiedEmail = profile.emails?.find((entry) => entry.verified)?.value;
  const anyEmail = profile.emails?.[0]?.value;

  return {
    providerUserId: profile.id,
    email: verifiedEmail ?? anyEmail ?? '',
    emailVerified: Boolean(verifiedEmail),
    name: profile.displayName || anyEmail || 'Usuário Google',
  };
}

/**
 * Estratégia registrada apenas quando as credenciais existem — o chamador
 * (src/passport/index.ts) decide se monta ou não as rotas correspondentes,
 * para que a ausência de credenciais nunca impeça a subida da API.
 */
export function buildGoogleStrategy(
  config: GoogleStrategyConfig,
  socialAuthService: SocialAuthService,
): GoogleStrategy {
  return new GoogleStrategy(
    {
      clientID: config.clientId,
      clientSecret: config.clientSecret,
      callbackURL: config.callbackUrl,
      scope: ['profile', 'email'],
    },
    (_accessToken: string, _refreshToken: string, profile: Profile, done: VerifyCallback) => {
      void handleVerify(profile, socialAuthService, done);
    },
  );
}

async function handleVerify(
  profile: Profile,
  socialAuthService: SocialAuthService,
  done: VerifyCallback,
): Promise<void> {
  try {
    const social = toSocialProfile(profile);
    if (!social.email) {
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        'O Google não retornou um e-mail para esta conta.',
        400,
      );
    }

    const result: SocialLoginResult = await socialAuthService.loginOrRegister(
      { provider: 'GOOGLE', ...social },
      { userAgent: null, ipAddress: null },
    );
    done(null, result);
  } catch (error) {
    done(error);
  }
}
