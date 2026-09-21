import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Badge, Button, Form, Input, Modal, Select, Space, Table, Tabs, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { listCompanies } from '@/features/admin/api/companies-api';
import { listOrganizations } from '@/features/admin/api/organizations-api';
import {
  approveUser,
  listPendingUsers,
  listUsers,
  rejectUser,
} from '@/features/admin/api/users-api';
import type { UserDto } from '@/features/admin/api/users-api';
import { translateError } from '@/shared/api/errors';
import { Can } from '@/shared/components/Can';
import { PageHeader } from '@/shared/components/PageHeader';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { formatCompanyDocument } from '@/shared/lib/cnpj';

// --- Schema ---

const approveSchema = z
  .object({
    role: z.enum(['CLIENT', 'OPERATIONAL', 'ADMIN']),
    organizationId: z.string().min(1, 'Organização é obrigatória.'),
    accessScope: z.enum(['ORGANIZATION', 'COMPANIES']),
    companyIds: z.array(z.string()).optional(),
  })
  .refine(
    (data) => data.accessScope !== 'COMPANIES' || (data.companyIds && data.companyIds.length > 0),
    { message: 'Selecione ao menos uma empresa.', path: ['companyIds'] },
  );

type ApproveFormValues = z.infer<typeof approveSchema>;

// --- Query keys ---

const userKeys = {
  all: ['admin-users'] as const,
  list: (params?: Record<string, unknown>) => ['admin-users', 'list', params] as const,
  pending: ['admin-users', 'pending'] as const,
};

// --- Status tag ---

function StatusTag({ status }: { status: string }): ReactElement {
  const colorMap: Record<string, string> = {
    ACTIVE: 'green',
    PENDING: 'orange',
    DISABLED: 'red',
    REJECTED: 'volcano',
  };
  return <Tag color={colorMap[status] ?? 'default'}>{status}</Tag>;
}

// --- Approve Modal ---

interface ApproveModalProps {
  open: boolean;
  user: UserDto | null;
  onClose: () => void;
}

