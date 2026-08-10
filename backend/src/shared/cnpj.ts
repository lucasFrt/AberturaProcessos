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
