import pino from 'pino';

import { env } from '@/config/env';

const redactConfig = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    '*.password',
    'passwordHash',
    '*.passwordHash',
    'accessToken',
    'refreshToken',
    'tokenHash',
  ],
  censor: '[REDACTED]',
};

export const logger =
  env.NODE_ENV === 'development'
    ? pino({ level: env.LOG_LEVEL, redact: redactConfig, transport: { target: 'pino-pretty' } })
    : pino({ level: env.LOG_LEVEL, redact: redactConfig });
