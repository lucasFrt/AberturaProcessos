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

/** Validação de CPF (docs/13, decisão 5). Mesmo algoritmo do backend (`shared/cnpj.ts`). */
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

/** CNPJ (14 dígitos) ou CPF (11), como o backend aceita em `Company.cnpj`. */
export function isValidDocument(rawValue: string): boolean {
  const digits = normalizeCnpjDigits(rawValue);
  if (digits.length === 14) return isValidCnpj(digits);
  if (digits.length === 11) return isValidCpf(digits);
  return false;
}

/** Formata dígitos como `000.000.000-00` (parcial enquanto digita). */
export function maskCpf(rawValue: string): string {
  const digits = normalizeCnpjDigits(rawValue).slice(0, 11);

  const p1 = digits.slice(0, 3);
  const p2 = digits.slice(3, 6);
  const p3 = digits.slice(6, 9);
  const p4 = digits.slice(9, 11);

  let result = p1;
  if (p2) result += `.${p2}`;
  if (p3) result += `.${p3}`;
  if (p4) result += `-${p4}`;
  return result;
}

/**
 * Máscara pelo tamanho: até 11 dígitos formata como CPF, acima como CNPJ.
 * Para valores já persistidos (11 ou 14 dígitos) o resultado é sempre a
 * máscara certa; enquanto o usuário digita, muda de CPF para CNPJ no 12º dígito.
 */
export function maskDocument(rawValue: string): string {
  const digits = normalizeCnpjDigits(rawValue);
  return digits.length <= 11 ? maskCpf(digits) : maskCnpj(digits);
}

export const PENDING_REGISTRATION_LABEL = 'Cadastro pendente';

/**
 * Documento da empresa para exibição. `null` é cadastro pendente: empresa
 * criada pelo intake a partir do domínio do e-mail, sem CNPJ (docs/13,
 * decisão 10) — aparece assim até alguém completar na tela de empresas.
 */
export function formatCompanyDocument(cnpj: string | null): string {
  return cnpj ? maskDocument(cnpj) : PENDING_REGISTRATION_LABEL;
}
