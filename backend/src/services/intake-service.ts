import type { CnpjLookupProvider } from '@/domain/cnpj/cnpj-lookup-provider';
import type { AccessScope } from '@/domain/entities/access-scope';
import type { Company } from '@/domain/entities/company';
import type {
  IntakeEvent,
  IntakeEventFilters,
  IntakeEventResult,
} from '@/domain/entities/intake-event';
import type {
  ProcessDetail,
  ProcessDocumentSummary,
  ProcessListItem,
} from '@/domain/entities/process';
import type { ProcessIdentifierInput } from '@/domain/entities/process-identifier';
import {
  classifyIdentifier,
  extractIdentifierCandidates,
  normalizeIdentifier,
} from '@/domain/entities/process-identifier';
import type { IntakeChannel, IntakeEventKind, ProcessIdentifierKind } from '@/domain/enums';
import { AppError, ConflictError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import type { MailAttachmentProvider } from '@/domain/mail/mail-attachment-provider';
import type { MailboxOrganizer } from '@/domain/mail/mailbox-organizer';
import type {
  MailboxAttachmentSummary,
  MailboxMessageSummary,
  MailboxReader,
} from '@/domain/mail/mailbox-reader';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';
import type { EmailDomainRepository } from '@/domain/repositories/email-domain-repository';
import type { IntakeCursorRepository } from '@/domain/repositories/intake-cursor-repository';
import type { IntakeEventRepository } from '@/domain/repositories/intake-event-repository';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';
import type { ProcessIdentifierRepository } from '@/domain/repositories/process-identifier-repository';
import type { ProcessRepository } from '@/domain/repositories/process-repository';
import type { DocumentService, UploadFileInput } from '@/services/document-service';
import type { IlogSyncService } from '@/services/ilog-sync-service';
import type { ProcessService } from '@/services/process-service';
import { classifyDocument, formatDocument, normalizeCnpjDigits } from '@/shared/cnpj';
import { PUBLIC_WEBMAIL_DOMAINS } from '@/shared/email-domains';

export interface IntakeServiceDeps {
  intakeEventRepository: IntakeEventRepository;
  intakeCursorRepository: IntakeCursorRepository;
  processRepository: ProcessRepository;
  /** Índice de identificadores (docs/15): primeira consulta de `lookup`/`attach`. */
  processIdentifierRepository: ProcessIdentifierRepository;
  companyRepository: CompanyRepository;
  organizationRepository: OrganizationRepository;
  emailDomainRepository: EmailDomainRepository;
  processService: ProcessService;
  documentService: DocumentService;
  /**
   * `null` = `ILOG_SYNC_ENABLED=false`. Com ele, um identificador que o
   * índice local não tem é procurado no iLog uma vez (retaguarda B, docs/15).
   */
  ilogSyncService: IlogSyncService | null;
  /** `null` = consulta na Receita desligada (docs/10); a razão social vem do payload. */
  cnpjLookupProvider: CnpjLookupProvider | null;
  /** `null` = `GRAPH_INTAKE_ENABLED=false`; `fetchAttachments` responde 503 (docs/13, decisão 3). */
  mailAttachmentProvider: MailAttachmentProvider | null;
  /** `null` = `GRAPH_INTAKE_ENABLED=false`; `/intake/mailbox/*` responde 503 (docs/13, decisão 9). */
  mailboxReader: MailboxReader | null;
  /**
   * `null` = `GRAPH_ORGANIZE_ENABLED=false`. Com organizer, o e-mail que virou
   * processo/documento é copiado para `organizeFolder/<Organização>` (docs/13,
   * decisão 12) — best-effort: falha vira aviso, nunca erro.
   */
  mailboxOrganizer: MailboxOrganizer | null;
  organizeFolder: string;
  /** Mesmo limite do upload web (`MAX_UPLOAD_SIZE_MB`); anexo maior é pulado com aviso. */
  maxAttachmentBytes: number;
}

export interface IntakeSource {
  channel: IntakeChannel;
  /** Id da mensagem no canal (Graph). Chave de idempotência. */
  externalId: string;
  /** Message-ID RFC 5322 — chave secundária, estável entre pastas/caixas (docs/14). */
  internetMessageId?: string | null | undefined;
  subject?: string | null | undefined;
  /** Data de recebimento do e-mail. */
  receivedAt: Date;
}

export interface IntakeRequester {
  email: string;
  name?: string | null | undefined;
}

export interface IntakeCompanyRef {
  /**
   * CNPJ ou CPF, com ou sem máscara. Ausente = resolver pelo domínio do
   * solicitante (docs/13, decisão 5): cliente recorrente manda "Novo
   * processo 230/26" sem repetir o CNPJ.
   */
  document?: string | null | undefined;
  /** Razão social/nome informado no e-mail — usado quando a Receita não responde ou é CPF. */
  name?: string | null | undefined;
  /**
   * `false` = quem escreveu não é o cliente (agente de carga, armador,
   * despachante...). Sem documento, a empresa é então resolvida pelo `name`
   * (docs/13, decisão 11), nunca pelo domínio do remetente — que é de
   * terceiro e não pode virar o cadastro do cliente. Padrão `true`.
   */
  senderIsClient?: boolean | undefined;
}

export interface CreateProcessIntakeInput {
  source: IntakeSource;
  requester: IntakeRequester;
  company: IntakeCompanyRef;
  requestingCompany?: IntakeCompanyRef | null | undefined;
  reference: string;
  additionalInfo?: string | null | undefined;
  /**
   * Identificadores do embarque que o e-mail traz (HBL, contêiner, número
   * do agente...), além do que a `reference` já contém — alimentam o índice
   * (docs/15) para os próximos documentos casarem.
   */
  identifiers?: string[] | null | undefined;
  /** Baixar anexos da mensagem `source.externalId` pelo `MailAttachmentProvider`. */
  fetchAttachments: boolean;
  /** Arquivos enviados no multipart (quando o orquestrador já os tem em disco). */
  files: UploadFileInput[];
}

export interface AttachIntakeInput {
  source: IntakeSource;
  requester: IntakeRequester;
  /** Código (`PRC-2026-00042`) ou referência citada no e-mail. Ignorado se `processId` vier. */
  processRef?: string | null | undefined;
  /** Escolha explícita do agente (ex.: depois de um 409 com candidatos). */
  processId?: string | null | undefined;
  /** Texto do e-mail a anexar em `additionalInfo`, com carimbo de remetente/data. */
  note?: string | null | undefined;
  /**
   * Identificadores do embarque que este e-mail revelou (HBL, contêiner,
   * número do agente...) para acrescentar à `reference` do processo, de
   * modo que os próximos documentos casem (docs/13, decisão 11).
   */
  addReferences?: string[] | null | undefined;
  fetchAttachments: boolean;
  files: UploadFileInput[];
}

export interface IntakeResult {
  event: IntakeEvent;
  /** `true` quando o `externalId` já tinha sido processado — nada foi refeito. */
  duplicate: boolean;
  process: ProcessDetail;
  documents: ProcessDocumentSummary[];
  company: { id: string; created: boolean } | null;
  organization: { id: string; created: boolean; domainRegistered: boolean } | null;
  warnings: string[];
}

export interface ListMailboxInput {
  after: Date;
  limit: number;
  /** Termos (minúsculas) que, contidos no e-mail ou no nome do remetente, descartam a mensagem. */
  excludeSenders: string[];
}

/**
 * O que o intake já fez com uma mensagem listada (docs/13, decisão 9) — a
 * rotina decide pela listagem o que pular, sem consultar evento por evento.
 */
export interface MailboxIntakeStatus {
  eventId: string;
  status: IntakeEvent['status'];
  kind: IntakeEvent['kind'];
  processId: string | null;
}

export interface MailboxListItem extends MailboxMessageSummary {
  /** `null` = nunca tratada pelo intake. */
  intake: MailboxIntakeStatus | null;
}

export interface ListMailboxResult {
  messages: MailboxListItem[];
  /** Quantas o provedor devolveu, antes do filtro de remetentes. */
  listed: number;
  blocked: number;
  /** `receivedAt` da última mensagem listada (bloqueada ou não) — o próximo `after`. */
  nextAfter: Date | null;
  hasMore: boolean;
}

export interface MailboxMessageView {
  id: string;
  internetMessageId: string | null;
  subject: string;
  from: { name: string | null; email: string | null };
  to: string[];
  cc: string[];
  receivedAt: Date;
  hasAttachments: boolean;
  attachments: MailboxAttachmentSummary[];
  /** Corpo em texto, sem histórico citado, limitado a `maxChars`. */
  bodyText: string;
  bodyTruncated: boolean;
}

/** E-mail que o agente decidiu não transformar em processo (docs/13, decisão 9). */
export interface SkipIntakeInput {
  source: IntakeSource;
  /** Remetente, quando faz sentido guardar (ruído automático pode não ter). */
  requester?: IntakeRequester | null | undefined;
  /** IGNORED = ruído descartado; ESCALATED = precisa de uma pessoa. */
  outcome: Extract<IntakeEventKind, 'IGNORED' | 'ESCALATED'>;
  /** Motivo curto, para o operacional entender a decisão sem reler o e-mail. */
  reason: string;
}

export interface SkipIntakeResult {
  event: IntakeEvent;
  /** `true` quando a mensagem já tinha desfecho registrado — nada foi alterado. */
  duplicate: boolean;
}

/**
 * Um item do descarte em lote: cada mensagem tem o próprio desfecho, e a
 * falha de uma (ex.: `INTAKE_IN_PROGRESS`) não impede as outras.
 */
export type SkipBatchItemResult =
  | ({ externalId: string; ok: true } & SkipIntakeResult)
  | { externalId: string; ok: false; error: { code: string; message: string } };

/** Ponto de onde a próxima execução do agente continua a leitura (docs/13, decisão 9). */
export interface IntakeCursor {
  channel: IntakeChannel;
  /** `receivedAt` do último e-mail examinado; `null` antes do primeiro. */
  receivedAt: Date | null;
  /** id da última mensagem examinada, quando conhecido. */
  externalId: string | null;
  /** `STORED` = gravado pelo agente (`advanceCursor`); `EVENTS` = deduzido dos eventos; `NONE`. */
  source: 'STORED' | 'EVENTS' | 'NONE';
}

export interface AdvanceCursorInput {
  channel: IntakeChannel;
  receivedAt: Date;
  externalId?: string | null | undefined;
}

export interface AdvanceCursorResult {
  cursor: IntakeCursor;
  /** `false` quando o valor informado era mais antigo que o atual (ignorado). */
  advanced: boolean;
}

/**
 * Como o candidato casou: código, referência exata, um identificador do
 * índice (o `kind` dele: `HBL`, `OPUS_NUMBER`...) ou busca parcial.
 */
export type ProcessMatchKind = 'CODE' | 'REFERENCE' | ProcessIdentifierKind | 'PARTIAL';

export interface ProcessMatch {
  process: ProcessListItem;
  matchedBy: ProcessMatchKind;
  /** Qual dos `refs` casou; `null` na busca só por empresa. */
  ref: string | null;
}

export interface LookupProcessQuery {
  /**
   * Código, referência ou identificadores do embarque, do mais específico
   * para o menos — vários numa chamada só, em vez de uma por identificador.
   */
  refs?: readonly string[] | undefined;
  companyDocument?: string | undefined;
  limit: number;
}

/** O intake é interno (OPERATIONAL/ADMIN via chave de API): escopo sempre ALL. */
const ALL: AccessScope = { kind: 'ALL' };

function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at === -1) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain.length > 0 ? domain : null;
}

