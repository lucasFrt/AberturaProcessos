import type { Page } from '@/domain/pagination';

interface CollectionMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CollectionResponseDto<T> {
  data: T[];
  meta: CollectionMeta;
}

/** Envelope de coleção (docs/05, seção "Convenções"): `{ data, meta }`. */
export function presentCollection<T, U>(
  page: Page<T>,
  pagination: { page: number; pageSize: number },
  mapItem: (item: T) => U,
): CollectionResponseDto<U> {
  return {
    data: page.items.map(mapItem),
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
      totalPages: pagination.pageSize > 0 ? Math.ceil(page.total / pagination.pageSize) : 0,
    },
  };
}
