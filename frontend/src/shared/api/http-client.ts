import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { useAuthStore } from '@/features/auth/store/auth-store';
import type { ApiErrorBody } from '@/shared/types';

/**
 * Cliente HTTP com refresh transparente e fila (docs/08, "Cliente HTTP").
 * `withCredentials: true` é necessário para o cookie httpOnly do refresh
 * token. O access token vive só em memória (auth-store, sem `persist`).
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

/**
 * Instância "crua", sem os interceptors de `api`, usada só para o próprio
 * `POST /auth/refresh`. Evita que uma falha do refresh dispare o mesmo
 * interceptor de resposta recursivamente.
 */
const rawApi = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

async function refreshAccessToken(): Promise<string> {
  const { data } = await rawApi.post<RefreshResponse>('/auth/refresh');
  useAuthStore.getState().setAccessToken(data.accessToken);
  return data.accessToken;
}

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean;
}

let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as RetriableConfig | undefined;
    const code = error.response?.data?.error?.code;
    const isRefreshCall = original?.url === '/auth/refresh';

    if (
      error.response?.status === 401 &&
      code === 'UNAUTHENTICATED' &&
      original &&
      !original._retried &&
      !isRefreshCall
    ) {
      original._retried = true;
      refreshing ??= refreshAccessToken().finally(() => {
        refreshing = null;
      });

      try {
        const token = await refreshing;
        original.headers.set('Authorization', `Bearer ${token}`);
        return await api(original);
      } catch {
        useAuthStore.getState().clear();
        window.location.assign('/login');
        return await Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

export { refreshAccessToken };
