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

  // ── Login social (docs/06, seção "Login social") ─────────────
  // URL pública do front (redirect final do callback) e da própria API
  // (base dos redirect URIs configurados no provedor). Com default local
  // para não quebrar ambientes que ainda não usam login social.
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),

  // Credenciais opcionais: a ausência de um provedor apenas desativa aquele
  // provedor (rota responde 404, /auth/providers informa false) — nunca
  // impede a subida da API (docs/06, critério de aceite da Tarefa 5).
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().min(1).default('common'),
  MICROSOFT_CALLBACK_URL: z.string().url().optional(),

  // ── Rate limiting (docs/06, seção "Rate limiting") ───────────
  // Configuráveis para permitir testes de integração com janelas/limites
  // baixos (Tarefa 6, critério de aceite) sem tocar no código do limitador.
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_AUTH_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_REFRESH_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_OAUTH_CALLBACK_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_OAUTH_CALLBACK_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_CLIENT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_CLIENT_WINDOW_MINUTES: z.coerce.number().int().positive().default(1),
  RATE_LIMIT_INTERNAL_MAX: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_INTERNAL_WINDOW_MINUTES: z.coerce.number().int().positive().default(1),
  RATE_LIMIT_UPLOAD_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_UPLOAD_WINDOW_MINUTES: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_ANONYMOUS_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_ANONYMOUS_WINDOW_MINUTES: z.coerce.number().int().positive().default(1),

  // ── Armazenamento de anexos (docs/10, RF-40 a RF-44, RNF-11) ──
  // Resolvido para caminho absoluto e criado se não existir por
  // `LocalDiskStorage` (docs/10: "criado se não existir; se não for
  // gravável, aborta").
  STORAGE_ROOT: z.string().min(1).default('./storage/uploads'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(100),
  MAX_FILES_PER_REQUEST: z.coerce.number().int().positive().default(10),

  // ── SMTP (docs/07, docs/10 — Mailpit local em desenvolvimento) ─
  // Defaults apontam para o Mailpit do docker-compose (localhost:1025), que
  // não exige autenticação — por isso SMTP_USER/SMTP_PASSWORD são opcionais.
  SMTP_HOST: z.string().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(1).default('Abertura de Processos <nao-responda@opusce.com.br>'),

  // ── Consulta de CNPJ na Receita (docs/05, "Empresas / CNPJs") ─
  // Nomes genéricos (CNPJ_LOOKUP_*, não RECEITAWS_*) porque o provedor é
  // detalhe de infraestrutura atrás de `CnpjLookupProvider`: trocar para
  // BrasilAPI/cnpj.ws não deve exigir renomear variáveis de ambiente.
  // Desligado (`false`) a consulta responde 503 CNPJ_LOOKUP_DISABLED e o
  // cadastro manual continua funcionando — é assim que os testes de
  // integração rodam sem tocar a rede.
  CNPJ_LOOKUP_ENABLED: booleanFromEnv(true),
  CNPJ_LOOKUP_BASE_URL: z.string().url().default('https://receitaws.com.br/v1'),
  /** Token do plano comercial. Vazio = plano gratuito (3 consultas/min por IP). */
  CNPJ_LOOKUP_TOKEN: z.string().optional(),
  CNPJ_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  /** Cache em memória por CNPJ — protege a cota do plano gratuito. `0` desliga. */
  CNPJ_LOOKUP_CACHE_TTL_MINUTES: z.coerce.number().int().nonnegative().default(60),
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
