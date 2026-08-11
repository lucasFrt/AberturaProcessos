import { Button, Result } from 'antd';
import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';

/**
 * Boundary simples para erros de renderização não previstos. Não substitui
 * o tratamento de erro de requisições (TanStack Query + `translateError`),
 * apenas evita a tela branca em caso de exceção no render.
 */
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- único ponto de log de erro de render não tratado
    console.error('Erro não tratado na interface:', error, info);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="Algo deu errado"
          subTitle="Ocorreu um erro inesperado na interface. Tente recarregar a página."
          extra={
            <Button type="primary" onClick={this.handleReload}>
              Recarregar
            </Button>
          }
        />
      );
    }

    return this.props.children;
  }
}
