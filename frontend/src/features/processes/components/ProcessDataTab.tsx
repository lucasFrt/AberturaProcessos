import { useQuery } from '@tanstack/react-query';
import { App, Button, Descriptions, Flex, Input, Select, Tag, Tooltip, Typography } from 'antd';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { listOperationalUsers } from '@/features/admin/api/user-management-api';
import type { ProcessDetailDto } from '@/features/processes/api/process-api';
import {
  PROCESS_IDENTIFIER_KIND_LABELS,
  PROCESS_IDENTIFIER_SOURCE_LABELS,
  RECORD_SOURCE_LABELS,
} from '@/features/processes/api/process-api';
import { MoveStageModal } from '@/features/processes/components/MoveStageModal';
import { useAssignResponsible } from '@/features/processes/hooks/useAssignResponsible';
import { useUpdateProcess } from '@/features/processes/hooks/useUpdateProcess';
import { translateError } from '@/shared/api/errors';
import { formatCompanyDocument } from '@/shared/lib/cnpj';
import { formatDateTime } from '@/shared/lib/format';

interface ProcessDataTabProps {
  process: ProcessDetailDto;
}

type SaveState = 'idle' | 'saving' | 'saved';

/**
 * Aba "Dados" da gaveta (docs/08, "Gaveta de detalhe"): edição inline de
 * referência/adicionais salvando no blur com indicador de estado, CNPJs,
 * responsável (só com `canAssign`) e etapa atual com botão de mover (só
 * com `canMove`).
 */
