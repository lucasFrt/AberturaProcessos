import { InboxOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Button, Form, Input, Select, Switch, Upload } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import type { RcFile } from 'antd/es/upload';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { useAuthStore } from '@/features/auth/store/auth-store';
import { searchCompanies } from '@/features/companies/api/company-api';
import { useDebounce } from '@/shared/hooks/useDebounce';
import type { CompanySummary } from '@/shared/types';

/**
 * Schema replicado dos limites do backend (`backend/src/http/schemas/process-schemas.ts`,
 * docs/08 "Abertura de processo"): `reference` 3-255 caracteres,
 * `additionalInfo` até 10.000. `requestingCompanyId` só é exigido quando o
 * toggle "solicitado por outra empresa" está ativo.
 */
const processFormSchema = z
  .object({
    clientCompanyId: z.string().min(1, 'CNPJ Cliente é obrigatório.'),
    hasRequestingCompany: z.boolean(),
    requestingCompanyId: z.string().min(1).nullable().optional(),
    reference: z
      .string()
      .trim()
      .min(3, 'Referência precisa ter ao menos 3 caracteres.')
      .max(255, 'Referência pode ter no máximo 255 caracteres.'),
    additionalInfo: z.string().max(10_000, 'Adicionais pode ter no máximo 10.000 caracteres.'),
  })
  .refine((data) => !data.hasRequestingCompany || !!data.requestingCompanyId, {
    message: 'Selecione o CNPJ solicitante.',
    path: ['requestingCompanyId'],
  });

export type ProcessFormValues = z.infer<typeof processFormSchema>;

const ADDITIONAL_INFO_MAX_LENGTH = 10_000;

interface ProcessFormProps {
  onSubmit: (values: ProcessFormValues, files: File[]) => void | Promise<void>;
  isSubmitting: boolean;
}

/** `Select` com busca assíncrona (debounce) para CNPJ (docs/08, tabela de campos). */
interface CompanySelectProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
}

function CompanySelect({
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
}: CompanySelectProps): ReactElement {
  const user = useAuthStore((state) => state.user);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  // CLIENT não tem acesso a `GET /companies` (rota restrita a ADMIN no
  // backend real) — usa a própria lista de CNPJs já devolvida por
  // `/auth/me`, filtrada localmente, em vez de buscar no servidor.
  const isClient = user?.role === 'CLIENT';

  const { data: remoteCompanies, isFetching } = useQuery({
    queryKey: ['companies', 'search', debouncedSearchTerm],
    queryFn: () => searchCompanies({ q: debouncedSearchTerm || undefined }),
    enabled: !isClient,
    staleTime: 30_000,
  });

  const options = useMemo(() => {
    const companies: CompanySummary[] = isClient
      ? (user?.companies ?? [])
      : (remoteCompanies ?? []);
    return companies.map((company) => ({
      value: company.id,
      label: `${company.legalName} — ${company.cnpj}`,
    }));
  }, [isClient, user?.companies, remoteCompanies]);

  return (
    <Select
      value={value ?? undefined}
      onChange={(selected: string) => onChange(selected)}
      onSearch={isClient ? undefined : setSearchTerm}
      showSearch
      allowClear
      onClear={() => onChange(null)}
      filterOption={
        isClient
          ? (input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())
          : false
      }
      loading={!isClient && isFetching}
      disabled={disabled}
      placeholder={placeholder}
      options={options}
      notFoundContent={isFetching ? 'Buscando...' : 'Nenhum CNPJ encontrado'}
      aria-label={ariaLabel}
    />
  );
}

/**
 * Formulário de abertura (docs/08, "Abertura de processo"). Junta os
 * arquivos localmente (sem enviar) — o upload real acontece em
 * `NewProcessPage`, no segundo passo da submissão, só depois que o
 * processo é criado com sucesso.
 */
