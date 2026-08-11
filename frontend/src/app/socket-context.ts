import { createContext } from 'react';

/**
 * Chave de query para as etapas do Kanban (docs/08, "Tempo real"; ainda
 * não existe um `features/stages/api/keys.ts` — a Tarefa 20 deve reusar
 * esta chave em vez de criar uma nova).
 */
export const stagesQueryKey = ['stages'] as const;

export interface SocketContextValue {
  isConnected: boolean;
}

export const SocketContext = createContext<SocketContextValue>({ isConnected: false });
