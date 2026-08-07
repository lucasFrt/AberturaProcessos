BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[organizations] (
    [id] NVARCHAR(30) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [isInternal] BIT NOT NULL CONSTRAINT [organizations_isInternal_df] DEFAULT 0,
    [isActive] BIT NOT NULL CONSTRAINT [organizations_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [organizations_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [organizations_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[email_domains] (
    [id] NVARCHAR(30) NOT NULL,
    [domain] NVARCHAR(255) NOT NULL,
    [organizationId] NVARCHAR(30) NOT NULL,
    [defaultRole] NVARCHAR(20) NOT NULL CONSTRAINT [email_domains_defaultRole_df] DEFAULT 'CLIENT',
    [autoApprove] BIT NOT NULL CONSTRAINT [email_domains_autoApprove_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [email_domains_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [email_domains_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [email_domains_domain_key] UNIQUE NONCLUSTERED ([domain])
);

-- CreateTable
CREATE TABLE [dbo].[companies] (
    [id] NVARCHAR(30) NOT NULL,
    [cnpj] NVARCHAR(14) NOT NULL,
    [legalName] NVARCHAR(255) NOT NULL,
    [tradeName] NVARCHAR(255),
    [organizationId] NVARCHAR(30) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [companies_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [companies_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [companies_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [companies_cnpj_key] UNIQUE NONCLUSTERED ([cnpj])
);

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] NVARCHAR(30) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [email] NVARCHAR(255) NOT NULL,
    [passwordHash] NVARCHAR(255),
    [role] NVARCHAR(20) NOT NULL CONSTRAINT [users_role_df] DEFAULT 'CLIENT',
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [users_status_df] DEFAULT 'PENDING',
    [accessScope] NVARCHAR(20) NOT NULL CONSTRAINT [users_accessScope_df] DEFAULT 'ORGANIZATION',
    [organizationId] NVARCHAR(30),
    [avatarUrl] NVARCHAR(1000),
    [lastLoginAt] DATETIME2,
    [approvedAt] DATETIME2,
    [approvedById] NVARCHAR(30),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [users_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[user_identities] (
    [id] NVARCHAR(30) NOT NULL,
    [userId] NVARCHAR(30) NOT NULL,
    [provider] NVARCHAR(20) NOT NULL,
    [providerUserId] NVARCHAR(255) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [user_identities_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [user_identities_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_identities_provider_providerUserId_key] UNIQUE NONCLUSTERED ([provider],[providerUserId])
);

-- CreateTable
CREATE TABLE [dbo].[user_companies] (
    [id] NVARCHAR(30) NOT NULL,
    [userId] NVARCHAR(30) NOT NULL,
    [companyId] NVARCHAR(30) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [user_companies_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [user_companies_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_companies_userId_companyId_key] UNIQUE NONCLUSTERED ([userId],[companyId])
);

-- CreateTable
CREATE TABLE [dbo].[refresh_tokens] (
    [id] NVARCHAR(30) NOT NULL,
    [userId] NVARCHAR(30) NOT NULL,
    [tokenHash] NVARCHAR(64) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [userAgent] NVARCHAR(500),
    [ipAddress] NVARCHAR(64),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [refresh_tokens_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [refresh_tokens_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [refresh_tokens_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[kanban_stages] (
    [id] NVARCHAR(30) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [color] NVARCHAR(9) NOT NULL CONSTRAINT [kanban_stages_color_df] DEFAULT '#1677ff',
    [order] INT NOT NULL,
    [isFinal] BIT NOT NULL CONSTRAINT [kanban_stages_isFinal_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [kanban_stages_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [kanban_stages_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [kanban_stages_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[process_sequences] (
    [year] INT NOT NULL,
    [lastNumber] INT NOT NULL CONSTRAINT [process_sequences_lastNumber_df] DEFAULT 0,
    CONSTRAINT [process_sequences_pkey] PRIMARY KEY CLUSTERED ([year])
);

-- CreateTable
CREATE TABLE [dbo].[processes] (
    [id] NVARCHAR(30) NOT NULL,
    [code] NVARCHAR(20) NOT NULL,
    [reference] NVARCHAR(255) NOT NULL,
    [additionalInfo] NVARCHAR(max),
    [clientCompanyId] NVARCHAR(30) NOT NULL,
    [requestingCompanyId] NVARCHAR(30),
    [currentStageId] NVARCHAR(30) NOT NULL,
    [responsibleId] NVARCHAR(30),
    [createdById] NVARCHAR(30) NOT NULL,
    [stageChangedAt] DATETIME2 NOT NULL CONSTRAINT [processes_stageChangedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [completedAt] DATETIME2,
    [deletedAt] DATETIME2,
    [deletedById] NVARCHAR(30),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [processes_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [processes_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [processes_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[process_history] (
    [id] NVARCHAR(30) NOT NULL,
    [processId] NVARCHAR(30) NOT NULL,
    [action] NVARCHAR(30) NOT NULL,
    [fromStageId] NVARCHAR(30),
    [toStageId] NVARCHAR(30),
    [actorId] NVARCHAR(30) NOT NULL,
    [description] NVARCHAR(1000),
    [metadata] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [process_history_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [process_history_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[documents] (
    [id] NVARCHAR(30) NOT NULL,
    [processId] NVARCHAR(30) NOT NULL,
    [originalName] NVARCHAR(500) NOT NULL,
    [storedName] NVARCHAR(255) NOT NULL,
    [relativePath] NVARCHAR(1000) NOT NULL,
    [mimeType] NVARCHAR(255) NOT NULL,
    [size] INT NOT NULL,
    [sha256] NVARCHAR(64) NOT NULL,
    [uploadedById] NVARCHAR(30) NOT NULL,
    [deletedAt] DATETIME2,
    [deletedById] NVARCHAR(30),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [documents_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [documents_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [organizations_name_idx] ON [dbo].[organizations]([name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [email_domains_organizationId_idx] ON [dbo].[email_domains]([organizationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [companies_organizationId_idx] ON [dbo].[companies]([organizationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [companies_legalName_idx] ON [dbo].[companies]([legalName]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_organizationId_idx] ON [dbo].[users]([organizationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_status_idx] ON [dbo].[users]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_role_idx] ON [dbo].[users]([role]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_identities_userId_idx] ON [dbo].[user_identities]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_companies_companyId_idx] ON [dbo].[user_companies]([companyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [refresh_tokens_userId_idx] ON [dbo].[refresh_tokens]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [refresh_tokens_expiresAt_idx] ON [dbo].[refresh_tokens]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [kanban_stages_order_idx] ON [dbo].[kanban_stages]([order]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [processes_currentStageId_idx] ON [dbo].[processes]([currentStageId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [processes_clientCompanyId_idx] ON [dbo].[processes]([clientCompanyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [processes_requestingCompanyId_idx] ON [dbo].[processes]([requestingCompanyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [processes_responsibleId_idx] ON [dbo].[processes]([responsibleId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [processes_deletedAt_idx] ON [dbo].[processes]([deletedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [processes_createdAt_idx] ON [dbo].[processes]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [process_history_processId_createdAt_idx] ON [dbo].[process_history]([processId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [process_history_action_idx] ON [dbo].[process_history]([action]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [documents_processId_deletedAt_idx] ON [dbo].[documents]([processId], [deletedAt]);

-- AddForeignKey
ALTER TABLE [dbo].[email_domains] ADD CONSTRAINT [email_domains_organizationId_fkey] FOREIGN KEY ([organizationId]) REFERENCES [dbo].[organizations]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[companies] ADD CONSTRAINT [companies_organizationId_fkey] FOREIGN KEY ([organizationId]) REFERENCES [dbo].[organizations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_organizationId_fkey] FOREIGN KEY ([organizationId]) REFERENCES [dbo].[organizations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[user_identities] ADD CONSTRAINT [user_identities_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[user_companies] ADD CONSTRAINT [user_companies_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[user_companies] ADD CONSTRAINT [user_companies_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[companies]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[refresh_tokens] ADD CONSTRAINT [refresh_tokens_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[processes] ADD CONSTRAINT [processes_clientCompanyId_fkey] FOREIGN KEY ([clientCompanyId]) REFERENCES [dbo].[companies]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[processes] ADD CONSTRAINT [processes_requestingCompanyId_fkey] FOREIGN KEY ([requestingCompanyId]) REFERENCES [dbo].[companies]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[processes] ADD CONSTRAINT [processes_currentStageId_fkey] FOREIGN KEY ([currentStageId]) REFERENCES [dbo].[kanban_stages]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[processes] ADD CONSTRAINT [processes_responsibleId_fkey] FOREIGN KEY ([responsibleId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[processes] ADD CONSTRAINT [processes_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[processes] ADD CONSTRAINT [processes_deletedById_fkey] FOREIGN KEY ([deletedById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[process_history] ADD CONSTRAINT [process_history_processId_fkey] FOREIGN KEY ([processId]) REFERENCES [dbo].[processes]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[process_history] ADD CONSTRAINT [process_history_fromStageId_fkey] FOREIGN KEY ([fromStageId]) REFERENCES [dbo].[kanban_stages]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[process_history] ADD CONSTRAINT [process_history_toStageId_fkey] FOREIGN KEY ([toStageId]) REFERENCES [dbo].[kanban_stages]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[process_history] ADD CONSTRAINT [process_history_actorId_fkey] FOREIGN KEY ([actorId]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[documents] ADD CONSTRAINT [documents_processId_fkey] FOREIGN KEY ([processId]) REFERENCES [dbo].[processes]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[documents] ADD CONSTRAINT [documents_uploadedById_fkey] FOREIGN KEY ([uploadedById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[documents] ADD CONSTRAINT [documents_deletedById_fkey] FOREIGN KEY ([deletedById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
