/**
 * Carregado pelo Jest antes de qualquer teste (jest.config.js -> setupFiles).
 * Garante que a suíte rode contra `.env.test`, não contra o `.env` de
 * desenvolvimento — em especial o banco `abertura_processos_test`
 * (docs/09-padroes-de-codigo-e-testes.md).
 */
import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });
