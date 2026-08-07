import { z } from 'zod';

/**
 * Política mínima de senha (docs/06, seção "Senhas"): 10+ caracteres, com
 * maiúscula, minúscula e dígito. Compartilhada por register (aqui) e pelo
 * mesmo schema reaproveitado no front (docs/08).
 */
export const passwordSchema = z
  .string()
  .min(10, 'A senha precisa de ao menos 10 caracteres.')
  .regex(/[A-Z]/, 'A senha precisa de ao menos uma letra maiúscula.')
  .regex(/[a-z]/, 'A senha precisa de ao menos uma letra minúscula.')
  .regex(/\d/, 'A senha precisa de ao menos um dígito.');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(200),
  email: z.string().trim().email('E-mail inválido.').max(255),
  password: passwordSchema,
});

export type RegisterBody = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido.').max(255),
  password: z.string().min(1, 'Senha é obrigatória.'),
});

export type LoginBody = z.infer<typeof loginSchema>;
