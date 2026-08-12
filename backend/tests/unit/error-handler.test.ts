import express from 'express';
import request from 'supertest';

import { AppError, NotFoundError } from '@/domain/errors/app-error';
import { errorHandler, notFoundHandler } from '@/http/middlewares/error-handler';

/**
 * Cobre os ramos de `errorHandler` (docs/09, `./src/http/middlewares/`
 * limite de branch 80%): AppError com/sem requestId, erro não tratado
 * (INTERNAL_ERROR) e `notFoundHandler`.
 */
describe('error-handler middleware', () => {
  function buildApp(routeHandler: express.RequestHandler): express.Express {
    const app = express();
    app.get('/rota', routeHandler);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
  }

  it('converte AppError no envelope padrão, com requestId quando req.id existe', async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.id = 'req-123';
      next();
    });
    app.get('/rota', (_req, _res, next) => {
      next(new AppError('CUSTOM_ERROR', 'Mensagem customizada.', 422, { field: 'x' }));
    });
    app.use(errorHandler);

    const response = await request(app).get('/rota');

    expect(response.status).toBe(422);
    const body = response.body as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe('CUSTOM_ERROR');
    expect(body.error.message).toBe('Mensagem customizada.');
    expect(body.error.requestId).toBe('req-123');
  });

  it('converte AppError sem requestId quando req.id não é string', async () => {
    const app = buildApp((_req, _res, next) => {
      next(new AppError('CUSTOM_ERROR', 'Mensagem.', 400));
    });

    const response = await request(app).get('/rota');

    const body = response.body as { error: { requestId?: string } };
    expect(body.error.requestId).toBeUndefined();
  });

  it('responde 500 INTERNAL_ERROR para erro não tratado (não é AppError)', async () => {
    const app = buildApp((_req, _res, next) => {
      next(new Error('Falha inesperada'));
    });

    const response = await request(app).get('/rota');

    expect(response.status).toBe(500);
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Erro interno.');
  });

  it('notFoundHandler encaminha NotFoundError para rota inexistente', async () => {
    const app = buildApp((_req, res) => {
      res.status(200).json({ ok: true });
    });

    const response = await request(app).get('/rota-que-nao-existe');

    expect(response.status).toBe(404);
    const body = response.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('/rota-que-nao-existe');
  });

  it('NotFoundError construído diretamente carrega status 404', () => {
    const error = new NotFoundError('NOT_FOUND', 'Recurso não encontrado.');
    expect(error.status).toBe(404);
    expect(error.name).toBe('NotFoundError');
  });
});
