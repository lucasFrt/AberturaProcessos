import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Flex } from 'antd';
import type { ReactElement } from 'react';

import { getProcessHistory } from '@/features/processes/api/process-api';
import { HistoryTimeline } from '@/features/processes/components/HistoryTimeline';
import { EmptyState } from '@/shared/components/EmptyState';

interface HistoryTabProps {
  processId: string;
}

const PAGE_SIZE = 20;

/**
 * Aba "Histórico" da gaveta (docs/08, "Gaveta de detalhe"): busca a
 * trilha paginada em `GET /processes/:id/history` (ordem cronológica
 * crescente) via `useInfiniteQuery`, para suportar "carregar mais" em
 * processos com trilha longa sem gerenciar acumulação manual em estado.
 */
export function HistoryTab({ processId }: HistoryTabProps): ReactElement {
  const { data, isLoading, isError, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useInfiniteQuery({
      queryKey: ['process', processId, 'history'],
      queryFn: ({ pageParam }) =>
        getProcessHistory(processId, { page: pageParam, pageSize: PAGE_SIZE }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.meta.page * lastPage.meta.pageSize < lastPage.meta.total
          ? lastPage.meta.page + 1
          : undefined,
    });

  if (isError) {
    return <EmptyState description="Não foi possível carregar o histórico." />;
  }

  const entries = data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Flex vertical gap={12}>
      <HistoryTimeline entries={entries} />
      {hasNextPage && (
        <Button
          loading={isLoading || isFetchingNextPage}
          onClick={() => void fetchNextPage()}
          block
        >
          Carregar mais
        </Button>
      )}
    </Flex>
  );
}
