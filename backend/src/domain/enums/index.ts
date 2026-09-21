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

/** Tipo do documento de `Company.cnpj` (docs/13, decisão 5). */
export const COMPANY_DOCUMENT_TYPES = ['CNPJ', 'CPF'] as const;
export type CompanyDocumentType = (typeof COMPANY_DOCUMENT_TYPES)[number];

/**
 * Origem de um processo/documento (docs/13, decisão 7). Derivada da
 * autenticação e da rota, nunca informada pelo cliente: JWT → WEB, chave de
 * API em rota comum → API, rota de intake → EMAIL.
 */
export const RECORD_SOURCES = ['WEB', 'EMAIL', 'API', 'ILOG'] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

/** Canal de origem de um `IntakeEvent` (docs/13, decisão 4). Só e-mail no v1. */
export const INTAKE_CHANNELS = ['EMAIL'] as const;
export type IntakeChannel = (typeof INTAKE_CHANNELS)[number];

/**
 * O que foi feito com o e-mail: abrir processo, complementar um existente, ou
 * registrar que foi descartado (IGNORED) / deixado para uma pessoa (ESCALATED).
 * Os dois últimos existem para o cursor do intake avançar por e-mails que não
 * viram processo (docs/13, decisão 9).
 */
export const INTAKE_EVENT_KINDS = ['PROCESS', 'ATTACHMENT', 'IGNORED', 'ESCALATED'] as const;
export type IntakeEventKind = (typeof INTAKE_EVENT_KINDS)[number];

/** PROCESSING é o "claim" do evento; FAILED permite retomar (docs/13, decisão 4). */
export const INTAKE_EVENT_STATUSES = ['PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type IntakeEventStatus = (typeof INTAKE_EVENT_STATUSES)[number];

/**
 * Tipo de identificador do embarque no índice `ProcessIdentifier` (docs/15,
 * seção 5.1). O `kind` separa "31435/26" (número da Opus) de um HBL com os
 * mesmos dígitos; a busca do intake é por `normalized` e devolve o `kind`
 * casado.
 */
export const PROCESS_IDENTIFIER_KINDS = [
  'OPUS_NUMBER',
  'CLIENT_REF',
  'HBL',
  'MBL',
  'CONTAINER',
  'INVOICE',
  'DI',
  'CE',
  'DTA',
  'OTHER',
] as const;
export type ProcessIdentifierKind = (typeof PROCESS_IDENTIFIER_KINDS)[number];

/** Quem gravou o identificador: espelho do iLog, intake por e-mail ou pessoa (formulário/edição). */
export const PROCESS_IDENTIFIER_SOURCES = ['ILOG', 'EMAIL', 'MANUAL'] as const;
export type ProcessIdentifierSource = (typeof PROCESS_IDENTIFIER_SOURCES)[number];

/** Chave da linha única de `IlogSyncState` (docs/15, seção 5.2). */
export const ILOG_SYNC_KEYS = ['ILOG'] as const;
export type IlogSyncKey = (typeof ILOG_SYNC_KEYS)[number];
