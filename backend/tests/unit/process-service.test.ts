import { FakeQueueProvider } from '../helpers/fakes/fake-queue-provider';
import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryKanbanStageRepository } from '../helpers/fakes/in-memory-kanban-stage-repository';
import { InMemoryProcessRepository } from '../helpers/fakes/in-memory-process-repository';
import { InMemoryUserRepository } from '../helpers/fakes/in-memory-user-repository';

import type { AccessScope } from '@/domain/entities/access-scope';
import type { Company } from '@/domain/entities/company';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/domain/errors/app-error';
import { EMAIL_JOBS } from '@/domain/queue/queue-provider';
import { ProcessService } from '@/services/process-service';

const ALL_SCOPE: AccessScope = { kind: 'ALL' };

function buildContext(): {
  service: ProcessService;
  processRepository: InMemoryProcessRepository;
  companyRepository: InMemoryCompanyRepository;
  stageRepository: InMemoryKanbanStageRepository;
  userRepository: InMemoryUserRepository;
  queueProvider: FakeQueueProvider;
} {
  const processRepository = new InMemoryProcessRepository();
  const companyRepository = new InMemoryCompanyRepository();
  const stageRepository = new InMemoryKanbanStageRepository();
  const userRepository = new InMemoryUserRepository();
  const queueProvider = new FakeQueueProvider();
  const service = new ProcessService({
    processRepository,
    companyRepository,
    stageRepository,
    userRepository,
    queueProvider,
  });
  return {
    service,
    processRepository,
    companyRepository,
    stageRepository,
    userRepository,
    queueProvider,
  };
}

