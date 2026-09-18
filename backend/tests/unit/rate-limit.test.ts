import express from 'express';
import request from 'supertest';

import { buildRateLimiters } from '@/http/middlewares/rate-limit';

/**
 * Testa o dispatcher `rateLimitByRole` e o envelope de erro 429 isolados do
 * resto da cadeia HTTP (mesmo padrão de `authorize.test.ts`), sem precisar
 * de banco. Cobre o critério de aceite da Tarefa 6 quanto ao formato da
 * resposta (`RATE_LIMIT_EXCEEDED` + `Retry-After`).
 */
describe('rate-limit middlewares', () => {
  function buildApp(role: 'CLIENT' | 'OPERATIONAL' | 'ADMIN' | null): express.Express {
    const limiters = buildRateLimiters({
      authMaxRequests: 100,
      authWindowMs: 60_000,
      refreshMaxRequests: 100,
      refreshWindowMs: 60_000,
      oauthCallbackMaxRequests: 100,
      oauthCallbackWindowMs: 60_000,
      clientMaxRequests: 2,
      clientWindowMs: 60_000,
      internalMaxRequests: 100,
      internalWindowMs: 60_000,
      uploadMaxRequests: 100,
      uploadWindowMs: 60_000,
      anonymousMaxRequests: 2,
      anonymousWindowMs: 60_000,
    });

    const app = express();
    app.get(
      '/resource',
      (req, _res, next) => {
        if (role) {
          req.auth = {
            userId: 'u1',
            role,
            organizationId: null,
            scope: { kind: 'ALL' },
            authKind: 'JWT',
            apiKeyId: null,
          };
        }
        next();
      },
      limiters.rateLimitByRole,
      (_req, res) => {
        res.status(200).json({ ok: true });
      },
    );
    return app;
  }

  it('bloqueia CLIENT com 429 e envelope RATE_LIMIT_EXCEEDED após estourar o limite', async () => {
    const app = buildApp('CLIENT');

    await request(app).get('/resource');
    await request(app).get('/resource');
    const response = await request(app).get('/resource');

    expect(response.status).toBe(429);
    expect(response.headers['retry-after']).toBeDefined();
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.message).toBeTruthy();
  });

  it('não bloqueia usuário anônimo isolado de CLIENT (chaves diferentes)', async () => {
    const clientApp = buildApp('CLIENT');
    const anonymousApp = buildApp(null);

    // Estoura o limite de CLIENT (2 por minuto neste teste).
    await request(clientApp).get('/resource');
    await request(clientApp).get('/resource');
    const clientBlocked = await request(clientApp).get('/resource');
    expect(clientBlocked.status).toBe(429);

    // App anônimo tem seu próprio limitador/estado — não é afetado.
    const anonymousResponse = await request(anonymousApp).get('/resource');
    expect(anonymousResponse.status).toBe(200);
  });
});
