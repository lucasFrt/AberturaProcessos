import { Alert, Flex, Spin, Typography } from 'antd';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { me as fetchMe, refresh } from '@/features/auth/api/auth-api';
import { useAuthStore } from '@/features/auth/store/auth-store';
import { translateError } from '@/shared/api/errors';

/**
 * `?status` da querystring (docs/06 "Login social"; docs/08 "Login"):
 * `ok` -> chama refresh + `/auth/me` e vai para o destino; `pending` ->
 * `/pending`; `error` -> volta ao login com a mensagem traduzida pelo
 * `code` (docs/05, tabela de códigos de erro).
 */
export function OAuthCallbackPage(): ReactElement {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function processCallback(): Promise<void> {
      const status = searchParams.get('status');
      const redirectTo = searchParams.get('redirect') ?? '/board';

      if (status === 'pending') {
        await navigate('/pending', { replace: true });
        return;
      }

      if (status === 'error') {
        const code = searchParams.get('code');
        setErrorMessage(translateError({ response: { data: { error: { code } } } }));
        return;
      }

      if (status === 'ok') {
        try {
          const { accessToken } = await refresh();
          const user = await fetchMe();
          setSession({ accessToken, user });
          await navigate(redirectTo, { replace: true });
        } catch (error) {
          setErrorMessage(translateError(error));
        }
        return;
      }

      setErrorMessage('Retorno de autenticação inválido.');
    }

    void processCallback();
  }, [searchParams, navigate, setSession]);

  if (errorMessage) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
        <Alert
          type="error"
          showIcon
          message="Não foi possível concluir o login"
          description={
            <>
              <Typography.Paragraph>{errorMessage}</Typography.Paragraph>
              <a href="/login">Voltar para o login</a>
            </>
          }
        />
      </Flex>
    );
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Spin size="large" tip="Concluindo login..." />
    </Flex>
  );
}
