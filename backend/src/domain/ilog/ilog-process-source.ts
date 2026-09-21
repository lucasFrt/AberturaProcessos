/**
 * Leitura do iLog (sistema de comex da Opus, MySQL) — docs/15. Só o que o
 * espelho e o intake precisam: processos com seus identificadores e o
 * importador. Sem escrita, nunca (docs/15, seção 5.4).
 */

export interface IlogCompany {
  /** `empresa.cod_emp` */
  ilogCompanyId: number;
  legalName: string;
  tradeName: string | null;
  /** Só dígitos (14); `null` quando o cadastro no iLog não tem CNPJ. */
  cnpj: string | null;
  /** Domínios (minúsculos) dos e-mails em `empcontato` desta empresa, sem repetição. */
  contactDomains: string[];
}

export interface IlogProcess {
  /** `processo.processoid` */
  ilogProcessId: number;
  /** "31435/26" (`nro_pro/ano_pro`) */
  number: string;
  /** Importação | Exportação | Outros */
  type: string | null;
  /** `ident_cli_pro` — referência do cliente ou o próprio HBL */
  clientRef: string | null;
  houseBl: string | null;
  masterBl: string | null;
  di: string | null;
  /** CE Mercante (`MasterMercanteNumero`) */
  ce: string | null;
  dta: string | null;
  containers: string[];
  invoices: string[];
  openedAt: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
  /** `cod_importador` — `null` quando o processo não tem importador. */
  importer: IlogCompany | null;
}

export interface IlogChangedProcesses {
  ilogProcessIds: number[];
  /** Maior `ChangedDateTime` visto, no formato do MySQL; `null` sem alterações. */
  latestChangedAt: string | null;
}

export interface IlogProcessSource {
  /** Testa a conexão (usado pelo health check e no início do sync). */
  ping(): Promise<void>;
  /** `NOW()` do servidor, no formato/fuso do MySQL — ponto de partida do cursor do `changelog`. */
  now(): Promise<string>;
  /** Ids dos processos em aberto (sem encerramento nem cancelamento) abertos desde `openedSince`. */
  listOpenProcessIds(openedSince: Date): Promise<number[]>;
  /**
   * Ids de processo com alteração no `changelog` depois de `since` (formato
   * do MySQL, ver `IlogSyncState.lastChangelogAt`) — inclui alterações nas
   * tabelas filhas de contêineres e faturas. `limit` protege a primeira
   * leitura depois de muito tempo parado.
   */
  listChangedProcessIds(since: string, limit: number): Promise<IlogChangedProcesses>;
  /** Processos completos (com importador, contêineres e faturas) para esses ids; ids inexistentes são omitidos. */
  fetchProcesses(ilogProcessIds: number[]): Promise<IlogProcess[]>;
  /**
   * Ids de processo cujo número da Opus, referência do cliente, HBL, MBL,
   * DI, CE, contêiner ou fatura é exatamente `value` (retaguarda B do
   * docs/15: só quando o índice local não tem o identificador).
   */
  findProcessIdsByIdentifier(value: string, limit: number): Promise<number[]>;
  /**
   * Domínios de contato usados por empresas **sem relação** entre si no iLog
   * (4+ raízes de CNPJ distintas: webmail, despachantes, transportadoras) —
   * não servem para ligar domínio → cliente (docs/15, seções 2 e 7). Um
   * domínio com 2–3 raízes é grupo/filiais: vira uma organização só.
   */
  listSharedContactDomains(): Promise<string[]>;
}
