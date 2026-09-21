/**
 * Domínios de webmail público: um remetente `@gmail.com` não representa uma
 * organização, então nem o intake (docs/13, decisão 5) nem o espelho do iLog
 * (docs/15) cadastram esses domínios em `EmailDomain` — cadastrar daria a
 * qualquer conta Gmail vínculo automático com a organização criada.
 */
export const PUBLIC_WEBMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.br',
  'outlook.com',
  'outlook.com.br',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'aol.com',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  'proton.me',
  'protonmail.com',
]);

/** `domain` já em minúsculas, sem "@". */
export function isPublicWebmailDomain(domain: string): boolean {
  return PUBLIC_WEBMAIL_DOMAINS.has(domain);
}
