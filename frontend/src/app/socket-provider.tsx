import type { ReactElement, ReactNode } from 'react';
import { useMemo } from 'react';

import { SocketContext } from '@/app/socket-context';
import type { SocketContextValue } from '@/app/socket-context';

/**
 * Provider de tempo real (docs/08, "Tempo real"). A conexão Socket.IO real
 * chega na Tarefa 18; por ora este é um provider no-op que só define o
 * contrato (`isConnected`) para as telas não precisarem ser refatoradas
 * quando a conexão real entrar.
 */
interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps): ReactElement {
  // TODO(Tarefa 18): conectar io(VITE_SOCKET_URL, { auth: { token } }) quando
  // houver accessToken, com invalidação de queries por evento (docs/08).
  const value = useMemo<SocketContextValue>(() => ({ isConnected: false }), []);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
