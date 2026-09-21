import { useQuery } from '@tanstack/react-query';
import { DatePicker, Flex, Input, Select } from 'antd';
import dayjs from 'dayjs';
import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';

import { listOperationalUsers } from '@/features/admin/api/user-management-api';
import { useAuthStore } from '@/features/auth/store/auth-store';
import { searchCompanies } from '@/features/companies/api/company-api';
import type { BoardFilters } from '@/features/processes/api/process-api';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { formatCompanyDocument } from '@/shared/lib/cnpj';
import type { CompanySummary } from '@/shared/types';

const { RangePicker } = DatePicker;

interface ProcessFiltersProps {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
}

/**
 * Filtros do board (docs/08, "Board Kanban"): busca por código/referência,
 * CNPJ, responsável, período. Persistidos na querystring pelo componente
 * pai (`BoardPage`, via `useSearchParams`) — este componente só lê/escreve
 * o objeto `filters`, sem conhecer a URL.
 */
export function ProcessFilters({ filters, onChange }: ProcessFiltersProps): ReactElement {
  const user = useAuthStore((state) => state.user);
  const isClient = user?.role === 'CLIENT';
  const [companySearch, setCompanySearch] = useState('');
  const debouncedCompanySearch = useDebounce(companySearch, 300);

  // CLIENT não acessa `GET /companies` nem `GET /users/operational`
  // (backend real restringe as duas a OPERATIONAL/ADMIN — a segunda nem
  // ao CLIENT) — usa a lista de CNPJs do próprio escopo (`/auth/me`) e
  // não exibe filtro de responsável.
  const { data: remoteCompanies } = useQuery({
    queryKey: ['companies', 'search', debouncedCompanySearch],
    queryFn: () => searchCompanies({ q: debouncedCompanySearch || undefined }),
    enabled: !isClient,
    staleTime: 30_000,
  });

  const { data: operationalUsers } = useQuery({
    queryKey: ['users', 'operational'],
    queryFn: listOperationalUsers,
    enabled: !isClient,
    staleTime: 30_000,
  });

  const companyOptions = useMemo(() => {
    const companies: CompanySummary[] = isClient
      ? (user?.companies ?? [])
      : (remoteCompanies ?? []);
    return companies.map((company) => ({
      value: company.id,
      label: `${company.legalName} — ${formatCompanyDocument(company.cnpj)}`,
    }));
  }, [isClient, user?.companies, remoteCompanies]);

  const responsibleOptions = useMemo(
    () => (operationalUsers ?? []).map((u) => ({ value: u.id, label: u.name })),
    [operationalUsers],
  );

  function handlePeriodChange(dates: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null): void {
    onChange({
      ...filters,
      createdFrom: dates?.[0] ? dates[0].startOf('day').toISOString() : undefined,
      createdTo: dates?.[1] ? dates[1].endOf('day').toISOString() : undefined,
    });
  }

  return (
    <Flex gap={12} wrap style={{ marginBottom: 16 }}>
      <Input
        placeholder="Buscar por código ou referência"
        value={filters.q ?? ''}
        onChange={(event) => onChange({ ...filters, q: event.target.value || undefined })}
        style={{ width: 260 }}
        aria-label="Buscar por código ou referência"
        allowClear
      />

      <Select
        placeholder="CNPJ do cliente"
        value={filters.clientCompanyId}
        onChange={(value: string | undefined) => onChange({ ...filters, clientCompanyId: value })}
        onSearch={isClient ? undefined : setCompanySearch}
        showSearch
        allowClear
        onClear={() => onChange({ ...filters, clientCompanyId: undefined })}
        filterOption={
          isClient
            ? (input, option) =>
                (option?.label as string).toLowerCase().includes(input.toLowerCase())
            : false
        }
        style={{ width: 240 }}
        options={companyOptions}
        aria-label="CNPJ do cliente"
      />

      {!isClient && (
        <Select
          placeholder="Responsável"
          value={filters.responsibleId}
          onChange={(value: string | undefined) => onChange({ ...filters, responsibleId: value })}
          allowClear
          onClear={() => onChange({ ...filters, responsibleId: undefined })}
          style={{ width: 200 }}
          options={responsibleOptions}
          aria-label="Responsável"
        />
      )}

      <RangePicker
        value={[
          filters.createdFrom ? dayjs(filters.createdFrom) : null,
          filters.createdTo ? dayjs(filters.createdTo) : null,
        ]}
        onChange={handlePeriodChange}
        aria-label="Período"
      />
    </Flex>
  );
}
