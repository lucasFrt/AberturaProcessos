import type { PasswordHasher } from '@/infra/security/password-hasher';

/** Hash determinístico e reversível — só para testes, nunca em produção. */
export class FakePasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    return `hashed:${plainText}`;
  }

  async compare(plainText: string, hash: string): Promise<boolean> {
    return hash === `hashed:${plainText}`;
  }
}
