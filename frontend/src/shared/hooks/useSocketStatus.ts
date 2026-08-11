import { useContext } from 'react';

import { SocketContext } from '@/app/socket-context';
import type { SocketContextValue } from '@/app/socket-context';

/** Lê o estado de conexão do SocketProvider (docs/08, "Tempo real"). */
export function useSocketStatus(): SocketContextValue {
  return useContext(SocketContext);
}
