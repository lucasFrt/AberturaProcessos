import express from 'express';
import request from 'supertest';
import { z } from 'zod';

import { errorHandler } from '@/http/middlewares/error-handler';
import { validate } from '@/http/middlewares/validate';

/**
 * Cobre os três ramos de `validate` (body/query/params), inclusive falha em
 * cada um (docs/09, `./src/http/middlewares/` limite de branch 80%).
 */
describe('validate middleware', () => {
  function buildApp(): express.Express {
    const app = express();
    app.use(express.json());

    app.post('/body', validate({ body: z.object({ name: z.string().min(1) }) }), (req, res) => {
      const body: unknown = req.body;
      res.status(200).json({ body });
    });

    app.get(
      '/query',
      validate({ query: z.object({ page: z.coerce.number().int().positive() }) }),
      (req, res) => {
        res.status(200).json({ query: req.query });
      },
    );

    app.get(
      '/params/:id',
      validate({ params: z.object({ id: z.string().uuid() }) }),
      (req, res) => {
        res.status(200).json({ params: req.params });
      },
    );

    app.use(errorHandler);
    return app;
  }

  it('body válido passa e é substituído pelo resultado do parse', async () => {
    const app = buildApp();
    const response = await request(app).post('/body').send({ name: 'Processo X' });

    expect(response.status).toBe(200);
    const body = response.body as { body: { name: string } };
    expect(body.body.name).toBe('Processo X');
  });

  it('body inválido responde 400 VALIDATION_ERROR', async () => {
    const app = buildApp();
    const response = await request(app).post('/body').send({ name: '' });

    expect(response.status).toBe(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('query válida passa e substitui req.query', async () => {
    const app = buildApp();
    const response = await request(app).get('/query').query({ page: '2' });

    expect(response.status).toBe(200);
    const body = response.body as { query: { page: number } };
    expect(body.query.page).toBe(2);
  });

  it('query inválida responde 400 VALIDATION_ERROR', async () => {
    const app = buildApp();
    const response = await request(app).get('/query').query({ page: '-1' });

    expect(response.status).toBe(400);
  });

  it('params válidos passam', async () => {
    const app = buildApp();
    const response = await request(app).get('/params/123e4567-e89b-12d3-a456-426614174000');

    expect(response.status).toBe(200);
  });

  it('params inválidos respondem 400 VALIDATION_ERROR', async () => {
    const app = buildApp();
    const response = await request(app).get('/params/nao-e-um-uuid');

    expect(response.status).toBe(400);
  });
});
