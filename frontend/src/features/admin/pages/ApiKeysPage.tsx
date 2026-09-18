import { CopyOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { createApiKey, listApiKeys, revokeApiKey } from '@/features/admin/api/api-keys-api';
import type { ApiKeyDto, CreatedApiKeyDto } from '@/features/admin/api/api-keys-api';
import { listOperationalUsers } from '@/features/admin/api/user-management-api';
import { translateError } from '@/shared/api/errors';
import { PageHeader } from '@/shared/components/PageHeader';
import { formatDateTime } from '@/shared/lib/format';

const apiKeysQueryKey = ['admin', 'api-keys'] as const;

const apiKeySchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório.').max(100),
  userId: z.string().min(1, 'Selecione o usuário vinculado.'),
});
type ApiKeyFormValues = z.infer<typeof apiKeySchema>;

/**
 * Chaves de API para contas de serviço (docs/13, decisão 2) — é o que o
 * agente de e-mail usa para autenticar. O segredo é mostrado uma única vez,
 * no modal pós-criação; depois disso só o prefixo aparece na tabela.
 */
export function ApiKeysPage(): ReactElement {
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKeyDto | null>(null);

  const { data: apiKeys = [], isLoading } = useQuery({
    queryKey: apiKeysQueryKey,
    queryFn: listApiKeys,
  });

  const { data: internalUsers = [] } = useQuery({
    queryKey: ['users', 'operational'],
    queryFn: listOperationalUsers,
    enabled: createOpen,
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ApiKeyFormValues>({
    resolver: zodResolver(apiKeySchema),
    defaultValues: { name: '', userId: '' },
  });

  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
      setCreateOpen(false);
      reset({ name: '', userId: '' });
      setCreated(result);
    },
    onError: (error) => void message.error(translateError(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: apiKeysQueryKey });
      void message.success('Chave revogada.');
    },
    onError: (error) => void message.error(translateError(error)),
  });

  async function copyKey(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      void message.success('Chave copiada.');
    } catch {
      void message.warning('Não foi possível copiar automaticamente. Selecione e copie o texto.');
    }
  }

  const columns: ColumnsType<ApiKeyDto> = [
    { title: 'Nome', dataIndex: 'name', key: 'name' },
    {
      title: 'Prefixo',
      dataIndex: 'keyPrefix',
      key: 'keyPrefix',
      render: (prefix: string) => <Typography.Text code>{prefix}…</Typography.Text>,
    },
    {
      title: 'Usuário vinculado',
      key: 'user',
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <span>{record.user.name}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.user.email} · {record.user.role}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Último uso',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      render: (value: string | null) => (value ? formatDateTime(value) : 'Nunca'),
    },
    {
      title: 'Criada em',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (value: string) => formatDateTime(value),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, record) =>
        record.revokedAt ? (
          <Tag color="default">Revogada em {formatDateTime(record.revokedAt)}</Tag>
        ) : (
          <Tag color="green">Ativa</Tag>
        ),
    },
    {
      title: 'Ações',
      key: 'actions',
      render: (_, record) =>
        record.revokedAt ? null : (
          <Popconfirm
            title="Revogar esta chave?"
            description="Quem a usa perde o acesso imediatamente. A ação não pode ser desfeita."
            onConfirm={() => revokeMutation.mutate(record.id)}
            okText="Revogar"
            okButtonProps={{ danger: true }}
          >
            <Button
              type="text"
              danger
              size="small"
              icon={<StopOutlined />}
              aria-label={`Revogar chave ${record.name}`}
            >
              Revogar
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Chaves de API"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Nova chave
          </Button>
        }
      />

      <Typography.Paragraph type="secondary">
        Chaves de API autenticam integrações (como o agente que lê a caixa de e-mail) com o header{' '}
        <Typography.Text code>X-Api-Key</Typography.Text>. Cada chave age como o usuário interno
        vinculado: o histórico dos processos mostra esse usuário como autor.
      </Typography.Paragraph>

      <Table<ApiKeyDto>
        rowKey="id"
        columns={columns}
        dataSource={apiKeys}
        loading={isLoading}
        pagination={false}
      />

      <Modal
        open={createOpen}
        title="Nova chave de API"
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleSubmit((values) => createMutation.mutate(values))()}
        confirmLoading={createMutation.isPending}
        okText="Criar"
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
              render={({ field }) => <Input {...field} placeholder="Ex.: Agente de e-mail" />}
            />
          </Form.Item>
          <Form.Item
            label="Usuário vinculado (interno)"
            required
            validateStatus={errors.userId ? 'error' : ''}
            help={errors.userId?.message}
          >
            <Controller
              name="userId"
              control={control}
              render={({ field }) => (
                <Select
                  {...field}
                  showSearch={{ optionFilterProp: 'label' }}
                  placeholder="Selecione um usuário OPERATIONAL ou ADMIN"
                  options={internalUsers.map((user) => ({
                    value: user.id,
                    label: `${user.name} (${user.role})`,
                  }))}
                />
              )}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={created !== null}
        title="Chave criada"
        onCancel={() => setCreated(null)}
        onOk={() => setCreated(null)}
        okText="Já copiei"
        cancelButtonProps={{ style: { display: 'none' } }}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="Esta é a única vez que a chave completa será exibida."
          description="Guarde-a no cofre de segredos da integração. Se perder, revogue e crie outra."
        />
        {created && (
          <Space.Compact style={{ width: '100%' }}>
            <Input readOnly value={created.key} aria-label="Chave de API" />
            <Button icon={<CopyOutlined />} onClick={() => void copyKey(created.key)}>
              Copiar
            </Button>
          </Space.Compact>
        )}
      </Modal>
    </div>
  );
}
