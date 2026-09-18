/**
 * Validação de CNPJ (RF-12): 14 dígitos + dígitos verificadores calculados
 * pelo algoritmo módulo 11 padrão da Receita Federal. Função pura, sem
 * dependência de framework — pode ser usada por domain/services e por
 * schemas Zod igualmente.
 */

export function normalizeCnpjDigits(rawValue: string): string {
  return rawValue.replace(/\D/g, '');
}

function calcCheckDigit(digits: number[], weights: number[]): number {
  const sum = digits.reduce((acc, digit, index) => acc + digit * (weights[index] ?? 0), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** `rawValue` pode vir com ou sem máscara; apenas os dígitos são considerados. */
export function isValidCnpj(rawValue: string): boolean {
  const digits = normalizeCnpjDigits(rawValue);

  if (digits.length !== 14) return false;
  // Sequências com todos os dígitos iguais (ex.: "00000000000000") passam no
  // cálculo do módulo 11 mas nunca são CNPJs válidos na prática.
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const numbers = digits.split('').map(Number);
  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const firstCheck = calcCheckDigit(numbers.slice(0, 12), firstWeights);
  if (firstCheck !== numbers[12]) return false;

  const secondCheck = calcCheckDigit(numbers.slice(0, 13), secondWeights);
  if (secondCheck !== numbers[13]) return false;

  return true;
}

/**
 * Validação de CPF (docs/13, decisão 5): 11 dígitos + dois dígitos
 * verificadores por módulo 11. Mesma função pura, mesmo uso que `isValidCnpj`.
 */
export function isValidCpf(rawValue: string): boolean {
  const digits = normalizeCnpjDigits(rawValue);

  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const numbers = digits.split('').map(Number);
  const check = (length: number): number => {
    const sum = numbers
      .slice(0, length)
      .reduce((acc, digit, index) => acc + digit * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return check(9) === numbers[9] && check(10) === numbers[10];
}

export type DocumentKind = 'CNPJ' | 'CPF';

/**
 * Classifica e valida um documento pelo tamanho: 14 dígitos → CNPJ, 11 → CPF.
 * Devolve `null` quando o tamanho não corresponde a nenhum dos dois ou os
 * dígitos verificadores são inválidos — quem chama decide o código de erro.
 */
export function classifyDocument(rawValue: string): { kind: DocumentKind; digits: string } | null {
  const digits = normalizeCnpjDigits(rawValue);
  if (digits.length === 14) {
    return isValidCnpj(digits) ? { kind: 'CNPJ', digits } : null;
  }
  if (digits.length === 11) {
    return isValidCpf(digits) ? { kind: 'CPF', digits } : null;
  }
  return null;
}

/** `12345678000190` → `12.345.678/0001-90`; `12345678909` → `123.456.789-09`. */
export function formatDocument(digits: string): string {
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return digits;
}
