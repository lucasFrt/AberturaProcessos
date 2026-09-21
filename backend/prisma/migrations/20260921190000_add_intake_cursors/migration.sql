-- Tarefa 27 (docs/13, decisão 9): cursor de leitura gravado, um por canal.
BEGIN TRY

BEGIN TRAN;

CREATE TABLE [dbo].[intake_cursors] (
    [channel] NVARCHAR(20) NOT NULL,
    [receivedAt] DATETIME2 NOT NULL,
    [externalId] NVARCHAR(400),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [intake_cursors_pkey] PRIMARY KEY CLUSTERED ([channel])
);

ALTER TABLE [dbo].[intake_cursors] ADD CONSTRAINT [CK_intake_cursors_channel]
  CHECK ([channel] IN ('EMAIL'));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
