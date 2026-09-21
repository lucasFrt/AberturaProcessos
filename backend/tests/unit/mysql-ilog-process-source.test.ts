/**
 * `MysqlIlogProcessSource` sem MySQL: o `createPool` do mysql2 é substituído
 * por um pool falso que registra as consultas e devolve linhas roteadas
 * pelo texto do SQL. O que se prova aqui é a tradução (linhas → domínio,
 * cursor do changelog, sessão somente leitura), não o MySQL.
 */
type Row = Record<string, unknown>;
type QueryHandler = (sql: string, params: unknown[]) => Row[];

interface FakePool {
  queries: { sql: string; params: unknown[] }[];
  handlers: QueryHandler[];
  listeners: Record<string, ((connection: { query: jest.Mock }) => void)[]>;
  query: jest.Mock;
  on: jest.Mock;
  end: jest.Mock;
}

function makeFakePool(): FakePool {
  const pool: FakePool = {
    queries: [],
    handlers: [],
    listeners: {},
    query: jest.fn(),
    on: jest.fn(),
    end: jest.fn(() => Promise.resolve()),
  };
  pool.query.mockImplementation((sql: string, params: unknown[] = []) => {
    pool.queries.push({ sql, params });
    for (const handler of pool.handlers) {
      const rows = handler(sql, params);
      if (rows.length > 0) return Promise.resolve([rows, []]);
    }
    return Promise.resolve([[], []]);
  });
  pool.on.mockImplementation(
    (event: string, listener: (connection: { query: jest.Mock }) => void) => {
      pool.listeners[event] = [...(pool.listeners[event] ?? []), listener];
      return pool;
    },
  );
  return pool;
}

const fakePool = makeFakePool();

jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(() => fakePool),
}));

// Importado depois do mock, de propósito.
import { createPool } from 'mysql2/promise';

import { MysqlIlogProcessSource } from '@/infra/ilog/mysql-ilog-process-source';

function build(): MysqlIlogProcessSource {
  return new MysqlIlogProcessSource({
    host: 'ilog.local',
    port: 3306,
    user: 'leitura',
    password: 'segredo',
    database: 'ilog',
    queryTimeoutSeconds: 10,
    connectTimeoutMs: 5000,
  });
}

function routes(...handlers: [RegExp, (params: unknown[]) => Row[]][]): void {
  fakePool.handlers = handlers.map(
    ([pattern, rows]) =>
      (sql, params): Row[] =>
        pattern.test(sql) ? rows(params) : [],
  );
}

beforeEach(() => {
  fakePool.queries = [];
  fakePool.handlers = [];
  fakePool.listeners = {};
  jest.mocked(createPool).mockClear();
});

