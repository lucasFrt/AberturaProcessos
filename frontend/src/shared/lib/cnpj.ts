/**
 * Validação e máscara de CNPJ no cliente (docs/08, "Administração"). Mesmo
 * algoritmo de dígito verificador do backend (`backend/src/shared/cnpj.ts`),
 * para validar no formulário antes de qualquer chamada de rede. Ainda sem
 * uso nesta tarefa — a Tarefa 16 (formulário) e a 20 (admin/empresas)
 * consomem estas funções.
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
  // Sequências com todos os dígitos iguais passam no cálculo do módulo 11
  // mas nunca são CNPJs válidos na prática.
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

/** Formata dígitos (com ou sem máscara) como `00.000.000/0000-00`. */
export function maskCnpj(rawValue: string): string {
  const digits = normalizeCnpjDigits(rawValue).slice(0, 14);

  const p1 = digits.slice(0, 2);
  const p2 = digits.slice(2, 5);
  const p3 = digits.slice(5, 8);
  const p4 = digits.slice(8, 12);
  const p5 = digits.slice(12, 14);

  let result = p1;
  if (p2) result += `.${p2}`;
  if (p3) result += `.${p3}`;
  if (p4) result += `/${p4}`;
  if (p5) result += `-${p5}`;
  return result;
}
