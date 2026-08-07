-- Migration manual (não gerada pelo `prisma migrate dev` a partir do schema).
-- SQL Server + Prisma não suporta `enum` nativo (ver docs/04-modelo-de-dados.md),
-- então os "enums" do domínio são colunas String. Esta migration adiciona
-- CHECK constraints para garantir a integridade desses valores no banco,
-- como rede de segurança abaixo da validação Zod da aplicação.
--
-- Sempre que um valor for adicionado/removido em backend/src/domain/enums,
-- esta constraint correspondente precisa ser atualizada por nova migration.

ALTER TABLE [users] ADD CONSTRAINT [CK_users_role]
  CHECK ([role] IN ('CLIENT','OPERATIONAL','ADMIN'));

ALTER TABLE [users] ADD CONSTRAINT [CK_users_status]
  CHECK ([status] IN ('PENDING','ACTIVE','DISABLED','REJECTED'));

ALTER TABLE [users] ADD CONSTRAINT [CK_users_access_scope]
  CHECK ([accessScope] IN ('ORGANIZATION','COMPANIES'));

ALTER TABLE [user_identities] ADD CONSTRAINT [CK_user_identities_provider]
  CHECK ([provider] IN ('LOCAL','GOOGLE','MICROSOFT'));

ALTER TABLE [email_domains] ADD CONSTRAINT [CK_email_domains_default_role]
  CHECK ([defaultRole] IN ('CLIENT','OPERATIONAL','ADMIN'));

ALTER TABLE [process_history] ADD CONSTRAINT [CK_process_history_action]
  CHECK ([action] IN ('PROCESS_CREATED','PROCESS_UPDATED','STAGE_CHANGED',
                      'RESPONSIBLE_CHANGED','DOCUMENT_ADDED','DOCUMENT_REMOVED',
                      'PROCESS_DELETED'));
