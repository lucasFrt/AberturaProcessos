import type { ConfiguredProviders } from '@/passport';
import type { SocialAuthService } from '@/services/social-auth-service';

/** Reavalia `@/passport` já com o `@/config/env` mockado no teste atual. */
function requirePassportModule(): {
  configurePassport: (service: SocialAuthService) => ConfiguredProviders;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- necessário para reavaliar o módulo mockado a cada teste
  return require('@/passport') as {
    configurePassport: (service: SocialAuthService) => ConfiguredProviders;
  };
}

/**
 * Cobre `configurePassport` (docs/09, "provedor sem credencial não impede
 * a subida da API" — Tarefa 5): cada combinação de credenciais
 * presentes/ausentes por provedor. `@/config/env` é mockado porque `env`
 * é resolvido uma única vez no import do módulo (singleton) — mockar
 * permite testar as quatro combinações sem reiniciar o processo.
 */
describe('configurePassport', () => {
  const fakeSocialAuthService = {} as SocialAuthService;

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('@/config/env');
  });

  function mockEnv(overrides: Record<string, unknown>): void {
    jest.doMock('@/config/env', () => ({
      env: {
        API_PREFIX: '/api/v1',
        API_BASE_URL: 'http://localhost:3000',
        GOOGLE_CLIENT_ID: undefined,
        GOOGLE_CLIENT_SECRET: undefined,
        GOOGLE_CALLBACK_URL: undefined,
        MICROSOFT_CLIENT_ID: undefined,
        MICROSOFT_CLIENT_SECRET: undefined,
        MICROSOFT_CALLBACK_URL: undefined,
        MICROSOFT_TENANT_ID: 'common',
        ...overrides,
      },
    }));
  }

  it('retorna { google: false, microsoft: false } quando nenhuma credencial está configurada', () => {
    mockEnv({});
    const { configurePassport } = requirePassportModule();
    const result = configurePassport(fakeSocialAuthService);
    expect(result).toEqual({ google: false, microsoft: false });
  });

  it('retorna { google: true, microsoft: false } quando só o Google está configurado', () => {
    mockEnv({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret' });
    const { configurePassport } = requirePassportModule();
    const result = configurePassport(fakeSocialAuthService);
    expect(result).toEqual({ google: true, microsoft: false });
  });

  it('retorna { google: false, microsoft: true } quando só o Microsoft está configurado', () => {
    mockEnv({ MICROSOFT_CLIENT_ID: 'mid', MICROSOFT_CLIENT_SECRET: 'msecret' });
    const { configurePassport } = requirePassportModule();
    const result = configurePassport(fakeSocialAuthService);
    expect(result).toEqual({ google: false, microsoft: true });
  });

  it('retorna { google: true, microsoft: true } e usa GOOGLE_CALLBACK_URL/MICROSOFT_CALLBACK_URL quando definidos', () => {
    mockEnv({
      GOOGLE_CLIENT_ID: 'gid',
      GOOGLE_CLIENT_SECRET: 'gsecret',
      GOOGLE_CALLBACK_URL: 'https://app.com/callback/google',
      MICROSOFT_CLIENT_ID: 'mid',
      MICROSOFT_CLIENT_SECRET: 'msecret',
      MICROSOFT_CALLBACK_URL: 'https://app.com/callback/microsoft',
    });
    const { configurePassport } = requirePassportModule();
    const result = configurePassport(fakeSocialAuthService);
    expect(result).toEqual({ google: true, microsoft: true });
  });
});
