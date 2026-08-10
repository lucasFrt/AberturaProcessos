import { InMemoryCompanyRepository } from '../helpers/fakes/in-memory-company-repository';
import { InMemoryKanbanStageRepository } from '../helpers/fakes/in-memory-kanban-stage-repository';
import { InMemoryProcessRepository } from '../helpers/fakes/in-memory-process-repository';

import type { AccessScope } from '@/domain/entities/access-scope';
import type { Company } from '@/domain/entities/company';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/errors/app-error';
import { ProcessService } from '@/services/process-service';

const ALL_SCOPE: AccessScope = { kind: 'ALL' };

function buildContext(): {
  service: ProcessService;
  processRepository: InMemoryProcessRepository;
  companyRepository: InMemoryCompanyRepository;
  stageRepository: InMemoryKanbanStageRepository;
} {
  const processRepository = new InMemoryProcessRepository();
  const companyRepository = new InMemoryCompanyRepository();
  const stageRepository = new InMemoryKanbanStageRepository();
  const service = new ProcessService({ processRepository, companyRepository, stageRepository });
  return { service, processRepository, companyRepository, stageRepository };
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
});
