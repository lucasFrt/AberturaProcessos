import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Col,
  DatePicker,
  Flex,
  Row,
  Select,
  Statistic,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { listOrganizations } from '@/features/admin/api/organizations-api';
import type { DashboardAverageTimePerStageDto } from '@/features/dashboard/api/dashboard-api';
import { useDashboardMetrics } from '@/features/dashboard/hooks/useDashboardMetrics';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageHeader } from '@/shared/components/PageHeader';
import { maskCnpj } from '@/shared/lib/cnpj';
import { formatDateOnly, formatDurationHours } from '@/shared/lib/format';

const { RangePicker } = DatePicker;

type DateRange = [dayjs.Dayjs, dayjs.Dayjs];

/** Últimos `n` dias, inclusive hoje (mesmo default do backend, docs/05). */
function lastNDays(n: number): DateRange {
  const to = dayjs().endOf('day');
  const from = dayjs()
    .subtract(n - 1, 'day')
    .startOf('day');
  return [from, to];
}

const RANGE_PRESETS: Array<{ label: string; value: () => DateRange }> = [
  { label: '7 dias', value: () => lastNDays(7) },
  { label: '30 dias', value: () => lastNDays(30) },
  { label: '90 dias', value: () => lastNDays(90) },
];

interface DashboardFilters {
  from?: string;
  to?: string;
  organizationId?: string;
}

function filtersFromSearchParams(params: URLSearchParams): DashboardFilters {
  return {
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    organizationId: params.get('organizationId') ?? undefined,
  };
}

const stageTimeColumns: ColumnsType<DashboardAverageTimePerStageDto> = [
  { title: 'Etapa', dataIndex: 'stageName', key: 'stageName' },
  {
    title: 'Tempo médio',
    key: 'averageHours',
    render: (_, record) => formatDurationHours(record.averageHours),
  },
  { title: 'Amostra', dataIndex: 'sampleSize', key: 'sampleSize' },
];

/**
 * `/dashboard` (ADMIN, docs/08 "Dashboard"; docs/12, Tarefa 21). Filtro de
 * período e organização persistidos na querystring (mesmo padrão do board,
 * `useSearchParams`). Sem parâmetros na URL, o front assume os últimos 30
 * dias (mesmo default do backend) e envia `from`/`to` já calculados, em vez
 * de deixar a API decidir — assim o `RangePicker` sempre reflete o período
 * de fato usado na busca.
 */
