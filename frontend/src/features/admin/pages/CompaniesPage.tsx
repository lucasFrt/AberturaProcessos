import {
  DeleteOutlined,
  EditOutlined,
  LoadingOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  createCompany,
  deleteCompany,
  listCompanies,
  lookupCnpj,
  updateCompany,
} from '@/features/admin/api/companies-api';
import type { CompanyDto } from '@/features/admin/api/companies-api';
import { createOrganization, listOrganizations } from '@/features/admin/api/organizations-api';
import { translateError } from '@/shared/api/errors';
import { Can } from '@/shared/components/Can';
import { PageHeader } from '@/shared/components/PageHeader';
import { useDebounce } from '@/shared/hooks/useDebounce';
import {
  isValidCnpj,
  isValidDocument,
  maskDocument,
  normalizeCnpjDigits,
  PENDING_REGISTRATION_LABEL,
} from '@/shared/lib/cnpj';

// --- Schema ---

// `cnpj` vazio só é aceito ao editar cadastro pendente sem completá-lo; na
// criação `onSubmit` exige o campo (o schema não sabe em que modo o modal está).
const companySchema = z.object({
  cnpj: z.string().refine((v) => v === '' || isValidDocument(v), 'CNPJ ou CPF inválido.'),
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

  // --- Criação rápida de organização, sem saltar para a tela de Administração ---

  const [newOrgName, setNewOrgName] = useState('');

  const createOrgMutation = useMutation({
    mutationFn: () => createOrganization({ name: newOrgName.trim() }),
    onSuccess: (organization) => {
      void queryClient.invalidateQueries({ queryKey: ['organizations', 'all-for-select'] });
      setValue('organizationId', organization.id, { shouldValidate: true });
      setNewOrgName('');
      void message.success('Organização criada.');
    },
    onError: (error) => void message.error(translateError(error)),
  });

  function submitNewOrganization(): void {
    const name = newOrgName.trim();
    if (!name || createOrgMutation.isPending) return;
    createOrgMutation.mutate();
  }

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
    setValue,
    setError,
    formState: { errors },
  } = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
    defaultValues: { cnpj: '', legalName: '', tradeName: '', organizationId: '' },
  });

  // --- Autopreenchimento pela Receita Federal ---

  const [lookupNotice, setLookupNotice] = useState<{
    type: 'success' | 'warning';
    text: string;
  } | null>(null);

  /**
   * Último CNPJ já consultado. Sem isso, o efeito abaixo refaz a consulta a
   * cada re-render enquanto o campo continuar válido — e a cota do plano
   * gratuito é de 3 consultas por minuto.
   */
  const lastLookedUpRef = useRef<string | null>(null);

  const { mutate: runCnpjLookup, isPending: isLookingUp } = useMutation({
    mutationFn: lookupCnpj,
    onSuccess: (result) => {
      setValue('legalName', result.legalName, { shouldValidate: true });
      setValue('tradeName', result.tradeName ?? '');

      if (result.alreadyRegistered) {
        setLookupNotice({
          type: 'warning',
          text: 'Este CNPJ já está cadastrado. Os dados exibidos vieram do próprio sistema.',
        });
        return;
      }

      const status = result.registrationStatus;
      if (status && status.toUpperCase() !== 'ATIVA') {
        setLookupNotice({
          type: 'warning',
          text: `Dados preenchidos pela Receita Federal. Atenção: situação cadastral "${status}".`,
        });
        return;
      }

      // A própria Receita não tem nome fantasia para uma parte das empresas
      // (comum em CNPJs mais antigos ou que nunca registraram um): sem este
      // aviso, o campo vazio pareceria falha da consulta em vez de dado
      // realmente ausente na fonte.
      setLookupNotice(
        result.tradeName
          ? { type: 'success', text: 'Dados preenchidos pela Receita Federal.' }
          : {
              type: 'success',
              text: 'Dados preenchidos pela Receita Federal. Esta empresa não tem nome fantasia registrado — o campo pode ficar em branco ou ser preenchido manualmente.',
            },
      );
    },
    onError: (error) => setLookupNotice({ type: 'warning', text: translateError(error) }),
  });

  const cnpjValue = useWatch({ control, name: 'cnpj' });
  // Cadastro pendente (docs/13, decisão 10): o CNPJ ainda não existe e pode
  // ser definido na edição — único caso em que o campo fica editável ali.
  const documentEditable = editingCompany === null || editingCompany.cnpj === null;

  // Dispara sozinho quando o CNPJ fica completo e válido: é o que evita
  // digitar razão social e nome fantasia à mão. Na edição de cadastro
  // completo o campo é somente leitura, então não há o que consultar.
  useEffect(() => {
    if (!modalOpen || !documentEditable) return;

    const digits = normalizeCnpjDigits(cnpjValue ?? '');
    if (digits.length !== 14 || !isValidCnpj(digits)) {
      lastLookedUpRef.current = null;
      return;
    }
    if (lastLookedUpRef.current === digits) return;

    lastLookedUpRef.current = digits;
    runCnpjLookup(digits);
  }, [cnpjValue, modalOpen, documentEditable, runCnpjLookup]);

  /**
   * Retentativa manual. Necessária porque o efeito acima só dispara na
   * transição para "CNPJ válido": depois de um 429 (limite de 3/min), o
   * usuário precisa de um jeito de repetir a mesma consulta.
   */
  function retryCnpjLookup(): void {
    const digits = normalizeCnpjDigits(cnpjValue ?? '');
    if (digits.length !== 14 || !isValidCnpj(digits)) return;
    lastLookedUpRef.current = digits;
    runCnpjLookup(digits);
  }

  function resetLookupState(): void {
    setLookupNotice(null);
    lastLookedUpRef.current = null;
  }

  function openCreate(): void {
    setEditingCompany(null);
    reset({ cnpj: '', legalName: '', tradeName: '', organizationId: '' });
    resetLookupState();
    setModalOpen(true);
  }

  function openEdit(company: CompanyDto): void {
    setEditingCompany(company);
    reset({
      // A API devolve só dígitos; o formulário exibe com máscara.
      cnpj: company.cnpj ? maskDocument(company.cnpj) : '',
      legalName: company.legalName,
      tradeName: company.tradeName ?? '',
      organizationId: company.organizationId,
    });
    resetLookupState();
    setModalOpen(true);
  }

  function closeModal(): void {
    setModalOpen(false);
    setEditingCompany(null);
    resetLookupState();
  }

  function onSubmit(values: CompanyFormValues): void {
    const cleanCnpj = normalizeCnpjDigits(values.cnpj);
    if (!editingCompany && cleanCnpj.length === 0) {
      setError('cnpj', { message: 'CNPJ/CPF é obrigatório.' });
      return;
    }
    if (editingCompany) {
      updateMutation.mutate({
        id: editingCompany.id,
        // Só a pendente pode ganhar documento; vazio = continua pendente.
        ...(editingCompany.cnpj === null && cleanCnpj.length > 0 ? { cnpj: cleanCnpj } : {}),
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
      title: 'CNPJ/CPF',
      key: 'cnpj',
      render: (_, record) =>
        record.cnpj === null ? (
          <Tooltip title="Criada pelo intake de e-mail sem CNPJ. Edite para completar o cadastro.">
            <Tag color="orange">{PENDING_REGISTRATION_LABEL}</Tag>
          </Tooltip>
        ) : (
          <>
            {maskDocument(record.cnpj)}
            {record.documentType === 'CPF' && (
              <Tag style={{ marginLeft: 8 }} color="purple">
                CPF
              </Tag>
            )}
          </>
        ),
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
          placeholder="Buscar por razão social, CNPJ ou CPF"
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
            label="CNPJ ou CPF"
            required
            validateStatus={errors.cnpj ? 'error' : ''}
            help={errors.cnpj?.message}
            extra={
              !documentEditable
                ? undefined
                : editingCompany
                  ? 'Cadastro pendente: informe o CNPJ/CPF para completar. Deixe vazio para manter pendente.'
                  : 'CNPJ completo: razão social e nome fantasia são buscados na Receita Federal. CPF (pessoa física): preencha o nome manualmente.'
            }
          >
            <Controller
              name="cnpj"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  onChange={(event) => field.onChange(maskDocument(event.target.value))}
                  placeholder="00.000.000/0000-00 ou 000.000.000-00"
                  inputMode="numeric"
                  disabled={!documentEditable}
                  suffix={
                    !documentEditable ? null : isLookingUp ? (
                      <LoadingOutlined aria-label="Consultando CNPJ na Receita Federal" />
                    ) : (
                      <Tooltip title="Consultar CNPJ na Receita Federal">
                        <Button
                          type="text"
                          size="small"
                          icon={<SearchOutlined />}
                          onClick={retryCnpjLookup}
                          aria-label="Consultar CNPJ na Receita Federal"
                        />
                      </Tooltip>
                    )
                  }
                />
              )}
            />
          </Form.Item>
          {lookupNotice ? (
            <Alert
              type={lookupNotice.type === 'success' ? 'success' : 'warning'}
              message={lookupNotice.text}
              showIcon
              closable
              onClose={() => setLookupNotice(null)}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Form.Item
            label="Razão social"
            required
            validateStatus={errors.legalName ? 'error' : ''}
            help={errors.legalName?.message}
          >
            <Controller
              name="legalName"
              control={control}
              render={({ field }) => (
                <Input {...field} placeholder="Preenchido pela consulta do CNPJ" />
              )}
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
                  popupRender={(menu) => (
                    <>
                      {menu}
                      <Divider style={{ margin: '8px 0' }} />
                      <Space style={{ padding: '0 8px 8px', width: '100%' }}>
                        <Input
                          placeholder="Nova organização"
                          value={newOrgName}
                          onChange={(event) => setNewOrgName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              submitNewOrganization();
                            }
                          }}
                        />
                        <Button
                          type="text"
                          icon={<PlusOutlined />}
                          loading={createOrgMutation.isPending}
                          onClick={submitNewOrganization}
                          disabled={!newOrgName.trim()}
                        >
                          Adicionar
                        </Button>
                      </Space>
                    </>
                  )}
                />
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
