import type { AccessScope } from '@/domain/entities/access-scope';
import type {
  Process,
  ProcessBoardStageResult,
  ProcessDetail,
  ProcessFilters,
  ProcessHistoryEntry,
  ProcessListItem,
  ProcessSort,
  ProcessUpdateDiffEntry,
  UpdateProcessData,
} from '@/domain/entities/process';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/domain/errors/app-error';
import type { Page, PaginationParams } from '@/domain/pagination';
import type { CompanyRepository } from '@/domain/repositories/company-repository';
import type { KanbanStageRepository } from '@/domain/repositories/kanban-stage-repository';
import type { ProcessRepository } from '@/domain/repositories/process-repository';
import type { UserRepository } from '@/domain/repositories/user-repository';

export interface ProcessServiceDeps {
  processRepository: ProcessRepository;
  companyRepository: CompanyRepository;
  stageRepository: KanbanStageRepository;
  userRepository: UserRepository;
}

export interface CreateProcessInput {
  clientCompanyId: string;
  requestingCompanyId?: string | null | undefined;
  reference: string;
  additionalInfo?: string | null | undefined;
}

export interface UpdateProcessInput {
  reference?: string | undefined;
  additionalInfo?: string | null | undefined;
  clientCompanyId?: string | undefined;
  requestingCompanyId?: string | null | undefined;
}

/** `scope.companyIds` só existe quando `kind === 'COMPANIES'` — checagem centralizada aqui. */
function isCompanyInScope(companyId: string, scope: AccessScope): boolean {
  return scope.kind === 'ALL' || scope.companyIds.includes(companyId);
}

/**
 * Criação e listagem de processos com escopo de acesso (RF-20 a RF-24,
 * RNF-01; docs/05 seção "Processos"; docs/04 "Geração do código do
 * processo"; docs/06 "Autorização"). A validação de escopo na escrita
 * (CLIENT só cria/edita dentro de `scope.companyIds`) fica aqui, não no
 * repositório — é regra de negócio, não de persistência.
 */
export class ProcessService {
  constructor(private readonly deps: ProcessServiceDeps) {}

  async create(
    actorId: string,
    scope: AccessScope,
    input: CreateProcessInput,
  ): Promise<ProcessDetail> {
    if (!isCompanyInScope(input.clientCompanyId, scope)) {
      throw new ForbiddenError('FORBIDDEN', 'Você não tem acesso a este CNPJ cliente.');
    }
    if (input.requestingCompanyId && !isCompanyInScope(input.requestingCompanyId, scope)) {
      throw new ForbiddenError('FORBIDDEN', 'Você não tem acesso a este CNPJ solicitante.');
    }

    const clientCompany = await this.deps.companyRepository.findById(input.clientCompanyId);
    if (!clientCompany || !clientCompany.isActive) {
      throw new ValidationError('CNPJ cliente inválido ou inativo.');
    }

    if (input.requestingCompanyId) {
      const requestingCompany = await this.deps.companyRepository.findById(
        input.requestingCompanyId,
      );
      if (!requestingCompany || !requestingCompany.isActive) {
        throw new ValidationError('CNPJ solicitante inválido ou inativo.');
      }
    }

    // Posiciona na etapa de menor `order` (docs/12, critério de aceite da Tarefa 9).
    const stages = await this.deps.stageRepository.list();
    const firstStage = stages[0];
    if (!firstStage) {
      throw new ValidationError('Não há etapas do Kanban cadastradas.');
    }

    return this.deps.processRepository.createWithHistory({
      reference: input.reference,
      additionalInfo: input.additionalInfo ?? null,
      clientCompanyId: input.clientCompanyId,
      requestingCompanyId: input.requestingCompanyId ?? null,
      currentStageId: firstStage.id,
      createdById: actorId,
    });
  }

  async list(
    filters: ProcessFilters,
    scope: AccessScope,
    pagination: PaginationParams,
    sort: ProcessSort,
  ): Promise<Page<ProcessListItem>> {
    return this.deps.processRepository.list(filters, scope, pagination, sort);
  }

  async board(
    filters: ProcessFilters,
    scope: AccessScope,
    limitPerStage: number,
  ): Promise<ProcessBoardStageResult[]> {
    return this.deps.processRepository.board(filters, scope, limitPerStage);
  }

