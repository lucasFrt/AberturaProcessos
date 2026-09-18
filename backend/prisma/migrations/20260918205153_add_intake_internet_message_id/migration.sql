BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[intake_events] ADD [internetMessageId] NVARCHAR(400);

-- CreateIndex
CREATE NONCLUSTERED INDEX [intake_events_channel_internetMessageId_idx] ON [dbo].[intake_events]([channel], [internetMessageId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
