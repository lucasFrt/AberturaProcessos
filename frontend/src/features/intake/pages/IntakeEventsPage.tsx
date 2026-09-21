import { useQuery } from '@tanstack/react-query';
import { Alert, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { getIntakeCursor, listIntakeEvents } from '@/features/intake/api/intake-api';
import type {
  IntakeEventDto,
  IntakeEventKind,
  IntakeEventStatus,
} from '@/features/intake/api/intake-api';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format';

const KIND_LABELS: Record<IntakeEventKind, { label: string; color: string }> = {
  PROCESS: { label: 'Processo criado', color: 'green' },
  ATTACHMENT: { label: 'Documento anexado', color: 'blue' },
  IGNORED: { label: 'Sem ação', color: 'default' },
  ESCALATED: { label: 'Precisa de uma pessoa', color: 'orange' },
};

const STATUS_LABELS: Record<IntakeEventStatus, { label: string; color: string }> = {
  COMPLETED: { label: 'Concluído', color: 'green' },
  FAILED: { label: 'Falhou', color: 'red' },
  PROCESSING: { label: 'Em andamento', color: 'processing' },
};

/**
 * O que a IA fez com cada e-mail (docs/13, decisão 12). Substitui o
 * relatório por e-mail: o operacional vê aqui os processos criados, os
 * documentos anexados, o que ficou "sem processo" (documento de embarque
 * que não existe no sistema — criar o processo faz os próximos entrarem
 * sozinhos) e o que precisa de uma pessoa, sempre com o motivo. Só
 * leitura: a decisão de reprocessar é do agente na próxima execução.
 */
export function IntakeEventsPage(): ReactElement {
  const [kind, setKind] = useState<IntakeEventKind | undefined>(undefined);
  const [status, setStatus] = useState<IntakeEventStatus | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['intake', 'events', { kind, status, page }],
    queryFn: () => listIntakeEvents({ kind, status, page, pageSize: 25 }),
  });

  const { data: cursor } = useQuery({
    queryKey: ['intake', 'cursor'],
    queryFn: getIntakeCursor,
  });

  const columns: ColumnsType<IntakeEventDto> = [
    {
      title: 'Recebido',
      key: 'receivedAt',
      width: 150,
      render: (_, record) =>
        record.receivedAt ? (
          <Tooltip title={formatRelativeTime(record.receivedAt)}>
            {formatDateTime(record.receivedAt)}
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: 'Resultado',
      key: 'kind',
      width: 190,
      render: (_, record) => {
        const kindMeta = KIND_LABELS[record.kind];
        const statusMeta = STATUS_LABELS[record.status];
        return (
          <Space size={4} wrap>
            <Tag color={kindMeta.color}>{kindMeta.label}</Tag>
            {record.status !== 'COMPLETED' && (
              <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: 'E-mail',
      key: 'subject',
      render: (_, record) => (
        <>
          <Typography.Text strong>{record.subject ?? '(sem assunto)'}</Typography.Text>
          <br />
          <Typography.Text type="secondary">
            {record.requesterName ? `${record.requesterName} — ` : ''}
            {record.requesterEmail ?? 'remetente não registrado'}
          </Typography.Text>
        </>
      ),
    },
    {
      title: 'Motivo / avisos',
      key: 'reason',
      render: (_, record) => {
        const reason = record.result?.reason ?? null;
        const warnings = record.result?.warnings ?? [];
        return (
          <>
            {reason && <Typography.Text>{reason}</Typography.Text>}
            {record.errorMessage && (
              <Typography.Text type="danger">{record.errorMessage}</Typography.Text>
            )}
            {warnings.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                {warnings.map((warning) => (
                  <li key={warning}>
                    <Typography.Text type="secondary">{warning}</Typography.Text>
                  </li>
                ))}
              </ul>
            )}
            {!reason && !record.errorMessage && warnings.length === 0 && '-'}
          </>
        );
      },
    },
    {
      title: 'Processo',
      key: 'process',
      width: 120,
      render: (_, record) =>
        record.processId ? <Link to={`/processes/${record.processId}`}>abrir processo</Link> : '-',
    },
  ];

  return (
    <>
      <PageHeader title="Intake IA" />
      {cursor && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={
            cursor.receivedAt
              ? `Caixa lida até ${formatDateTime(cursor.receivedAt)} (${formatRelativeTime(cursor.receivedAt)}).`
              : 'A caixa ainda não foi lida pela IA.'
          }
          description="Documentos de embarque que chegam sem processo no sistema aparecem como “Sem ação” com o motivo “sem processo para …”: criar o processo com esses identificadores faz os próximos documentos entrarem sozinhos."
        />
      )}
      <Space style={{ marginBottom: 16 }} wrap>
        <Select<IntakeEventKind>
          allowClear
          placeholder="Resultado"
          style={{ width: 220 }}
          value={kind}
          onChange={(value) => {
            setKind(value);
            setPage(1);
          }}
          options={(Object.keys(KIND_LABELS) as IntakeEventKind[]).map((key) => ({
            value: key,
            label: KIND_LABELS[key].label,
          }))}
        />
        <Select<IntakeEventStatus>
          allowClear
          placeholder="Situação"
          style={{ width: 180 }}
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={(Object.keys(STATUS_LABELS) as IntakeEventStatus[]).map((key) => ({
            value: key,
            label: STATUS_LABELS[key].label,
          }))}
        />
      </Space>
      <Table<IntakeEventDto>
        rowKey="id"
        columns={columns}
        dataSource={data?.data ?? []}
        loading={isLoading}
        pagination={{
          current: page,
          pageSize: 25,
          total: data?.meta.total,
          showSizeChanger: false,
          onChange: (next) => setPage(next),
        }}
      />
    </>
  );
}
