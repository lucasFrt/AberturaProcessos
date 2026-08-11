import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { BoardFilters } from '@/features/processes/api/process-api';
import { KanbanBoard } from '@/features/processes/components/KanbanBoard';
import { ProcessFilters } from '@/features/processes/components/ProcessFilters';
import { useBoard } from '@/features/processes/hooks/useBoard';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageHeader } from '@/shared/components/PageHeader';

const FILTER_KEYS: Array<keyof BoardFilters> = [
  'q',
  'clientCompanyId',
  'responsibleId',
  'organizationId',
  'createdFrom',
  'createdTo',
];

function filtersFromSearchParams(params: URLSearchParams): BoardFilters {
  const filters: BoardFilters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

/**
 * `/board` (docs/08, "Board Kanban"; docs/12, Tarefa 17). Filtros
 * persistidos na querystring via `useSearchParams`, para o link ser
 * compartilhável e sobreviver ao F5. `/processes/:id` reaproveita esta
 * página (docs/08, "Rotas e proteção") — a gaveta de detalhe chega na
 * Tarefa 19.
 */
export function BoardPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);

  const { data: board, isLoading, isError } = useBoard(filters);

  function handleFiltersChange(next: BoardFilters): void {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = next[key];
      if (value) params.set(key, value);
    }
    setSearchParams(params);
  }

  return (
    <div>
      <PageHeader title="Board" />
      <ProcessFilters filters={filters} onChange={handleFiltersChange} />

      {isError && <EmptyState description="Não foi possível carregar o board." />}
      {!isError && !isLoading && board && board.stages.length === 0 && (
        <EmptyState description="Nenhuma etapa configurada." />
      )}
      {board && board.stages.length > 0 && <KanbanBoard board={board} filters={filters} />}
    </div>
  );
}
