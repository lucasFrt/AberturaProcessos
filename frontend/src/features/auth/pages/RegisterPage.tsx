import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { register as registerRequest } from '@/features/auth/api/auth-api';
import { translateError } from '@/shared/api/errors';

/** Mesma política de senha do backend (docs/06, "Senhas"). */
const passwordSchema = z
  .string()
  .min(10, 'A senha precisa de ao menos 10 caracteres.')
  .regex(/[A-Z]/, 'A senha precisa de ao menos uma letra maiúscula.')
  .regex(/[a-z]/, 'A senha precisa de ao menos uma letra minúscula.')
  .regex(/\d/, 'A senha precisa de ao menos um dígito.');

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(200),
  email: z.string().trim().min(1, 'E-mail é obrigatório.').email('E-mail inválido.'),
  password: passwordSchema,
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterPage(): ReactElement {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  async function onSubmit(values: RegisterFormValues): Promise<void> {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const response = await registerRequest(values);
      if (response.status === 'PENDING') {
        void navigate('/pending', { replace: true });
        return;
      }
      void navigate('/login', { replace: true });
    } catch (error) {
      setErrorMessage(translateError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          Criar conta
        </Typography.Title>

        <Form layout="vertical" onFinish={() => void handleSubmit(onSubmit)()}>
          {errorMessage && (
            <Alert type="error" message={errorMessage} showIcon style={{ marginBottom: 16 }} />
          )}

          <Form.Item
            label="Nome"
            validateStatus={errors.name ? 'error' : ''}
            help={errors.name?.message}
          >
            <Controller
              name="name"
              control={control}
              render={({ field }) => <Input {...field} />}
            />
          </Form.Item>

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
              render={({ field }) => <Input.Password {...field} autoComplete="new-password" />}
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={isSubmitting}>
              Cadastrar
            </Button>
          </Form.Item>
        </Form>

        <Typography.Paragraph style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          Já tem conta? <Link to="/login">Entrar</Link>
        </Typography.Paragraph>
      </Card>
    </Flex>
  );
}
