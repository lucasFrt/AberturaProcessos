import { Flex, Typography } from 'antd';
import type { ReactElement, ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  extra?: ReactNode;
}

/** Cabeçalho padrão de página: título à esquerda, ações à direita. */
export function PageHeader({ title, extra }: PageHeaderProps): ReactElement {
  return (
    <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      {extra}
    </Flex>
  );
}