/**
 * Onde começa o histórico citado num corpo em texto — cabeçalhos de resposta
 * do Outlook/Gmail em português, inglês e espanhol e o separador de linha do
 * Outlook. Cortar ali mantém só a mensagem nova: é o que o agente precisa
 * ler, e o que cabe na execução (docs/13, decisão 9).
 */
const QUOTED_HISTORY_MARKERS: RegExp[] = [
  /^\s*(De|From|Von|Da):\s.+$/m,
  /^\s*-{3,}\s*(Mensagem original|Original Message|Mensaje original)\s*-{3,}/im,
  /^\s*_{10,}\s*$/m,
  /^\s*Em .{6,80} escreveu:\s*$/m,
  /^\s*On .{6,80} wrote:\s*$/m,
  /^\s*El .{6,80} escribió:\s*$/m,
];

/** Remove histórico citado, normaliza linhas em branco e limita o tamanho. */
export function cleanBodyText(raw: string, maxChars: number): { text: string; truncated: boolean } {
  let text = raw.replace(/\r\n?/g, '\n');
  let cut = text.length;
  for (const marker of QUOTED_HISTORY_MARKERS) {
    const match = marker.exec(text);
    // Marcador sem texto antes é o próprio e-mail (ex.: encaminhamento), não histórico.
    if (match && match.index < cut && text.slice(0, match.index).trim().length > 0) {
      cut = match.index;
    }
  }
  text = text.slice(0, cut);
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `${text.slice(0, maxChars).trimEnd()}\n[…]`, truncated: true };
}

/** Nome de pasta aceito pelo Exchange: sem `\\ / : * ? " < > |`, sem espaços nas pontas, até 100 caracteres. */
export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .trim();
  return cleaned.length > 0 ? cleaned : 'Sem organização';
}

function senderMatches(from: MailboxMessageSummary['from'], terms: string[]): boolean {
  const haystack = `${from.email ?? ''} ${from.name ?? ''}`.toLowerCase();
  return terms.some((term) => term.length > 0 && haystack.includes(term));
}

