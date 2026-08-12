import express from 'express';
import request from 'supertest';

import { requestContext } from '@/http/middlewares/request-context';

/**
 * Cobre `requestContext` (docs/09, `./src/http/middlewares/` limite de
 * branch 80%): geração do `X-Request-Id` e presença de `req.log`
 * (encadeado pelo pino-http) em requisições de sucesso e de erro.
 */
describe('requestContext middleware', () => {
  function buildApp(): express.Express {
    const app = express();
    app.use(requestContext());

    app.get('/ok', (req, res) => {
      res.status(200).json({ hasLog: typeof req.log === 'object', requestId: req.id });
    });

    app.get('/erro', (_req, res) => {
      res.status(500).json({ ok: false });
    });

    return app;
  }

  it('define o header X-Request-Id na resposta', async () => {
    const app = buildApp();
    const response = await request(app).get('/ok');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeDefined();
    expect(typeof response.headers['x-request-id']).toBe('string');
  });

  it('popula req.log e req.id, propagando o mesmo id no header', async () => {
    const app = buildApp();
    const response = await request(app).get('/ok');

    const body = response.body as { hasLog: boolean; requestId: string };
    expect(body.hasLog).toBe(true);
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('gera um X-Request-Id diferente por requisição', async () => {
    const app = buildApp();
    const first = await request(app).get('/ok');
    const second = await request(app).get('/ok');

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('mantém o X-Request-Id mesmo em resposta de erro (>= 500)', async () => {
    const app = buildApp();
    const response = await request(app).get('/erro');

    expect(response.status).toBe(500);
    expect(response.headers['x-request-id']).toBeDefined();
  });
});
