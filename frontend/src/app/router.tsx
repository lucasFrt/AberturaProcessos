import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ApiKeysPage } from '@/features/admin/pages/ApiKeysPage';
import { CompaniesPage } from '@/features/admin/pages/CompaniesPage';
import { OrganizationsPage } from '@/features/admin/pages/OrganizationsPage';
import { StagesPage } from '@/features/admin/pages/StagesPage';
import { UsersPage } from '@/features/admin/pages/UsersPage';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { OAuthCallbackPage } from '@/features/auth/pages/OAuthCallbackPage';
import { PendingPage } from '@/features/auth/pages/PendingPage';
import { RegisterPage } from '@/features/auth/pages/RegisterPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { IntakeEventsPage } from '@/features/intake/pages/IntakeEventsPage';
import { BoardPage } from '@/features/processes/pages/BoardPage';
import { NewProcessPage } from '@/features/processes/pages/NewProcessPage';
import { ProcessListPage } from '@/features/processes/pages/ProcessListPage';
import { AppLayout } from '@/shared/components/AppLayout';
import { RequireAuth } from '@/shared/components/RequireAuth';
import { RequireRole } from '@/shared/components/RequireRole';

/**
 * Estrutura de rotas (docs/08, "Rotas e proteção"). Rotas públicas de auth
 * ficam fora do `AppLayout`; rotas protegidas entram por `RequireAuth`, e a
 * área ADMIN (dashboard/admin) tem sub-proteção por `RequireRole`.
 *
 * `/processes/:id` reaproveita `BoardPage`, que lê o `:id` via `useParams`
 * e abre `ProcessDrawer` por cima do board (docs/12, Tarefa 19) — o card
 * fica linkável e compartilhável sem duplicar a tela.
 */
export function AppRouter(): ReactElement {
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/board" replace />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/processes" element={<ProcessListPage />} />
          <Route path="/processes/new" element={<NewProcessPage />} />
          <Route path="/processes/:id" element={<BoardPage />} />

          <Route element={<RequireRole roles={['OPERATIONAL', 'ADMIN']} />}>
            <Route path="/intake" element={<IntakeEventsPage />} />
          </Route>

          <Route element={<RequireRole roles={['ADMIN']} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/admin/organizations" element={<OrganizationsPage />} />
            <Route path="/admin/companies" element={<CompaniesPage />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/stages" element={<StagesPage />} />
            <Route path="/admin/api-keys" element={<ApiKeysPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/auth/callback" element={<OAuthCallbackPage />} />
      <Route path="/pending" element={<PendingPage />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
