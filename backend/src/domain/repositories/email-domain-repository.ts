import type { CreateEmailDomainData, EmailDomain } from '@/domain/entities/email-domain';

export interface EmailDomainRepository {
  /** `domain` já deve chegar normalizado (minúsculo, sem "@"). */
  findByDomain(domain: string): Promise<EmailDomain | null>;
  findById(id: string): Promise<EmailDomain | null>;
  listByOrganization(organizationId: string): Promise<EmailDomain[]>;
  create(data: CreateEmailDomainData): Promise<EmailDomain>;
  delete(id: string): Promise<void>;
}
