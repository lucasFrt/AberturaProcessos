import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import ptBR from 'antd/locale/pt_BR';
import type { ReactElement, ReactNode } from 'react';

import { queryClient } from '@/app/query-client';
import { SocketProvider } from '@/app/socket-provider';

/**
 * Providers de topo (docs/08, `app/providers.tsx`): QueryClient,
 * ConfigProvider do AntD com locale pt-BR, e SocketProvider (estrutura
 * pronta para a Tarefa 18). `AntApp` habilita os hooks estáticos
 * (`message`, `notification`) usados pelos guards de rota.
 */
interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps): ReactElement {
  return (
    <ConfigProvider locale={ptBR}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <SocketProvider>{children}</SocketProvider>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
