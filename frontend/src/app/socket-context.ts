import { createContext } from 'react';

export interface SocketContextValue {
  isConnected: boolean;
}

export const SocketContext = createContext<SocketContextValue>({ isConnected: false });
