import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Form, Input } from 'antd';
import type { ReactElement } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

/**
 * Schema de senha replicado do backend (`backend/src/http/schemas/auth-schemas.ts`,
 * docs/06 "Senhas"): mínimo 10 caracteres, com maiúscula, minúscula e
 * dígito. Login não exige as regras de força (a senha já existe), mas o
 * e-mail segue o mesmo formato.
 */
const loginSchema = z.object({
  email: z.string().trim().min(1, 'E-mail é obrigatório.').email('E-mail inválido.'),
  password: z.string().min(1, 'Senha é obrigatória.'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSubmit: (values: LoginFormValues) => void | Promise<void>;
  isSubmitting: boolean;
  errorMessage: string | null;
}

export function LoginForm({ onSubmit, isSubmitting, errorMessage }: LoginFormProps): ReactElement {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  return (
    <Form layout="vertical" onFinish={() => void handleSubmit(onSubmit)()}>
      {errorMessage && (
        <Alert type="error" message={errorMessage} showIcon style={{ marginBottom: 16 }} />
      )}

      <Form.Item
        label="E-mail"
        validateStatus={errors.email ? 'error' : ''}
        help={errors.email?.message}
      >
        <Controller
          name="email"
          control={control}
          render={({ field }) => <Input {...field} type="email" autoComplete="email" />}
        />
      </Form.Item>

      <Form.Item
        label="Senha"
        validateStatus={errors.password ? 'error' : ''}
        help={errors.password?.message}
      >
        <Controller
          name="password"
          control={control}
          render={({ field }) => <Input.Password {...field} autoComplete="current-password" />}
        />
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" block loading={isSubmitting}>
          Entrar
        </Button>
      </Form.Item>
    </Form>
  );
}
