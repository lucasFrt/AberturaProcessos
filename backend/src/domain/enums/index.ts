/**
 * "Enums" do domínio, como uniões de string.
 *
 * SQL Server + Prisma não suporta `enum` nativo (ver docs/04-modelo-de-dados.md),
 * então estes valores vivem como String no banco, com CHECK constraint aplicada
 * na migration 20260807190618_add_check_constraints como rede de segurança.
 *
 * Ao adicionar/remover um valor aqui, atualize também:
 * - o schema Zod correspondente (usa z.enum(...) a partir destes arrays)
 * - a CHECK constraint no banco, por nova migration
 */

export const ROLES = ['CLIENT', 'OPERATIONAL', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['PENDING', 'ACTIVE', 'DISABLED', 'REJECTED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ACCESS_SCOPES = ['ORGANIZATION', 'COMPANIES'] as const;
export type AccessScopeKind = (typeof ACCESS_SCOPES)[number];

export const AUTH_PROVIDERS = ['LOCAL', 'GOOGLE', 'MICROSOFT'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const HISTORY_ACTIONS = [
  'PROCESS_CREATED',
  'PROCESS_UPDATED',
  'STAGE_CHANGED',
  'RESPONSIBLE_CHANGED',
  'DOCUMENT_ADDED',
  'DOCUMENT_REMOVED',
  'PROCESS_DELETED',
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
