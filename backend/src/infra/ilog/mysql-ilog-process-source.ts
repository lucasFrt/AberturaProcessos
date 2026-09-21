import { createPool } from 'mysql2/promise';
import type { Pool, PoolConnection } from 'mysql2/promise';

import type {
  IlogChangedProcesses,
  IlogCompany,
  IlogProcess,
  IlogProcessSource,
} from '@/domain/ilog/ilog-process-source';
import { normalizeCnpjDigits } from '@/shared/cnpj';

export interface MysqlIlogOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Banco principal (`ilog`). */
  database: string;
  /** Segundos que uma consulta pode levar antes de o MySQL a abortar (`max_execution_time`). */
  queryTimeoutSeconds: number;
  connectTimeoutMs: number;
}

/**
 * Fuso do servidor MySQL do iLog (horário de Brasília, sem horário de verão
 * desde 2019). As colunas DATETIME não têm fuso; convertemos aqui, uma vez,
 * em vez de depender do fuso do processo Node (docs/15, seção 2).
 */
const ILOG_UTC_OFFSET = '-03:00';

/** Sobreposição da leitura incremental do `changelog` (docs/15, seção 5.2). */
const CHANGELOG_OVERLAP_MINUTES = 2;

/** Lotes de `IN (...)`: o suficiente para o backfill em poucas idas sem estourar o pacote. */
const FETCH_BATCH_SIZE = 200;

/**
 * A partir de quantas raízes de CNPJ distintas um domínio de contato deixa de
 * identificar um cliente. Medido em 21/09/2026 (docs/15, seção 7): grupos e
 * filiais têm 2–3 raízes (`carstation.com.br`, `globoimport.com.br`);
 * transportadoras, webmail e o domínio da própria Opus têm 4 ou mais.
 */
const SHARED_DOMAIN_MIN_ROOTS = 4;

type Row = Record<string, unknown>;

function isRowArray(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null);
}

function text(row: Row, column: string): string | null {
  const value = row[column];
  let asText: string;
  if (typeof value === 'string') asText = value;
  else if (typeof value === 'number' || typeof value === 'bigint') asText = value.toString();
  else return null;
  const trimmed = asText.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function integer(row: Row, column: string): number | null {
  const value = row[column];
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * "2026-09-21 03:00:00" / "2026-09-21" (com `dateStrings: true`) → Date no
 * fuso do iLog. Datas inválidas viram `null` em vez de "Invalid Date".
 */
function dateFromIlog(row: Row, column: string): Date | null {
  const raw = text(row, column);
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/.exec(raw);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2] ?? '00:00:00'}${ILOG_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Date → "YYYY-MM-DD HH:MM:SS" no fuso do iLog, para parâmetros de consulta. */
function formatForIlog(date: Date): string {
  const shifted = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 19).replace('T', ' ');
}

function opusNumber(row: Row): string | null {
  const number = integer(row, 'nro_pro');
  const year = integer(row, 'ano_pro');
  if (number === null || year === null) return null;
  return `${number}/${String(year % 100).padStart(2, '0')}`;
}

/** "a@x.com; b@y.com" → ["x.com", "y.com"] (minúsculos, sem repetição). */
function domainsOf(emails: string | null): string[] {
  if (!emails) return [];
  const out = new Set<string>();
  for (const piece of emails.split(/[;,\s]+/)) {
    const at = piece.lastIndexOf('@');
    if (at === -1) continue;
    const domain = piece
      .slice(at + 1)
      .trim()
      .toLowerCase()
      .replace(/[>)\]]+$/, '');
    if (domain.includes('.')) out.add(domain);
  }
  return [...out];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/**
 * Leitura do iLog por MySQL (docs/15, seção 5.3): pool pequeno, sessão
 * somente leitura, só colunas indexadas nos `WHERE`, `LIMIT` sempre. Nada
 * aqui escreve no iLog — e a sessão em `READ ONLY` garante isso mesmo que
 * o usuário do banco tenha mais permissão do que deveria.
 */
export class MysqlIlogProcessSource implements IlogProcessSource {
  private readonly pool: Pool;

