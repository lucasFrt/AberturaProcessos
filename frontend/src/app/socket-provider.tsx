import { useQueryClient } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import { stagesQueryKey, SocketContext } from '@/app/socket-context';
import type { SocketContextValue } from '@/app/socket-context';
import { useAuthStore } from '@/features/auth/store/auth-store';
import { processKeys } from '@/features/processes/api/keys';

/**
 * Payload de `process:moved` (docs/05, "Eventos WebSocket"; docs/07,
 * "Tempo real (Socket.IO)"). Único evento que carrega mais que o
 * `processId`, para permitir atualização otimista da posição do card —
 * aqui só usamos `processId` para invalidar o detalhe.
 */
interface ProcessMovedPayload {
  processId: string;
  fromStageId: string;
  toStageId: string;
  actor: { id: string; name: string };
  at: string;
}

interface ProcessUpdatedPayload {
  processId: string;
}

/**
 * Provider de tempo real (docs/08, "Tempo real"; docs/07, "Handshake
 * autenticado"). Conecta quando há `accessToken` no auth-store e
 * reconecta com o token novo sempre que ele mudar (ex.: depois de um
 * refresh silencioso disparado pelo `http-client`). O evento serve como
 * gatilho de invalidação, não como fonte de dados — cada cliente refaz a
 * busca já sob suas próprias regras de escopo (docs/08).
 */
interface SocketProviderProps {
  children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps): ReactElement {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      return undefined;
    }

    const socket: Socket = io(import.meta.env.VITE_SOCKET_URL, {
      auth: { token: accessToken },
      withCredentials: true,
    });

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('connect_error', () => setIsConnected(false));

    // `process:created`/`process:deleted` só carregam `processId` (ou nada,
    // no caso de `created`, que carrega o processo inteiro) — o board é
    // invalidado por prefixo de chave porque os filtros variam por coluna.
    socket.on('process:created', () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'board',
      });
    });

    socket.on('process:deleted', () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'board',
      });
    });

    socket.on('process:moved', (payload: ProcessMovedPayload) => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'board',
      });
      void queryClient.invalidateQueries({ queryKey: processKeys.detail(payload.processId) });
    });

    socket.on('process:updated', (payload: ProcessUpdatedPayload) => {
      void queryClient.invalidateQueries({ queryKey: processKeys.detail(payload.processId) });
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'board',
      });
    });

    socket.on('stages:changed', () => {
      void queryClient.invalidateQueries({ queryKey: stagesQueryKey });
    });

    return () => {
      socket.disconnect();
    };
  }, [accessToken, queryClient]);

  const value: SocketContextValue = { isConnected };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