describe('MysqlIlogProcessSource (docs/15, seção 5.3)', () => {
  it('abre um pool pequeno, com datas como texto, e deixa toda sessão somente leitura com tempo máximo', () => {
    build();
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'ilog.local',
        user: 'leitura',
        database: 'ilog',
        connectionLimit: 2,
        dateStrings: true,
      }),
    );
    const connection = { query: jest.fn() };
    for (const listener of fakePool.listeners['connection'] ?? []) listener(connection);
    expect(connection.query).toHaveBeenCalledWith('SET SESSION TRANSACTION READ ONLY');
    expect(connection.query).toHaveBeenCalledWith('SET SESSION max_execution_time = 10000');
  });

  it('now() devolve o instante do servidor tal qual', async () => {
    routes([/SELECT NOW\(\)/, () => [{ now: '2026-09-21 17:20:03' }]]);
    expect(await build().now()).toBe('2026-09-21 17:20:03');
  });

  it('listOpenProcessIds filtra abertos e passa a data no fuso do iLog', async () => {
    routes([
      /dt_enc_pro IS NULL AND CanceladoData IS NULL/,
      () => [{ processoid: 1 }, { processoid: '2' }],
    ]);
    const ids = await build().listOpenProcessIds(new Date('2026-06-23T12:00:00Z'));
    expect(ids).toEqual([1, 2]);
    expect(fakePool.queries[0]?.params).toEqual(['2026-06-23 09:00:00']);
  });

  it('listChangedProcessIds junta processo + filhas, sem repetir ids, e só avança o cursor até onde tudo foi lido', async () => {
    routes(
      [
        /TableName = 'processo'/,
        () => [
          { recordId: '10', changedAt: '2026-09-21 12:01:00' },
          { recordId: '11', changedAt: '2026-09-21 12:02:00' },
        ],
      ],
      [/TableName = 'processofatura'/, () => [{ recordId: 10, changedAt: '2026-09-21 12:09:00' }]],
      [/TableName = 'procequipamento'/, () => []],
    );
    const source = build();

    // limit 2: a consulta de `processo` bateu no limite em 12:02 → cursor para ali,
    // mesmo com a de faturas tendo ido até 12:09.
    const truncated = await source.listChangedProcessIds('2026-09-21 12:00:00', 2);
    expect(truncated).toEqual({ ilogProcessIds: [10, 11], latestChangedAt: '2026-09-21 12:02:00' });
    expect(fakePool.queries[0]?.params).toEqual(['2026-09-21 12:00:00', 2]);
    expect(fakePool.queries[0]?.sql).toContain('DATE_SUB(?, INTERVAL 2 MINUTE)');

    // limit 10: nada truncado → maior instante de todas.
    const complete = await source.listChangedProcessIds('2026-09-21 12:00:00', 10);
    expect(complete).toEqual({ ilogProcessIds: [10, 11], latestChangedAt: '2026-09-21 12:09:00' });
  });

  it('fetchProcesses traduz linhas em processos com importador, contêineres, faturas e datas no fuso do iLog', async () => {
    routes(
      [
        /LEFT JOIN empresa e/,
        () => [
          {
            processoid: 350368,
            nro_pro: 31435,
            ano_pro: 26,
            tipo_pro: 'Importação',
            ident_cli_pro: ' DANGB26080406 ',
            house_nro_pro: 'DANGB26080406',
            master_nro_pro: null,
            di_pro: '',
            MasterMercanteNumero: '132605301737430',
            DTANumero: null,
            dt_ab_pro: '2026-09-21 00:00:00',
            dt_enc_pro: null,
            CanceladoData: null,
            cod_emp: 569,
            razaosocial_emp: 'CASA E NOVIDADE COMERCIO LTDA',
            fantasia_emp: 'CASA & NOVIDADE',
            cgc_emp: '12.345.678/0001-95',
          },
          {
            processoid: 1,
            nro_pro: 1,
            ano_pro: 2025,
            cod_emp: null,
            dt_ab_pro: '2025-01-05',
          },
        ],
      ],
      [
        /FROM procequipamento q/,
        () => [
          { processoid: 350368, value: 'MSKU1234567' },
          { processoid: 350368, value: 'MSKU1234567' },
        ],
      ],
      [/FROM processofatura f/, () => [{ processoid: 350368, value: 'INV-1' }]],
      [
        /FROM empcontato WHERE cod_emp IN/,
        () => [
          { cod_emp: 569, email_empcontato: 'Ana@CasaENovidade.com.br; joao@gmail.com' },
          { cod_emp: 569, email_empcontato: 'fiscal@casaenovidade.com.br' },
        ],
      ],
    );

    const processes = await build().fetchProcesses([350368, 1, 350368]);
    expect(processes).toHaveLength(2);
    expect(processes[0]).toEqual({
      ilogProcessId: 350368,
      number: '31435/26',
      type: 'Importação',
      clientRef: 'DANGB26080406',
      houseBl: 'DANGB26080406',
      masterBl: null,
      di: null,
      ce: '132605301737430',
      dta: null,
      containers: ['MSKU1234567'],
      invoices: ['INV-1'],
      openedAt: new Date('2026-09-21T03:00:00.000Z'),
      closedAt: null,
      cancelledAt: null,
      importer: {
        ilogCompanyId: 569,
        legalName: 'CASA E NOVIDADE COMERCIO LTDA',
        tradeName: 'CASA & NOVIDADE',
        cnpj: '12345678000195',
        contactDomains: ['casaenovidade.com.br', 'gmail.com'],
      },
    });
    expect(processes[1]).toMatchObject({
      ilogProcessId: 1,
      number: '1/25',
      importer: null,
      openedAt: new Date('2025-01-05T03:00:00.000Z'),
    });
    // Ids repetidos entram uma vez só no IN (...).
    expect(fakePool.queries[0]?.params).toEqual([[350368, 1]]);
  });

  it('findProcessIdsByIdentifier consulta número da Opus por colunas numéricas, as colunas indexadas e as filhas', async () => {
    routes(
      [
        /nro_pro = \? AND ano_pro = \?/,
        (params) => (params[0] === 31435 && params[1] === 26 ? [{ processoid: 350368 }] : []),
      ],
      [/ident_cli_pro = \?/, () => [{ processoid: 350368 }, { processoid: 99 }]],
      [/container_procequip = \?/, () => [{ processoid: 7 }]],
    );
    const source = build();
    expect(await source.findProcessIdsByIdentifier(' 31435/26 ', 5)).toEqual([350368, 99, 7]);
    expect(await source.findProcessIdsByIdentifier('', 5)).toEqual([]);
    expect(fakePool.queries.filter((q) => /WHERE nro_pro = \?/.test(q.sql))).toHaveLength(1);
  });

  it('listSharedContactDomains devolve só domínios usados por mais de uma empresa', async () => {
    routes([
      /FROM empcontato WHERE email_empcontato LIKE/,
      () => [
        { cod_emp: 1, email_empcontato: 'a@despachante.com.br' },
        { cod_emp: 2, email_empcontato: 'b@despachante.com.br, c@unica.com.br' },
        { cod_emp: 2, email_empcontato: 'd@unica.com.br' },
      ],
    ]);
    expect(await build().listSharedContactDomains()).toEqual(['despachante.com.br']);
  });

  it('close() encerra o pool', async () => {
    await build().close();
    expect(fakePool.end).toHaveBeenCalled();
  });
});