function formatSaoPaulo(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Identificadores da referência + os informados explicitamente, classificados pelo formato (docs/15). */
function identifiersFromInput(
  reference: string,
  explicit: string[] | null | undefined,
): ProcessIdentifierInput[] {
  const out = reference.length > 0 ? extractIdentifierCandidates(reference) : [];
  const seen = new Set(out.map((item) => normalizeIdentifier(item.value)));
  for (const raw of explicit ?? []) {
    const value = raw.trim();
    const normalized = normalizeIdentifier(value);
    if (normalized.length < 4 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push({ kind: classifyIdentifier(value), value });
  }
  return out;
}

/** Forma reduzida de um candidato, para o `details` de 404/409 e para o lookup (docs/05). */
export function toCandidate(item: ProcessListItem): {
  id: string;
  code: string;
  reference: string;
  clientCompany: { id: string; cnpj: string | null; legalName: string };
  currentStage: string;
  createdAt: string;
} {
  return {
    id: item.id,
    code: item.code,
    reference: item.reference,
    clientCompany: {
      id: item.clientCompany.id,
      cnpj: item.clientCompany.cnpj,
      legalName: item.clientCompany.legalName,
    },
    currentStage: item.currentStage.name,
    createdAt: item.createdAt.toISOString(),
  };
}

/**
 * Alimentação de processos por IA a partir de e-mails (docs/13). Orquestra
 * os services existentes (`ProcessService`, `DocumentService`) e os
 * repositórios de cadastro; não reimplementa regra de processo — só
 * acrescenta o que é específico do canal: idempotência por mensagem
 * (decisão 4), cadastro automático de empresa/organização (decisão 5),
 * resolução de "Processo X" citado no e-mail (decisão 6) e anexos
 * baixados pelo próprio backend (decisão 3).
 */
export class IntakeService {
  constructor(private readonly deps: IntakeServiceDeps) {}

  async createProcessFromEmail(
    actorId: string,
    input: CreateProcessIntakeInput,
  ): Promise<IntakeResult> {
    const claim = await this.claim(actorId, input.source, input.requester, 'PROCESS');
    if (claim.kind === 'duplicate') return claim.result;

    const { event, resumeProcessId } = claim;
    const warnings: string[] = [];

    try {
      // Anexos antes de qualquer escrita: uma falha do Graph não pode deixar
      // processo sem documento (docs/13, decisão 4).
      const fetched = await this.fetchAttachmentsIfRequested(input, warnings);
      const files = [...input.files, ...fetched].map((file) => ({
        ...file,
        receivedAt: file.receivedAt ?? input.source.receivedAt,
      }));

      let processId = resumeProcessId;
      let companyOutcome: IntakeResult['company'] = null;
      let organizationOutcome: IntakeResult['organization'] = null;

      if (!processId) {
        const client = await this.resolveCompany(input.company, input.requester.email, warnings);
        companyOutcome = { id: client.company.id, created: client.created };
        organizationOutcome = client.organization;

        let requestingCompanyId: string | null = null;
        if (input.requestingCompany) {
          const requesting = await this.resolveCompany(
            input.requestingCompany,
            input.requester.email,
            warnings,
          );
          requestingCompanyId = requesting.company.id;
        }

        const identifiers = identifiersFromInput(input.reference, input.identifiers);

        // Um processo por embarque (docs/13, decisão 11): se a mesma empresa
        // já tem processo com um destes identificadores (aberto por e-mail
        // anterior ou espelhado do iLog), este e-mail complementa aquele.
        const existing = client.created
          ? null
          : await this.findExistingForCompany(identifiers, client.company.id);
        if (existing) {
          processId = existing.id;
          warnings.push(
            `Já existia o processo ${existing.code} (${existing.reference}) desta empresa com o mesmo identificador: e-mail anexado a ele em vez de abrir outro.`,
          );
          await this.deps.processIdentifierRepository.addForProcess(
            processId,
            'EMAIL',
            identifiers,
          );
          await this.deps.intakeEventRepository.update(event.id, {
            processId,
            kind: 'ATTACHMENT',
          });
          if (input.additionalInfo) {
            await this.appendNote(processId, actorId, {
              source: input.source,
              requester: input.requester,
              note: input.additionalInfo,
              fetchAttachments: false,
              files: [],
            });
          }
        } else {
          const created = await this.deps.processService.create(actorId, ALL, {
            clientCompanyId: client.company.id,
            requestingCompanyId,
            reference: input.reference,
            additionalInfo: input.additionalInfo ?? null,
            source: 'EMAIL',
            requester: { name: input.requester.name ?? null, email: input.requester.email },
            receivedAt: input.source.receivedAt,
            identifiers,
          });
          processId = created.id;
          // Grava o vínculo já: se o upload falhar, a retomada anexa a este processo.
          await this.deps.intakeEventRepository.update(event.id, { processId });
        }
      } else {
        warnings.push(
          `Execução anterior falhou depois de criar o processo; documentos anexados ao processo existente.`,
        );
      }

      const documentIds = await this.uploadFiles(processId, actorId, files);
      await this.organizeMessage(input.source, processId, warnings);

      return this.complete(event, processId, {
        documentIds,
        warnings,
        company: companyOutcome,
        organization: organizationOutcome,
        reason: null,
      });
    } catch (error) {
      await this.fail(event, error);
      throw error;
    }
  }

  async attachToProcess(actorId: string, input: AttachIntakeInput): Promise<IntakeResult> {
    const claim = await this.claim(actorId, input.source, input.requester, 'ATTACHMENT');
    if (claim.kind === 'duplicate') return claim.result;

    const { event, resumeProcessId } = claim;
    const warnings: string[] = [];

    try {
      const processId = resumeProcessId ?? (await this.resolveTargetProcess(input));
      await this.deps.intakeEventRepository.update(event.id, { processId });

      const fetched = await this.fetchAttachmentsIfRequested(input, warnings);
      const files = [...input.files, ...fetched].map((file) => ({
        ...file,
        receivedAt: file.receivedAt ?? input.source.receivedAt,
      }));

      if (files.length === 0 && !input.note && !(input.addReferences?.length ?? 0)) {
        throw new ValidationError('Nada a anexar: informe arquivos, fetchAttachments ou uma nota.');
      }

      const documentIds = await this.uploadFiles(processId, actorId, files);

      if (input.note) {
        await this.appendNote(processId, actorId, input);
      }
      if (input.addReferences && input.addReferences.length > 0) {
        await this.appendReferences(processId, actorId, input.addReferences, warnings);
      }
      await this.organizeMessage(input.source, processId, warnings);

      return this.complete(event, processId, {
        documentIds,
        warnings,
        company: null,
        organization: null,
        reason: null,
      });
    } catch (error) {
      await this.fail(event, error);
      throw error;
    }
  }

  /**
   * Candidatos para o agente conferir antes de decidir entre abrir e
   * complementar (docs/13, decisão 6). `refs` vêm do mais específico para
   * o menos; vale o primeiro que casar exato (código, referência ou índice
   * de identificadores). O iLog só é consultado se nenhum casar no índice
   * local — na mesma ordem, parando no primeiro que achar —, para não ir
   * ao iLog pelo número da Opus quando o HBL já está aqui. Parciais
   * completam a lista: do ref que casou, ou de todos se nenhum casou.
   * Opcionalmente restritos ao documento da empresa.
   */
  async lookupProcess(query: LookupProcessQuery): Promise<ProcessMatch[]> {
    const refs = [
      ...new Set((query.refs ?? []).map((ref) => ref.trim()).filter((ref) => ref.length > 0)),
    ];
    const companyDigits = query.companyDocument ? normalizeCnpjDigits(query.companyDocument) : null;
    const matches: ProcessMatch[] = [];
    const seen = new Set<string>();

    const push = (item: ProcessListItem, matchedBy: ProcessMatchKind, ref: string | null): void => {
      if (seen.has(item.id)) return;
      if (companyDigits && item.clientCompany.cnpj !== companyDigits) return;
      seen.add(item.id);
      matches.push({ process: item, matchedBy, ref });
    };

    if (refs.length > 0) {
      let matchedRef: string | null = null;
      for (const ref of refs) {
        const before = matches.length;
        for (const item of await this.deps.processRepository.findExactByRef(ref)) {
          push(item, item.code.toUpperCase() === ref.toUpperCase() ? 'CODE' : 'REFERENCE', ref);
        }
        for (const match of await this.matchByIdentifier(ref, false)) {
          push(match.process, match.kind, ref);
        }
        if (matches.length > before) {
          matchedRef = ref;
          break;
        }
      }
      // Retaguarda B do docs/15: um identificador por vez, até o iLog achar.
      if (matchedRef === null && this.deps.ilogSyncService) {
        for (const ref of refs) {
          const before = matches.length;
          for (const match of await this.matchByIdentifier(ref, true)) {
            push(match.process, match.kind, ref);
          }
          if (matches.length > before) {
            matchedRef = ref;
            break;
          }
        }
      }
      for (const ref of matchedRef === null ? refs : [matchedRef]) {
        if (matches.length >= query.limit) break;
        const partial = await this.deps.processRepository.list(
          { q: ref },
          ALL,
          { page: 1, pageSize: query.limit },
          { field: 'createdAt', order: 'desc' },
        );
        for (const item of partial.items) push(item, 'PARTIAL', ref);
      }
    } else if (companyDigits) {
      const company = await this.deps.companyRepository.findByCnpj(companyDigits);
      if (company) {
        const page = await this.deps.processRepository.list(
          { clientCompanyId: company.id },
          ALL,
          { page: 1, pageSize: query.limit },
          { field: 'createdAt', order: 'desc' },
        );
        for (const item of page.items) push(item, 'PARTIAL', null);
      }
    }

    return matches.slice(0, query.limit);
  }

  /**
   * Se a retaguarda do iLog está respondendo: `null` = desligada
   * (`ILOG_SYNC_ENABLED=false`); `false` = em pausa por falha recente. Com
   * `false`, um lookup sem resultado não prova que o processo não existe — o
   * agente registra o "sem processo" dizendo isso (docs/13, decisão 13).
   */
  ilogLookupAvailable(): boolean | null {
    return this.deps.ilogSyncService ? this.deps.ilogSyncService.isLookupAvailable() : null;
  }

  async listEvents(
    filters: IntakeEventFilters,
    pagination: PaginationParams,
  ): Promise<Page<IntakeEvent>> {
    return this.deps.intakeEventRepository.list(filters, pagination);
  }

  /**
   * Caixa de entrada desde `after`, já sem os remetentes bloqueados (docs/13,
   * decisão 9). `nextAfter` é o `receivedAt` da última mensagem que o
   * provedor devolveu — bloqueada ou não — porque o cursor tem de passar
   * também pelo que foi descartado. Cada mensagem vem com o evento de intake
   * que já tiver (por `externalId` ou `internetMessageId`): a rotina pula o
   * que já foi tratado sem uma consulta por e-mail.
   */
  async listMailbox(input: ListMailboxInput): Promise<ListMailboxResult> {
    const reader = this.requireMailboxReader();
    const outcome = await reader.listMessages({ after: input.after, limit: input.limit });
    if (outcome.kind === 'UNAVAILABLE') {
      throw new AppError('MAIL_UNAVAILABLE', outcome.reason, 503);
    }
    const terms = input.excludeSenders.map((term) => term.trim().toLowerCase());
    const kept = outcome.messages.filter((message) => !senderMatches(message.from, terms));
    const events =
      kept.length === 0
        ? []
        : await this.deps.intakeEventRepository.findByMessages(
            'EMAIL',
            kept.map((message) => message.id),
            kept.flatMap((message) =>
              message.internetMessageId ? [message.internetMessageId] : [],
            ),
          );
    const byExternalId = new Map(events.map((event) => [event.externalId, event]));
    const byInternetMessageId = new Map(
      events.flatMap((event) =>
        event.internetMessageId ? [[event.internetMessageId, event] as const] : [],
      ),
    );
    const last = outcome.messages[outcome.messages.length - 1];
    return {
      messages: kept.map((message) => {
        const event =
          byExternalId.get(message.id) ??
          (message.internetMessageId
            ? byInternetMessageId.get(message.internetMessageId)
            : undefined);
        return {
          ...message,
          intake: event
            ? {
                eventId: event.id,
                status: event.status,
                kind: event.kind,
                processId: event.processId,
              }
            : null,
        };
      }),
      listed: outcome.messages.length,
      blocked: outcome.messages.length - kept.length,
      nextAfter: last ? last.receivedAt : null,
      hasMore: outcome.hasMore,
    };
  }

  /** Detalhe com o corpo limpo (sem histórico citado) e limitado a `maxChars`. */
  async getMailboxMessage(messageId: string, maxChars: number): Promise<MailboxMessageView> {
    const reader = this.requireMailboxReader();
    const outcome = await reader.getMessage(messageId);
    if (outcome.kind === 'MESSAGE_NOT_FOUND') {
      throw new NotFoundError(
        'MAIL_MESSAGE_NOT_FOUND',
        'Mensagem não encontrada na caixa de e-mail configurada.',
      );
    }
    if (outcome.kind === 'UNAVAILABLE') {
      throw new AppError('MAIL_UNAVAILABLE', outcome.reason, 503);
    }
    const message = outcome.message;
    const body = cleanBodyText(message.bodyText, maxChars);
    return {
      id: message.id,
      internetMessageId: message.internetMessageId,
      subject: message.subject,
      from: message.from,
      to: message.to,
      cc: message.cc,
      receivedAt: message.receivedAt,
      hasAttachments: message.hasAttachments,
      attachments: message.attachments.filter((attachment) => !attachment.isInline),
      bodyText: body.text,
      bodyTruncated: body.truncated,
    };
  }

  private requireMailboxReader(): MailboxReader {
    if (!this.deps.mailboxReader) {
      throw new AppError(
        'MAIL_READ_DISABLED',
        'A leitura da caixa pelo servidor está desabilitada (GRAPH_INTAKE_ENABLED=false).',
        503,
      );
    }
    return this.deps.mailboxReader;
  }

  /**
   * Registra um e-mail descartado ou escalado (docs/13, decisão 9). Sem
   * isso o cursor não passaria por ele e a próxima execução o releria.
   * Nunca sobrescreve um desfecho real: mensagem já COMPLETED (processo
   * criado/complementado, ou já pulada) responde `duplicate: true`.
   */
  async skipEmail(actorId: string, input: SkipIntakeInput): Promise<SkipIntakeResult> {
    const outcome = await this.deps.intakeEventRepository.claim({
      channel: input.source.channel,
      externalId: input.source.externalId,
      internetMessageId: input.source.internetMessageId ?? null,
      kind: input.outcome,
      status: 'PROCESSING',
      subject: input.source.subject ?? null,
      requesterName: input.requester?.name ?? null,
      requesterEmail: input.requester?.email ?? null,
      receivedAt: input.source.receivedAt,
      createdById: actorId,
    });

    let eventId: string;
    if (outcome.created) {
      eventId = outcome.event.id;
    } else if (outcome.existing.status === 'COMPLETED') {
      return { event: outcome.existing, duplicate: true };
    } else if (outcome.existing.status === 'PROCESSING') {
      throw new ConflictError(
        'INTAKE_IN_PROGRESS',
        'Esta mensagem está sendo processada por outra execução. Tente novamente em instantes.',
        { eventId: outcome.existing.id },
      );
    } else {
      // FAILED: o agente desistiu de retomar (ex.: PROCESS_REF_NOT_FOUND sem
      // candidato) e está escalando. O evento passa a refletir isso.
      eventId = outcome.existing.id;
    }

    const event = await this.deps.intakeEventRepository.update(eventId, {
      kind: input.outcome,
      status: 'COMPLETED',
      errorMessage: null,
      ...(outcome.created || outcome.existing.externalId === input.source.externalId
        ? {}
        : { externalId: input.source.externalId }),
      result: {
        documentIds: [],
        warnings: [],
        company: null,
        organization: null,
        reason: input.reason.trim().slice(0, 1000),
      },
    });
    return { event, duplicate: false };
  }

  /**
   * Descarte em lote (docs/13, decisão 9): a rotina decide um e-mail por
   * vez, mas registra os descartes da página numa chamada só. Cada item é
   * um `skipEmail` independente, em ordem; erro de domínio de um item (ex.:
   * `INTAKE_IN_PROGRESS`) vira o resultado daquele item, sem derrubar os
   * outros. Erro inesperado (banco fora) propaga — repetir o lote é seguro,
   * porque o skip é idempotente.
   */
  async skipEmails(
    actorId: string,
    inputs: readonly SkipIntakeInput[],
  ): Promise<SkipBatchItemResult[]> {
    const results: SkipBatchItemResult[] = [];
    for (const input of inputs) {
      const externalId = input.source.externalId;
      try {
        results.push({ externalId, ok: true, ...(await this.skipEmail(actorId, input)) });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        results.push({
          externalId,
          ok: false,
          error: { code: error.code, message: error.message },
        });
      }
    }
    return results;
  }

  /**
   * Cursor de leitura (docs/13, decisão 9): a rotina lista a caixa só a
   * partir daqui. Vale o ponteiro gravado por `advanceCursor` (o agente
   * avança a cada página, e remetentes bloqueados passam sem evento); sem
   * ponteiro gravado, deduz do último evento COMPLETED/FAILED — o que
   * havia antes de o cursor ser persistido. A retentativa de FAILED não é
   * pelo cursor, e sim pela lista `status=FAILED`.
   */
  async getCursor(channel: IntakeChannel): Promise<IntakeCursor> {
    const stored = await this.deps.intakeCursorRepository.get(channel);
    if (stored) {
      return {
        channel,
        receivedAt: stored.receivedAt,
        externalId: stored.externalId,
        source: 'STORED',
      };
    }
    const event = await this.deps.intakeEventRepository.findLatestReceived(channel, [
      'COMPLETED',
      'FAILED',
    ]);
    if (event?.receivedAt) {
      return {
        channel,
        receivedAt: event.receivedAt,
        externalId: event.externalId,
        source: 'EVENTS',
      };
    }
    return { channel, receivedAt: null, externalId: null, source: 'NONE' };
  }

  /**
   * Avança o ponteiro. Monotônico em relação ao ponteiro **gravado**: um
   * valor mais antigo é ignorado (`advanced: false`) — protege de uma
   * execução atrasada gravar por cima de uma mais nova. O valor deduzido
   * dos eventos não entra na comparação: é só o ponto de partida antes da
   * primeira gravação. Rebobinar de propósito é operação de administração
   * direta no banco, não da API.
   */
  async advanceCursor(input: AdvanceCursorInput): Promise<AdvanceCursorResult> {
    const current = await this.deps.intakeCursorRepository.get(input.channel);
    if (current && input.receivedAt.getTime() <= current.receivedAt.getTime()) {
      return {
        cursor: {
          channel: input.channel,
          receivedAt: current.receivedAt,
          externalId: current.externalId,
          source: 'STORED',
        },
        advanced: false,
      };
    }
    const stored = await this.deps.intakeCursorRepository.set(
      input.channel,
      input.receivedAt,
      input.externalId ?? null,
    );
    return {
      cursor: {
        channel: input.channel,
        receivedAt: stored.receivedAt,
        externalId: stored.externalId,
        source: 'STORED',
      },
      advanced: true,
    };
  }

  // ── Idempotência (docs/13, decisão 4) ─────────────────────────────

  private async claim(
    actorId: string,
    source: IntakeSource,
    requester: IntakeRequester,
    kind: IntakeEventKind,
  ): Promise<
    | { kind: 'claimed'; event: IntakeEvent; resumeProcessId: string | null }
    | { kind: 'duplicate'; result: IntakeResult }
  > {
    const outcome = await this.deps.intakeEventRepository.claim({
      channel: source.channel,
      externalId: source.externalId,
      internetMessageId: source.internetMessageId ?? null,
      kind,
      status: 'PROCESSING',
      subject: source.subject ?? null,
      requesterName: requester.name ?? null,
      requesterEmail: requester.email,
      receivedAt: source.receivedAt,
      createdById: actorId,
    });

    if (outcome.created) {
      return { kind: 'claimed', event: outcome.event, resumeProcessId: null };
    }

    const existing = outcome.existing;
    if (existing.status === 'COMPLETED' && existing.processId) {
      return { kind: 'duplicate', result: await this.resultFromCompletedEvent(existing) };
    }
    if (existing.status === 'COMPLETED') {
      // IGNORED/ESCALATED (docs/13, decisão 9): o agente mudou de ideia e
      // agora quer processar. Reaproveita o evento como uma retomada.
      const reopened = await this.deps.intakeEventRepository.update(existing.id, {
        status: 'PROCESSING',
        kind,
        result: null,
        ...(existing.externalId !== source.externalId ? { externalId: source.externalId } : {}),
      });
      return { kind: 'claimed', event: reopened, resumeProcessId: null };
    }
    if (existing.status === 'PROCESSING') {
      throw new ConflictError(
        'INTAKE_IN_PROGRESS',
        'Esta mensagem está sendo processada por outra execução. Tente novamente em instantes.',
        { eventId: existing.id },
      );
    }
    // FAILED: retoma. Se um processo já foi criado antes da falha, reaproveita.
    // O id do Graph pode ter mudado (evento achado por internetMessageId) e a
    // ação pode ser outra (ex.: 404 em ATTACHMENT → agente reclassificou como
    // PROCESS): o evento passa a refletir a tentativa atual.
    const resumed = await this.deps.intakeEventRepository.update(existing.id, {
      status: 'PROCESSING',
      errorMessage: null,
      kind,
      ...(existing.externalId !== source.externalId ? { externalId: source.externalId } : {}),
    });
    return { kind: 'claimed', event: resumed, resumeProcessId: existing.processId };
  }

  private async resultFromCompletedEvent(event: IntakeEvent): Promise<IntakeResult> {
    if (!event.processId) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Evento de intake concluído sem processo vinculado.',
        500,
      );
    }
    const process = await this.deps.processRepository.findDetailById(event.processId, ALL);
    if (!process) {
      throw new NotFoundError(
        'NOT_FOUND',
        'O processo criado por esta mensagem não existe mais (excluído).',
        { eventId: event.id, processId: event.processId },
      );
    }
    const documentIds = new Set(event.result?.documentIds ?? []);
    return {
      event,
      duplicate: true,
      process,
      documents: process.documents.filter((doc) => documentIds.has(doc.id)),
      company: event.result?.company ?? null,
      organization: event.result?.organization ?? null,
      warnings: event.result?.warnings ?? [],
    };
  }

  private async complete(
    event: IntakeEvent,
    processId: string,
    result: IntakeEventResult,
  ): Promise<IntakeResult> {
    const updated = await this.deps.intakeEventRepository.update(event.id, {
      status: 'COMPLETED',
      processId,
      result,
      errorMessage: null,
    });
    const process = await this.deps.processRepository.findDetailById(processId, ALL);
    if (!process) {
      throw new AppError('INTERNAL_ERROR', 'Falha ao carregar o processo do intake.', 500);
    }
    const documentIds = new Set(result.documentIds);
    return {
      event: updated,
      duplicate: false,
      process,
      documents: process.documents.filter((doc) => documentIds.has(doc.id)),
      company: result.company,
      organization: result.organization,
      warnings: result.warnings,
    };
  }

  private async fail(event: IntakeEvent, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Erro desconhecido.';
    try {
      await this.deps.intakeEventRepository.update(event.id, {
        status: 'FAILED',
        errorMessage: message.slice(0, 1000),
      });
    } catch {
      // O erro original é o que interessa a quem chamou; não mascarar.
    }
  }

  // ── Anexos (docs/13, decisão 3) ───────────────────────────────────

  private async fetchAttachmentsIfRequested(
    input: { fetchAttachments: boolean; source: IntakeSource },
    warnings: string[],
  ): Promise<UploadFileInput[]> {
    if (!input.fetchAttachments) return [];

    const provider = this.deps.mailAttachmentProvider;
    if (!provider) {
      throw new AppError(
        'MAIL_ATTACHMENTS_DISABLED',
        'A leitura de anexos pelo servidor está desabilitada (GRAPH_INTAKE_ENABLED=false). Envie os arquivos no multipart.',
        503,
      );
    }

    const outcome = await provider.listAttachments(input.source.externalId, {
      internetMessageId: input.source.internetMessageId ?? null,
    });
    switch (outcome.kind) {
      case 'MESSAGE_NOT_FOUND':
        throw new NotFoundError(
          'MAIL_MESSAGE_NOT_FOUND',
          'Mensagem não encontrada na caixa de e-mail configurada.',
        );
      case 'UNAVAILABLE':
        throw new AppError('MAIL_ATTACHMENTS_UNAVAILABLE', outcome.reason, 503);
      case 'OK':
        break;
    }

    const files: UploadFileInput[] = [];
    for (const attachment of outcome.attachments) {
      if (attachment.isInline) {
        continue;
      }
      if (attachment.size > this.deps.maxAttachmentBytes) {
        warnings.push(
          `Anexo "${attachment.name}" ignorado: ${Math.round(attachment.size / 1024 / 1024)}MB excede o limite de upload.`,
        );
        continue;
      }
      files.push({
        originalName: attachment.name,
        mimeType: attachment.mimeType,
        buffer: attachment.content,
        receivedAt: input.source.receivedAt,
      });
    }

    if (files.length === 0) {
      warnings.push('A mensagem não tem anexos de arquivo (só inline ou nenhum).');
    }
    return files;
  }

  private async uploadFiles(
    processId: string,
    actorId: string,
    files: UploadFileInput[],
  ): Promise<string[]> {
    if (files.length === 0) return [];
    const documents = await this.deps.documentService.upload(processId, actorId, ALL, files, {
      source: 'EMAIL',
    });
    return documents.map((doc) => doc.id);
  }

  // ── Empresa / organização (docs/13, decisão 5) ────────────────────

  private async resolveCompany(
    ref: IntakeCompanyRef,
    requesterEmail: string,
    warnings: string[],
  ): Promise<{
    company: Company;
    created: boolean;
    organization: { id: string; created: boolean; domainRegistered: boolean };
  }> {
    const document = ref.document?.trim() ?? '';
    if (document.length === 0) {
      return ref.senderIsClient === false
        ? this.resolveCompanyByName(ref.name ?? null, warnings)
        : this.resolveCompanyByDomain(requesterEmail, ref.name ?? null, warnings);
    }

    const classified = classifyDocument(document);
    if (!classified) {
      const digits = normalizeCnpjDigits(document);
      if (digits.length === 11) {
        throw new AppError('INVALID_CPF', 'CPF com dígitos verificadores inválidos.', 400);
      }
      throw new AppError('INVALID_CNPJ', 'CNPJ com dígitos verificadores inválidos.', 400);
    }

    const existing = await this.deps.companyRepository.findByCnpj(classified.digits);
    if (existing) {
      if (!existing.isActive) {
        // Desativar foi decisão humana; o agente escala em vez de contornar.
        throw new ConflictError(
          'COMPANY_INACTIVE',
          `A empresa ${formatDocument(classified.digits)} está inativa no sistema.`,
          { companyId: existing.id },
        );
      }
      return {
        company: existing,
        created: false,
        organization: { id: existing.organizationId, created: false, domainRegistered: false },
      };
    }

    const legalName = await this.resolveLegalName(classified, ref.name ?? null, warnings);
    const organization = await this.resolveOrganization(requesterEmail, legalName, warnings);

    // A organização do domínio pode ter uma empresa em cadastro pendente
    // (criada por um e-mail anterior sem CNPJ, decisão 10): este e-mail
    // trouxe o documento, então conclui aquele cadastro em vez de criar uma
    // segunda empresa para o mesmo cliente.
    if (!organization.created) {
      const pending = await this.deps.companyRepository.list(
        { organizationId: organization.id, isActive: true, pendingRegistration: true },
        { page: 1, pageSize: 2 },
      );
      const only = pending.items.length === 1 ? pending.items[0] : undefined;
      if (only) {
        const completed = await this.deps.companyRepository.update(only.id, {
          cnpj: classified.digits,
          documentType: classified.kind,
          legalName,
        });
        warnings.push(
          `Cadastro pendente de "${only.legalName}" concluído com ${formatDocument(classified.digits)} (${legalName}).`,
        );
        return { company: completed, created: false, organization };
      }
    }

    const company = await this.deps.companyRepository.create({
      cnpj: classified.digits,
      documentType: classified.kind,
      legalName,
      tradeName: null,
      organizationId: organization.id,
    });
    warnings.push(
      `Empresa ${formatDocument(classified.digits)} (${company.legalName}) cadastrada automaticamente.`,
    );

    return { company, created: true, organization };
  }

  /**
   * Sem CNPJ no e-mail, a empresa vem do domínio do solicitante (docs/13,
   * decisão 10): o domínio aponta a organização e a organização tem as
   * empresas. Uma empresa ativa resolve sozinha; várias exigem o nome
   * (assinatura) ou o documento. Domínio corporativo ainda desconhecido, ou
   * conhecido mas sem empresa, **não bloqueia**: cria a empresa em
   * "cadastro pendente" (sem CNPJ) para o processo abrir e a origem ficar
   * registrada; alguém completa o CNPJ depois. Só webmail público (um
   * `@gmail.com` não identifica empresa nenhuma) responde `COMPANY_REQUIRED`.
   */
  private async resolveCompanyByDomain(
    requesterEmail: string,
    nameHint: string | null,
    warnings: string[],
  ): Promise<{
    company: Company;
    created: boolean;
    organization: { id: string; created: boolean; domainRegistered: boolean };
  }> {
    const domain = emailDomainOf(requesterEmail);
    if (!domain || PUBLIC_WEBMAIL_DOMAINS.has(domain)) {
      throw new AppError(
        'COMPANY_REQUIRED',
        `Sem CNPJ/CPF no e-mail e o remetente (${requesterEmail}) não tem domínio corporativo: não dá para identificar a empresa. Informe company.document.`,
        400,
        { domain },
      );
    }

    const name = nameHint?.trim() || domain;
    const organization = await this.resolveOrganization(requesterEmail, name, warnings);
    const page = organization.created
      ? { items: [] as Company[] }
      : await this.deps.companyRepository.list(
          { organizationId: organization.id, isActive: true },
          { page: 1, pageSize: 50 },
        );
    let candidates = page.items;
    if (candidates.length === 0) {
      const company = await this.deps.companyRepository.create({
        cnpj: null,
        documentType: null,
        legalName: name,
        tradeName: null,
        organizationId: organization.id,
      });
      warnings.push(
        `Sem CNPJ/CPF no e-mail: empresa "${name}" criada em cadastro pendente pelo domínio ${domain}. Complete o CNPJ na tela de empresas.`,
      );
      return { company, created: true, organization };
    }

    if (candidates.length > 1 && nameHint) {
      const hint = nameHint.trim().toLowerCase();
      const byName = candidates.filter(
        (company) =>
          company.legalName.toLowerCase().includes(hint) ||
          (company.tradeName?.toLowerCase().includes(hint) ?? false),
      );
      if (byName.length === 1) candidates = byName;
    }
    if (candidates.length > 1) {
      throw new ConflictError(
        'COMPANY_AMBIGUOUS',
        `Mais de uma empresa ativa para o domínio ${domain}. Informe company.document.`,
        {
          candidates: candidates.map((company) => ({
            id: company.id,
            cnpj: company.cnpj,
            legalName: company.legalName,
            tradeName: company.tradeName,
          })),
        },
      );
    }

    const company = candidates[0];
    if (!company) {
      throw new AppError('INTERNAL_ERROR', 'Falha ao resolver empresa pelo domínio.', 500);
    }
    warnings.push(
      company.cnpj
        ? `Sem CNPJ/CPF no e-mail: empresa ${formatDocument(company.cnpj)} (${company.legalName}) resolvida pelo domínio ${domain} do solicitante.`
        : `Sem CNPJ/CPF no e-mail: empresa "${company.legalName}" (cadastro pendente) resolvida pelo domínio ${domain}. Complete o CNPJ na tela de empresas.`,
    );
    return { company, created: false, organization };
  }

  /**
   * Remetente terceiro (agente, armador, despachante) sem CNPJ do cliente
   * (docs/13, decisão 11): o cliente é identificado só pelo nome que o
   * e-mail traz ("Cnee: PROMEDON"). Uma empresa com esse nome → usa; várias
   * → ambíguo; nenhuma → organização + empresa pendentes com esse nome, sem
   * domínio nenhum — o domínio do remetente é do terceiro.
   */
  private async resolveCompanyByName(
    name: string | null,
    warnings: string[],
  ): Promise<{
    company: Company;
    created: boolean;
    organization: { id: string; created: boolean; domainRegistered: boolean };
  }> {
    const hint = name?.trim() ?? '';
    if (hint.length < 3) {
      throw new AppError(
        'COMPANY_REQUIRED',
        'Remetente terceiro sem CNPJ/CPF nem nome do cliente: informe company.name (razão social como aparece no e-mail) ou company.document.',
        400,
      );
    }

    const page = await this.deps.companyRepository.list(
      { q: hint, isActive: true },
      { page: 1, pageSize: 50 },
    );
    const lowered = hint.toLowerCase();
    const candidates = page.items.filter(
      (company) =>
        company.legalName.toLowerCase().includes(lowered) ||
        (company.tradeName?.toLowerCase().includes(lowered) ?? false),
    );
    if (candidates.length > 1) {
      throw new ConflictError(
        'COMPANY_AMBIGUOUS',
        `Mais de uma empresa corresponde a "${hint}". Informe company.document.`,
        {
          candidates: candidates.map((company) => ({
            id: company.id,
            cnpj: company.cnpj,
            legalName: company.legalName,
            tradeName: company.tradeName,
          })),
        },
      );
    }
    const found = candidates[0];
    if (found) {
      warnings.push(
        `Sem CNPJ/CPF no e-mail (remetente terceiro): empresa "${found.legalName}" resolvida pelo nome.`,
      );
      return {
        company: found,
        created: false,
        organization: { id: found.organizationId, created: false, domainRegistered: false },
      };
    }

    const organization = await this.deps.organizationRepository.create({
      name: hint,
      isInternal: false,
    });
    const company = await this.deps.companyRepository.create({
      cnpj: null,
      documentType: null,
      legalName: hint,
      tradeName: null,
      organizationId: organization.id,
    });
    warnings.push(
      `Sem CNPJ/CPF no e-mail (remetente terceiro): organização e empresa "${hint}" criadas em cadastro pendente, sem domínio. Complete o CNPJ na tela de empresas.`,
    );
    return {
      company,
      created: true,
      organization: { id: organization.id, created: true, domainRegistered: false },
    };
  }

  private async resolveLegalName(
    classified: { kind: 'CNPJ' | 'CPF'; digits: string },
    providedName: string | null,
    warnings: string[],
  ): Promise<string> {
    const trimmedProvided = providedName?.trim() ?? '';

    if (classified.kind === 'CNPJ' && this.deps.cnpjLookupProvider) {
      const outcome = await this.deps.cnpjLookupProvider.lookup(classified.digits);
      if (outcome.kind === 'FOUND') {
        return outcome.data.legalName;
      }
      if (outcome.kind === 'NOT_FOUND') {
        warnings.push(`CNPJ ${formatDocument(classified.digits)} não consta na base da Receita.`);
      } else {
        warnings.push('Consulta à Receita indisponível; razão social veio do e-mail.');
      }
    }

    if (trimmedProvided.length > 0) {
      return trimmedProvided;
    }

    warnings.push(
      `Sem razão social para ${formatDocument(classified.digits)}: cadastrada com o próprio documento como nome. Corrija no cadastro de empresas.`,
    );
    return `${classified.kind} ${formatDocument(classified.digits)}`;
  }

  private async resolveOrganization(
    requesterEmail: string,
    companyName: string,
    warnings: string[],
  ): Promise<{ id: string; created: boolean; domainRegistered: boolean }> {
    const domain = emailDomainOf(requesterEmail);

    if (domain) {
      const known = await this.deps.emailDomainRepository.findByDomain(domain);
      if (known) {
        return { id: known.organizationId, created: false, domainRegistered: false };
      }
    }

    const organization = await this.deps.organizationRepository.create({
      name: companyName,
      isInternal: false,
    });
    warnings.push(`Organização "${organization.name}" criada automaticamente.`);

    let domainRegistered = false;
    if (domain && !PUBLIC_WEBMAIL_DOMAINS.has(domain)) {
      // autoApprove = false: agrupa as filiais que vierem depois sem conceder
      // acesso a ninguém — quem logar por este domínio entra PENDING.
      await this.deps.emailDomainRepository.create({
        domain,
        organizationId: organization.id,
        defaultRole: 'CLIENT',
        autoApprove: false,
      });
      domainRegistered = true;
      warnings.push(
        `Domínio ${domain} vinculado à organização "${organization.name}" sem aprovação automática.`,
      );
    }

    return { id: organization.id, created: true, domainRegistered };
  }

  // ── Resolução de processo (docs/13, decisão 6) ────────────────────

  private async resolveTargetProcess(input: AttachIntakeInput): Promise<string> {
    if (input.processId) {
      const process = await this.deps.processRepository.findRawById(input.processId, ALL);
      if (!process) {
        throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
      }
      return process.id;
    }

    const ref = input.processRef?.trim();
    if (!ref) {
      throw new ValidationError('Informe processRef ou processId.');
    }

    const exact = await this.deps.processRepository.findExactByRef(ref);

    const byCode = exact.filter((item) => item.code.toUpperCase() === ref.toUpperCase());
    if (byCode.length === 1 && byCode[0]) return byCode[0].id;

    const byReference = exact.filter((item) => item.code.toUpperCase() !== ref.toUpperCase());
    if (byReference.length === 1 && byReference[0]) return byReference[0].id;

    if (byReference.length > 1) {
      const narrowed = await this.narrowByRequesterOrganization(byReference, input.requester.email);
      if (narrowed.length === 1 && narrowed[0]) return narrowed[0].id;
      throw new ConflictError(
        'PROCESS_REF_AMBIGUOUS',
        `Mais de um processo corresponde a "${ref}". Escolha um e chame de novo com processId.`,
        { candidates: (narrowed.length > 0 ? narrowed : byReference).map(toCandidate) },
      );
    }

    // Índice de identificadores (docs/15) e, se preciso, o iLog.
    const indexed = (await this.matchByIdentifier(ref, true)).map((match) => match.process);
    if (indexed.length === 1 && indexed[0]) return indexed[0].id;
    if (indexed.length > 1) {
      const narrowed = await this.narrowByRequesterOrganization(indexed, input.requester.email);
      if (narrowed.length === 1 && narrowed[0]) return narrowed[0].id;
      throw new ConflictError(
        'PROCESS_REF_AMBIGUOUS',
        `Mais de um processo tem o identificador "${ref}". Escolha um e chame de novo com processId.`,
        { candidates: (narrowed.length > 0 ? narrowed : indexed).map(toCandidate) },
      );
    }

    const partial = await this.deps.processRepository.list(
      { q: ref },
      ALL,
      { page: 1, pageSize: 5 },
      { field: 'createdAt', order: 'desc' },
    );
    throw new NotFoundError(
      'PROCESS_REF_NOT_FOUND',
      `Nenhum processo com código ou referência "${ref}".`,
      { candidates: partial.items.map(toCandidate) },
    );
  }

  /** Desempate: fica com os processos cujo CNPJ cliente pertence à organização do domínio do solicitante. */
  private async narrowByRequesterOrganization(
    candidates: ProcessListItem[],
    requesterEmail: string,
  ): Promise<ProcessListItem[]> {
    const domain = emailDomainOf(requesterEmail);
    if (!domain) return [];
    const known = await this.deps.emailDomainRepository.findByDomain(domain);
    if (!known) return [];

    const companies = await this.deps.companyRepository.findManyByIds(
      candidates.map((item) => item.clientCompany.id),
    );
    const inOrganization = new Set(
      companies
        .filter((company) => company.organizationId === known.organizationId)
        .map((company) => company.id),
    );
    return candidates.filter((item) => inOrganization.has(item.clientCompany.id));
  }

  // ── Cópia do e-mail para a pasta da organização (docs/13, decisão 12) ─

  /**
   * Best-effort: o processo já está gravado; uma falha aqui (permissão,
   * Graph fora) vira aviso no resultado e no evento, nunca erro.
   */
  private async organizeMessage(
    source: IntakeSource,
    processId: string,
    warnings: string[],
  ): Promise<void> {
    const organizer = this.deps.mailboxOrganizer;
    if (!organizer) return;

    const process = await this.deps.processRepository.findRawById(processId, ALL);
    const company = process
      ? await this.deps.companyRepository.findById(process.clientCompanyId)
      : null;
    const organization = company
      ? await this.deps.organizationRepository.findById(company.organizationId)
      : null;
    const folderName = sanitizeFolderName(
      organization?.name ?? company?.legalName ?? 'Sem organização',
    );

    try {
      const outcome = await organizer.copyMessageToFolder(source.externalId, [
        this.deps.organizeFolder,
        folderName,
      ]);
      switch (outcome.kind) {
        case 'OK':
          return;
        case 'FORBIDDEN':
          warnings.push(
            `E-mail não copiado para "${this.deps.organizeFolder}/${folderName}": o app não tem permissão de escrita na caixa (Application Mail.ReadWrite).`,
          );
          return;
        case 'MESSAGE_NOT_FOUND':
          warnings.push(`E-mail não copiado para a pasta: mensagem não encontrada na caixa.`);
          return;
        case 'UNAVAILABLE':
          warnings.push(`E-mail não copiado para a pasta: ${outcome.reason}`);
          return;
      }
    } catch (error) {
      warnings.push(
        `E-mail não copiado para a pasta: ${error instanceof Error ? error.message : 'erro desconhecido'}.`,
      );
    }
  }

  // ── Identificadores novos na referência (docs/13, decisão 11) ─────

  private async appendReferences(
    processId: string,
    actorId: string,
    references: string[],
    warnings: string[],
  ): Promise<void> {
    const current = await this.deps.processRepository.findRawById(processId, ALL);
    if (!current) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }
    let reference = current.reference;
    const lowered = (): string => reference.toLowerCase();
    for (const raw of references) {
      const candidate = raw.trim();
      if (candidate.length < 3 || lowered().includes(candidate.toLowerCase())) continue;
      const next = `${reference} / ${candidate}`;
      if (next.length > 255) {
        warnings.push(`Referência cheia: "${candidate}" não coube em ${current.code}.`);
        continue;
      }
      reference = next;
    }
    if (reference !== current.reference) {
      await this.deps.processService.update(processId, actorId, ALL, {
        reference,
        identifierSource: 'EMAIL',
      });
    }
    // O índice recebe todos, coubessem ou não na referência (docs/15).
    await this.deps.processIdentifierRepository.addForProcess(
      processId,
      'EMAIL',
      identifiersFromInput('', references),
    );
  }

  // ── Índice de identificadores (docs/15) ───────────────────────────

  /**
   * Processos ativos com `ref` no índice (exato por normalizado). Sem
   * resultado e com `consultIlog`, pergunta ao iLog uma vez — só para o que
   * parece identificador (tem dígito e tamanho mínimo), nunca para nomes.
   */
  private async matchByIdentifier(
    ref: string,
    consultIlog: boolean,
  ): Promise<{ process: ProcessListItem; kind: ProcessIdentifierKind }[]> {
    const normalized = normalizeIdentifier(ref);
    if (normalized.length < 4 || !/\d/.test(normalized)) return [];

    const found = await this.matchIndex(normalized);
    if (found.length > 0 || !consultIlog || !this.deps.ilogSyncService) return found;

    const imported = await this.deps.ilogSyncService.importByIdentifier(ref);
    if (imported.length === 0) return [];
    const indexed = await this.matchIndex(normalized);
    if (indexed.length > 0) return indexed;
    // O iLog achou, mas o índice ainda não reflete (ex.: casamento por
    // número parcial): devolve o que veio, classificado pelo formato.
    return imported.map((process) => ({ process, kind: classifyIdentifier(ref) }));
  }

  private async matchIndex(
    normalized: string,
  ): Promise<{ process: ProcessListItem; kind: ProcessIdentifierKind }[]> {
    const matches = await this.deps.processIdentifierRepository.findByNormalized([normalized]);
    if (matches.length === 0) return [];
    const kindByProcess = new Map<string, ProcessIdentifierKind>();
    for (const match of matches) {
      if (!kindByProcess.has(match.processId)) kindByProcess.set(match.processId, match.kind);
    }
    const items = await this.deps.processRepository.findListItemsByIds([...kindByProcess.keys()]);
    return items.map((process) => ({
      process,
      kind: kindByProcess.get(process.id) ?? 'OTHER',
    }));
  }

  /** Processo ativo da mesma empresa que já tem um destes identificadores (um processo por BL). */
  private async findExistingForCompany(
    identifiers: ProcessIdentifierInput[],
    companyId: string,
  ): Promise<ProcessListItem | null> {
    const normalized = identifiers.map((item) => normalizeIdentifier(item.value));
    const matches = await this.deps.processIdentifierRepository.findByNormalized(normalized);
    if (matches.length === 0) return null;
    const items = await this.deps.processRepository.findListItemsByIds([
      ...new Set(matches.map((match) => match.processId)),
    ]);
    const sameCompany = items.filter((item) => item.clientCompany.id === companyId);
    return sameCompany.length === 1 ? (sameCompany[0] ?? null) : null;
  }

  // ── Nota do e-mail em additionalInfo ──────────────────────────────

  private async appendNote(
    processId: string,
    actorId: string,
    input: AttachIntakeInput,
  ): Promise<void> {
    const current = await this.deps.processRepository.findRawById(processId, ALL);
    if (!current) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }
    const who = input.requester.name
      ? `${input.requester.name} <${input.requester.email}>`
      : input.requester.email;
    const stamp = `--- E-mail de ${who} em ${formatSaoPaulo(input.source.receivedAt)} ---`;
    const note = (input.note ?? '').trim();
    const appended = current.additionalInfo
      ? `${current.additionalInfo.trimEnd()}\n\n${stamp}\n${note}`
      : `${stamp}\n${note}`;

    await this.deps.processService.update(processId, actorId, ALL, {
      additionalInfo: appended.slice(0, 10_000),
    });
  }
}
