import { normalizeIdentifier } from '@/domain/entities/process-identifier';
import type {
  IlogChangedProcesses,
  IlogProcess,
  IlogProcessSource,
} from '@/domain/ilog/ilog-process-source';

/**
 * iLog em memória (docs/15): `processes` é o "banco"; `changes` é o
 * changelog simplificado (processoid + instante no formato do MySQL). As
 * contagens de chamadas deixam os testes provarem que o intake só consulta
 * o iLog quando o índice local falha.
 */
export class FakeIlogProcessSource implements IlogProcessSource {
  readonly processes = new Map<number, IlogProcess>();
  readonly changes: { ilogProcessId: number; changedAt: string }[] = [];
  readonly sharedDomains: string[] = [];
  nowValue = '2026-09-21 12:00:00';
  failWith: Error | null = null;
  calls = { ping: 0, now: 0, listOpen: 0, listChanged: 0, fetch: 0, findByIdentifier: 0 };

  private guard(): void {
    if (this.failWith) throw this.failWith;
  }

  async ping(): Promise<void> {
    this.calls.ping += 1;
    this.guard();
  }

  async now(): Promise<string> {
    this.calls.now += 1;
    this.guard();
    return this.nowValue;
  }

  async listOpenProcessIds(openedSince: Date): Promise<number[]> {
    this.calls.listOpen += 1;
    this.guard();
    return [...this.processes.values()]
      .filter(
        (process) =>
          process.closedAt === null &&
          process.cancelledAt === null &&
          (process.openedAt === null || process.openedAt >= openedSince),
      )
      .map((process) => process.ilogProcessId)
      .sort((a, b) => a - b);
  }

  async listChangedProcessIds(since: string, limit: number): Promise<IlogChangedProcesses> {
    this.calls.listChanged += 1;
    this.guard();
    const changed = this.changes
      .filter((change) => change.changedAt > since)
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt))
      .slice(0, limit);
    const ids = [...new Set(changed.map((change) => change.ilogProcessId))];
    const latest = changed.at(-1)?.changedAt ?? null;
    return { ilogProcessIds: ids, latestChangedAt: latest };
  }

  async fetchProcesses(ilogProcessIds: number[]): Promise<IlogProcess[]> {
    this.calls.fetch += 1;
    this.guard();
    return ilogProcessIds
      .map((id) => this.processes.get(id))
      .filter((process): process is IlogProcess => process !== undefined);
  }

  async findProcessIdsByIdentifier(value: string, limit: number): Promise<number[]> {
    this.calls.findByIdentifier += 1;
    this.guard();
    const needle = normalizeIdentifier(value);
    return [...this.processes.values()]
      .filter((process) =>
        [
          process.number,
          process.clientRef,
          process.houseBl,
          process.masterBl,
          process.di,
          process.ce,
          process.dta,
          ...process.containers,
          ...process.invoices,
        ].some((candidate) => candidate !== null && normalizeIdentifier(candidate) === needle),
      )
      .map((process) => process.ilogProcessId)
      .slice(0, limit);
  }

  async listSharedContactDomains(): Promise<string[]> {
    this.guard();
    return [...this.sharedDomains];
  }
}

/** Processo do iLog com defaults razoáveis; sobrescreva o que o teste precisa. */
export function makeIlogProcess(
  overrides: Partial<IlogProcess> & { ilogProcessId: number },
): IlogProcess {
  return {
    number: `${30000 + overrides.ilogProcessId}/26`,
    type: 'Importação',
    clientRef: null,
    houseBl: null,
    masterBl: null,
    di: null,
    ce: null,
    dta: null,
    containers: [],
    invoices: [],
    openedAt: new Date('2026-09-20T03:00:00Z'),
    closedAt: null,
    cancelledAt: null,
    importer: {
      ilogCompanyId: 569,
      legalName: 'CASA E NOVIDADE COMERCIO LTDA',
      tradeName: 'CASA & NOVIDADE',
      cnpj: '12345678000195',
      contactDomains: ['casaenovidade.com.br'],
    },
    ...overrides,
  };
}
