import express from 'express';
import request from 'supertest';

import { authorize } from '@/http/middlewares/authorize';
import { errorHandler } from '@/http/middlewares/error-handler';

/**
 * Critério de aceite da Tarefa 4: "rota com authorize('ADMIN') responde
 * 403 para CLIENT". Testado isoladamente do restante da cadeia HTTP para
 * exercitar só a lógica do guard.
 */
describe('authorize middleware', () => {
  function buildApp(role: 'CLIENT' | 'OPERATIONAL' | 'ADMIN' | null): express.Express {
    const app = express();

    app.get(
      '/admin-only',
      (req, _res, next) => {
        if (role) {
          req.auth = { userId: 'u1', role, organizationId: null, scope: { kind: 'ALL' } };
        }
        next();
      },
      authorize('ADMIN'),
      (_req, res) => {
        res.status(200).json({ ok: true });
      },
    );

    app.use(errorHandler);
    return app;
  }

  it('permite acesso quando o papel está na lista', async () => {
    const app = buildApp('ADMIN');
    const response = await request(app).get('/admin-only');
    expect(response.status).toBe(200);
  });

  it('responde 403 FORBIDDEN quando o papel não está na lista', async () => {
    const app = buildApp('CLIENT');
    const response = await request(app).get('/admin-only');

    expect(response.status).toBe(403);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('responde 401 UNAUTHENTICATED quando não há req.auth', async () => {
    const app = buildApp(null);
    const response = await request(app).get('/admin-only');

    expect(response.status).toBe(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});
