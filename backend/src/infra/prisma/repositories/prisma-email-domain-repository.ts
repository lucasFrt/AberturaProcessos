import type { PrismaClient } from '@prisma/client';

import type { EmailDomain } from '@/domain/entities/email-domain';
import type { Role } from '@/domain/enums';
import type { EmailDomainRepository } from '@/domain/repositories/email-domain-repository';

export class PrismaEmailDomainRepository implements EmailDomainRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByDomain(domain: string): Promise<EmailDomain | null> {
    const record = await this.prisma.emailDomain.findUnique({ where: { domain } });
    return record ? { ...record, defaultRole: record.defaultRole as Role } : null;
  }
}
