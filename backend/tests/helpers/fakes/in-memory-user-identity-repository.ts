import type { CreateUserIdentityData, UserIdentity } from '@/domain/entities/user-identity';
import type { AuthProvider } from '@/domain/enums';
import type { UserIdentityRepository } from '@/domain/repositories/user-identity-repository';

let idCounter = 0;

export class InMemoryUserIdentityRepository implements UserIdentityRepository {
  readonly items: UserIdentity[] = [];

  async findByProvider(
    provider: AuthProvider,
    providerUserId: string,
  ): Promise<UserIdentity | null> {
    return (
      this.items.find(
        (identity) => identity.provider === provider && identity.providerUserId === providerUserId,
      ) ?? null
    );
  }

  async create(data: CreateUserIdentityData): Promise<UserIdentity> {
    idCounter += 1;
    const identity: UserIdentity = { id: `identity-${idCounter}`, createdAt: new Date(), ...data };
    this.items.push(identity);
    return identity;
  }

  async listByUserId(userId: string): Promise<UserIdentity[]> {
    return this.items.filter((item) => item.userId === userId);
  }
}
