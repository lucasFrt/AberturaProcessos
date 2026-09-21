-- Tarefa 27 (docs/13, decisão 9): IGNORED e ESCALATED passam a ser kinds de
-- IntakeEvent, para o cursor do intake avançar por e-mails que não viram
-- processo. Espelha INTAKE_EVENT_KINDS de backend/src/domain/enums.
ALTER TABLE [dbo].[intake_events] DROP CONSTRAINT [CK_intake_events_kind];

ALTER TABLE [dbo].[intake_events] ADD CONSTRAINT [CK_intake_events_kind]
  CHECK ([kind] IN ('PROCESS','ATTACHMENT','IGNORED','ESCALATED'));

-- Cursor: "maior receivedAt com status X" por canal.
CREATE NONCLUSTERED INDEX [intake_events_channel_status_receivedAt_idx]
  ON [dbo].[intake_events]([channel], [status], [receivedAt]);
