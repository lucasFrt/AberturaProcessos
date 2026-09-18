import type {
  CnpjLookupOutcome,
  CnpjLookupProvider,
  CnpjRegistrationData,
} from '@/domain/cnpj/cnpj-lookup-provider';

/**
 * Dublê de `CnpjLookupProvider` para os testes unitários (docs/09): nenhuma
 * chamada de rede. `outcome` é o que a próxima consulta devolve; `calls`
 * registra os CNPJs consultados, o que permite provar o curto-circuito do
 * `CompanyService` (empresa já cadastrada não deve consumir cota do provedor).
 */
export class FakeCnpjLookupProvider implements CnpjLookupProvider {
  readonly calls: string[] = [];
  outcome: CnpjLookupOutcome = { kind: 'NOT_FOUND' };

  async lookup(cnpj: string): Promise<CnpjLookupOutcome> {
    this.calls.push(cnpj);
    return this.outcome;
  }

  /** Atalho para o caso de sucesso, que é o mais usado nos testes. */
  respondFound(data: Partial<CnpjRegistrationData> & { cnpj: string; legalName: string }): void {
    this.outcome = {
      kind: 'FOUND',
      data: {
        tradeName: null,
        registrationStatus: 'ATIVA',
        ...data,
      },
    };
  }
}
