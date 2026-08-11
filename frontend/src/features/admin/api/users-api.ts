import { api } from '@/shared/api/http-client';
import type { AccessScopeKind, Paginated, Role, UserStatus } from '@/shared/types';

/**
 * Gestão de usuários para ADMIN (docs/05, "Usuários (ADMIN)").
 * O `listOperationalUsers` de `user-management-api.ts` é mantido
 * separado pois é acessível a OPERATIONAL também.
 */

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  avatarUrl: string | null;
  organization: { id: string; name: string } | null;
  accessScope: AccessScopeKind;
  createdAt: string;
  updatedAt: string;
}

export interface ListUsersParams {
  q?: string;
  status?: UserStatus;
  role?: Role;
  organizationId?: string;
  page?: number;
  pageSize?: number;
}

export async function listUsers(params: ListUsersParams = {}): Promise<Paginated<UserDto>> {
  const { data } = await api.get<Paginated<UserDto>>('/users', { params });
  return data;
}

export async function listPendingUsers(): Promise<Paginated<UserDto>> {
  const { data } = await api.get<Paginated<UserDto>>('/users/pending');
  return data;
}

export async function getUser(id: string): Promise<UserDto> {
  const { data } = await api.get<UserDto>(`/users/${id}`);
  return data;
}

export interface ApproveUserPayload {
  role: Role;
  organizationId: string;
  accessScope: AccessScopeKind;
  companyIds?: string[];
}

export async function approveUser(id: string, payload: ApproveUserPayload): Promise<void> {
  await api.post(`/users/${id}/approve`, payload);
}

export interface RejectUserPayload {
  reason?: string;
}

export async function rejectUser(id: string, payload: RejectUserPayload = {}): Promise<void> {
  await api.post(`/users/${id}/reject`, payload);
}

export interface UpdateUserPayload {
  name?: string;
  role?: Role;
  status?: UserStatus;
  organizationId?: string;
  accessScope?: AccessScopeKind;
}

export async function updateUser(id: string, payload: UpdateUserPayload): Promise<void> {
  await api.patch(`/users/${id}`, payload);
}

export async function replaceUserCompanies(
  id: string,
  payload: { companyIds: string[] },
): Promise<void> {
  await api.put(`/users/${id}/companies`, payload);
}
