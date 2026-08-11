import { GoogleOutlined, WindowsOutlined } from '@ant-design/icons';
import { Button, Flex } from 'antd';
import type { ReactElement } from 'react';

/**
 * Botões de login social (docs/08, tela de Login). Navegação de página
 * real (`window.location.href`), não `fetch` — é um fluxo OAuth que
 * precisa do redirect do navegador para o provedor.
 */
interface SocialButtonsProps {
  google: boolean;
  microsoft: boolean;
  redirectTo?: string;
}

export function SocialButtons({
  google,
  microsoft,
  redirectTo = '/board',
}: SocialButtonsProps): ReactElement | null {
  if (!google && !microsoft) return null;

  const apiUrl = import.meta.env.VITE_API_URL;

  return (
    <Flex vertical gap={8} style={{ marginTop: 16 }}>
      {google && (
        <Button
          icon={<GoogleOutlined />}
          block
          onClick={() => {
            window.location.href = `${apiUrl}/auth/google?redirect=${encodeURIComponent(redirectTo)}`;
          }}
        >
          Entrar com Google
        </Button>
      )}
      {microsoft && (
        <Button
          icon={<WindowsOutlined />}
          block
          onClick={() => {
            window.location.href = `${apiUrl}/auth/microsoft?redirect=${encodeURIComponent(redirectTo)}`;
          }}
        >
          Entrar com Microsoft
        </Button>
      )}
    </Flex>
  );
}
