import request from 'supertest';

import { createApp } from '@/http/app';

describe('GET /health', () => {
  it('retorna 200 com status ok', async () => {
    const app = createApp();

    const response = await request(app).get('/health');
    const body = response.body as { status: string; uptime: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok' });
    expect(typeof body.uptime).toBe('number');
  });
});
