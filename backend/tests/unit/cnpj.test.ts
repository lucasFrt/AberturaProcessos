import {
  classifyDocument,
  formatDocument,
  isValidCnpj,
  isValidCpf,
  normalizeCnpjDigits,
} from '@/shared/cnpj';

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

  describe('isValidCpf (docs/13, decisão 5)', () => {
    it('aceita um CPF válido com e sem máscara', () => {
      expect(isValidCpf('529.982.247-25')).toBe(true);
      expect(isValidCpf('52998224725')).toBe(true);
    });

    it('rejeita tamanho incorreto e sequência repetida', () => {
      expect(isValidCpf('5299822472')).toBe(false);
      expect(isValidCpf('11111111111')).toBe(false);
    });

    it('rejeita dígitos verificadores incorretos', () => {
      expect(isValidCpf('52998224735')).toBe(false);
      expect(isValidCpf('52998224726')).toBe(false);
    });
  });

  describe('classifyDocument', () => {
    it('classifica 14 dígitos válidos como CNPJ', () => {
      expect(classifyDocument('11.222.333/0001-81')).toEqual({
        kind: 'CNPJ',
        digits: '11222333000181',
      });
    });

    it('classifica 11 dígitos válidos como CPF', () => {
      expect(classifyDocument('529.982.247-25')).toEqual({ kind: 'CPF', digits: '52998224725' });
    });

    it('devolve null para tamanho fora do padrão ou dígitos inválidos', () => {
      expect(classifyDocument('123')).toBeNull();
      expect(classifyDocument('11222333000191')).toBeNull();
      expect(classifyDocument('52998224726')).toBeNull();
    });
  });

  describe('formatDocument', () => {
    it('formata CNPJ e CPF; devolve como está para outros tamanhos', () => {
      expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
      expect(formatDocument('52998224725')).toBe('529.982.247-25');
      expect(formatDocument('123')).toBe('123');
    });
  });
});
