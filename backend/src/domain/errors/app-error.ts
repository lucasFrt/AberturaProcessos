/**
 * Erro de domínio/aplicação. Services lançam AppError (ou subclasses);
 * o error-handler central converte para o envelope de resposta padrão (doc 05).
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 404, details);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 409, details);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 403, details);
    this.name = 'ForbiddenError';
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Não autenticado.', details?: unknown) {
    super('UNAUTHENTICATED', message, 401, details);
    this.name = 'UnauthenticatedError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}