  constructor(options: MysqlIlogOptions) {
    this.pool = createPool({
      host: options.host,
      port: options.port,
      user: options.user,
      password: options.password,
      database: options.database,
      waitForConnections: true,
      connectionLimit: 2,
      maxIdle: 1,
      idleTimeout: 60_000,
      connectTimeout: options.connectTimeoutMs,
      // Datas como texto: o cursor do changelog volta tal qual e as DATETIME
      // são convertidas por `dateFromIlog`, sem passar pelo fuso do Node.
      dateStrings: true,
      decimalNumbers: true,
    });
    this.pool.on('connection', (connection: PoolConnection) => {
      void connection.query('SET SESSION TRANSACTION READ ONLY');
      void connection.query(
        `SET SESSION max_execution_time = ${Math.round(options.queryTimeoutSeconds * 1000)}`,
      );
    });
  }

  async ping(): Promise<void> {
    await this.query('SELECT 1');
  }

  async now(): Promise<string> {
    const rows = await this.query('SELECT NOW() AS now');
    const value = rows[0] ? text(rows[0], 'now') : null;
    if (!value) throw new Error('iLog: NOW() não devolveu valor.');
    return value;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listOpenProcessIds(openedSince: Date): Promise<number[]> {
    const rows = await this.query(
      `SELECT processoid
         FROM processo
        WHERE dt_enc_pro IS NULL AND CanceladoData IS NULL AND dt_ab_pro >= ?
        ORDER BY processoid
        LIMIT 10000`,
      [formatForIlog(openedSince)],
    );
    return rows.map((row) => integer(row, 'processoid')).filter((id): id is number => id !== null);
  }

  async listChangedProcessIds(since: string, limit: number): Promise<IlogChangedProcesses> {
    const window = `DATE_SUB(?, INTERVAL ${CHANGELOG_OVERLAP_MINUTES} MINUTE)`;
    // Alterações diretas no processo…
    const direct = await this.query(
      `SELECT c.RecordID AS recordId, MAX(c.ChangedDateTime) AS changedAt
         FROM changelog c
        WHERE c.TableName = 'processo' AND c.ChangedDateTime > ${window}
        GROUP BY c.RecordID
        ORDER BY changedAt ASC
        LIMIT ?`,
      [since, limit],
    );
    // …e nas tabelas filhas de faturas e contêineres, que também carregam
    // identificadores (docs/15, seção 2). `RecordID` é texto: o CAST fica do
    // lado do changelog para a chave primária da filha continuar indexada.
    const invoices = await this.query(
      `SELECT p.processoid AS recordId, MAX(c.ChangedDateTime) AS changedAt
         FROM changelog c
         JOIN processofatura f ON f.ProcessoFaturaId = CAST(c.RecordID AS UNSIGNED)
         JOIN processo p ON p.nro_pro = f.Nro_Pro AND p.ano_pro = f.Ano_Pro
        WHERE c.TableName = 'processofatura' AND c.ChangedDateTime > ${window}
        GROUP BY p.processoid
        ORDER BY changedAt ASC
        LIMIT ?`,
      [since, limit],
    );
    const containers = await this.query(
      `SELECT p.processoid AS recordId, MAX(c.ChangedDateTime) AS changedAt
         FROM changelog c
         JOIN procequipamento q ON q.ProcessoEquipamentoId = CAST(c.RecordID AS UNSIGNED)
         JOIN processo p ON p.nro_pro = q.nro_pro AND p.ano_pro = q.ano_pro
        WHERE c.TableName = 'procequipamento' AND c.ChangedDateTime > ${window}
        GROUP BY p.processoid
        ORDER BY changedAt ASC
        LIMIT ?`,
      [since, limit],
    );

    const ids = new Set<number>();
    // O cursor só pode avançar até onde TODAS as consultas foram lidas por
    // inteiro: se uma bateu no `limit`, o próximo ciclo continua do maior
    // instante que ela devolveu, mesmo que outra tenha ido mais longe.
    let latest: string | null = null;
    let truncatedAt: string | null = null;
    for (const rows of [direct, invoices, containers]) {
      let max: string | null = null;
      for (const row of rows) {
        const id = integer(row, 'recordId');
        if (id !== null) ids.add(id);
        const changedAt = text(row, 'changedAt');
        if (changedAt && (max === null || changedAt > max)) max = changedAt;
      }
      if (max === null) continue;
      if (latest === null || max > latest) latest = max;
      if (rows.length >= limit && (truncatedAt === null || max < truncatedAt)) truncatedAt = max;
    }
    return {
      ilogProcessIds: [...ids].sort((a, b) => a - b),
      latestChangedAt: truncatedAt ?? latest,
    };
  }

  async fetchProcesses(ilogProcessIds: number[]): Promise<IlogProcess[]> {
    const out: IlogProcess[] = [];
    for (const ids of chunk([...new Set(ilogProcessIds)], FETCH_BATCH_SIZE)) {
      if (ids.length === 0) continue;
      const rows = await this.query(
        `SELECT p.processoid, p.nro_pro, p.ano_pro, p.tipo_pro, p.ident_cli_pro,
                p.house_nro_pro, p.master_nro_pro, p.di_pro, p.MasterMercanteNumero,
                p.DTANumero, p.dt_ab_pro, p.dt_enc_pro, p.CanceladoData,
                e.cod_emp, e.razaosocial_emp, e.fantasia_emp, e.cgc_emp
           FROM processo p
           LEFT JOIN empresa e ON e.cod_emp = p.cod_importador
          WHERE p.processoid IN (?)`,
        [ids],
      );
      const containers = await this.childValues(
        `SELECT p.processoid, q.container_procequip AS value
           FROM procequipamento q
           JOIN processo p ON p.nro_pro = q.nro_pro AND p.ano_pro = q.ano_pro
          WHERE p.processoid IN (?)`,
        ids,
      );
      const invoices = await this.childValues(
        `SELECT p.processoid, f.Numero AS value
           FROM processofatura f
           JOIN processo p ON p.nro_pro = f.Nro_Pro AND p.ano_pro = f.Ano_Pro
          WHERE p.processoid IN (?)`,
        ids,
      );
      const companyIds = rows
        .map((row) => integer(row, 'cod_emp'))
        .filter((id): id is number => id !== null);
      const contactDomains = await this.contactDomainsByCompany(companyIds);

      for (const row of rows) {
        const ilogProcessId = integer(row, 'processoid');
        const number = opusNumber(row);
        if (ilogProcessId === null || number === null) continue;
        const importerId = integer(row, 'cod_emp');
        const importer: IlogCompany | null =
          importerId === null
            ? null
            : {
                ilogCompanyId: importerId,
                legalName: text(row, 'razaosocial_emp') ?? `Empresa iLog ${importerId}`,
                tradeName: text(row, 'fantasia_emp'),
                cnpj: cnpjDigits(text(row, 'cgc_emp')),
                contactDomains: contactDomains.get(importerId) ?? [],
              };
        out.push({
          ilogProcessId,
          number,
          type: text(row, 'tipo_pro'),
          clientRef: text(row, 'ident_cli_pro'),
          houseBl: text(row, 'house_nro_pro'),
          masterBl: text(row, 'master_nro_pro'),
          di: text(row, 'di_pro'),
          ce: text(row, 'MasterMercanteNumero'),
          dta: text(row, 'DTANumero'),
          containers: containers.get(ilogProcessId) ?? [],
          invoices: invoices.get(ilogProcessId) ?? [],
          openedAt: dateFromIlog(row, 'dt_ab_pro'),
          closedAt: dateFromIlog(row, 'dt_enc_pro'),
          cancelledAt: dateFromIlog(row, 'CanceladoData'),
          importer,
        });
      }
    }
    return out;
  }

  async findProcessIdsByIdentifier(value: string, limit: number): Promise<number[]> {
    const needle = value.trim();
    if (needle.length === 0) return [];
    const ids = new Set<number>();

    // Número da Opus ("31435/26" ou "31435-26"): colunas numéricas separadas.
    const asNumber = /^(\d{1,6})\s*[/-]\s*(\d{2}|\d{4})$/.exec(needle);
    if (asNumber?.[1] && asNumber[2]) {
      const rows = await this.query(
        `SELECT processoid FROM processo WHERE nro_pro = ? AND ano_pro = ? LIMIT ?`,
        [Number(asNumber[1]), Number(asNumber[2]) % 100, limit],
      );
      for (const row of rows) {
        const id = integer(row, 'processoid');
        if (id !== null) ids.add(id);
      }
    }

    // Colunas de identificação, todas indexadas (docs/15, seção 2). A
    // collation do iLog é case-insensitive, então `=` já ignora maiúsculas.
    const direct = await this.query(
      `SELECT processoid FROM processo
        WHERE ident_cli_pro = ? OR house_nro_pro = ? OR master_nro_pro = ?
           OR di_pro = ? OR MasterMercanteNumero = ?
        ORDER BY processoid DESC
        LIMIT ?`,
      [needle, needle, needle, needle, needle, limit],
    );
    for (const row of direct) {
      const id = integer(row, 'processoid');
      if (id !== null) ids.add(id);
    }

    if (ids.size < limit) {
      const children = await this.query(
        `SELECT p.processoid
           FROM procequipamento q
           JOIN processo p ON p.nro_pro = q.nro_pro AND p.ano_pro = q.ano_pro
          WHERE q.container_procequip = ?
          UNION
         SELECT p.processoid
           FROM processofatura f
           JOIN processo p ON p.nro_pro = f.Nro_Pro AND p.ano_pro = f.Ano_Pro
          WHERE f.Numero = ?
          LIMIT ?`,
        [needle, needle, limit],
      );
      for (const row of children) {
        const id = integer(row, 'processoid');
        if (id !== null) ids.add(id);
      }
    }

    return [...ids].slice(0, limit);
  }

  async listSharedContactDomains(): Promise<string[]> {
    // `empcontato` tem centenas de linhas: uma leitura inteira por execução é
    // mais barata (e mais correta, por causa de células com vários e-mails)
    // do que um GROUP BY por domínio no MySQL. Conta raízes de CNPJ (8
    // primeiros dígitos), não `cod_emp`: filiais da mesma empresa são uma.
    const rows = await this.query(
      `SELECT c.cod_emp, c.email_empcontato, e.cgc_emp
         FROM empcontato c
         LEFT JOIN empresa e ON e.cod_emp = c.cod_emp
        WHERE c.email_empcontato LIKE '%@%'
        LIMIT 20000`,
    );
    const rootsByDomain = new Map<string, Set<string>>();
    for (const row of rows) {
      const companyId = integer(row, 'cod_emp');
      if (companyId === null) continue;
      const root = cnpjDigits(text(row, 'cgc_emp'))?.slice(0, 8) ?? `cod_emp:${companyId}`;
      for (const domain of domainsOf(text(row, 'email_empcontato'))) {
        const set = rootsByDomain.get(domain) ?? new Set<string>();
        set.add(root);
        rootsByDomain.set(domain, set);
      }
    }
    return [...rootsByDomain.entries()]
      .filter(([, roots]) => roots.size >= SHARED_DOMAIN_MIN_ROOTS)
      .map(([domain]) => domain)
      .sort();
  }

  private async contactDomainsByCompany(companyIds: number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    const unique = [...new Set(companyIds)];
    if (unique.length === 0) return out;
    const rows = await this.query(
      `SELECT cod_emp, email_empcontato FROM empcontato WHERE cod_emp IN (?) LIMIT 5000`,
      [unique],
    );
    for (const row of rows) {
      const companyId = integer(row, 'cod_emp');
      if (companyId === null) continue;
      const current = out.get(companyId) ?? [];
      for (const domain of domainsOf(text(row, 'email_empcontato'))) {
        if (!current.includes(domain)) current.push(domain);
      }
      out.set(companyId, current);
    }
    return out;
  }

  private async childValues(sql: string, ids: number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    const rows = await this.query(sql, [ids]);
    for (const row of rows) {
      const processId = integer(row, 'processoid');
      const value = text(row, 'value');
      if (processId === null || !value) continue;
      const current = out.get(processId) ?? [];
      if (!current.includes(value)) current.push(value);
      out.set(processId, current);
    }
    return out;
  }

  private async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    const [result] = await this.pool.query(sql, params);
    return isRowArray(result) ? result : [];
  }
}

/** "50.075.764/0001-14" → "50075764000114"; qualquer outra coisa → `null`. */
function cnpjDigits(masked: string | null): string | null {
  if (!masked) return null;
  const digits = normalizeCnpjDigits(masked);
  return digits.length === 14 ? digits : null;
}
