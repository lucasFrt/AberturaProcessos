import { InMemoryDashboardRepository } from '../helpers/fakes/in-memory-dashboard-repository';

import { DashboardService } from '@/services/dashboard-service';

const HOUR_MS = 60 * 60 * 1000;

function buildContext(): {
  service: DashboardService;
  repository: InMemoryDashboardRepository;
} {
  const repository = new InMemoryDashboardRepository();
  const service = new DashboardService({ dashboardRepository: repository });
  return { service, repository };
}

describe('DashboardService', () => {
  it('retorna zeros e sampleSize 0 sem divisão por zero quando não há processos', async () => {
    const { service } = buildContext();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T00:00:00.000Z');

    const metrics = await service.getMetrics({ from, to });

    expect(metrics.totals.processes).toBe(0);
    expect(metrics.completionTime.sampleSize).toBe(0);
    expect(metrics.completionTime.averageHours).toBe(0);
    expect(metrics.completionTime.medianHours).toBe(0);
    expect(metrics.completionTime.formatted).toBe('0d 0h');
    expect(metrics.averageTimePerStage).toEqual([]);
    expect(metrics.byStage).toEqual([]);
  });

  it('inclui etapas com 0 processos em byStage', async () => {
    const { service, repository } = buildContext();
    repository.stages = [
      { id: 's1', name: 'Entrada', color: '#111', order: 0 },
      { id: 's2', name: 'Concluído', color: '#222', order: 1 },
    ];
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T00:00:00.000Z');

    const metrics = await service.getMetrics({ from, to });

    expect(metrics.byStage).toEqual([
      { stageId: 's1', stageName: 'Entrada', color: '#111', order: 0, count: 0 },
      { stageId: 's2', stageName: 'Concluído', color: '#222', order: 1, count: 0 },
    ]);
  });

  it('calcula totais (ativos vs concluídos, criados/concluídos no período)', async () => {
    const { service, repository } = buildContext();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T00:00:00.000Z');

    repository.processes = [
      {
        id: 'p1',
        clientCompanyId: 'c1',
        clientCompanyCnpj: '11111111000191',
        clientCompanyLegalName: 'Empresa 1',
        organizationId: 'o1',
        organizationName: 'Org 1',
        currentStageId: 's1',
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        completedAt: null,
      },
      {
        id: 'p2',
        clientCompanyId: 'c1',
        clientCompanyCnpj: '11111111000191',
        clientCompanyLegalName: 'Empresa 1',
        organizationId: 'o1',
        organizationName: 'Org 1',
        currentStageId: 's2',
        createdAt: new Date('2026-01-05T00:00:00.000Z'),
        completedAt: new Date('2026-01-15T00:00:00.000Z'),
      },
    ];

    const metrics = await service.getMetrics({ from, to });

    expect(metrics.totals).toEqual({
      processes: 2,
      active: 1,
      completed: 1,
      createdInPeriod: 2,
      completedInPeriod: 1,
    });
  });

  it('completionTime bate com o cálculo manual (average/median/sampleSize)', async () => {
    const { service, repository } = buildContext();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T00:00:00.000Z');
    const completedAt = new Date('2026-01-10T00:00:00.000Z');

    repository.processes = [
      {
        id: 'p1',
        clientCompanyId: 'c1',
        clientCompanyCnpj: '1',
        clientCompanyLegalName: 'E1',
        organizationId: 'o1',
        organizationName: 'Org 1',
        currentStageId: 's1',
        createdAt: new Date(completedAt.getTime() - 10 * HOUR_MS),
        completedAt,
      },
      {
        id: 'p2',
        clientCompanyId: 'c1',
        clientCompanyCnpj: '1',
        clientCompanyLegalName: 'E1',
        organizationId: 'o1',
        organizationName: 'Org 1',
        currentStageId: 's1',
        createdAt: new Date(completedAt.getTime() - 30 * HOUR_MS),
        completedAt,
      },
    ];

    const metrics = await service.getMetrics({ from, to });

    expect(metrics.completionTime.sampleSize).toBe(2);
    expect(metrics.completionTime.averageHours).toBeCloseTo(20, 5);
    expect(metrics.completionTime.medianHours).toBeCloseTo(20, 5);
    expect(metrics.completionTime.formatted).toBe('0d 20h');
  });

  it('averageTimePerStage exclui a etapa atual de processo em aberto', async () => {
    const { service, repository } = buildContext();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T00:00:00.000Z');
    const t0 = new Date('2026-01-01T00:00:00.000Z');

    repository.stages = [
      { id: 'entrada', name: 'Entrada', color: '#111', order: 0 },
      { id: 'andamento', name: 'Em Andamento', color: '#222', order: 1 },
    ];

    // Processo aberto: entrou em "andamento" 8h depois de criado, ainda não concluído.
    repository.processesForTiming = [{ id: 'p1', createdAt: t0, completedAt: null }];
    repository.stageChangeHistory = [
      {
        processId: 'p1',
        fromStageId: 'entrada',
        toStageId: 'andamento',
        createdAt: new Date(t0.getTime() + 8 * HOUR_MS),
      },
    ];

    const metrics = await service.getMetrics({ from, to });

    const entrada = metrics.averageTimePerStage.find((s) => s.stageId === 'entrada');
    const andamento = metrics.averageTimePerStage.find((s) => s.stageId === 'andamento');

    expect(entrada?.sampleSize).toBe(1);
    expect(entrada?.averageHours).toBeCloseTo(8, 5);
    // "andamento" é a etapa atual do processo em aberto — não deve aparecer.
    expect(andamento).toBeUndefined();
  });

  it('throughputByDay reflete created/completed por dia dentro do período', async () => {
    const { service, repository } = buildContext();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-03T00:00:00.000Z');

    repository.processes = [
      {
        id: 'p1',
        clientCompanyId: 'c1',
        clientCompanyCnpj: '1',
        clientCompanyLegalName: 'E1',
        organizationId: 'o1',
        organizationName: 'Org 1',
        currentStageId: 's1',
        createdAt: new Date('2026-01-02T10:00:00.000Z'),
        completedAt: new Date('2026-01-02T15:00:00.000Z'),
      },
    ];

    const metrics = await service.getMetrics({ from, to });

    const day = metrics.throughputByDay.find((d) => d.date === '2026-01-02');
    expect(day).toEqual({ date: '2026-01-02', created: 1, completed: 1 });

    const emptyDay = metrics.throughputByDay.find((d) => d.date === '2026-01-01');
    expect(emptyDay).toEqual({ date: '2026-01-01', created: 0, completed: 0 });
  });

  it('filtra por organizationId', async () => {
    const { service, repository } = buildContext();
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T00:00:00.000Z');

    repository.processes = [
      {
        id: 'p1',
        clientCompanyId: 'c1',
        clientCompanyCnpj: '1',
        clientCompanyLegalName: 'E1',
        organizationId: 'o1',
        organizationName: 'Org 1',
        currentStageId: 's1',
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        completedAt: null,
      },
      {
        id: 'p2',
        clientCompanyId: 'c2',
        clientCompanyCnpj: '2',
        clientCompanyLegalName: 'E2',
        organizationId: 'o2',
        organizationName: 'Org 2',
        currentStageId: 's1',
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        completedAt: null,
      },
    ];

    const metrics = await service.getMetrics({ from, to, organizationId: 'o1' });

    expect(metrics.totals.processes).toBe(1);
    expect(metrics.byOrganization).toEqual([{ organizationId: 'o1', name: 'Org 1', count: 1 }]);
  });
});
