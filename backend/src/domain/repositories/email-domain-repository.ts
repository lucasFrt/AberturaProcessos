import type { EmailDomain } from '@/domain/entities/email-domain';

export interface EmailDomainRepository {
  /** `domain` já deve chegar normalizado (minúsculo, sem "@"). */
  findByDomain(domain: string): Promise<EmailDomain | null>;
}
