import {
  AppstoreOutlined,
  BankOutlined,
  DashboardOutlined,
  LogoutOutlined,
  OrderedListOutlined,
  PlusCircleOutlined,
  SolutionOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Flex, Layout, Menu, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';

import { logout as logoutRequest } from '@/features/auth/api/auth-api';
import { useAuthStore } from '@/features/auth/store/auth-store';
import { useSocketStatus } from '@/shared/hooks/useSocketStatus';

const { Header, Sider, Content } = Layout;

/**
 * Navegação lateral com itens filtrados por papel (docs/08, `AppLayout`).
 * A restrição real de acesso é feita pelas rotas (`RequireRole`); este
 * menu só evita mostrar links que o usuário não pode usar.
 */
function useMenuItems(): MenuProps['items'] {
  const role = useAuthStore((state) => state.user?.role);

  return useMemo(() => {
    const items: MenuProps['items'] = [
      { key: '/board', icon: <AppstoreOutlined />, label: <Link to="/board">Board</Link> },
      {
        key: '/processes',
        icon: <OrderedListOutlined />,
        label: <Link to="/processes">Processos</Link>,
      },
      {
        key: '/processes/new',
        icon: <PlusCircleOutlined />,
        label: <Link to="/processes/new">Novo processo</Link>,
      },
    ];

    if (role === 'ADMIN') {
      items.push(
        {
          key: '/dashboard',
          icon: <DashboardOutlined />,
          label: <Link to="/dashboard">Dashboard</Link>,
        },
        {
          key: 'admin',
          icon: <SolutionOutlined />,
          label: 'Administração',
          children: [
            {
              key: '/admin/organizations',
              icon: <BankOutlined />,
              label: <Link to="/admin/organizations">Organizações</Link>,
            },
            {
              key: '/admin/companies',
              icon: <BankOutlined />,
              label: <Link to="/admin/companies">Empresas</Link>,
            },
            {
              key: '/admin/users',
              icon: <TeamOutlined />,
              label: <Link to="/admin/users">Usuários</Link>,
            },
            {
              key: '/admin/stages',
              icon: <OrderedListOutlined />,
              label: <Link to="/admin/stages">Etapas</Link>,
            },
          ],
        },
      );
    }

    return items;
  }, [role]);
}

export function AppLayout(): ReactElement {
  const user = useAuthStore((state) => state.user);
  const clear = useAuthStore((state) => state.clear);
  const location = useLocation();
  const navigate = useNavigate();
  const items = useMenuItems();
  const { isConnected } = useSocketStatus();

  async function handleLogout(): Promise<void> {
    try {
      await logoutRequest();
    } finally {
      clear();
      void navigate('/login', { replace: true });
    }
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0}>
        <Flex align="center" style={{ height: 56, padding: '0 16px' }}>
          <Typography.Text strong style={{ color: '#fff' }}>
            Abertura de Processos
          </Typography.Text>
        </Flex>
        <Menu theme="dark" mode="inline" selectedKeys={[location.pathname]} items={items} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px' }}>
          <Flex align="center" justify="flex-end" gap={12} style={{ height: '100%' }}>
            {!isConnected && (
              <Tag color="warning" role="status" aria-live="polite">
                Conexão em tempo real perdida
              </Tag>
            )}
            <Avatar icon={<UserOutlined />} />
            <Typography.Text>{user?.name}</Typography.Text>
            <Button
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => void handleLogout()}
              aria-label="Sair"
            >
              Sair
            </Button>
          </Flex>
        </Header>
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
