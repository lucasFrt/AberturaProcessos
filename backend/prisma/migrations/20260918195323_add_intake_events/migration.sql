BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[intake_events] (
    [id] NVARCHAR(30) NOT NULL,
    [channel] NVARCHAR(20) NOT NULL,
    [externalId] NVARCHAR(400) NOT NULL,
    [kind] NVARCHAR(20) NOT NULL,
    [status] NVARCHAR(20) NOT NULL,
    [subject] NVARCHAR(500),
    [requesterName] NVARCHAR(200),
    [requesterEmail] NVARCHAR(255),
    [receivedAt] DATETIME2,
    [processId] NVARCHAR(30),
    [result] NVARCHAR(max),
    [errorMessage] NVARCHAR(1000),
    [createdById] NVARCHAR(30) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [intake_events_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [intake_events_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [intake_events_channel_externalId_key] UNIQUE NONCLUSTERED ([channel],[externalId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [intake_events_processId_idx] ON [dbo].[intake_events]([processId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [intake_events_status_idx] ON [dbo].[intake_events]([status]);

-- AddForeignKey
ALTER TABLE [dbo].[intake_events] ADD CONSTRAINT [intake_events_processId_fkey] FOREIGN KEY ([processId]) REFERENCES [dbo].[processes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[intake_events] ADD CONSTRAINT [intake_events_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
