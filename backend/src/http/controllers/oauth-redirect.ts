/**
 * Valida o parâmetro `?redirect=` dos fluxos OAuth contra uma lista de
 * caminhos internos permitidos (docs/06, seção "Outras proteções HTTP"),
 * para evitar open redirect. Só aceita caminho relativo começando com `/`
 * — nunca uma URL absoluta, que poderia apontar para fora do FRONTEND_URL.
 */
const ALLOWED_REDIRECT_PREFIXES = ['/board', '/login', '/dashboard', '/processes'];

export function sanitizeRedirectPath(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return null;

  const isAllowed = ALLOWED_REDIRECT_PREFIXES.some(
    (prefix) =>
      candidate === prefix ||
      candidate.startsWith(`${prefix}/`) ||
      candidate.startsWith(`${prefix}?`),
  );
  return isAllowed ? candidate : null;
}
