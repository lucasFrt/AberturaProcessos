import type { ReactElement } from 'react';
import { useEffect } from 'react';

import { AppProviders } from '@/app/providers';
import { AppRouter } from '@/app/router';
import { me as fetchMe, refresh } from '@/features/auth/api/auth-api';
import { useAuthStore } from '@/features/auth/store/auth-store';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';

/**
 * Bootstrap da sessão (docs/08, "Cliente HTTP"): ao carregar a app, chama
 * `POST /auth/refresh` (cookie httpOnly) e depois `GET /auth/me` para
 * reconstruir a sessão sem piscar a tela de login em um F5. Falha (sem
 * cookie válido, por exemplo) apenas marca o bootstrap como concluído sem
 * sessão — `RequireAuth` decide o redirect.
 */
function useSessionBootstrap(): void {
  const setSession = useAuthStore((state) => state.setSession);
  const setBootstrapped = useAuthStore((state) => state.setBootstrapped);

  useEffect(() => {
    void (async () => {
      try {
        const { accessToken } = await refresh();
        const user = await fetchMe();
        setSession({ accessToken, user });
      } catch {
        // Sem sessão válida: RequireAuth redireciona para /login.
      } finally {
        setBootstrapped();
      }
    })();
  }, [setSession, setBootstrapped]);
}

function AppContent(): ReactElement {
  useSessionBootstrap();
  return <AppRouter />;
}

function App(): ReactElement {
  return (
    <ErrorBoundary>
      <AppProviders>
        <AppContent />
      </AppProviders>
    </ErrorBoundary>
  );
}

export default App;
