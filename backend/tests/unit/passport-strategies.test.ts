import type { Profile } from 'passport-google-oauth20';

import { buildGoogleStrategy } from '@/passport/google-strategy';
import { buildMicrosoftStrategy, type MicrosoftProfile } from '@/passport/microsoft-strategy';
import type { SocialAuthService, SocialLoginResult } from '@/services/social-auth-service';

/**
 * Cobre a função `verify` interna de cada estratégia (docs/06, "Login
 * social"): tradução de profile → e-mail verificado/não verificado,
 * ausência de e-mail (`EMAIL_NOT_VERIFIED`), e propagação de erro/resultado
 * via `done`. Não testamos o construtor `Strategy` do passport em si (é
 * biblioteca de terceiros); testamos o callback de verificação que este
 * módulo constrói, chamando-o diretamente.
 */

interface GoogleVerifyFn {
  (
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (error: unknown, user?: SocialLoginResult | false) => void,
  ): void;
}

interface MicrosoftVerifyFn {
  (
    accessToken: string,
    refreshToken: string,
    profile: MicrosoftProfile,
    done: (error: unknown, user?: SocialLoginResult | false) => void,
  ): void;
}

function buildFakeSocialAuthService(
  result: SocialLoginResult | Error,
): SocialAuthService & { calls: unknown[] } {
  const calls: unknown[] = [];
  const service = {
    calls,
    loginOrRegister: jest.fn((input: unknown) => {
      calls.push(input);
      if (result instanceof Error) return Promise.reject(result);
      return Promise.resolve(result);
    }),
  };
  return service as unknown as SocialAuthService & { calls: unknown[] };
}

function waitForDone<T>(
  invoke: (done: (error: unknown, user?: T | false) => void) => void,
): Promise<{ error: unknown; user: T | false | undefined }> {
  return new Promise((resolve) => {
    invoke((error, user) => resolve({ error, user }));
  });
}

describe('google-strategy verify callback', () => {
  const pendingResult: SocialLoginResult = { status: 'PENDING' };

  function extractVerify(service: SocialAuthService): GoogleVerifyFn {
    const strategy = buildGoogleStrategy(
      { clientId: 'id', clientSecret: 'secret', callbackUrl: 'https://app.com/callback' },
      service,
    );
    // A lib armazena o callback de verificação em `_verify` — acesso
    // necessário pois não há outra forma pública de invocar o callback
    // sem simular todo o handshake OAuth2 real.
    return (strategy as unknown as { _verify: GoogleVerifyFn })._verify;
  }

  it('chama loginOrRegister com o e-mail verificado quando presente', async () => {
    const service = buildFakeSocialAuthService(pendingResult);
    const verify = extractVerify(service);
    const profile = {
      id: 'google-123',
      displayName: 'Fulano',
      emails: [
        { value: 'nao-verificado@teste.com', verified: false },
        { value: 'verificado@teste.com', verified: true },
      ],
    } as unknown as Profile;

    const { error, user } = await waitForDone<SocialLoginResult>((done) =>
      verify('at', 'rt', profile, done),
    );

    expect(error).toBeNull();
    expect(user).toEqual(pendingResult);
    expect(service.calls[0]).toMatchObject({
      provider: 'GOOGLE',
      email: 'verificado@teste.com',
      emailVerified: true,
    });
  });

  it('usa o primeiro e-mail disponível quando nenhum está marcado como verificado', async () => {
    const service = buildFakeSocialAuthService(pendingResult);
    const verify = extractVerify(service);
    const profile = {
      id: 'google-456',
      displayName: 'Fulano',
      emails: [{ value: 'unico@teste.com', verified: false }],
    } as unknown as Profile;

    await waitForDone<SocialLoginResult>((done) => verify('at', 'rt', profile, done));

    expect(service.calls[0]).toMatchObject({ email: 'unico@teste.com', emailVerified: false });
  });

  it('chama done com AppError EMAIL_NOT_VERIFIED quando não há nenhum e-mail', async () => {
    const service = buildFakeSocialAuthService(pendingResult);
    const verify = extractVerify(service);
    const profile = {
      id: 'google-789',
      displayName: 'Sem Email',
      emails: [],
    } as unknown as Profile;

    const { error, user } = await waitForDone<SocialLoginResult>((done) =>
      verify('at', 'rt', profile, done),
    );

    expect(error).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    expect(user).toBeUndefined();
    expect(service.calls).toHaveLength(0);
  });

  it('propaga erro do service via done quando loginOrRegister lança', async () => {
    const failure = new Error('falha no service');
    const service = buildFakeSocialAuthService(failure);
    const verify = extractVerify(service);
    const profile = {
      id: 'google-999',
      displayName: 'Fulano',
      emails: [{ value: 'existe@teste.com', verified: true }],
    } as unknown as Profile;

    const { error } = await waitForDone<SocialLoginResult>((done) =>
      verify('at', 'rt', profile, done),
    );

    expect(error).toBe(failure);
  });

  it('usa displayName vazio e cai para o e-mail ou fallback fixo no nome', async () => {
    const service = buildFakeSocialAuthService(pendingResult);
    const verify = extractVerify(service);
    const profile = {
      id: 'google-111',
      displayName: '',
      emails: [{ value: 'nome-fallback@teste.com', verified: true }],
    } as unknown as Profile;

    await waitForDone<SocialLoginResult>((done) => verify('at', 'rt', profile, done));

    expect(service.calls[0]).toMatchObject({ name: 'nome-fallback@teste.com' });
  });
});

