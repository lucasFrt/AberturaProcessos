import type {
  Company,
  CompanyFilters,
  CreateCompanyData,
  UpdateCompanyData,
} from '@/domain/entities/company';
import type { Page, PaginationParams } from '@/domain/pagination';

export interface CompanyRepository {
  findManyByIds(ids: string[]): Promise<Company[]>;
  findById(id: string): Promise<Company | null>;
  /** `cnpj` já deve chegar normalizado (somente dígitos). */
  findByCnpj(cnpj: string): Promise<Company | null>;
  /** Empresa vinculada a este `cod_emp` do iLog (docs/15). */
  findByIlogCompanyId(ilogCompanyId: number): Promise<Company | null>;
  list(filters: CompanyFilters, pagination: PaginationParams): Promise<Page<Company>>;
  create(data: CreateCompanyData): Promise<Company>;
  update(id: string, data: UpdateCompanyData): Promise<Company>;
  delete(id: string): Promise<void>;
  /** Processos em que a empresa é cliente ou solicitante — bloqueia exclusão (docs/04). */
  countLinkedProcesses(id: string): Promise<number>;
}
