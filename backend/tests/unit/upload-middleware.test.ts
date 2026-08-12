import express from 'express';
import request from 'supertest';

import { errorHandler } from '@/http/middlewares/error-handler';
import { buildUploadMiddleware } from '@/http/middlewares/upload';

/**
 * Cobre os ramos de erro do Multer traduzidos por `buildUploadMiddleware`
 * (docs/09, `./src/http/middlewares/` limite de branch 80%): arquivo acima
 * do limite (413 PAYLOAD_TOO_LARGE) e excesso de arquivos por requisição
 * (400 VALIDATION_ERROR), além do caminho feliz.
 */
describe('upload middleware', () => {
  function buildApp(maxFileSizeMb: number, maxFilesPerRequest: number): express.Express {
    const app = express();
    app.post(
      '/upload',
      buildUploadMiddleware({ maxFileSizeMb, maxFilesPerRequest }),
      (req, res) => {
        const files = (req.files as Express.Multer.File[] | undefined) ?? [];
        res.status(200).json({ count: files.length });
      },
    );
    app.use(errorHandler);
    return app;
  }

  it('aceita upload dentro do limite de tamanho e quantidade', async () => {
    const app = buildApp(1, 2);
    const response = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('conteudo pequeno'), 'arquivo.txt');

    expect(response.status).toBe(200);
    const body = response.body as { count: number };
    expect(body.count).toBe(1);
  });

  it('responde 413 PAYLOAD_TOO_LARGE quando o arquivo excede maxFileSizeMb', async () => {
    const app = buildApp(0, 2); // 0 MB: qualquer arquivo com conteúdo excede.
    const response = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('conteudo que excede o limite configurado'), 'grande.txt');

    expect(response.status).toBe(413);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('responde 400 VALIDATION_ERROR quando excede o número de arquivos por requisição', async () => {
    const app = buildApp(1, 1);
    const response = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('a'), 'a.txt')
      .attach('files', Buffer.from('b'), 'b.txt');

    expect(response.status).toBe(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
