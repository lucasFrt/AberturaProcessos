import { z } from 'zod';

import { INTAKE_CHANNELS, INTAKE_EVENT_KINDS, INTAKE_EVENT_STATUSES } from '@/domain/enums';
import { paginationQuerySchema } from '@/http/schemas/pagination-schemas';

/**
 * Payloads de `/intake/*` (docs/05, "Intake"; docs/13). Chegam como JSON
 * puro ou como campo `payload` (JSON) de um multipart — o middleware
 * `multipartJsonPayload` normaliza os dois para `req.body` antes do
 * `validate`, então os schemas aqui não sabem de multipart.
 */

const sourceSchema = z.object({
  channel: z.enum(INTAKE_CHANNELS).default('EMAIL'),
  externalId: z.string().trim().min(1, 'source.externalId é obrigatório.').max(400),
  /** Message-ID RFC 5322 (chave secundária de idempotência, docs/14). */
  internetMessageId: z.string().trim().min(1).max(400).nullable().optional(),
  subject: z.string().trim().max(500).nullable().optional(),
  receivedAt: z.coerce.date(),
});

const requesterSchema = z.object({
  email: z.string().trim().toLowerCase().email('requester.email inválido.').max(255),
  name: z.string().trim().max(200).nullable().optional(),
});

const companyRefSchema = z.object({
  document: z.string().trim().min(11, 'CNPJ/CPF inválido.').max(20),
  name: z.string().trim().max(255).nullable().optional(),
});

/**
 * Cliente sem documento no e-mail é resolvido pelo domínio do solicitante
 * (docs/13, decisão 5) ou, quando o remetente é terceiro, pelo nome (decisão 11).
 */
const clientCompanyRefSchema = z.object({
  document: z.string().trim().min(11, 'CNPJ/CPF inválido.').max(20).nullable().optional(),
  name: z.string().trim().max(255).nullable().optional(),
  senderIsClient: z.boolean().optional(),
});

export const intakeCreateProcessSchema = z.object({
  source: sourceSchema,
  requester: requesterSchema,
  company: clientCompanyRefSchema.nullable().default({}),
  requestingCompany: companyRefSchema.nullable().optional(),
  reference: z.string().trim().min(3, 'Referência precisa ter ao menos 3 caracteres.').max(255),
  additionalInfo: z.string().max(10_000).nullable().optional(),
  /** Identificadores do embarque além da referência (HBL, contêiner...), para o índice (docs/15). */
  identifiers: z.array(z.string().trim().min(3).max(100)).max(20).nullable().optional(),
  fetchAttachments: z.boolean().default(false),
});
export type IntakeCreateProcessBody = z.infer<typeof intakeCreateProcessSchema>;

export const intakeAttachSchema = z
  .object({
    source: sourceSchema,
    requester: requesterSchema,
    processRef: z.string().trim().min(1).max(255).nullable().optional(),
    processId: z.string().trim().min(1).nullable().optional(),
    note: z.string().max(10_000).nullable().optional(),
    addReferences: z.array(z.string().trim().min(3).max(100)).max(10).nullable().optional(),
    fetchAttachments: z.boolean().default(false),
  })
  .refine((data) => Boolean(data.processRef) || Boolean(data.processId), {
    message: 'Informe processRef ou processId.',
    path: ['processRef'],
  });
export type IntakeAttachBody = z.infer<typeof intakeAttachSchema>;

export const intakeLookupQuerySchema = z
  .object({
    ref: z.string().trim().min(1).max(255).optional(),
    companyDocument: z.string().trim().min(11).max(20).optional(),
    limit: z.coerce.number().int().positive().max(20).default(5),
  })
  .refine((data) => Boolean(data.ref) || Boolean(data.companyDocument), {
    message: 'Informe ref ou companyDocument.',
    path: ['ref'],
  });
export type IntakeLookupQuery = z.infer<typeof intakeLookupQuerySchema>;

/** Descarte/escalada registrados para o cursor avançar (docs/13, decisão 9). */
export const intakeSkipSchema = z.object({
  source: sourceSchema,
  requester: requesterSchema.nullable().optional(),
  outcome: z.enum(['IGNORED', 'ESCALATED']),
  reason: z.string().trim().min(3, 'Informe o motivo.').max(1000),
});
export type IntakeSkipBody = z.infer<typeof intakeSkipSchema>;

export const intakeCursorQuerySchema = z.object({
  channel: z.enum(INTAKE_CHANNELS).default('EMAIL'),
});
export type IntakeCursorQuery = z.infer<typeof intakeCursorQuerySchema>;

/** Listagem da caixa pelo servidor (docs/13, decisão 9). `exclude` = termos separados por vírgula. */
export const intakeListMailboxQuerySchema = z.object({
  after: z.coerce.date(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  exclude: z
    .string()
    .max(2000)
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length > 0),
    ),
});
export type IntakeListMailboxQuery = z.infer<typeof intakeListMailboxQuerySchema>;

export const intakeMailboxMessageParamsSchema = z.object({ id: z.string().min(1).max(400) });
export const intakeMailboxMessageQuerySchema = z.object({
  maxChars: z.coerce.number().int().positive().max(50_000).default(6000),
});
export type IntakeMailboxMessageQuery = z.infer<typeof intakeMailboxMessageQuerySchema>;

export const intakeAdvanceCursorSchema = z.object({
  channel: z.enum(INTAKE_CHANNELS).default('EMAIL'),
  receivedAt: z.coerce.date(),
  externalId: z.string().trim().min(1).max(400).nullable().optional(),
});
export type IntakeAdvanceCursorBody = z.infer<typeof intakeAdvanceCursorSchema>;

export const intakeListEventsQuerySchema = paginationQuerySchema.extend({
  externalId: z.string().trim().min(1).max(400).optional(),
  internetMessageId: z.string().trim().min(1).max(400).optional(),
  kind: z.enum(INTAKE_EVENT_KINDS).optional(),
  status: z.enum(INTAKE_EVENT_STATUSES).optional(),
  processId: z.string().trim().min(1).optional(),
});
export type IntakeListEventsQuery = z.infer<typeof intakeListEventsQuerySchema>;
