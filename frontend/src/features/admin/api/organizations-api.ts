import { api } from '@/shared/api/http-client';
import type { Paginated } from '@/shared/types';

/**
 * CRUD de organizações e domínios (docs/05, "Organizações (ADMIN)").
 * Todas as rotas exigem papel ADMIN.
 */

export interface OrganizationDto {
  id: string;
  name: string;
  isInternal: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DomainDto {
  id: string;
  domain: string;
  defaultRole: string;
  autoApprove: boolean;
  organizationId: string;
  createdAt: string;
}

export interface ListOrganizationsParams {
  q?: string;
  isInternal?: boolean;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listOrganizations(
  params: ListOrganizationsParams = {},
): Promise<Paginated<OrganizationDto>> {
  const { data } = await api.get<Paginated<OrganizationDto>>('/organizations', { params });
  return data;
}

export interface CreateOrganizationPayload {
  name: string;
  isInternal?: boolean;
}

export async function createOrganization(
  payload: CreateOrganizationPayload,
): Promise<OrganizationDto> {
  const { data } = await api.post<OrganizationDto>('/organizations', payload);
  return data;
}

export interface UpdateOrganizationPayload {
  name?: string;
  isActive?: boolean;
}

export async function updateOrganization(
  id: string,
  payload: UpdateOrganizationPayload,
): Promise<OrganizationDto> {
  const { data } = await api.patch<OrganizationDto>(`/organizations/${id}`, payload);
  return data;
}

export async function deleteOrganization(id: string): Promise<void> {
  await api.delete(`/organizations/${id}`);
}

export async function listDomains(orgId: string): Promise<DomainDto[]> {
  const { data } = await api.get<{ data: DomainDto[] }>(`/organizations/${orgId}/domains`);
  return data.data;
}

export interface CreateDomainPayload {
  domain: string;
  defaultRole?: string;
  autoApprove?: boolean;
}

export async function createDomain(
  orgId: string,
  payload: CreateDomainPayload,
): Promise<DomainDto> {
  const { data } = await api.post<DomainDto>(`/organizations/${orgId}/domains`, payload);
  return data;
}

export async function deleteDomain(orgId: string, domainId: string): Promise<void> {
  await api.delete(`/organizations/${orgId}/domains/${domainId}`);
}
