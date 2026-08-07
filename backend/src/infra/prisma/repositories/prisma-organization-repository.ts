import type { PrismaClient } from '@prisma/client';

import type { Organization } from '@/domain/entities/organization';
import type { OrganizationRepository } from '@/domain/repositories/organization-repository';

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id } });
  }
}
