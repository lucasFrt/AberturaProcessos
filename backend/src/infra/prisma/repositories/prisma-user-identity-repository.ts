import type { PrismaClient } from '@prisma/client';

import type { CreateUserIdentityData, UserIdentity } from '@/domain/entities/user-identity';
import type { AuthProvider } from '@/domain/enums';
import type { UserIdentityRepository } from '@/domain/repositories/user-identity-repository';

function toDomain(record: {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string;
  createdAt: Date;
}): UserIdentity {
  return { ...record, provider: record.provider as AuthProvider };
}

export class PrismaUserIdentityRepository implements UserIdentityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByProvider(
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<UserIdentity | null> {
    const record = await this.prisma.userIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId } },
    });
    return record ? toDomain(record) : null;
  }

  async create(data: CreateUserIdentityData): Promise<UserIdentity> {
    const record = await this.prisma.userIdentity.create({ data });
    return toDomain(record);
  }
}
