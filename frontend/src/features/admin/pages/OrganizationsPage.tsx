import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Collapse,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactElement } from 'react';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  createDomain,
  createOrganization,
  deleteDomain,
  deleteOrganization,
  listDomains,
  listOrganizations,
  updateOrganization,
} from '@/features/admin/api/organizations-api';
import type { DomainDto, OrganizationDto } from '@/features/admin/api/organizations-api';
import { translateError } from '@/shared/api/errors';
import { Can } from '@/shared/components/Can';
import { PageHeader } from '@/shared/components/PageHeader';

// --- Schemas ---

const organizationSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.'),
  isInternal: z.boolean(),
});

type OrganizationFormValues = z.infer<typeof organizationSchema>;

const domainSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, 'Domínio é obrigatório.')
    .transform((v) => v.toLowerCase().replace('@', '').trim()),
  defaultRole: z.enum(['CLIENT', 'OPERATIONAL', 'ADMIN']),
  autoApprove: z.boolean(),
});

type DomainFormValues = z.infer<typeof domainSchema>;

// --- Query keys ---

const orgKeys = {
  all: ['organizations'] as const,
  list: (params?: Record<string, unknown>) => ['organizations', 'list', params] as const,
  domains: (orgId: string) => ['organizations', orgId, 'domains'] as const,
};

// --- Domain Panel ---

function DomainPanel({ organization }: { organization: OrganizationDto }): ReactElement {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [showAddForm, setShowAddForm] = useState(false);

  const { data: domains = [], isLoading } = useQuery({
    queryKey: orgKeys.domains(organization.id),
    queryFn: () => listDomains(organization.id),
  });

  const addMutation = useMutation({
    mutationFn: (payload: DomainFormValues) => createDomain(organization.id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.domains(organization.id) });
      void message.success('Domínio adicionado.');
      setShowAddForm(false);
    },
    onError: (error) => {
      void message.error(translateError(error));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (domainId: string) => deleteDomain(organization.id, domainId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.domains(organization.id) });
      void message.success('Domínio removido.');
    },
    onError: (error) => {
      void message.error(translateError(error));
    },
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DomainFormValues>({
    resolver: zodResolver(domainSchema),
    defaultValues: { domain: '', defaultRole: 'CLIENT', autoApprove: true },
  });

  function onSubmitDomain(values: DomainFormValues): void {
    addMutation.mutate(values);
    reset();
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <List
        size="small"
        loading={isLoading}
        dataSource={domains}
        locale={{ emptyText: 'Nenhum domínio cadastrado.' }}
        renderItem={(item: DomainDto) => (
          <List.Item
            actions={[
              <Can perform="admin:manage" key="delete">
                <Popconfirm
                  title="Remover este domínio?"
                  onConfirm={() => removeMutation.mutate(item.id)}
                >
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Remover domínio"
                  />
                </Popconfirm>
              </Can>,
            ]}
          >
            <Space>
              <Tag>{item.domain}</Tag>
              <Tag color="blue">{item.defaultRole}</Tag>
              <Tag color={item.autoApprove ? 'green' : 'orange'}>
                {item.autoApprove ? 'Auto-aprovar' : 'Aprovação manual'}
              </Tag>
            </Space>
          </List.Item>
        )}
      />

      {showAddForm ? (
        <Form
          layout="inline"
          onFinish={() => void handleSubmit(onSubmitDomain)()}
          style={{ marginTop: 8 }}
        >
          <Form.Item validateStatus={errors.domain ? 'error' : ''} help={errors.domain?.message}>
            <Controller
              name="domain"
              control={control}
              render={({ field }) => (
                <Input {...field} placeholder="exemplo.com.br" style={{ width: 180 }} />
              )}
            />
          </Form.Item>
          <Form.Item>
            <Controller
              name="defaultRole"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  style={{ width: 140 }}
                  options={[
                    { value: 'CLIENT', label: 'CLIENT' },
                    { value: 'OPERATIONAL', label: 'OPERATIONAL' },
                    { value: 'ADMIN', label: 'ADMIN' },
                  ]}
                />
              )}
            />
          </Form.Item>
          <Form.Item label="Auto-aprovar">
            <Controller
              name="autoApprove"
              control={control}
              render={({ field }) => (
                <Switch checked={field.value} onChange={field.onChange} aria-label="Auto-aprovar" />
              )}
            />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={addMutation.isPending}>
              Adicionar
            </Button>
          </Form.Item>
          <Form.Item>
            <Button onClick={() => setShowAddForm(false)}>Cancelar</Button>
          </Form.Item>
        </Form>
      ) : (
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => setShowAddForm(true)}
          style={{ marginTop: 8 }}
        >
          Adicionar domínio
        </Button>
      )}
    </div>
  );
}

