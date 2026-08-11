import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import {
  createCompany,
  deleteCompany,
  listCompanies,
  updateCompany,
} from '@/features/admin/api/companies-api';
import type { CompanyDto } from '@/features/admin/api/companies-api';
import { listOrganizations } from '@/features/admin/api/organizations-api';
import { translateError } from '@/shared/api/errors';
import { Can } from '@/shared/components/Can';
import { PageHeader } from '@/shared/components/PageHeader';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { isValidCnpj, maskCnpj, normalizeCnpjDigits } from '@/shared/lib/cnpj';

// --- Schema ---

const companySchema = z.object({
  cnpj: z
    .string()
    .min(1, 'CNPJ é obrigatório.')
    .refine((v) => isValidCnpj(v), 'CNPJ inválido.'),
  legalName: z.string().trim().min(1, 'Razão social é obrigatória.'),
  tradeName: z.string().trim().optional(),
  organizationId: z.string().min(1, 'Organização é obrigatória.'),
});

type CompanyFormValues = z.infer<typeof companySchema>;

// --- Query keys ---

const companyKeys = {
  all: ['admin-companies'] as const,
  list: (params?: Record<string, unknown>) => ['admin-companies', 'list', params] as const,
};

// --- Page ---

export function CompaniesPage(): ReactElement {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<CompanyDto | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: companyKeys.list({ page, q: debouncedSearch, organizationId: orgFilter }),
    queryFn: () =>
      listCompanies({
        page,
        pageSize: 20,
        q: debouncedSearch || undefined,
        organizationId: orgFilter,
      }),
  });

  const { data: orgsData } = useQuery({
    queryKey: ['organizations', 'all-for-select'],
    queryFn: () => listOrganizations({ pageSize: 100 }),
    staleTime: 60_000,
  });

  const orgOptions = (orgsData?.data ?? []).map((o) => ({ value: o.id, label: o.name }));

  const createMutation = useMutation({
    mutationFn: createCompany,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
      void message.success('Empresa criada.');
      closeModal();
    },
    onError: (error) => void message.error(translateError(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      legalName?: string;
      tradeName?: string;
      organizationId?: string;
      isActive?: boolean;
    }) => updateCompany(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
      void message.success('Empresa atualizada.');
      closeModal();
    },
    onError: (error) => void message.error(translateError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCompany,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companyKeys.all });
      void message.success('Empresa excluída.');
    },
    onError: (error) => void message.error(translateError(error)),
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: { cnpj: '', legalName: '', tradeName: '', organizationId: '' },
  });

  function openCreate(): void {
    setEditingCompany(null);
    reset({ cnpj: '', legalName: '', tradeName: '', organizationId: '' });
    setModalOpen(true);
  }

  function openEdit(company: CompanyDto): void {
    setEditingCompany(company);
    reset({
      cnpj: company.cnpj,
      legalName: company.legalName,
      tradeName: company.tradeName ?? '',
      organizationId: company.organizationId,
    });
    setModalOpen(true);
  }

  function closeModal(): void {
    setModalOpen(false);
    setEditingCompany(null);
  }

  function onSubmit(values: CompanyFormValues): void {
    const cleanCnpj = normalizeCnpjDigits(values.cnpj);
    if (editingCompany) {
      updateMutation.mutate({
        id: editingCompany.id,
        legalName: values.legalName,
        tradeName: values.tradeName || undefined,
        organizationId: values.organizationId,
      });
    } else {
      createMutation.mutate({
        cnpj: cleanCnpj,
        legalName: values.legalName,
        tradeName: values.tradeName || undefined,
        organizationId: values.organizationId,
      });
    }
  }

  const columns: ColumnsType<CompanyDto> = [
    {
      title: 'CNPJ',
      key: 'cnpj',
      render: (_, record) => maskCnpj(record.cnpj),
    },
    { title: 'Razão social', dataIndex: 'legalName', key: 'legalName' },
    {
      title: 'Organização',
      key: 'organization',
      render: (_, record) => record.organization?.name ?? '-',
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
              aria-label="Editar empresa"
            />
          </Can>
          <Can perform="admin:manage">
            <Popconfirm
              title="Excluir esta empresa?"
              description="Empresas com processos vinculados não podem ser excluídas."
              onConfirm={() => deleteMutation.mutate(record.id)}
            >
              <Button type="text" danger icon={<DeleteOutlined />} aria-label="Excluir empresa" />
            </Popconfirm>
          </Can>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Empresas"
        extra={
          <Can perform="admin:manage">
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Criar empresa
            </Button>
          </Can>
        }
      />

      <Space style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="Buscar por razão social ou CNPJ"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          allowClear
          style={{ width: 300 }}
        />
        <Select
          placeholder="Filtrar por organização"
          value={orgFilter}
          onChange={(value: string | undefined) => {
            setOrgFilter(value);
            setPage(1);
          }}
          allowClear
          options={orgOptions}
          style={{ width: 220 }}
        />
      </Space>

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

      <Modal
        open={modalOpen}
        title={editingCompany ? 'Editar empresa' : 'Criar empresa'}
        onCancel={closeModal}
        onOk={() => void handleSubmit(onSubmit)()}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        okText={editingCompany ? 'Salvar' : 'Criar'}
        cancelText="Cancelar"
      >
        <Form layout="vertical">
          <Form.Item
            label="CNPJ"
            required
            validateStatus={errors.cnpj ? 'error' : ''}
            help={errors.cnpj?.message}
          >
            <Controller
              name="cnpj"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  placeholder="00.000.000/0000-00"
                  disabled={editingCompany !== null}
                />
              )}
            />
          </Form.Item>
          <Form.Item
            label="Razão social"
            required
            validateStatus={errors.legalName ? 'error' : ''}
            help={errors.legalName?.message}
          >
            <Controller
              name="legalName"
              control={control}
              render={({ field }) => <Input {...field} placeholder="Razão social" />}
            />
          </Form.Item>
          <Form.Item label="Nome fantasia">
            <Controller
              name="tradeName"
              control={control}
              render={({ field }) => <Input {...field} placeholder="Nome fantasia (opcional)" />}
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
        </Form>
      </Modal>
    </div>
  );
}