describe('microsoft-strategy verify callback', () => {
  const pendingResult: SocialLoginResult = { status: 'PENDING' };

  function extractVerify(service: SocialAuthService): MicrosoftVerifyFn {
    const strategy = buildMicrosoftStrategy(
      {
        clientId: 'id',
        clientSecret: 'secret',
        callbackUrl: 'https://app.com/callback',
        tenantId: 'common',
      },
      service,
    );
    return (strategy as unknown as { _verify: MicrosoftVerifyFn })._verify;
  }

  it('chama loginOrRegister com o e-mail do profile', async () => {
    const service = buildFakeSocialAuthService(pendingResult);
    const verify = extractVerify(service);
    const profile: MicrosoftProfile = {
      provider: 'microsoft',
      id: 'ms-123',
      displayName: 'Fulano MS',
      emails: [{ type: 'work', value: 'fulano@empresa.com' }],
    };

    const { error, user } = await waitForDone<SocialLoginResult>((done) =>
      verify('at', 'rt', profile, done),
    );

    expect(error).toBeNull();
    expect(user).toEqual(pendingResult);
    expect(service.calls[0]).toMatchObject({
      provider: 'MICROSOFT',
      email: 'fulano@empresa.com',
      emailVerified: true,
    });
  });

  it('chama done com AppError EMAIL_NOT_VERIFIED quando não há e-mail', async () => {
    const service = buildFakeSocialAuthService(pendingResult);
    const verify = extractVerify(service);
    const profile: MicrosoftProfile = { provider: 'microsoft', id: 'ms-456', emails: [] };

    const { error } = await waitForDone<SocialLoginResult>((done) =>
      verify('at', 'rt', profile, done),
    );

    expect(error).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('usa displayName ausente e cai para o e-mail no nome', async () => {
    const service = buildFakeSocialAuthService(pendingResult);
    const verify = extractVerify(service);
    const profile: MicrosoftProfile = {
      provider: 'microsoft',
      id: 'ms-789',
      emails: [{ type: 'work', value: 'sem-nome@empresa.com' }],
    };

    await waitForDone<SocialLoginResult>((done) => verify('at', 'rt', profile, done));

    expect(service.calls[0]).toMatchObject({ name: 'sem-nome@empresa.com' });
  });

  it('propaga erro do service via done quando loginOrRegister lança', async () => {
    const failure = new Error('falha no service ms');
    const service = buildFakeSocialAuthService(failure);
    const verify = extractVerify(service);
    const profile: MicrosoftProfile = {
      provider: 'microsoft',
      id: 'ms-999',
      emails: [{ type: 'work', value: 'existe@empresa.com' }],
    };

    const { error } = await waitForDone<SocialLoginResult>((done) =>
      verify('at', 'rt', profile, done),
    );

    expect(error).toBe(failure);
  });
});
