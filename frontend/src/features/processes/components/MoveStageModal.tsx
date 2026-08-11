import { useQuery } from '@tanstack/react-query';
import { App, Input, Modal, Select } from 'antd';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { useMoveProcessStage } from '@/features/processes/hooks/useMoveProcessStage';
import { listStages } from '@/features/stages/api/stage-api';
import { translateError } from '@/shared/api/errors';

interface MoveStageModalProps {
  open: boolean;
  processId: string;
  currentStageId: string;
  onClose: () => void;
}

/**
 * Modal de seleção da etapa destino, acionado pelo botão "Mover etapa" da
 * aba Dados (docs/08, "Gaveta de detalhe"). Reaproveita `useMoveProcessStage`
 * (variante não otimista de `PATCH /processes/:id/stage`, já que aqui não
 * há coluna de board para atualizar localmente).
 */
export function MoveStageModal({
  open,
  processId,
  currentStageId,
  onClose,
}: MoveStageModalProps): ReactElement {
  const { message } = App.useApp();
  const [toStageId, setToStageId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { mutate: moveStage, isPending } = useMoveProcessStage();

  const { data: stages, isLoading } = useQuery({
    queryKey: ['stages'],
    queryFn: listStages,
    enabled: open,
  });

  const stageOptions = (stages ?? [])
    .filter((stage) => stage.id !== currentStageId)
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({ value: stage.id, label: stage.name }));

  function handleClose(): void {
    setToStageId(null);
    setNote('');
    onClose();
  }

  function handleOk(): void {
    if (!toStageId) {
      void message.error('Selecione a etapa destino.');
      return;
    }
    moveStage(
      { processId, toStageId, note: note.trim() || null },
      {
        onSuccess: () => {
          void message.success('Etapa alterada.');
          handleClose();
        },
        onError: (error) => void message.error(translateError(error)),
      },
    );
  }

  return (
    <Modal
      title="Mover etapa"
      open={open}
      onCancel={handleClose}
      onOk={handleOk}
      okButtonProps={{ loading: isPending, disabled: !toStageId }}
      okText="Mover"
      cancelText="Cancelar"
      destroyOnHidden
    >
      <Select
        style={{ width: '100%', marginBottom: 12 }}
        placeholder="Etapa destino"
        loading={isLoading}
        options={stageOptions}
        value={toStageId ?? undefined}
        onChange={setToStageId}
        aria-label="Etapa destino"
      />
      <Input.TextArea
        placeholder="Nota (opcional)"
        rows={3}
        maxLength={1000}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-label="Nota"
      />
    </Modal>
  );
}