export function ProcessDataTab({ process }: ProcessDataTabProps): ReactElement {
  const { message } = App.useApp();
  const { mutate: updateProcess } = useUpdateProcess();
  const { mutate: assignResponsible, isPending: isAssigning } = useAssignResponsible();

  const [reference, setReference] = useState(process.reference);
  const [additionalInfo, setAdditionalInfo] = useState(process.additionalInfo ?? '');
  const [referenceState, setReferenceState] = useState<SaveState>('idle');
  const [additionalInfoState, setAdditionalInfoState] = useState<SaveState>('idle');
  const [moveModalOpen, setMoveModalOpen] = useState(false);

  // Sincroniza com o servidor quando o processo muda (troca de gaveta ou
  // atualização por outro usuário via tempo real) sem sobrescrever o que
  // o próprio usuário está digitando. Ajuste durante a renderização
  // (padrão oficial do React para "resetar estado quando uma prop muda",
  // já usado em `KanbanBoard`), não em efeito.
  const [syncedReference, setSyncedReference] = useState(process.reference);
  if (syncedReference !== process.reference) {
    setSyncedReference(process.reference);
    setReference(process.reference);
  }
  const [syncedAdditionalInfo, setSyncedAdditionalInfo] = useState(process.additionalInfo ?? '');
  if (syncedAdditionalInfo !== (process.additionalInfo ?? '')) {
    setSyncedAdditionalInfo(process.additionalInfo ?? '');
    setAdditionalInfo(process.additionalInfo ?? '');
  }

  const { data: operationalUsers, isLoading: isLoadingUsers } = useQuery({
    queryKey: ['users', 'operational'],
    queryFn: listOperationalUsers,
    enabled: process.permissions.canAssign,
  });

  function saveField(
    field: 'reference' | 'additionalInfo',
    value: string,
    originalValue: string,
    setState: (state: SaveState) => void,
  ): void {
    if (value === originalValue) return;

    setState('saving');
    updateProcess(
      { processId: process.id, payload: { [field]: value } },
      {
        onSuccess: () => {
          setState('saved');
          setTimeout(() => setState('idle'), 2000);
        },
        onError: (error) => {
          setState('idle');
          void message.error(translateError(error));
        },
      },
    );
  }

  function saveStateLabel(state: SaveState): string | null {
    if (state === 'saving') return 'Salvando...';
    if (state === 'saved') return 'Salvo';
    return null;
  }

  function handleResponsibleChange(value: string | null): void {
    assignResponsible(
      { processId: process.id, responsibleId: value ?? null },
      {
        onSuccess: () => void message.success('Responsável atualizado.'),
      },
    );
  }

  return (
    <Flex vertical gap={16}>
      <div>
        <Typography.Text strong>Referência</Typography.Text>
        <Input
          value={reference}
          disabled={!process.permissions.canEdit}
          onChange={(event) => setReference(event.target.value)}
          onBlur={() => saveField('reference', reference, process.reference, setReferenceState)}
          aria-label="Referência"
        />
        {saveStateLabel(referenceState) && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {saveStateLabel(referenceState)}
          </Typography.Text>
        )}
      </div>

      <div>
        <Typography.Text strong>Adicionais</Typography.Text>
        <Input.TextArea
          rows={4}
          maxLength={10_000}
          value={additionalInfo}
          disabled={!process.permissions.canEdit}
          onChange={(event) => setAdditionalInfo(event.target.value)}
          onBlur={() =>
            saveField(
              'additionalInfo',
              additionalInfo,
              process.additionalInfo ?? '',
              setAdditionalInfoState,
            )
          }
          aria-label="Adicionais"
        />
        {saveStateLabel(additionalInfoState) && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {saveStateLabel(additionalInfoState)}
          </Typography.Text>
        )}
      </div>

      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="Cliente">
          {formatCompanyDocument(process.clientCompany.cnpj)} — {process.clientCompany.legalName}
        </Descriptions.Item>
        {process.requestingCompany && (
          <Descriptions.Item label="Solicitante (empresa)">
            {formatCompanyDocument(process.requestingCompany.cnpj)} —{' '}
            {process.requestingCompany.legalName}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Origem">
          <Tag
            color={
              process.source === 'EMAIL'
                ? 'geekblue'
                : process.source === 'ILOG'
                  ? 'purple'
                  : 'default'
            }
          >
            {RECORD_SOURCE_LABELS[process.source]}
          </Tag>
          {process.receivedAt && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              recebido em {formatDateTime(process.receivedAt)}
            </Typography.Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="iLog">
          {process.ilogNumber ? (
            <>
              <Tag color="purple">{process.ilogNumber}</Tag>
              {process.ilogSyncedAt && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  lido em {formatDateTime(process.ilogSyncedAt)}
                </Typography.Text>
              )}
            </>
          ) : (
            <Typography.Text type="secondary">ainda sem processo no iLog</Typography.Text>
          )}
        </Descriptions.Item>
        {process.identifiers.length > 0 && (
          <Descriptions.Item label="Identificadores">
            <Flex gap={4} wrap>
              {process.identifiers.map((identifier) => (
                <Tooltip
                  key={identifier.id}
                  title={`${PROCESS_IDENTIFIER_KIND_LABELS[identifier.kind]} · origem: ${PROCESS_IDENTIFIER_SOURCE_LABELS[identifier.source]}`}
                >
                  <Tag color={identifier.source === 'ILOG' ? 'purple' : 'default'}>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {PROCESS_IDENTIFIER_KIND_LABELS[identifier.kind]}{' '}
                    </Typography.Text>
                    {identifier.value}
                  </Tag>
                </Tooltip>
              ))}
            </Flex>
          </Descriptions.Item>
        )}
        {(process.requesterName || process.requesterEmail) && (
          <Descriptions.Item label="Solicitante (pessoa)">
            {process.requesterName ?? '—'}
            {process.requesterEmail && (
              <>
                {' '}
                <Typography.Link href={`mailto:${process.requesterEmail}`}>
                  &lt;{process.requesterEmail}&gt;
                </Typography.Link>
              </>
            )}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Responsável">
          {process.permissions.canAssign ? (
            <Select
              style={{ width: '100%' }}
              allowClear
              placeholder="Sem responsável"
              loading={isLoadingUsers}
              disabled={isAssigning}
              value={process.responsible?.id}
              options={(operationalUsers ?? []).map((user) => ({
                value: user.id,
                label: user.name,
              }))}
              onChange={(value: string | undefined) => handleResponsibleChange(value ?? null)}
              onClear={() => handleResponsibleChange(null)}
              aria-label="Responsável"
            />
          ) : (
            (process.responsible?.name ?? 'Sem responsável')
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Etapa atual">
          <Flex align="center" gap={8}>
            <Tag color={process.currentStage.color}>{process.currentStage.name}</Tag>
            {process.permissions.canMove && (
              <Button size="small" onClick={() => setMoveModalOpen(true)}>
                Mover etapa
              </Button>
            )}
          </Flex>
        </Descriptions.Item>
        <Descriptions.Item label="Criado por">{process.createdBy.name}</Descriptions.Item>
        <Descriptions.Item label="Criado em">{formatDateTime(process.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Última alteração de etapa">
          {formatDateTime(process.stageChangedAt)}
        </Descriptions.Item>
        {process.completedAt && (
          <Descriptions.Item label="Concluído em">
            {formatDateTime(process.completedAt)}
          </Descriptions.Item>
        )}
      </Descriptions>

      {process.permissions.canMove && (
        <MoveStageModal
          open={moveModalOpen}
          processId={process.id}
          currentStageId={process.currentStage.id}
          onClose={() => setMoveModalOpen(false)}
        />
      )}
    </Flex>
  );
}
