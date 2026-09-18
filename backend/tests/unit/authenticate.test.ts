import express from 'express';
import request from 'supertest';

import { FakeTokenService } from '../helpers/fakes/fake-token-service';
import { InMemoryApiKeyRepository } from '../helpers/fakes/in-memory-api-key-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import type { CreateUserData } from '@/domain/entities/user';
import { authenticate, type AuthenticateDeps } from '@/http/middlewares/authenticate';
import { errorHandler } from '@/http/middlewares/error-handler';
import { apiKeyDisplayPrefix, hashApiKey } from '@/infra/security/api-key-generator';
import { AccessScopeResolver } from '@/services/access-scope-resolver';

/**
 * Cobre os ramos de `authenticate` (docs/09, `./src/http/middlewares/`
 * limite de branch 80%): header ausente/mal formado, token inválido,
 * usuário inexistente, status PENDING/DISABLED, e o caminho feliz que
 * popula `req.auth`. Isolado do restante da cadeia HTTP, como
 * `authorize.test.ts` e `rate-limit.test.ts` já fazem.
 */
describe('authenticate middleware', () => {
  function buildApp(deps: AuthenticateDeps): express.Express {
    const app = express();
    app.get('/protegido', authenticate(deps), (req, res) => {
      res.status(200).json({ auth: req.auth });
    });
    app.use(errorHandler);
    return app;
  }

  function buildDeps(): {
    deps: AuthenticateDeps;
    userRepository: InMemoryUserRepository;
    apiKeyRepository: InMemoryApiKeyRepository;
  } {
    const userRepository = new InMemoryUserRepository();
    const tokenService = new FakeTokenService();
    const accessScopeResolver = new AccessScopeResolver(userRepository);
    const apiKeyRepository = new InMemoryApiKeyRepository(userRepository);
    return {
      deps: { tokenService, userRepository, accessScopeResolver, apiKeyRepository },
      userRepository,
      apiKeyRepository,
    };
  }

  async function seedApiKey(
    apiKeyRepository: InMemoryApiKeyRepository,
    userId: string,
    plainKey = 'apk_chave-de-teste-em-claro',
  ): Promise<{ plainKey: string; id: string }> {
    const created = await apiKeyRepository.create({
      name: 'Agente de E-mail',
      keyHash: hashApiKey(plainKey),
      keyPrefix: apiKeyDisplayPrefix(plainKey),
      userId,
      createdById: userId,
    });
    return { plainKey, id: created.id };
  }

  async function seedUser(
    userRepository: InMemoryUserRepository,
    overrides: Partial<CreateUserData> = {},
  ): Promise<string> {
    const user = await userRepository.create({
      name: 'Usuário Teste',
      email: 'usuario@teste.com.br',
      passwordHash: null,
      role: 'CLIENT',
      status: 'ACTIVE',
      accessScope: 'ORGANIZATION',
      organizationId: 'org-1',
      ...overrides,
    });
    return user.id;
  }

  it('responde 401 UNAUTHENTICATED quando não há header Authorization', async () => {
    const { deps } = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/protegido');

    expect(response.status).toBe(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('responde 401 UNAUTHENTICATED quando o header não começa com "Bearer "', async () => {
    const { deps } = buildDeps();
    const app = buildApp(deps);

    const response = await request(app).get('/protegido').set('Authorization', 'Token abc123');

    expect(response.status).toBe(401);
  });

  it('responde 401 UNAUTHENTICATED quando o token é inválido (erro do jsonwebtoken)', async () => {
    const { deps } = buildDeps();
    const app = buildApp(deps);

    const response = await request(app)
      .get('/protegido')
      .set('Authorization', 'Bearer token-invalido-nao-json');

    expect(response.status).toBe(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('responde 401 UNAUTHENTICATED quando o usuário do token não existe mais', async () => {
    const { deps } = buildDeps();
    const app = buildApp(deps);
    const token = deps.tokenService.signAccessToken({
      sub: 'usuario-inexistente',
      role: 'CLIENT',
      organizationId: null,
      scope: 'ORGANIZATION',
    });

    const response = await request(app).get('/protegido').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('responde 403 ACCOUNT_PENDING quando o usuário está PENDING', async () => {
    const { deps, userRepository } = buildDeps();
    const app = buildApp(deps);
    const userId = await seedUser(userRepository, { status: 'PENDING' });
    const token = deps.tokenService.signAccessToken({
      sub: userId,
      role: 'CLIENT',
      organizationId: 'org-1',
      scope: 'ORGANIZATION',
    });

    const response = await request(app).get('/protegido').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('ACCOUNT_PENDING');
  });

  it('responde 403 ACCOUNT_DISABLED quando o usuário está DISABLED', async () => {
    const { deps, userRepository } = buildDeps();
    const app = buildApp(deps);
    const userId = await seedUser(userRepository, { status: 'DISABLED' });
    const token = deps.tokenService.signAccessToken({
      sub: userId,
      role: 'CLIENT',
      organizationId: 'org-1',
      scope: 'ORGANIZATION',
    });

    const response = await request(app).get('/protegido').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('popula req.auth e chama next() para usuário ACTIVE com token válido', async () => {
    const { deps, userRepository } = buildDeps();
    const app = buildApp(deps);
    const userId = await seedUser(userRepository, { role: 'OPERATIONAL' });
    const token = deps.tokenService.signAccessToken({
      sub: userId,
      role: 'OPERATIONAL',
      organizationId: 'org-1',
      scope: 'ORGANIZATION',
    });

    const response = await request(app).get('/protegido').set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const body = response.body as { auth: { userId: string; role: string; scope: unknown } };
    expect(body.auth.userId).toBe(userId);
    expect(body.auth.role).toBe('OPERATIONAL');
    // OPERATIONAL resolve para escopo ALL (access-scope-resolver.ts).
    expect(body.auth.scope).toEqual({ kind: 'ALL' });
  });

  describe('X-Api-Key (docs/13, decisão 2)', () => {
    it('popula req.auth com authKind API_KEY e o usuário vinculado', async () => {
      const { deps, userRepository, apiKeyRepository } = buildDeps();
      const app = buildApp(deps);
      const userId = await seedUser(userRepository, { role: 'OPERATIONAL' });
      const { plainKey, id } = await seedApiKey(apiKeyRepository, userId);

      const response = await request(app).get('/protegido').set('X-Api-Key', plainKey);

      expect(response.status).toBe(200);
      const body = response.body as {
        auth: { userId: string; role: string; authKind: string; apiKeyId: string };
      };
      expect(body.auth.userId).toBe(userId);
      expect(body.auth.role).toBe('OPERATIONAL');
      expect(body.auth.authKind).toBe('API_KEY');
      expect(body.auth.apiKeyId).toBe(id);
    });

    it('registra lastUsedAt da chave (touchLastUsed)', async () => {
      const { deps, userRepository, apiKeyRepository } = buildDeps();
      const app = buildApp(deps);
      const userId = await seedUser(userRepository, { role: 'OPERATIONAL' });
      const { plainKey, id } = await seedApiKey(apiKeyRepository, userId);

      await request(app).get('/protegido').set('X-Api-Key', plainKey);

      expect(apiKeyRepository.touches.map((touch) => touch.id)).toContain(id);
    });

    it('responde 401 UNAUTHENTICATED para chave desconhecida', async () => {
      const { deps, userRepository, apiKeyRepository } = buildDeps();
      const app = buildApp(deps);
      const userId = await seedUser(userRepository, { role: 'OPERATIONAL' });
      await seedApiKey(apiKeyRepository, userId);

      const response = await request(app).get('/protegido').set('X-Api-Key', 'apk_outra');

      expect(response.status).toBe(401);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });

    it('responde 401 UNAUTHENTICATED para chave revogada', async () => {
      const { deps, userRepository, apiKeyRepository } = buildDeps();
      const app = buildApp(deps);
      const userId = await seedUser(userRepository, { role: 'OPERATIONAL' });
      const { plainKey, id } = await seedApiKey(apiKeyRepository, userId);
      await apiKeyRepository.revoke(id);

      const response = await request(app).get('/protegido').set('X-Api-Key', plainKey);

      expect(response.status).toBe(401);
    });

    it('responde 403 ACCOUNT_DISABLED quando o usuário vinculado foi desativado', async () => {
      const { deps, userRepository, apiKeyRepository } = buildDeps();
      const app = buildApp(deps);
      const userId = await seedUser(userRepository, { role: 'OPERATIONAL' });
      const { plainKey } = await seedApiKey(apiKeyRepository, userId);
      await userRepository.update(userId, { status: 'DISABLED' });

      const response = await request(app).get('/protegido').set('X-Api-Key', plainKey);

      expect(response.status).toBe(403);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('ACCOUNT_DISABLED');
    });

    it('X-Api-Key tem precedência sobre um Authorization inválido enviado junto', async () => {
      const { deps, userRepository, apiKeyRepository } = buildDeps();
      const app = buildApp(deps);
      const userId = await seedUser(userRepository, { role: 'OPERATIONAL' });
      const { plainKey } = await seedApiKey(apiKeyRepository, userId);

      const response = await request(app)
        .get('/protegido')
        .set('X-Api-Key', plainKey)
        .set('Authorization', 'Bearer lixo');

      expect(response.status).toBe(200);
    });
  });
});
