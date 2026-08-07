import { parseEnv } from '@/config/env';

describe('parseEnv', () => {
  it('aceita uma configuração mínima válida, aplicando os defaults', () => {
    const result = parseEnv({
      DATABASE_URL: 'sqlserver://localhost:1434;database=test',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.PORT).toBe(3000);
      expect(result.data.API_PREFIX).toBe('/api/v1');
    }
  });

  it('falha quando DATABASE_URL está ausente', () => {
    const result = parseEnv({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('DATABASE_URL');
    }
  });

  it('falha quando PORT não é um número positivo', () => {
    const result = parseEnv({
      DATABASE_URL: 'sqlserver://localhost:1434;database=test',
      PORT: '-1',
    });

    expect(result.success).toBe(false);
  });
});
