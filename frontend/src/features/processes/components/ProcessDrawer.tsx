import { Drawer, Grid, Tabs } from 'antd';
import type { ReactElement } from 'react';

import { DocumentsTab } from '@/features/processes/components/DocumentsTab';
import { HistoryTab } from '@/features/processes/components/HistoryTab';
import { ProcessDataTab } from '@/features/processes/components/ProcessDataTab';
import { useProcessDetail } from '@/features/processes/hooks/useProcessDetail';
import { EmptyState } from '@/shared/components/EmptyState';

interface ProcessDrawerProps {
  processId: string;
  open: boolean;
  onClose: () => void;
}

/**
 * Gaveta de detalhe do processo (docs/08, "Gaveta de detalhe"; docs/12,
 * Tarefa 19). `Drawer` lateral de 720px, largura total no mobile (via
 * `Grid.useBreakpoint`), com três abas: Dados, Documentos e Histórico.
 */
export function ProcessDrawer({ processId, open, onClose }: ProcessDrawerProps): ReactElement {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.sm;
  const { data: process, isLoading, isError } = useProcessDetail(open ? processId : undefined);

  return (
    <Drawer
      title={process ? `${process.code} — ${process.reference}` : 'Processo'}
      open={open}
      onClose={onClose}
      width={isMobile ? '100%' : 720}
      destroyOnHidden
    >
      {isError && <EmptyState description="Não foi possível carregar o processo." />}
      {!isError && (isLoading || !process) && <EmptyState description="Carregando..." />}
      {process && (
        <Tabs
          defaultActiveKey="data"
          items={[
            {
              key: 'data',
              label: 'Dados',
              children: <ProcessDataTab process={process} />,
            },
            {
              key: 'documents',
              label: 'Documentos',
              children: <DocumentsTab process={process} />,
            },
            {
              key: 'history',
              label: 'Histórico',
              children: <HistoryTab processId={process.id} />,
            },
          ]}
        />
      )}
    </Drawer>
  );
}
