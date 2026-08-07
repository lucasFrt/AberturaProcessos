import type { EmailDomain } from '@/domain/entities/email-domain';
import type { EmailDomainRepository } from '@/domain/repositories/email-domain-repository';

export class InMemoryEmailDomainRepository implements EmailDomainRepository {
  readonly items: EmailDomain[] = [];

  async findByDomain(domain: string): Promise<EmailDomain | null> {
    return this.items.find((item) => item.domain === domain) ?? null;
  }
}