function pushCompany(
  companyRepository: InMemoryCompanyRepository,
  processRepository: InMemoryProcessRepository,
  id: string,
  cnpj: string,
  organizationId = 'org-1',
): Company {
  const now = new Date();
  const company: Company = {
    id,
    cnpj,
    legalName: `Empresa ${id}`,
    tradeName: null,
    organizationId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  companyRepository.items.push(company);
  processRepository.companies.push({ id, cnpj, legalName: company.legalName });
  return company;
}

async function pushStage(
  stageRepository: InMemoryKanbanStageRepository,
  processRepository: InMemoryProcessRepository,
  name: string,
  order: number,
): Promise<string> {
  const stage = await stageRepository.create({ name, order });
  processRepository.stages.push({
    id: stage.id,
    name: stage.name,
    color: stage.color,
    order: stage.order,
    isFinal: stage.isFinal,
  });
  return stage.id;
}

describe('ProcessService', () => {
  describe('create', () => {
    it('cria o processo na primeira etapa (menor order) e grava histórico PROCESS_CREATED', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      const firstStageId = await pushStage(stageRepository, processRepository, 'Entrada', 0);
      await pushStage(stageRepository, processRepository, 'Em Andamento', 1);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const detail = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Referência de teste',
      });

      expect(detail.currentStage.id).toBe(firstStageId);
      expect(detail.history).toHaveLength(1);
      expect(detail.history[0]?.action).toBe('PROCESS_CREATED');
    });

    it('gera código PRC-{ano}-00001 e o próximo é 00002', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const first = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo 1',
      });
      const second = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo 2',
      });

      const year = new Date().getFullYear();
      expect(first.code).toBe(`PRC-${year}-00001`);
      expect(second.code).toBe(`PRC-${year}-00002`);
    });

    it('rejeita CLIENT criando processo para CNPJ fora do escopo', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const outOfScope = pushCompany(
        companyRepository,
        processRepository,
        'company-out',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const scope: AccessScope = { kind: 'COMPANIES', companyIds: ['company-in-scope'] };

      await expect(
        service.create('user-1', scope, {
          clientCompanyId: outOfScope.id,
          reference: 'Processo fora do escopo',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('permite CLIENT criar processo quando o CNPJ está no escopo', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const scope: AccessScope = { kind: 'COMPANIES', companyIds: [company.id] };

      const detail = await service.create('user-1', scope, {
        clientCompanyId: company.id,
        reference: 'Processo no escopo',
      });

      expect(detail.clientCompany.id).toBe(company.id);
    });

    it('rejeita quando não há etapas cadastradas', async () => {
      const { service, companyRepository, processRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );

      await expect(
        service.create('user-1', ALL_SCOPE, {
          clientCompanyId: company.id,
          reference: 'Sem etapa',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('rejeita CNPJ cliente inexistente', async () => {
      const { service, stageRepository, processRepository } = buildContext();
      await pushStage(stageRepository, processRepository, 'Entrada', 0);

      await expect(
        service.create('user-1', ALL_SCOPE, { clientCompanyId: 'nao-existe', reference: 'Teste' }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('findDetailById', () => {
    it('responde NotFoundError (404) para processo fora do escopo, nunca ForbiddenError', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo de outra org',
      });

      const otherScope: AccessScope = { kind: 'COMPANIES', companyIds: ['outra-empresa'] };

      await expect(service.findDetailById(created.id, otherScope)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('CLIENT alcança processo em que sua empresa é apenas requestingCompany', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const clientCompany = pushCompany(
        companyRepository,
        processRepository,
        'company-client',
        '11222333000181',
      );
      const requestingCompany = pushCompany(
        companyRepository,
        processRepository,
        'company-requesting',
        '11444777000161',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: clientCompany.id,
        requestingCompanyId: requestingCompany.id,
        reference: 'Processo com solicitante',
      });

      const scope: AccessScope = { kind: 'COMPANIES', companyIds: [requestingCompany.id] };

      const detail = await service.findDetailById(created.id, scope);
      expect(detail.id).toBe(created.id);
    });
  });

  describe('update', () => {
    it('gera histórico PROCESS_UPDATED com o diff dos campos alterados', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Referência original',
      });

      const updated = await service.update(created.id, 'user-1', ALL_SCOPE, {
        reference: 'Referência atualizada',
      });

      const updateEntry = updated.history.find((entry) => entry.action === 'PROCESS_UPDATED');
      expect(updateEntry).toBeDefined();
      expect(updated.reference).toBe('Referência atualizada');
    });

    it('rejeita atualização de processo fora do escopo com 404', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      const otherScope: AccessScope = { kind: 'COMPANIES', companyIds: ['outra-empresa'] };

      await expect(
        service.update(created.id, 'user-1', otherScope, { reference: 'Nova referência' }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('rejeita mover para CNPJ fora do escopo do CLIENT', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      const outOfScope = pushCompany(
        companyRepository,
        processRepository,
        'company-out',
        '11444777000161',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      const scope: AccessScope = { kind: 'COMPANIES', companyIds: [company.id] };

      await expect(
        service.update(created.id, 'user-1', scope, { clientCompanyId: outOfScope.id }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('moveStage', () => {
    it('move para outra etapa e grava histórico STAGE_CHANGED com origem, destino, autor e timestamp', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      const entradaId = await pushStage(stageRepository, processRepository, 'Entrada', 0);
      const andamentoId = await pushStage(stageRepository, processRepository, 'Em Andamento', 1);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo a mover',
      });

      const moved = await service.moveStage(created.id, 'user-1', ALL_SCOPE, {
        toStageId: andamentoId,
      });

      expect(moved.currentStage.id).toBe(andamentoId);
      const entry = moved.history.find((h) => h.action === 'STAGE_CHANGED');
      expect(entry).toBeDefined();
      expect(entry?.fromStage?.id).toBe(entradaId);
      expect(entry?.toStage?.id).toBe(andamentoId);
      expect(entry?.actor.id).toBe('user-1');
      expect(entry?.createdAt).toBeInstanceOf(Date);
    });

    it('grava completedAt ao entrar em etapa final e limpa ao saltar para etapa não final', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      const andamentoId = await pushStage(stageRepository, processRepository, 'Em Andamento', 1);
      const finalStage = await stageRepository.create({ name: 'Concluído', order: 2 });
      await stageRepository.update(finalStage.id, { isFinal: true });
      processRepository.stages.push({
        id: finalStage.id,
        name: finalStage.name,
        color: finalStage.color,
        order: finalStage.order,
        isFinal: true,
      });
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo final',
      });

      const completed = await service.moveStage(created.id, 'user-1', ALL_SCOPE, {
        toStageId: finalStage.id,
      });
      expect(completed.completedAt).not.toBeNull();

      const reopened = await service.moveStage(created.id, 'user-1', ALL_SCOPE, {
        toStageId: andamentoId,
      });
      expect(reopened.completedAt).toBeNull();
    });

    it('mover para a etapa atual responde 409 CONFLICT', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      const entradaId = await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      await expect(
        service.moveStage(created.id, 'user-1', ALL_SCOPE, { toStageId: entradaId }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('processo fora do escopo responde 404 ao tentar mover', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      const andamentoId = await pushStage(stageRepository, processRepository, 'Em Andamento', 1);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      const otherScope: AccessScope = { kind: 'COMPANIES', companyIds: ['outra-empresa'] };

      await expect(
        service.moveStage(created.id, 'user-1', otherScope, { toStageId: andamentoId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('falha na escrita do histórico desfaz a mudança de etapa (atomicidade)', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      const andamentoId = await pushStage(stageRepository, processRepository, 'Em Andamento', 1);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      // Simula falha na escrita do histórico dentro da transação — o fake
      // rejeita ANTES de mutar `items`, reproduzindo a garantia real do
      // `$transaction` do Prisma (docs/12, Tarefa 10).
      processRepository.failHistoryWrite = true;

      await expect(
        service.moveStage(created.id, 'user-1', ALL_SCOPE, { toStageId: andamentoId }),
      ).rejects.toThrow('Falha simulada na escrita do histórico.');

      processRepository.failHistoryWrite = false;
      const detail = await service.findDetailById(created.id, ALL_SCOPE);
      expect(detail.currentStage.id).not.toBe(andamentoId);
      expect(detail.history.some((h) => h.action === 'STAGE_CHANGED')).toBe(false);
    });

    it('enfileira PROCESS_STAGE_CHANGED com fromStage, toStage, actor e note (RF-50/docs/07)', async () => {
      const {
        service,
        companyRepository,
        processRepository,
        stageRepository,
        userRepository,
        queueProvider,
      } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      const andamentoId = await pushStage(stageRepository, processRepository, 'Em Andamento', 1);
      await userRepository.create({
        name: 'Maria',
        email: 'maria@x.com',
        passwordHash: null,
        role: 'OPERATIONAL',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId: 'org-1',
      });
      const actor = await userRepository.findByEmail('maria@x.com');
      processRepository.users.push({ id: actor!.id, name: actor!.name, email: actor!.email });

      const created = await service.create(actor!.id, ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo com e-mail',
      });

      await service.moveStage(created.id, actor!.id, ALL_SCOPE, {
        toStageId: andamentoId,
        note: 'Aguardando documentação adicional',
      });

      expect(queueProvider.enqueuedJobs).toHaveLength(1);
      const job = queueProvider.enqueuedJobs[0];
      expect(job?.name).toBe(EMAIL_JOBS.PROCESS_STAGE_CHANGED);
      if (job?.name === EMAIL_JOBS.PROCESS_STAGE_CHANGED) {
        expect(job.payload.fromStageName).toBe('Entrada');
        expect(job.payload.toStageName).toBe('Em Andamento');
        expect(job.payload.actorName).toBe('Maria');
        expect(job.payload.note).toBe('Aguardando documentação adicional');
        expect(job.payload.processId).toBe(created.id);
      }
    });

    it('RF-51: falha simulada no enqueue não impede a resposta de sucesso de moveStage', async () => {
      const { service, companyRepository, processRepository, stageRepository, queueProvider } =
        buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      const andamentoId = await pushStage(stageRepository, processRepository, 'Em Andamento', 1);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      queueProvider.shouldFailEnqueue = true;

      const moved = await service.moveStage(created.id, 'user-1', ALL_SCOPE, {
        toStageId: andamentoId,
      });

      expect(moved.currentStage.id).toBe(andamentoId);
      expect(queueProvider.enqueuedJobs).toHaveLength(0);
    });
  });

  describe('assignResponsible', () => {
    it('atribui responsável interno ativo e grava histórico RESPONSIBLE_CHANGED', async () => {
      const { service, companyRepository, processRepository, stageRepository, userRepository } =
        buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });
      const operational = await userRepository.create({
        name: 'Carlos Souza',
        email: 'carlos@opusce.com.br',
        passwordHash: null,
        role: 'OPERATIONAL',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId: 'org-1',
      });
      processRepository.users.push({
        id: operational.id,
        name: operational.name,
        email: operational.email,
      });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      const updated = await service.assignResponsible(
        created.id,
        'user-1',
        ALL_SCOPE,
        operational.id,
      );

      expect(updated.responsible?.id).toBe(operational.id);
      expect(updated.history.some((h) => h.action === 'RESPONSIBLE_CHANGED')).toBe(true);
    });

    it('atribuir CLIENT como responsável responde 400 VALIDATION_ERROR', async () => {
      const { service, companyRepository, processRepository, stageRepository, userRepository } =
        buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });
      const clientUser = await userRepository.create({
        name: 'Cliente Qualquer',
        email: 'cliente@clientex.com.br',
        passwordHash: null,
        role: 'CLIENT',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId: 'org-2',
      });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      await expect(
        service.assignResponsible(created.id, 'user-1', ALL_SCOPE, clientUser.id),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('permite desatribuir responsável com responsibleId null', async () => {
      const { service, companyRepository, processRepository, stageRepository, userRepository } =
        buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });
      const operational = await userRepository.create({
        name: 'Carlos Souza',
        email: 'carlos@opusce.com.br',
        passwordHash: null,
        role: 'OPERATIONAL',
        status: 'ACTIVE',
        accessScope: 'ORGANIZATION',
        organizationId: 'org-1',
      });
      processRepository.users.push({
        id: operational.id,
        name: operational.name,
        email: operational.email,
      });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });
      await service.assignResponsible(created.id, 'user-1', ALL_SCOPE, operational.id);

      const cleared = await service.assignResponsible(created.id, 'user-1', ALL_SCOPE, null);
      expect(cleared.responsible).toBeNull();
    });
  });

  describe('softDelete', () => {
    it('exclui logicamente e grava histórico PROCESS_DELETED', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo a excluir',
      });

      await service.softDelete(created.id, 'user-1', ALL_SCOPE);

      await expect(service.findDetailById(created.id, ALL_SCOPE)).rejects.toBeInstanceOf(
        NotFoundError,
      );

      const history = await service.listHistory(created.id, ALL_SCOPE, { page: 1, pageSize: 20 });
      expect(history.items.some((h) => h.action === 'PROCESS_DELETED')).toBe(true);
    });

    it('processo fora do escopo responde 404 ao excluir', async () => {
      const { service, companyRepository, processRepository, stageRepository } = buildContext();
      const company = pushCompany(
        companyRepository,
        processRepository,
        'company-1',
        '11222333000181',
      );
      await pushStage(stageRepository, processRepository, 'Entrada', 0);
      processRepository.users.push({ id: 'user-1', name: 'Maria', email: 'maria@x.com' });

      const created = await service.create('user-1', ALL_SCOPE, {
        clientCompanyId: company.id,
        reference: 'Processo',
      });

      const otherScope: AccessScope = { kind: 'COMPANIES', companyIds: ['outra-empresa'] };

      await expect(service.softDelete(created.id, 'user-1', otherScope)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
});
