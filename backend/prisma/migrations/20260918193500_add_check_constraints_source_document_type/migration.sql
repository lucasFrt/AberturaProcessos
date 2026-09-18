-- Migration manual, separada da anterior de propósito: o SQL Server compila o
-- batch inteiro antes de executar, então uma CHECK constraint sobre coluna
-- adicionada no mesmo batch falha com "Invalid column name" (mesmo motivo de
-- 20260807190618_add_check_constraints ser separada da init).
-- CHECK constraints espelhando domain/enums (docs/04, "CHECK constraints").
-- Sem enum nativo no SQL Server, estas constraints são a rede de segurança
-- abaixo da validação Zod; o teste enum-check-constraints-consistency
-- confere que aceitam exatamente os valores dos arrays em domain/enums.
ALTER TABLE [companies] ADD CONSTRAINT [CK_companies_document_type]
  CHECK ([documentType] IN ('CNPJ','CPF'));

ALTER TABLE [processes] ADD CONSTRAINT [CK_processes_source]
  CHECK ([source] IN ('WEB','EMAIL','API'));

ALTER TABLE [documents] ADD CONSTRAINT [CK_documents_source]
  CHECK ([source] IN ('WEB','EMAIL','API'));

