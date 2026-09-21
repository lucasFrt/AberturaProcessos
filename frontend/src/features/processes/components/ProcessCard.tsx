import { FileOutlined, MailOutlined } from '@ant-design/icons';
import { Avatar, Card, Flex, Tag, Tooltip, Typography } from 'antd';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ProcessListItemDto } from '@/features/processes/api/process-api';
import { formatCompanyDocument } from '@/shared/lib/cnpj';
import { formatRelativeTime } from '@/shared/lib/format';

/**
 * Limiar de destaque por tempo parado na etapa (docs/08 não especifica o
 * número exato — escolha documentada aqui: 6 dias, meio do intervalo
 * "5-7 dias" sugerido no prompt da tarefa).
 */
const STALE_STAGE_THRESHOLD_DAYS = 6;

function daysSince(isoValue: string): number {
  const diffMs = Date.now() - new Date(isoValue).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

interface ProcessCardProps {
  process: ProcessListItemDto;
}

/**
 * Card do board (docs/08, "Board Kanban"): código, referência (2 linhas
 * com ellipsis), tag do CNPJ cliente, avatar do responsável, contagem de
 * documentos e tempo na etapa. Destaque discreto (borda laranja) quando
 * parado há muitos dias na mesma etapa.
 */
export function ProcessCard({ process }: ProcessCardProps): ReactElement {
  const navigate = useNavigate();
  const isStale = daysSince(process.stageChangedAt) >= STALE_STAGE_THRESHOLD_DAYS;

  // Abre a gaveta de detalhe (docs/08, "Gaveta de detalhe"; docs/12,
  // Tarefa 19). O card fica dentro do `Draggable` do dnd (que já cuida do
  // próprio tabIndex/teclado), então o clique aqui é só navegação — sem
  // interferir no drag-and-drop, que dispara em pointer down/move, não em
  // click simples.
  function handleOpen(): void {
    void navigate(`/processes/${process.id}`);
  }

  return (
    <Card
      size="small"
      hoverable
      onClick={handleOpen}
      style={{
        marginBottom: 8,
        borderColor: isStale ? '#faad14' : undefined,
        borderWidth: isStale ? 2 : 1,
      }}
      styles={{ body: { padding: 12 } }}
    >
      <Flex vertical gap={4}>
        <Typography.Text strong>{process.code}</Typography.Text>

        <Typography.Paragraph
          style={{ margin: 0, minHeight: 40 }}
          ellipsis={{ rows: 2, tooltip: process.reference }}
        >
          {process.reference}
        </Typography.Paragraph>

        <Flex gap={4} wrap>
          <Tag>{formatCompanyDocument(process.clientCompany.cnpj)}</Tag>
          {process.ilogNumber && (
            <Tooltip title="Número do processo no iLog">
              <Tag color="purple">iLog {process.ilogNumber}</Tag>
            </Tooltip>
          )}
          {process.source === 'EMAIL' && (
            <Tooltip
              title={
                process.requesterEmail
                  ? `Aberto por e-mail — ${process.requesterName ?? ''} <${process.requesterEmail}>`
                  : 'Aberto por e-mail'
              }
            >
              <Tag color="geekblue" icon={<MailOutlined aria-hidden />}>
                e-mail
              </Tag>
            </Tooltip>
          )}
        </Flex>

        <Flex justify="space-between" align="center">
          <Tooltip title={process.responsible?.name ?? 'Sem responsável'}>
            <Avatar size="small">
              {process.responsible?.name?.charAt(0).toUpperCase() ?? '?'}
            </Avatar>
          </Tooltip>

          <Tooltip title={`${process.documentCount} documento(s)`}>
            <span>
              <FileOutlined aria-hidden /> {process.documentCount}
            </span>
          </Tooltip>

          <Typography.Text
            type={isStale ? 'warning' : 'secondary'}
            style={{ fontSize: 12 }}
            title={isStale ? `Parado há muitos dias nesta etapa` : undefined}
          >
            {formatRelativeTime(process.stageChangedAt)}
          </Typography.Text>
        </Flex>
      </Flex>
    </Card>
  );
}