export function ProcessForm({ onSubmit, isSubmitting }: ProcessFormProps): ReactElement {
  const user = useAuthStore((state) => state.user);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const singleOwnCompanyId =
    user?.role === 'CLIENT' && user.companies.length === 1 ? user.companies[0]?.id : undefined;

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProcessFormValues>({
    resolver: zodResolver(processFormSchema),
    defaultValues: {
      clientCompanyId: singleOwnCompanyId ?? '',
      hasRequestingCompany: false,
      requestingCompanyId: null,
      reference: '',
      additionalInfo: '',
    },
  });

  const hasRequestingCompany = watch('hasRequestingCompany');
  const additionalInfo = watch('additionalInfo');

  const uploadProps: UploadProps = {
    multiple: true,
    fileList,
    beforeUpload: () => false, // nunca envia sozinho — só junta os arquivos localmente.
    onChange: ({ fileList: newFileList }) => setFileList(newFileList),
    onRemove: (file) => {
      setFileList((current) => current.filter((item) => item.uid !== file.uid));
    },
  };

  function submitHandler(values: ProcessFormValues): void {
    const files = fileList
      .map((item) => item.originFileObj)
      .filter((file): file is RcFile => file !== undefined);
    void onSubmit(values, files);
  }

  return (
    <Form layout="vertical" onFinish={() => void handleSubmit(submitHandler)()}>
      <Form.Item
        label="CNPJ Cliente"
        required
        validateStatus={errors.clientCompanyId ? 'error' : ''}
        help={errors.clientCompanyId?.message}
      >
        <Controller
          name="clientCompanyId"
          control={control}
          render={({ field }) => (
            <CompanySelect
              value={field.value}
              onChange={(selected) => field.onChange(selected ?? '')}
              disabled={singleOwnCompanyId !== undefined}
              placeholder="Busque por razão social ou CNPJ"
              ariaLabel="CNPJ Cliente"
            />
          )}
        />
      </Form.Item>

      <Form.Item label="Este processo foi solicitado por outra empresa?">
        <Controller
          name="hasRequestingCompany"
          control={control}
          render={({ field }) => (
            <Switch
              checked={field.value}
              onChange={(checked) => {
                field.onChange(checked);
                if (!checked) {
                  setValue('requestingCompanyId', null);
                }
              }}
              aria-label="Este processo foi solicitado por outra empresa?"
            />
          )}
        />
      </Form.Item>

      {hasRequestingCompany && (
        <Form.Item
          label="CNPJ Solicitante"
          validateStatus={errors.requestingCompanyId ? 'error' : ''}
          help={errors.requestingCompanyId?.message}
        >
          <Controller
            name="requestingCompanyId"
            control={control}
            render={({ field }) => (
              <CompanySelect
                value={field.value}
                onChange={field.onChange}
                placeholder="Busque por razão social ou CNPJ"
                ariaLabel="CNPJ Solicitante"
              />
            )}
          />
        </Form.Item>
      )}

      <Form.Item
        label="Referência"
        required
        validateStatus={errors.reference ? 'error' : ''}
        help={errors.reference?.message}
      >
        <Controller
          name="reference"
          control={control}
          render={({ field }) => (
            <Input {...field} placeholder="Ex.: IMP-2026-0042 / Contêiner MSKU1234567" />
          )}
        />
      </Form.Item>

      <Form.Item
        label="Adicionais"
        validateStatus={errors.additionalInfo ? 'error' : ''}
        help={
          errors.additionalInfo?.message ??
          `${(additionalInfo ?? '').length}/${ADDITIONAL_INFO_MAX_LENGTH}`
        }
      >
        <Controller
          name="additionalInfo"
          control={control}
          render={({ field }) => (
            <Input.TextArea {...field} rows={6} maxLength={ADDITIONAL_INFO_MAX_LENGTH} showCount />
          )}
        />
      </Form.Item>

      <Form.Item label="Documentos">
        <Upload.Dragger {...uploadProps}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">Clique ou arraste arquivos para esta área</p>
          <p className="ant-upload-hint">
            Suporta múltiplos arquivos, de qualquer tipo. O envio ocorre após a criação do processo.
          </p>
        </Upload.Dragger>
      </Form.Item>

      <Form.Item>
        <Button type="primary" htmlType="submit" loading={isSubmitting} disabled={isSubmitting}>
          Criar processo
        </Button>
      </Form.Item>
    </Form>
  );
}
