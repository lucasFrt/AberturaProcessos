import express from 'express';
import request from 'supertest';

import { FakeTokenService } from '../helpers/fakes/fake-token-service';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import type { CreateUserData } from '@/domain/entities/user';
import { authenticate, type AuthenticateDeps } from '@/http/middlewares/authenticate';
import { errorHandler } from '@/http/middlewares/error-handler';
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

  function buildDeps(): { deps: AuthenticateDeps; userRepository: InMemoryUserRepository } {
    const userRepository = new InMemoryUserRepository();
    const tokenService = new FakeTokenService();
    const accessScopeResolver = new AccessScopeResolver(userRepository);
    return {
      deps: { tokenService, userRepository, accessScopeResolver },
      userRepository,
    };
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
});
