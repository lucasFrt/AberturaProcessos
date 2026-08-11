import { create } from 'zustand';

import type { CurrentUser } from '@/shared/types';

/**
 * Sessão do usuário (docs/08, "Estado"). Zustand **sem** `persist`: o
 * access token vive só em memória. Ao recarregar a página, o bootstrap
 * (`app/providers.tsx` / `App.tsx`) chama `POST /auth/refresh` usando o
 * cookie httpOnly para reconstruir a sessão, sem guardar token no
 * `localStorage`.
 */
interface AuthState {
  accessToken: string | null;
  user: CurrentUser | null;
  /** `null` enquanto o bootstrap (refresh + /auth/me) ainda não terminou. */
  isBootstrapped: boolean;
  setSession: (input: { accessToken: string; user: CurrentUser }) => void;
  setAccessToken: (accessToken: string) => void;
  setBootstrapped: () => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isBootstrapped: false,
  setSession: ({ accessToken, user }) => set({ accessToken, user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  setBootstrapped: () => set({ isBootstrapped: true }),
  clear: () => set({ accessToken: null, user: null }),
}));
