-- Migration manual, separada da anterior de propósito (o SQL Server compila
-- o batch inteiro antes de executar; CHECK sobre coluna/tabela criada no
-- mesmo batch falha — ver 20260918193500). CHECK constraints espelhando
-- domain/enums (docs/04): RECORD_SOURCES ganha ILOG (docs/15, Tarefa 30) e
-- os novos enums de identificador. Também os índices únicos filtrados das
-- colunas `ilog*` (mesmo padrão de companies_cnpj_key, docs/04): único só
-- quando preenchido, porque o SQL Server aceita um único NULL num índice
-- único comum e o Prisma não expressa filtro — por isso não há `@unique`.
CREATE UNIQUE NONCLUSTERED INDEX [processes_ilogProcessId_key]
  ON [dbo].[processes]([ilogProcessId]) WHERE [ilogProcessId] IS NOT NULL;

CREATE UNIQUE NONCLUSTERED INDEX [companies_ilogCompanyId_key]
  ON [dbo].[companies]([ilogCompanyId]) WHERE [ilogCompanyId] IS NOT NULL;

ALTER TABLE [processes] DROP CONSTRAINT [CK_processes_source];
ALTER TABLE [processes] ADD CONSTRAINT [CK_processes_source]
  CHECK ([source] IN ('WEB','EMAIL','API','ILOG'));

ALTER TABLE [documents] DROP CONSTRAINT [CK_documents_source];
ALTER TABLE [documents] ADD CONSTRAINT [CK_documents_source]
  CHECK ([source] IN ('WEB','EMAIL','API','ILOG'));

ALTER TABLE [process_identifiers] ADD CONSTRAINT [CK_process_identifiers_kind]
  CHECK ([kind] IN ('OPUS_NUMBER','CLIENT_REF','HBL','MBL','CONTAINER','INVOICE','DI','CE','DTA','OTHER'));

ALTER TABLE [process_identifiers] ADD CONSTRAINT [CK_process_identifiers_source]
  CHECK ([source] IN ('ILOG','EMAIL','MANUAL'));

ALTER TABLE [ilog_sync_state] ADD CONSTRAINT [CK_ilog_sync_state_key]
  CHECK ([key] IN ('ILOG'));
