import type { Role } from '@/domain/enums';

export interface EmailDomain {
  id: string;
  domain: string;
  organizationId: string;
  defaultRole: Role;
  autoApprove: boolean;
  createdAt: Date;
}

export interface CreateEmailDomainData {
  domain: string;
  organizationId: string;
  defaultRole: Role;
  autoApprove: boolean;
}
