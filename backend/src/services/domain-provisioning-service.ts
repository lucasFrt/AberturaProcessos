import type { AccessScopeKind, Role } from '@/domain/enums';
import type { EmailDomainRepository } from '@/domain/repositories/email-domain-repository';

export interface DomainProvisioningResult {
  organizationId: string | null;
  role: Role;
  accessScope: AccessScopeKind;
  /** false => a conta deve entrar com status PENDING mesmo tendo domínio reconhecido. */
  autoApprove: boolean;
}

/**
 * Provisionamento por domínio (docs/06, seção "Provisionamento por
 * domínio"). Compartilhado entre `AuthService` (registro local, Tarefa 4) e
 * `SocialAuthService` (login social, Tarefa 5) para não duplicar a regra.
 *
 * Subdomínios não herdam o domínio pai — comparação é sempre exata contra
 * o valor normalizado gravado em EmailDomain.domain.
 */
export class DomainProvisioningService {
  constructor(private readonly emailDomainRepository: EmailDomainRepository) {}

  extractDomain(email: string): string {
    const domain = email.split('@')[1];
    return (domain ?? '').trim().toLowerCase();
  }

  async resolve(email: string): Promise<DomainProvisioningResult> {
    const domain = this.extractDomain(email);
    const emailDomain = domain ? await this.emailDomainRepository.findByDomain(domain) : null;

    if (!emailDomain) {
      return {
        organizationId: null,
        role: 'CLIENT',
        accessScope: 'ORGANIZATION',
        autoApprove: false,
      };
    }

    return {
      organizationId: emailDomain.organizationId,
      role: emailDomain.defaultRole,
      accessScope: 'ORGANIZATION',
      autoApprove: emailDomain.autoApprove,
    };
  }
}
