import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().min(1).default('/api/v1'),
  APP_VERSION: z.string().min(1).default('1.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória.'),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Função pura (sem side effect) para permitir testar a validação sem
 * precisar simular `process.exit`. `loadEnv` abaixo é quem decide o que
 * fazer com o resultado em runtime.
 */
export function parseEnv(source: NodeJS.ProcessEnv): ReturnType<typeof envSchema.safeParse> {
  return envSchema.safeParse(source);
}

function loadEnv(): Env {
  const parsed = parseEnv(process.env);

  if (!parsed.success) {
    // eslint-disable-next-line no-console -- única saída permitida: falha de config antes do logger existir
    console.error('Configuração inválida:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
