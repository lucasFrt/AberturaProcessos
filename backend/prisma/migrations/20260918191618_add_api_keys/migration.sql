BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[api_keys] (
    [id] NVARCHAR(30) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [keyHash] NVARCHAR(64) NOT NULL,
    [keyPrefix] NVARCHAR(16) NOT NULL,
    [userId] NVARCHAR(30) NOT NULL,
    [createdById] NVARCHAR(30) NOT NULL,
    [lastUsedAt] DATETIME2,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [api_keys_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [api_keys_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [api_keys_keyHash_key] UNIQUE NONCLUSTERED ([keyHash])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [api_keys_userId_idx] ON [dbo].[api_keys]([userId]);

-- AddForeignKey
ALTER TABLE [dbo].[api_keys] ADD CONSTRAINT [api_keys_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[api_keys] ADD CONSTRAINT [api_keys_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
