import {
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FileExcelOutlined,
  PlusCircleOutlined,
  SwapOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { Empty, Timeline, Typography } from 'antd';
import type { ReactElement, ReactNode } from 'react';

import type { ProcessHistoryEntryDto } from '@/features/processes/api/process-api';
import { formatDateTime } from '@/shared/lib/format';

/**
 * Ícone por `action` (docs/08, "Gaveta de detalhe" — aba Histórico). Os 7
 * valores possíveis vêm de `backend/src/domain/enums/index.ts`
 * (`HISTORY_ACTIONS`).
 */
const ICON_BY_ACTION: Record<ProcessHistoryEntryDto['action'], ReactNode> = {
  PROCESS_CREATED: <PlusCircleOutlined />,
  PROCESS_UPDATED: <EditOutlined />,
  STAGE_CHANGED: <SwapOutlined />,
  RESPONSIBLE_CHANGED: <UserSwitchOutlined />,
  DOCUMENT_ADDED: <FileAddOutlined />,
  DOCUMENT_REMOVED: <FileExcelOutlined />,
  PROCESS_DELETED: <DeleteOutlined />,
};

const COLOR_BY_ACTION: Record<ProcessHistoryEntryDto['action'], string> = {
  PROCESS_CREATED: 'green',
  PROCESS_UPDATED: 'blue',
  STAGE_CHANGED: 'orange',
  RESPONSIBLE_CHANGED: 'purple',
  DOCUMENT_ADDED: 'blue',
  DOCUMENT_REMOVED: 'red',
  PROCESS_DELETED: 'red',
};

interface HistoryTimelineProps {
  entries: ProcessHistoryEntryDto[];
}

export function HistoryTimeline({ entries }: HistoryTimelineProps): ReactElement {
  if (entries.length === 0) {
    return <Empty description="Sem histórico ainda." />;
  }

  return (
    <Timeline
      items={entries.map((entry) => ({
        key: entry.id,
        color: COLOR_BY_ACTION[entry.action],
        dot: ICON_BY_ACTION[entry.action],
        children: (
          <div>
            <Typography.Text strong>{entry.description ?? entry.action}</Typography.Text>
            {entry.action === 'STAGE_CHANGED' && entry.fromStage && entry.toStage && (
              <div>
                <Typography.Text type="secondary">
                  {entry.fromStage.name} → {entry.toStage.name}
                </Typography.Text>
              </div>
            )}
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {entry.actor.name} · {formatDateTime(entry.createdAt)}
              </Typography.Text>
            </div>
          </div>
        ),
      }))}
    />
  );
}