// --- Main Page ---

export function OrganizationsPage(): ReactElement {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrganizationDto | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: orgKeys.list({ page }),
    queryFn: () => listOrganizations({ page, pageSize: 20 }),
  });

  const createMutation = useMutation({
    mutationFn: createOrganization,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.all });
      void message.success('Organização criada.');
      closeModal();
    },
    onError: (error) => {
      void message.error(translateError(error));
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name?: string; isActive?: boolean }) =>
      updateOrganization(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.all });
      void message.success('Organização atualizada.');
      closeModal();
    },
    onError: (error) => {
      void message.error(translateError(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteOrganization,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.all });
      void message.success('Organização excluída.');
    },
    onError: (error) => {
      void message.error(translateError(error));
    },
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<OrganizationFormValues>({
    resolver: zodResolver(organizationSchema),
    defaultValues: { name: '', isInternal: false },
  });

  function openCreate(): void {
    setEditingOrg(null);
    reset({ name: '', isInternal: false });
    setModalOpen(true);
  }

  function openEdit(org: OrganizationDto): void {
    setEditingOrg(org);
    reset({ name: org.name, isInternal: org.isInternal });
    setModalOpen(true);
  }

  function closeModal(): void {
    setModalOpen(false);
    setEditingOrg(null);
  }

  function onSubmit(values: OrganizationFormValues): void {
    if (editingOrg) {
      updateMutation.mutate({ id: editingOrg.id, name: values.name });
    } else {
      createMutation.mutate(values);
    }
  }

  const handleDelete = useCallback(
    (org: OrganizationDto) => {
      modal.confirm({
        title: `Excluir "${org.name}"?`,
        content: 'Organizações com usuários, empresas ou processos não podem ser excluídas.',
        okText: 'Excluir',
        okType: 'danger',
        onOk: () => deleteMutation.mutateAsync(org.id),
      });
    },
    [modal, deleteMutation],
  );

  const columns: ColumnsType<OrganizationDto> = [
    { title: 'Nome', dataIndex: 'name', key: 'name' },
    {
      title: 'Tipo',
      key: 'isInternal',
      render: (_, record) => (
        <Tag color={record.isInternal ? 'blue' : 'default'}>
          {record.isInternal ? 'Interna' : 'Externa'}
        </Tag>
      ),
    },
    {
      title: 'Status',
      key: 'isActive',
      render: (_, record) => (
        <Tag color={record.isActive ? 'green' : 'red'}>{record.isActive ? 'Ativa' : 'Inativa'}</Tag>
      ),
    },
    {
      title: 'Ações',
      key: 'actions',
      width: 120,
      render: (_, record) => (
        <Space>
          <Can perform="admin:manage">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
              aria-label="Editar organização"
            />
          </Can>
          <Can perform="admin:manage">
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)}
              aria-label="Excluir organização"
            />
          </Can>
        </Space>
      ),
    },
  ];

  const collapseItems = (data?.data ?? []).map((org) => ({
    key: org.id,
    label: `Domínios de "${org.name}"`,
    children: <DomainPanel organization={org} />,
  }));

  return (
    <div>
      <PageHeader
        title="Organizações"
        extra={
          <Can perform="admin:manage">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Criar organização
            </Button>
          </Can>
        }
      />

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data?.data}
        loading={isLoading}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.meta.total,
          onChange: setPage,
          showSizeChanger: false,
        }}
      />

      {(data?.data ?? []).length > 0 && (
        <Collapse items={collapseItems} style={{ marginTop: 16 }} />
      )}

      <Modal
        open={modalOpen}
        title={editingOrg ? 'Editar organização' : 'Criar organização'}
        onCancel={closeModal}
        onOk={() => void handleSubmit(onSubmit)()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        okText={editingOrg ? 'Salvar' : 'Criar'}
        cancelText="Cancelar"
      >
        <Form layout="vertical">
          <Form.Item
            label="Nome"
            required
            validateStatus={errors.name ? 'error' : ''}
            help={errors.name?.message}
          >
            <Controller
              name="name"
              control={control}
              render={({ field }) => <Input {...field} placeholder="Nome da organização" />}
            />
          </Form.Item>
          {!editingOrg && (
            <Form.Item label="Organização interna?">
              <Controller
                name="isInternal"
                control={control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onChange={field.onChange}
                    aria-label="Organização interna"
                  />
                )}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
