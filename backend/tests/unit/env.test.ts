import { parseEnv } from '@/config/env';

const validMinimalEnv = {
  DATABASE_URL: 'sqlserver://localhost:1434;database=test',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
};

describe('parseEnv', () => {
  it('aceita uma configuração mínima válida, aplicando os defaults', () => {
    const result = parseEnv(validMinimalEnv);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.PORT).toBe(3000);
      expect(result.data.API_PREFIX).toBe('/api/v1');
    }
  });

  it('falha quando DATABASE_URL está ausente', () => {
    const result = parseEnv({ JWT_ACCESS_SECRET: validMinimalEnv.JWT_ACCESS_SECRET });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('DATABASE_URL');
    }
  });

  it('falha quando PORT não é um número positivo', () => {
    const result = parseEnv({ ...validMinimalEnv, PORT: '-1' });

    expect(result.success).toBe(false);
  });

  it('falha quando JWT_ACCESS_SECRET tem menos de 32 caracteres', () => {
    const result = parseEnv({ ...validMinimalEnv, JWT_ACCESS_SECRET: 'curto' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('JWT_ACCESS_SECRET');
    }
  });

  it('falha em produção sem COOKIE_SECURE=true', () => {
    const result = parseEnv({ ...validMinimalEnv, NODE_ENV: 'production', COOKIE_SECURE: 'false' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('COOKIE_SECURE');
    }
  });

  it('aceita produção com COOKIE_SECURE=true', () => {
    const result = parseEnv({ ...validMinimalEnv, NODE_ENV: 'production', COOKIE_SECURE: 'true' });

    expect(result.success).toBe(true);
  });
});
