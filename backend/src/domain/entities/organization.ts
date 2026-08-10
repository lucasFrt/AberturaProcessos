export interface Organization {
  id: string;
  name: string;
  isInternal: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationData {
  name: string;
  isInternal: boolean;
}

export interface UpdateOrganizationData {
  name?: string | undefined;
  isActive?: boolean | undefined;
}

export interface OrganizationFilters {
  q?: string | undefined;
  isInternal?: boolean | undefined;
  isActive?: boolean | undefined;
}
