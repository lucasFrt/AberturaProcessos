import { Empty } from 'antd';
import type { ReactElement, ReactNode } from 'react';

interface EmptyStateProps {
  description?: ReactNode;
}

/** Estado vazio padrão para listas/tabelas/gráficos sem dados. */
export function EmptyState({
  description = 'Nenhum dado encontrado.',
}: EmptyStateProps): ReactElement {
  return (
    <div style={{ padding: '48px 0' }}>
      <Empty description={description} />
    </div>
  );
}
