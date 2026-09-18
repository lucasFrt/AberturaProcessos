import type { AccessScope } from '@/domain/entities/access-scope';
import type { Role } from '@/domain/enums';

/**
 * Aumenta `Request` com o contexto de autenticação preenchido pelo
 * middleware `authenticate` (docs/06). Único lugar que declara este
 * campo — controllers e demais middlewares apenas o leem.
 */
export interface AuthContext {
  userId: string;
  role: Role;
  organizationId: string | null;
  scope: AccessScope;
  /**
   * Como a requisição se autenticou (docs/13, decisão 2). Serve para
   * derivar `Process.source` (JWT → WEB, chave → API) e para auditoria;
   * nunca para autorizar — papel e escopo já vêm do usuário resolvido.
   */
  authKind: 'JWT' | 'API_KEY';
  apiKeyId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