export function DashboardPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);

  // Estável durante a vida do componente: recalcular a cada render moveria
  // o período "últimos 30 dias" a cada segundo sem o usuário pedir nada.
  const defaultRange = useMemo(() => lastNDays(30), []);

  const range: DateRange = useMemo(
    () => [
      filters.from ? dayjs(filters.from) : defaultRange[0],
      filters.to ? dayjs(filters.to) : defaultRange[1],
    ],
    [filters.from, filters.to, defaultRange],
  );

  const effectiveFilters = useMemo(
    () => ({
      from: filters.from ?? defaultRange[0].toISOString(),
      to: filters.to ?? defaultRange[1].toISOString(),
      organizationId: filters.organizationId,
    }),
    [filters, defaultRange],
  );

  const { data, isLoading, isError } = useDashboardMetrics(effectiveFilters);

  const { data: orgsData } = useQuery({
    queryKey: ['organizations', 'all-for-select'],
    queryFn: () => listOrganizations({ pageSize: 100 }),
    staleTime: 60_000,
  });
  const orgOptions = (orgsData?.data ?? []).map((org) => ({ value: org.id, label: org.name }));

  const topCompanies = useMemo(
    () =>
      [...(data?.byCompany ?? [])]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((company) => ({
          ...company,
          label: `${company.legalName} (${maskCnpj(company.cnpj)})`,
        })),
    [data?.byCompany],
  );

  const throughputData = useMemo(
    () =>
      (data?.throughputByDay ?? []).map((day) => ({
        ...day,
        dateLabel: formatDateOnly(day.date),
      })),
    [data?.throughputByDay],
  );

  function handleRangeChange(dates: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null): void {
    const next = new URLSearchParams(searchParams);
    if (dates?.[0] && dates[1]) {
      next.set('from', dates[0].startOf('day').toISOString());
      next.set('to', dates[1].endOf('day').toISOString());
    } else {
      next.delete('from');
      next.delete('to');
    }
    setSearchParams(next);
  }

  function handleOrganizationChange(value: string | undefined): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('organizationId', value);
    else next.delete('organizationId');
    setSearchParams(next);
  }

  const stageHasData = (data?.byStage ?? []).some((stage) => stage.count > 0);
  const throughputHasData = throughputData.some((day) => day.created > 0 || day.completed > 0);

  const completionTooltip = data
    ? `Média: ${data.completionTime.averageHours.toFixed(1)}h · Mediana: ${data.completionTime.medianHours.toFixed(1)}h · Amostra: ${data.completionTime.sampleSize} processo(s)`
    : '';

  return (
    <div>
      <PageHeader title="Dashboard" />

      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <RangePicker
          value={range}
          onChange={handleRangeChange}
          presets={RANGE_PRESETS}
          aria-label="Período"
        />
        <Select
          placeholder="Organização"
          value={filters.organizationId}
          onChange={handleOrganizationChange}
          allowClear
          onClear={() => handleOrganizationChange(undefined)}
          options={orgOptions}
          style={{ width: 240 }}
          aria-label="Organização"
        />
      </Flex>

      {isError && <EmptyState description="Não foi possível carregar as métricas do dashboard." />}

      {!isError && (
        <>
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col xs={24} sm={12} md={6}>
              <Card loading={isLoading}>
                <Statistic title="Total de processos" value={data?.totals.processes ?? 0} />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card loading={isLoading}>
                <Statistic title="Ativos" value={data?.totals.active ?? 0} />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card loading={isLoading}>
                <Statistic
                  title="Concluídos no período"
                  value={data?.totals.completedInPeriod ?? 0}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card loading={isLoading}>
                <Tooltip title={completionTooltip}>
                  <div>
                    <Statistic
                      title="Tempo médio de conclusão"
                      value={data?.completionTime.formatted ?? '-'}
                    />
                  </div>
                </Tooltip>
              </Card>
            </Col>
          </Row>

          {!isLoading && data && data.totals.processes === 0 && (
            <EmptyState description="Nenhum processo no período selecionado." />
          )}

          {!isLoading && data && data.totals.processes > 0 && (
            <>
              <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col xs={24} lg={12}>
                  <Card title="Processos por etapa">
                    {data.byStage.length > 0 && stageHasData ? (
                      <>
                        <Typography.Text type="secondary">
                          Quantidade de processos em cada etapa do funil, na cor da própria etapa.
                        </Typography.Text>
                        <div
                          role="img"
                          aria-label={`Processos por etapa: ${data.byStage
                            .map((stage) => `${stage.stageName}, ${stage.count} processo(s)`)
                            .join('; ')}.`}
                        >
                          <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={data.byStage}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="stageName" />
                              <YAxis allowDecimals={false} />
                              <RechartsTooltip />
                              <Bar dataKey="count" name="Processos">
                                {data.byStage.map((stage) => (
                                  <Cell key={stage.stageId} fill={stage.color} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    ) : (
                      <EmptyState description="Nenhum processo por etapa no período." />
                    )}
                  </Card>
                </Col>

                <Col xs={24} lg={12}>
                  <Card title="Top 10 CNPJs por volume">
                    {topCompanies.length > 0 ? (
                      <>
                        <Typography.Text type="secondary">
                          As 10 empresas com mais processos criados no período, em ordem decrescente
                          de volume.
                        </Typography.Text>
                        <div
                          role="img"
                          aria-label={`Top 10 CNPJs por volume: ${topCompanies
                            .map((company) => `${company.legalName}, ${company.count} processo(s)`)
                            .join('; ')}.`}
                        >
                          <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={topCompanies} layout="vertical" margin={{ left: 24 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis type="number" allowDecimals={false} />
                              <YAxis
                                type="category"
                                dataKey="label"
                                width={200}
                                tick={{ fontSize: 11 }}
                              />
                              <RechartsTooltip />
                              <Bar dataKey="count" name="Processos" fill="#1677ff" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </>
                    ) : (
                      <EmptyState description="Nenhum CNPJ com processos no período." />
                    )}
                  </Card>
                </Col>
              </Row>

              <Card title="Criados vs. concluídos por dia" style={{ marginBottom: 24 }}>
                {throughputData.length > 0 && throughputHasData ? (
                  <>
                    <Typography.Text type="secondary">
                      Processos criados e concluídos por dia, no período selecionado.
                    </Typography.Text>
                    <div
                      role="img"
                      aria-label="Gráfico de linha comparando a quantidade de processos criados e concluídos por dia no período selecionado."
                    >
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={throughputData}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="dateLabel" />
                          <YAxis allowDecimals={false} />
                          <RechartsTooltip />
                          <Legend />
                          <Line type="monotone" dataKey="created" name="Criados" stroke="#1677ff" />
                          <Line
                            type="monotone"
                            dataKey="completed"
                            name="Concluídos"
                            stroke="#52c41a"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </>
                ) : (
                  <EmptyState description="Nenhum processo criado ou concluído no período." />
                )}
              </Card>

              <Card title="Tempo médio por etapa">
                {data.averageTimePerStage.length > 0 ? (
                  <>
                    <Typography.Text
                      type="secondary"
                      style={{ display: 'block', marginBottom: 12 }}
                    >
                      Tempo médio de permanência em cada etapa, com o tamanho da amostra usada no
                      cálculo (processos ainda na etapa atual não entram na média).
                    </Typography.Text>
                    <Table
                      rowKey="stageId"
                      columns={stageTimeColumns}
                      dataSource={data.averageTimePerStage}
                      pagination={false}
                    />
                  </>
                ) : (
                  <EmptyState description="Sem histórico suficiente para calcular o tempo médio por etapa." />
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
