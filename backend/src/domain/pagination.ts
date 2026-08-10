/**
 * Paginação de coleções (docs/05-contrato-api.md, seção "Convenções").
 * `page`/`pageSize` entram validados pelo schema Zod da rota (pageSize
 * máximo 100); `Page<T>` é o retorno padrão de todo método `list` de
 * repositório paginado.
 */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}
