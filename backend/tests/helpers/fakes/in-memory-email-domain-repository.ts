import type { CreateEmailDomainData, EmailDomain } from '@/domain/entities/email-domain';
import type { EmailDomainRepository } from '@/domain/repositories/email-domain-repository';

let idCounter = 0;

export class InMemoryEmailDomainRepository implements EmailDomainRepository {
  readonly items: EmailDomain[] = [];

  async findByDomain(domain: string): Promise<EmailDomain | null> {
    return this.items.find((item) => item.domain === domain) ?? null;
  }

  async findById(id: string): Promise<EmailDomain | null> {
    return this.items.find((item) => item.id === id) ?? null;
  }

  async listByOrganization(organizationId: string): Promise<EmailDomain[]> {
    return this.items.filter((item) => item.organizationId === organizationId);
  }

  async create(data: CreateEmailDomainData): Promise<EmailDomain> {
    idCounter += 1;
    const domain: EmailDomain = { id: `domain-${idCounter}`, createdAt: new Date(), ...data };
    this.items.push(domain);
    return domain;
  }

  async delete(id: string): Promise<void> {
    const index = this.items.findIndex((item) => item.id === id);
    if (index !== -1) this.items.splice(index, 1);
  }
}
