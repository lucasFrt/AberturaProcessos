import type { CreateUserIdentityData, UserIdentity } from '@/domain/entities/user-identity';
import type { AuthProvider } from '@/domain/enums';

export interface UserIdentityRepository {
  findByProvider(provider: AuthProvider, providerUserId: string): Promise<UserIdentity | null>;
  create(data: CreateUserIdentityData): Promise<UserIdentity>;
  listByUserId(userId: string): Promise<UserIdentity[]>;
}
