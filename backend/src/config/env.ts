import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * `z.coerce.boolean()` converte qualquer string não vazia para `true`
 * (`Boolean('false') === true` em JS) — ou seja, `COOKIE_SECURE=false` no
 * `.env` seria lido como `true`. Esse schema interpreta o texto de fato.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- retorno inferido: o tipo exato do schema Zod (ZodEffects em v3, diferente em v4) não vale a pena fixar aqui
function booleanFromEnv(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) return defaultValue;
      return ['true', '1'].includes(value.trim().toLowerCase());
    });
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().min(1).default('/api/v1'),
  APP_VERSION: z.string().min(1).default('1.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória.'),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET precisa de ao menos 32 caracteres.'),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  JWT_ISSUER: z.string().min(1).default('abertura-processos'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: booleanFromEnv(false),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

const refinedEnvSchema = envSchema.superRefine((data, ctx) => {
  // docs/10-ambiente-e-configuracao.md: produção exige cookie seguro.
  if (data.NODE_ENV === 'production' && !data.COOKIE_SECURE) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'COOKIE_SECURE precisa ser true em produção.',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * Função pura (sem side effect) para permitir testar a validação sem
 * precisar simular `process.exit`. `loadEnv` abaixo é quem decide o que
 * fazer com o resultado em runtime.
 */
export function parseEnv(source: NodeJS.ProcessEnv): ReturnType<typeof refinedEnvSchema.safeParse> {
  return refinedEnvSchema.safeParse(source);
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
