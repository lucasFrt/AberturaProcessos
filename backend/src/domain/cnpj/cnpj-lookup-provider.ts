/**
 * Abstração da consulta de dados cadastrais de CNPJ na Receita Federal
 * (RF-11/RF-12, docs/05 seção "Empresas / CNPJs"). Vive no domínio pelo
 * mesmo motivo de `StorageProvider` e `Mailer`: `CompanyService` depende
 * apenas desta interface, nunca do provedor concreto — `no-restricted-imports`
 * (eslint.config.js) bloqueia `src/services/**` e `src/domain/**` de importar
 * `@/infra/cnpj/*`. A implementação padrão (`ReceitaWsCnpjLookupProvider`)
 * fica em `infra/cnpj/` e pode ser trocada por outro provedor (BrasilAPI,
 * cnpj.ws, base própria) sem tocar em regra de negócio.
 */

/**
 * Subconjunto dos dados da Receita que este sistema aproveita. Deliberadamente
 * pequeno: só o que a entidade `Company` persiste (`legalName`, `tradeName`) e
 * o que a UI precisa para avisar o operador (`registrationStatus`). Endereço,
 * CNAE e quadro societário são devolvidos pelo provedor mas não têm coluna
 * correspondente em `docs/04-modelo-de-dados.md` — trazer para cá exigiria
 * mudar o schema, o que está fora do escopo desta consulta.
 */
export interface CnpjRegistrationData {
  /** Somente dígitos, normalizado pelo provider. */
  cnpj: string;
  legalName: string;
  /** A Receita devolve string vazia quando não há nome fantasia — normalizado para `null`. */
  tradeName: string | null;
  /** Situação cadastral crua da Receita (ex.: "ATIVA", "BAIXADA", "SUSPENSA"). */
  registrationStatus: string | null;
}

/**
 * Resultado discriminado em vez de exceção: quem decide o status HTTP de cada
 * caso é a camada de serviço (regra de negócio), não a de infraestrutura. O
 * provider só classifica o que aconteceu na chamada externa.
 */
export type CnpjLookupOutcome =
  | { kind: 'FOUND'; data: CnpjRegistrationData }
  /** CNPJ com dígitos válidos, mas inexistente na base da Receita. */
  | { kind: 'NOT_FOUND' }
  /** Cota do provedor estourada (o plano gratuito da ReceitaWS permite 3 consultas/minuto por IP). */
  | { kind: 'RATE_LIMITED' }
  /** Timeout, erro de rede, 5xx do provedor ou payload fora do contrato. */
  | { kind: 'UNAVAILABLE'; reason: string };

export interface CnpjLookupProvider {
  /** `cnpj` pode chegar com ou sem máscara; o provider normaliza antes de consultar. */
  lookup(cnpj: string): Promise<CnpjLookupOutcome>;
}
