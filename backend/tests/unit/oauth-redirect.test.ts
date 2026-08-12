import { sanitizeRedirectPath } from '@/http/controllers/oauth-redirect';

/**
 * Cobre todos os ramos de `sanitizeRedirectPath` (proteção contra open
 * redirect, docs/06 "Outras proteções HTTP"): tipo inválido, caminho
 * absoluto ausente, `//` (protocol-relative), prefixo permitido em cada uma
 * das três formas aceitas (exato, com `/`, com `?`) e prefixo não permitido.
 */
describe('sanitizeRedirectPath', () => {
  it('retorna null para valores que não são string', () => {
    expect(sanitizeRedirectPath(undefined)).toBeNull();
    expect(sanitizeRedirectPath(null)).toBeNull();
    expect(sanitizeRedirectPath(123)).toBeNull();
    expect(sanitizeRedirectPath({})).toBeNull();
  });

  it('retorna null quando não começa com "/"', () => {
    expect(sanitizeRedirectPath('board')).toBeNull();
    expect(sanitizeRedirectPath('https://evil.com/board')).toBeNull();
  });

  it('retorna null para "//" (protocol-relative, possível open redirect)', () => {
    expect(sanitizeRedirectPath('//evil.com')).toBeNull();
  });

  it('aceita um prefixo permitido exato', () => {
    expect(sanitizeRedirectPath('/board')).toBe('/board');
  });

  it('aceita um prefixo permitido seguido de "/"', () => {
    expect(sanitizeRedirectPath('/processes/123')).toBe('/processes/123');
  });

  it('aceita um prefixo permitido seguido de "?"', () => {
    expect(sanitizeRedirectPath('/dashboard?period=30d')).toBe('/dashboard?period=30d');
  });

  it('retorna null para caminho fora da lista de prefixos permitidos', () => {
    expect(sanitizeRedirectPath('/admin/secreto')).toBeNull();
  });

  it('retorna null para prefixo permitido sem separador válido (ex.: "/boardx")', () => {
    expect(sanitizeRedirectPath('/boardx')).toBeNull();
  });
});
