import type { ReactElement } from 'react';
import { useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import type { BoardFilters } from '@/features/processes/api/process-api';
import { KanbanBoard } from '@/features/processes/components/KanbanBoard';
import { ProcessDrawer } from '@/features/processes/components/ProcessDrawer';
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
 * página (docs/08, "Rotas e proteção"): o `:id` da rota abre a
 * `ProcessDrawer` sobre o board (docs/12, Tarefa 19). Fechar a gaveta
 * navega de volta para `/board` preservando a querystring atual; o foco
 * volta para o container do board — devolver o foco exatamente ao card
 * que abriu a gaveta exigiria guardar uma ref por card antes da
 * navegação, o que não é trivial com o roteamento por URL (o card pode
 * nem estar montado quando a gaveta fecha, ex.: filtro mudou); a
 * limitação é aceita e documentada aqui.
 */
export function BoardPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);
  const { id: processId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const boardContainerRef = useRef<HTMLDivElement>(null);

  const { data: board, isLoading, isError } = useBoard(filters);

  function handleFiltersChange(next: BoardFilters): void {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = next[key];
      if (value) params.set(key, value);
    }
    setSearchParams(params);
  }

  function handleDrawerClose(): void {
    void navigate({ pathname: '/board', search: searchParams.toString() });
    // Foco não fica perdido no `body` ao fechar a gaveta (ver limitação
    // documentada acima sobre não devolver o foco ao card exato).
    boardContainerRef.current?.focus();
  }

  return (
    <div ref={boardContainerRef} tabIndex={-1}>
      <PageHeader title="Board" />
      <ProcessFilters filters={filters} onChange={handleFiltersChange} />

      {isError && <EmptyState description="Não foi possível carregar o board." />}
      {!isError && !isLoading && board && board.stages.length === 0 && (
        <EmptyState description="Nenhuma etapa configurada." />
      )}
      {board && board.stages.length > 0 && <KanbanBoard board={board} filters={filters} />}

      {processId && <ProcessDrawer processId={processId} open onClose={handleDrawerClose} />}
    </div>
  );
}
