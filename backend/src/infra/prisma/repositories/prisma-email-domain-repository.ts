import type { PrismaClient } from '@prisma/client';

import type { CreateEmailDomainData, EmailDomain } from '@/domain/entities/email-domain';
import type { Role } from '@/domain/enums';
import type { EmailDomainRepository } from '@/domain/repositories/email-domain-repository';

function toDomain(record: {
  id: string;
  domain: string;
  organizationId: string;
  defaultRole: string;
  autoApprove: boolean;
  createdAt: Date;
}): EmailDomain {
  return { ...record, defaultRole: record.defaultRole as Role };
}

export class PrismaEmailDomainRepository implements EmailDomainRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByDomain(domain: string): Promise<EmailDomain | null> {
    const record = await this.prisma.emailDomain.findUnique({ where: { domain } });
    return record ? toDomain(record) : null;
  }

  async findById(id: string): Promise<EmailDomain | null> {
    const record = await this.prisma.emailDomain.findUnique({ where: { id } });
    return record ? toDomain(record) : null;
  }

  async listByOrganization(organizationId: string): Promise<EmailDomain[]> {
    const records = await this.prisma.emailDomain.findMany({
      where: { organizationId },
      orderBy: { domain: 'asc' },
    });
    return records.map(toDomain);
  }

  async create(data: CreateEmailDomainData): Promise<EmailDomain> {
    const record = await this.prisma.emailDomain.create({ data });
    return toDomain(record);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.emailDomain.delete({ where: { id } });
  }
}
