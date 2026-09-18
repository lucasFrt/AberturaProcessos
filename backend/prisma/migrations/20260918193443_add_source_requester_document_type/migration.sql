BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[companies] ADD [documentType] NVARCHAR(10) NOT NULL CONSTRAINT [companies_documentType_df] DEFAULT 'CNPJ';

-- AlterTable
ALTER TABLE [dbo].[documents] ADD [receivedAt] DATETIME2,
[source] NVARCHAR(10) NOT NULL CONSTRAINT [documents_source_df] DEFAULT 'WEB';

-- AlterTable
ALTER TABLE [dbo].[processes] ADD [receivedAt] DATETIME2,
[requesterEmail] NVARCHAR(255),
[requesterName] NVARCHAR(200),
[source] NVARCHAR(10) NOT NULL CONSTRAINT [processes_source_df] DEFAULT 'WEB';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
