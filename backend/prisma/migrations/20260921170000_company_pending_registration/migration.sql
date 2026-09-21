-- Tarefa 27 (docs/13, decisão 10): empresa em "cadastro pendente" — criada pelo
-- intake a partir do domínio do solicitante quando o e-mail não traz CNPJ/CPF.
-- `cnpj` e `documentType` passam a aceitar NULL. A unicidade do documento vira
-- um índice único FILTRADO: o SQL Server só admite um NULL num índice único
-- comum, e pode haver várias empresas pendentes ao mesmo tempo. Escrito à mão
-- (o Prisma geraria uma constraint UNIQUE sem filtro); `prisma migrate diff`
-- não acusa drift porque o índice continua único sobre [cnpj].
BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[companies] DROP CONSTRAINT [companies_cnpj_key];
ALTER TABLE [dbo].[companies] ALTER COLUMN [cnpj] NVARCHAR(14) NULL;
CREATE UNIQUE NONCLUSTERED INDEX [companies_cnpj_key]
  ON [dbo].[companies]([cnpj]) WHERE [cnpj] IS NOT NULL;

ALTER TABLE [dbo].[companies] DROP CONSTRAINT [companies_documentType_df];
ALTER TABLE [dbo].[companies] ALTER COLUMN [documentType] NVARCHAR(10) NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
