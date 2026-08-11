import { App } from 'antd';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { createProcess, uploadDocuments } from '@/features/processes/api/process-api';
import type { ProcessFormValues } from '@/features/processes/components/ProcessForm';
import { ProcessForm } from '@/features/processes/components/ProcessForm';
import { translateError } from '@/shared/api/errors';
import { PageHeader } from '@/shared/components/PageHeader';

/**
 * `/processes/new` (docs/08, "Abertura de processo"; docs/12, Tarefa 16).
 * Submissão em dois passos: `POST /processes` e, se houver arquivos,
 * `POST /processes/:id/documents`. Falha no upload NÃO desfaz o processo
 * criado — apenas avisa que os anexos precisam ser reenviados na tela de
 * detalhe. `/processes/${'{id}'}` abre a gaveta de detalhe (`ProcessDrawer`,
 * docs/12 Tarefa 19), onde o usuário reenvia o(s) arquivo(s) que falharam.
 */
export function NewProcessPage(): ReactElement {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const uploadInFlightRef = useRef(false);

  // Duplo clique não cria dois processos: o botão do ProcessForm já
  // desabilita durante `isSubmitting`, e a guarda abaixo bloqueia uma
  // segunda chamada mesmo se o evento disparar de novo antes do re-render.
  const submissionInFlightRef = useRef(false);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      if (uploadInFlightRef.current) {
        event.preventDefault();
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  async function handleSubmit(values: ProcessFormValues, files: File[]): Promise<void> {
    if (submissionInFlightRef.current) return;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);

    try {
      const process = await createProcess({
        clientCompanyId: values.clientCompanyId,
        requestingCompanyId: values.hasRequestingCompany ? values.requestingCompanyId : null,
        reference: values.reference,
        additionalInfo: values.additionalInfo.trim() ? values.additionalInfo : null,
      });

      if (files.length > 0) {
        uploadInFlightRef.current = true;
        try {
          await uploadDocuments(process.id, files);
          uploadInFlightRef.current = false;
          void message.success(`Processo ${process.code} criado com sucesso.`);
        } catch (uploadError) {
          uploadInFlightRef.current = false;
          void message.warning(
            `Processo ${process.code} foi criado, mas os anexos precisam ser reenviados: ${translateError(uploadError)}`,
          );
        }
      } else {
        void message.success(`Processo ${process.code} criado com sucesso.`);
      }

      void navigate(`/processes/${process.id}`, { replace: true });
    } catch (error) {
      void message.error(translateError(error));
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Novo processo" />
      <ProcessForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
    </div>
  );
}
