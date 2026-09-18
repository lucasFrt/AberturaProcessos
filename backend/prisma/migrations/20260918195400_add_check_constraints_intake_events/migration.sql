-- Migration manual, separada da que cria a tabela (mesmo motivo de
-- 20260918193500: o SQL Server compila o batch antes de executar). Espelha
-- INTAKE_CHANNELS / INTAKE_EVENT_KINDS / INTAKE_EVENT_STATUSES de
-- backend/src/domain/enums (docs/04, "CHECK constraints"; docs/13).
ALTER TABLE [intake_events] ADD CONSTRAINT [CK_intake_events_channel]
  CHECK ([channel] IN ('EMAIL'));

ALTER TABLE [intake_events] ADD CONSTRAINT [CK_intake_events_kind]
  CHECK ([kind] IN ('PROCESS','ATTACHMENT'));

ALTER TABLE [intake_events] ADD CONSTRAINT [CK_intake_events_status]
  CHECK ([status] IN ('PROCESSING','COMPLETED','FAILED'));