function ApproveModal({ open, user, onClose }: ApproveModalProps): ReactElement {
  const queryClient = useQueryClient();
  const { message } = App.useApp();

  const { data: orgsData } = useQuery({
    queryKey: ['organizations', 'all-for-select'],
    queryFn: () => listOrganizations({ pageSize: 100 }),
    staleTime: 60_000,
    enabled: open,
  });

  const orgOptions = (orgsData?.data ?? []).map((o) => ({ value: o.id, label: o.name }));

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ApproveFormValues>({
    resolver: zodResolver(approveSchema),
    defaultValues: {
      role: 'CLIENT',
      organizationId: '',
      accessScope: 'ORGANIZATION',
      companyIds: [],
    },
  });

  const accessScope = useWatch({ control, name: 'accessScope' });
  const organizationId = useWatch({ control, name: 'organizationId' });

  const { data: companiesData } = useQuery({
    queryKey: ['admin-companies', 'for-user-select', organizationId],
    queryFn: () => listCompanies({ organizationId, pageSize: 100 }),
    enabled: accessScope === 'COMPANIES' && !!organizationId,
  });

  const companyOptions = (companiesData?.data ?? []).map((c) => ({
    value: c.id,
    label: `${c.legalName} — ${formatCompanyDocument(c.cnpj)}`,
  }));

  const approveMutation = useMutation({
    mutationFn: (values: ApproveFormValues) => {
      if (!user) return Promise.resolve();
      return approveUser(user.id, {
        role: values.role,
        organizationId: values.organizationId,
        accessScope: values.accessScope,
        companyIds: values.accessScope === 'COMPANIES' ? values.companyIds : undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      void message.success('Usuário aprovado.');
      reset();
      onClose();
    },
    onError: (error) => void message.error(translateError(error)),
  });

  function onSubmit(values: ApproveFormValues): void {
    approveMutation.mutate(values);
  }

  return (
    <Modal
      open={open}
      title={`Aprovar "${user?.name ?? ''}"`}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={() => void handleSubmit(onSubmit)()}
      confirmLoading={approveMutation.isPending}
      okText="Aprovar"
      cancelText="Cancelar"
    >
      <Form layout="vertical">
        <Form.Item
          label="Papel"
          required
          validateStatus={errors.role ? 'error' : ''}
          help={errors.role?.message}
        >
          <Controller
            name="role"
            control={control}
            render={({ field }) => (
              <Select
                {...field}
                options={[
                  { value: 'CLIENT', label: 'CLIENT' },
                  { value: 'OPERATIONAL', label: 'OPERATIONAL' },
                  { value: 'ADMIN', label: 'ADMIN' },
                ]}
              />
            )}
          />
        </Form.Item>
        <Form.Item
          label="Organização"
          required
          validateStatus={errors.organizationId ? 'error' : ''}
          help={errors.organizationId?.message}
        >
          <Controller
            name="organizationId"
            control={control}
            render={({ field }) => (
              <Select
                {...field}
                placeholder="Selecione a organização"
                options={orgOptions}
                showSearch
                filterOption={(input, option) =>
                  (option?.label as string).toLowerCase().includes(input.toLowerCase())
                }
              />
            )}
          />
        </Form.Item>
        <Form.Item
          label="Escopo de acesso"
          required
          validateStatus={errors.accessScope ? 'error' : ''}
          help={errors.accessScope?.message}
        >
          <Controller
            name="accessScope"
            control={control}
            render={({ field }) => (
              <Select
                {...field}
                options={[
                  { value: 'ORGANIZATION', label: 'Toda a organização' },
                  { value: 'COMPANIES', label: 'Empresas específicas' },
                ]}
              />
            )}
          />
        </Form.Item>
        {accessScope === 'COMPANIES' && (
          <Form.Item
            label="Empresas"
            required
            validateStatus={errors.companyIds ? 'error' : ''}
            help={errors.companyIds?.message}
          >
            <Controller
              name="companyIds"
              control={control}
              render={({ field }) => (
                <Select
                  mode="multiple"
                  value={field.value ?? []}
                  onChange={field.onChange}
                  placeholder="Selecione as empresas"
                  options={companyOptions}
                  filterOption={(input, option) =>
                    (option?.label as string).toLowerCase().includes(input.toLowerCase())
                  }
                />
              )}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

// --- Main Page ---

export function UsersPage(): ReactElement {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserDto | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: userKeys.pending,
    queryFn: listPendingUsers,
    enabled: activeTab === 'pending',
  });

  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: userKeys.list({ page, q: debouncedSearch }),
    queryFn: () => listUsers({ page, pageSize: 20, q: debouncedSearch || undefined }),
    enabled: activeTab === 'all',
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectUser(id, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      void message.success('Usuário rejeitado.');
    },
    onError: (error) => void message.error(translateError(error)),
  });

  function handleApprove(user: UserDto): void {
    setSelectedUser(user);
    setApproveModalOpen(true);
  }

  function handleReject(user: UserDto): void {
    modal.confirm({
      title: `Rejeitar "${user.name}"?`,
      content: 'O usuário não poderá fazer login.',
      okText: 'Rejeitar',
      okType: 'danger',
      onOk: () => rejectMutation.mutateAsync(user.id),
    });
  }

  const pendingColumns: ColumnsType<UserDto> = [
    { title: 'Nome', dataIndex: 'name', key: 'name' },
    { title: 'E-mail', dataIndex: 'email', key: 'email' },
    {
      title: 'Ações',
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space>
          <Can perform="admin:manage">
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              onClick={() => handleApprove(record)}
            >
              Aprovar
            </Button>
          </Can>
          <Can perform="admin:manage">
            <Button
              danger
              size="small"
              icon={<CloseOutlined />}
              onClick={() => handleReject(record)}
            >
              Rejeitar
            </Button>
          </Can>
        </Space>
      ),
    },
  ];

  const allColumns: ColumnsType<UserDto> = [
    { title: 'Nome', dataIndex: 'name', key: 'name' },
    { title: 'E-mail', dataIndex: 'email', key: 'email' },
    { title: 'Papel', dataIndex: 'role', key: 'role', render: (role: string) => <Tag>{role}</Tag> },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) => <StatusTag status={record.status} />,
    },
    {
      title: 'Organização',
      key: 'organization',
      render: (_, record) => record.organization?.name ?? '-',
    },
  ];

  const pendingCount = pendingData?.meta.total ?? pendingData?.data.length ?? 0;

  return (
    <div>
      <PageHeader title="Usuários" />

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'pending' | 'all')}
        items={[
          {
            key: 'pending',
            label: (
              <Badge count={pendingCount} offset={[10, 0]} size="small">
                Pendentes
              </Badge>
            ),
            children: (
              <Table
                rowKey="id"
                columns={pendingColumns}
                dataSource={pendingData?.data}
                loading={pendingLoading}
                pagination={false}
                locale={{ emptyText: 'Nenhum usuário pendente.' }}
              />
            ),
          },
          {
            key: 'all',
            label: 'Todos',
            children: (
              <>
                <Input.Search
                  placeholder="Buscar por nome ou e-mail"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  allowClear
                  style={{ width: 300, marginBottom: 16 }}
                />
                <Table
                  rowKey="id"
                  columns={allColumns}
                  dataSource={allData?.data}
                  loading={allLoading}
                  pagination={{
                    current: page,
                    pageSize: 20,
                    total: allData?.meta.total,
                    onChange: setPage,
                    showSizeChanger: false,
                  }}
                />
              </>
            ),
          },
        ]}
      />

      <ApproveModal
        open={approveModalOpen}
        user={selectedUser}
        onClose={() => {
          setApproveModalOpen(false);
          setSelectedUser(null);
        }}
      />
    </div>
  );
}
