import type { AxiosError } from 'axios';

import type { ApiErrorBody } from '@/shared/types';

/**
 * Mapa de `error.code` -> mensagem em pt-BR (docs/05, tabela de códigos de
 * erro; docs/08, "Cliente HTTP"). A UI nunca exibe `error.message` cru da
 * API: sempre traduz pelo `code`, que é o contrato estável.
 */
const MESSAGES_BY_CODE: Record<string, string> = {
  VALIDATION_ERROR: 'Dados inválidos. Verifique os campos e tente novamente.',
  INVALID_CNPJ: 'CNPJ inválido.',
  UNAUTHENTICATED: 'Sua sessão expirou. Faça login novamente.',
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  FORBIDDEN: 'Você não tem permissão para realizar esta ação.',
  ACCOUNT_PENDING: 'Sua conta está aguardando aprovação de um administrador.',
  ACCOUNT_DISABLED: 'Sua conta foi desativada. Contate um administrador.',
  NOT_FOUND: 'Recurso não encontrado.',
  CONFLICT: 'Não foi possível concluir: há um conflito com o estado atual.',
  STAGE_NOT_EMPTY: 'Esta etapa ainda possui processos e não pode ser excluída.',
  PAYLOAD_TOO_LARGE: 'Arquivo acima do tamanho permitido.',
  RATE_LIMIT_EXCEEDED: 'Muitas tentativas. Aguarde um momento antes de tentar novamente.',
  INTERNAL_ERROR: 'Erro interno. Tente novamente em alguns instantes.',
};

const DEFAULT_MESSAGE = 'Ocorreu um erro inesperado. Tente novamente.';

export function getErrorCode(error: unknown): string | undefined {
  const axiosError = error as AxiosError<ApiErrorBody>;
  return axiosError?.response?.data?.error?.code;
}

/** Traduz o erro (Axios ou não) para mensagem amigável em pt-BR. */
export function translateError(error: unknown): string {
  const code = getErrorCode(error);
  if (code && MESSAGES_BY_CODE[code]) {
    return MESSAGES_BY_CODE[code];
  }
  return DEFAULT_MESSAGE;
}

export function getErrorDetails(
  error: unknown,
): Array<{ path: string; message: string }> | undefined {
  const axiosError = error as AxiosError<ApiErrorBody>;
  return axiosError?.response?.data?.error?.details;
}
