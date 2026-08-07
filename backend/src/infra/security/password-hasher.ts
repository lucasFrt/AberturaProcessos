import bcrypt from 'bcrypt';

const BCRYPT_COST = 12;

/**
 * Interface + implementação padrão (docs/03-arquitetura.md). Services
 * dependem apenas de `PasswordHasher`, nunca de `bcrypt` diretamente —
 * permite trocar o algoritmo sem tocar em regra de negócio (Open/Closed).
 */
export interface PasswordHasher {
  hash(plainText: string): Promise<string>;
  compare(plainText: string, hash: string): Promise<boolean>;
}

export class BcryptPasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    return bcrypt.hash(plainText, BCRYPT_COST);
  }

  async compare(plainText: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainText, hash);
  }
}
