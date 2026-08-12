import { isValidCnpj, normalizeCnpjDigits } from '@/shared/cnpj';

/**
 * Cobre os ramos do validador de CNPJ (RF-12, docs/09): normalização com
 * máscara, tamanho incorreto, sequência de dígitos repetidos, primeiro e
 * segundo dígito verificador incorretos, e o caminho válido.
 */
describe('cnpj', () => {
  describe('normalizeCnpjDigits', () => {
    it('remove máscara e mantém apenas dígitos', () => {
      expect(normalizeCnpjDigits('11.222.333/0001-81')).toBe('11222333000181');
    });

    it('mantém string já normalizada', () => {
      expect(normalizeCnpjDigits('11222333000181')).toBe('11222333000181');
    });
  });

  describe('isValidCnpj', () => {
    it('aceita um CNPJ válido com máscara', () => {
      expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    });

    it('aceita um CNPJ válido sem máscara', () => {
      expect(isValidCnpj('11222333000181')).toBe(true);
    });

    it('rejeita quando não tem 14 dígitos', () => {
      expect(isValidCnpj('1234')).toBe(false);
      expect(isValidCnpj('112223330001811')).toBe(false);
    });

    it('rejeita sequência de dígitos repetidos', () => {
      expect(isValidCnpj('00000000000000')).toBe(false);
      expect(isValidCnpj('11111111111111')).toBe(false);
    });

    it('rejeita quando o primeiro dígito verificador está incorreto', () => {
      // Últimos dois dígitos de um CNPJ válido (81) alterados só no primeiro.
      expect(isValidCnpj('11222333000191')).toBe(false);
    });

    it('rejeita quando o segundo dígito verificador está incorreto', () => {
      expect(isValidCnpj('11222333000180')).toBe(false);
    });
  });
});
