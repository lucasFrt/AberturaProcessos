import type { AuthProvider } from '@/domain/enums';

export interface UserIdentity {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
  createdAt: Date;
}

export interface CreateUserIdentityData {
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
}