  /** `null`/fora do escopo respondem 404, nunca 403 (docs/05, docs/06). */
  async findDetailById(id: string, scope: AccessScope): Promise<ProcessDetail> {
    const detail = await this.deps.processRepository.findDetailById(id, scope);
    if (!detail) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }
    return detail;
  }

  async update(
    id: string,
    actorId: string,
    scope: AccessScope,
    input: UpdateProcessInput,
  ): Promise<ProcessDetail> {
    const current = await this.deps.processRepository.findRawById(id, scope);
    if (!current) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }

    if (input.clientCompanyId && !isCompanyInScope(input.clientCompanyId, scope)) {
      throw new ForbiddenError('FORBIDDEN', 'Você não tem acesso a este CNPJ cliente.');
    }
    if (input.requestingCompanyId && !isCompanyInScope(input.requestingCompanyId, scope)) {
      throw new ForbiddenError('FORBIDDEN', 'Você não tem acesso a este CNPJ solicitante.');
    }

    if (input.clientCompanyId) {
      const company = await this.deps.companyRepository.findById(input.clientCompanyId);
      if (!company || !company.isActive) {
        throw new ValidationError('CNPJ cliente inválido ou inativo.');
      }
    }
    if (input.requestingCompanyId) {
      const company = await this.deps.companyRepository.findById(input.requestingCompanyId);
      if (!company || !company.isActive) {
        throw new ValidationError('CNPJ solicitante inválido ou inativo.');
      }
    }

    const { data, diff } = buildUpdateDiff(current, input);
    if (diff.length === 0) {
      return this.findDetailById(id, scope);
    }

    return this.deps.processRepository.updateWithHistory(id, {
      data,
      actorId,
      description: `Processo atualizado: ${diff.map((entry) => entry.field).join(', ')}.`,
      diff,
    });
  }

  /**
   * Move o processo para outra etapa (RF-25, RF-27; docs/05,
   * `PATCH /processes/:id/stage`). `authorize('OPERATIONAL', 'ADMIN')` já
   * bloqueia CLIENT na rota; aqui ficam as regras de estado (etapa igual à
   * atual, existência da etapa destino) que não dependem de papel.
   */
  async moveStage(
    id: string,
    actorId: string,
    scope: AccessScope,
    input: { toStageId: string; note?: string | null | undefined },
  ): Promise<ProcessDetail> {
    const current = await this.deps.processRepository.findRawById(id, scope);
    if (!current) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }

    if (input.toStageId === current.currentStageId) {
      throw new ConflictError('CONFLICT', 'O processo já está nesta etapa.');
    }

    const toStage = await this.deps.stageRepository.findById(input.toStageId);
    if (!toStage) {
      throw new ValidationError('Etapa de destino inválida.');
    }

    const fromStage = await this.deps.stageRepository.findById(current.currentStageId);

    return this.deps.processRepository.moveStageWithHistory(id, {
      fromStageId: current.currentStageId,
      toStageId: input.toStageId,
      toStageIsFinal: toStage.isFinal,
      actorId,
      note: input.note ?? null,
      description: `Etapa alterada de ${fromStage?.name ?? 'desconhecida'} para ${toStage.name}.`,
    });
  }

  /**
   * Define/limpa o responsável (RF-26; docs/05,
   * `PATCH /processes/:id/responsible`). O responsável precisa ser
   * usuário ativo OPERATIONAL ou ADMIN, senão `400 VALIDATION_ERROR`
   * (validação do papel do atribuído, não de quem chama).
   */
  async assignResponsible(
    id: string,
    actorId: string,
    scope: AccessScope,
    responsibleId: string | null,
  ): Promise<ProcessDetail> {
    const current = await this.deps.processRepository.findRawById(id, scope);
    if (!current) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }

    let description: string;
    if (responsibleId === null) {
      description = 'Responsável removido.';
    } else {
      const responsible = await this.deps.userRepository.findById(responsibleId);
      if (
        !responsible ||
        responsible.status !== 'ACTIVE' ||
        (responsible.role !== 'OPERATIONAL' && responsible.role !== 'ADMIN')
      ) {
        throw new ValidationError(
          'O responsável precisa ser um usuário interno ativo (OPERATIONAL ou ADMIN).',
        );
      }
      description = `Responsável definido: ${responsible.name}.`;
    }

    return this.deps.processRepository.assignResponsibleWithHistory(id, {
      responsibleId,
      actorId,
      description,
    });
  }

  /** Exclusão lógica (RF-28; docs/05, `DELETE /processes/:id`). */
  async softDelete(id: string, actorId: string, scope: AccessScope): Promise<void> {
    const current = await this.deps.processRepository.findRawById(id, scope);
    if (!current) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }

    await this.deps.processRepository.softDeleteWithHistory(id, {
      actorId,
      description: `Processo ${current.code} excluído.`,
    });
  }

  /**
   * Trilha paginada em ordem cronológica (RF-29; docs/05,
   * `GET /processes/:id/history`). Fora do escopo responde 404, como o
   * detalhe do processo.
   */
  async listHistory(
    id: string,
    scope: AccessScope,
    pagination: PaginationParams,
  ): Promise<Page<ProcessHistoryEntry>> {
    const page = await this.deps.processRepository.listHistory(id, scope, pagination);
    if (!page) {
      throw new NotFoundError('NOT_FOUND', 'Processo não encontrado.');
    }
    return page;
  }
}

/** Monta o diff apenas dos campos efetivamente alterados (docs/05, `PATCH /processes/:id`). */
function buildUpdateDiff(
  current: Process,
  input: UpdateProcessInput,
): { data: UpdateProcessData; diff: ProcessUpdateDiffEntry[] } {
  const diff: ProcessUpdateDiffEntry[] = [];
  const data: UpdateProcessData = {};

  if (input.reference !== undefined && input.reference !== current.reference) {
    diff.push({ field: 'reference', from: current.reference, to: input.reference });
    data.reference = input.reference;
  }

  if (input.additionalInfo !== undefined && input.additionalInfo !== current.additionalInfo) {
    diff.push({ field: 'additionalInfo', from: current.additionalInfo, to: input.additionalInfo });
    data.additionalInfo = input.additionalInfo;
  }

  if (input.clientCompanyId !== undefined && input.clientCompanyId !== current.clientCompanyId) {
    diff.push({
      field: 'clientCompanyId',
      from: current.clientCompanyId,
      to: input.clientCompanyId,
    });
    data.clientCompanyId = input.clientCompanyId;
  }

  if (
    input.requestingCompanyId !== undefined &&
    input.requestingCompanyId !== current.requestingCompanyId
  ) {
    diff.push({
      field: 'requestingCompanyId',
      from: current.requestingCompanyId,
      to: input.requestingCompanyId,
    });
    data.requestingCompanyId = input.requestingCompanyId;
  }

  return { data, diff };
}
