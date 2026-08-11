import { useQuery } from '@tanstack/react-query';
import { Card, Flex, Typography } from 'antd';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { getProviders, login, me as fetchMe } from '@/features/auth/api/auth-api';
import type { LoginFormValues } from '@/features/auth/components/LoginForm';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { SocialButtons } from '@/features/auth/components/SocialButtons';
import { useAuthStore } from '@/features/auth/store/auth-store';
import { translateError } from '@/shared/api/errors';

/**
 * Card centralizado com login local + social (docs/08, "Telas / Login").
 * Conta pendente redireciona para `/pending`; demais erros mostram a
 * mensagem traduzida por `code` (nunca `error.message` cru).
 */
export function LoginPage(): ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: providers } = useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: getProviders,
  });

  const redirectTo =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/board';

  async function handleSubmit(values: LoginFormValues): Promise<void> {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const response = await login(values);
      setSession({ accessToken: response.accessToken, user: await fetchMe() });
      void navigate(redirectTo, { replace: true });
    } catch (error) {
      const code = (error as { response?: { data?: { error?: { code?: string } } } })?.response
        ?.data?.error?.code;
      if (code === 'ACCOUNT_PENDING') {
        void navigate('/pending', { replace: true });
        return;
      }
      setErrorMessage(translateError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', background: '#f5f5f5' }}>
      <Card style={{ width: 380 }}>
        <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          Abertura de Processos
        </Typography.Title>

        <LoginForm
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
        />

        <SocialButtons
          google={providers?.google ?? false}
          microsoft={providers?.microsoft ?? false}
          redirectTo={redirectTo}
        />

        <Typography.Paragraph style={{ textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          Não tem conta? <Link to="/register">Cadastre-se</Link>
        </Typography.Paragraph>
      </Card>
    </Flex>
  );
}
