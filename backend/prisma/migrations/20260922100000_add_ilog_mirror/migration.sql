-- Tarefa 30 (docs/15): espelho do iLog + índice de identificadores. Os índices
-- únicos FILTRADOS ficam na migration seguinte: o `WHERE` deles é compilado
-- junto com o batch e falha com "Invalid column name" sobre coluna criada aqui.
BEGIN TRY

BEGIN TRAN;

-- Process: vínculo com o processo do iLog.
ALTER TABLE [dbo].[processes] ADD [ilogProcessId] INT,
                                  [ilogNumber] NVARCHAR(20),
                                  [ilogSyncedAt] DATETIME2;

CREATE NONCLUSTERED INDEX [processes_ilogNumber_idx] ON [dbo].[processes]([ilogNumber]);

-- Company: vínculo com empresa.cod_emp.
ALTER TABLE [dbo].[companies] ADD [ilogCompanyId] INT;

-- Índice de identificadores por processo.
CREATE TABLE [dbo].[process_identifiers] (
    [id] NVARCHAR(30) NOT NULL,
    [processId] NVARCHAR(30) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL,
    [value] NVARCHAR(255) NOT NULL,
    [normalized] NVARCHAR(255) NOT NULL,
    [source] NVARCHAR(10) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [process_identifiers_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [process_identifiers_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [process_identifiers_processId_kind_normalized_key] UNIQUE NONCLUSTERED ([processId],[kind],[normalized])
);

CREATE NONCLUSTERED INDEX [process_identifiers_normalized_idx] ON [dbo].[process_identifiers]([normalized]);

ALTER TABLE [dbo].[process_identifiers] ADD CONSTRAINT [process_identifiers_processId_fkey]
  FOREIGN KEY ([processId]) REFERENCES [dbo].[processes]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- Estado do espelho incremental (uma linha).
CREATE TABLE [dbo].[ilog_sync_state] (
    [key] NVARCHAR(20) NOT NULL,
    [lastChangelogAt] NVARCHAR(30),
    [backfillDone] BIT NOT NULL CONSTRAINT [ilog_sync_state_backfillDone_df] DEFAULT 0,
    [lastRunAt] DATETIME2,
    [lastError] NVARCHAR(1000),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ilog_sync_state_pkey] PRIMARY KEY CLUSTERED ([key])
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
