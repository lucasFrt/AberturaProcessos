import passport from 'passport';

import { env } from '@/config/env';
import { buildGoogleStrategy } from '@/passport/google-strategy';
import { buildMicrosoftStrategy } from '@/passport/microsoft-strategy';
import type { SocialAuthService } from '@/services/social-auth-service';

export interface ConfiguredProviders {
  google: boolean;
  microsoft: boolean;
}

/**
 * Registra as estratégias Passport apenas quando as credenciais do
 * provedor estão presentes no env (docs/06, critério de aceite da
 * Tarefa 5: "provedor sem credencial não impede a subida da API"). O
 * `Authenticator` é sempre criado, mas rotas de um provedor sem
 * credencial nunca são montadas (ver `buildSocialAuthRouter`).
 */
export function configurePassport(socialAuthService: SocialAuthService): ConfiguredProviders {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } =
    env;
  const google = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
  const microsoft = Boolean(MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET);

  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    passport.use(
      'google',
      buildGoogleStrategy(
        {
          clientId: GOOGLE_CLIENT_ID,
          clientSecret: GOOGLE_CLIENT_SECRET,
          callbackUrl:
            env.GOOGLE_CALLBACK_URL ?? `${env.API_BASE_URL}${env.API_PREFIX}/auth/google/callback`,
        },
        socialAuthService,
      ),
    );
  }

  if (MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET) {
    passport.use(
      'microsoft',
      buildMicrosoftStrategy(
        {
          clientId: MICROSOFT_CLIENT_ID,
          clientSecret: MICROSOFT_CLIENT_SECRET,
          callbackUrl:
            env.MICROSOFT_CALLBACK_URL ??
            `${env.API_BASE_URL}${env.API_PREFIX}/auth/microsoft/callback`,
          tenantId: env.MICROSOFT_TENANT_ID,
        },
        socialAuthService,
      ),
    );
  }

  return { google, microsoft };
}

export { passport };
