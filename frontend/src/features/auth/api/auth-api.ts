import { api } from '@/shared/api/http-client';
import type { CurrentUser } from '@/shared/types';

/** Payloads e chamadas de `/auth/*` (docs/05, seção "Autenticação"). */

export interface LoginPayload {
  email: string;
  password: string;
}

export interface OrganizationRef {
  id: string;
  name: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    name: string;
    email: string;
    role: 'CLIENT' | 'OPERATIONAL' | 'ADMIN';
    organization: OrganizationRef | null;
  };
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', payload);
  return data;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export type RegisterResponse =
  { status: 'PENDING'; message: string } | ({ status: 'ACTIVE'; message: string } & LoginResponse);

export async function register(payload: RegisterPayload): Promise<RegisterResponse> {
  const { data } = await api.post<RegisterResponse>('/auth/register', payload);
  return data;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export async function refresh(): Promise<RefreshResponse> {
  const { data } = await api.post<RefreshResponse>('/auth/refresh');
  return data;
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function me(): Promise<CurrentUser> {
  const { data } = await api.get<CurrentUser>('/auth/me');
  return data;
}

export interface ProvidersResponse {
  local: boolean;
  google: boolean;
  microsoft: boolean;
}

export async function getProviders(): Promise<ProvidersResponse> {
  const { data } = await api.get<ProvidersResponse>('/auth/providers');
  return data;
}
