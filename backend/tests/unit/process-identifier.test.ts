import {
  classifyIdentifier,
  extractIdentifierCandidates,
  normalizeIdentifier,
} from '@/domain/entities/process-identifier';

describe('normalizeIdentifier (docs/15, seção 5.3)', () => {
  it('iguala grafias diferentes do mesmo identificador', () => {
    expect(normalizeIdentifier('31435/26')).toBe('3143526');
    expect(normalizeIdentifier('31435-26')).toBe('3143526');
    expect(normalizeIdentifier(' 31435 / 26 ')).toBe('3143526');
    expect(normalizeIdentifier('swt 0021/26')).toBe('SWT002126');
    expect(normalizeIdentifier('DUAP-014826 - 26J04-2B')).toBe('DUAP01482626J042B');
  });

  it('remove acentos junto com o resto', () => {
    expect(normalizeIdentifier('Pré-alerta 123')).toBe('PREALERTA123');
  });
});

describe('classifyIdentifier', () => {
  it('reconhece os formatos fixos', () => {
    expect(classifyIdentifier('31435/26')).toBe('OPUS_NUMBER');
    expect(classifyIdentifier('230/26')).toBe('OPUS_NUMBER');
    expect(classifyIdentifier('MSKU1234567')).toBe('CONTAINER');
    expect(classifyIdentifier('msku 1234567')).toBe('CONTAINER');
    expect(classifyIdentifier('26BR00017973636')).toBe('DI');
    expect(classifyIdentifier('132605301737430')).toBe('CE');
  });

  it('deixa como OTHER o que não tem formato fixo (HBL, referência do cliente)', () => {
    expect(classifyIdentifier('DANGB26080406')).toBe('OTHER');
    expect(classifyIdentifier('SWT 0021/26')).toBe('OTHER');
    expect(classifyIdentifier('Casa & Novidade')).toBe('OTHER');
  });
});

describe('extractIdentifierCandidates', () => {
  it('devolve o texto inteiro e cada pedaço com dígito, sem repetir', () => {
    const candidates = extractIdentifierCandidates('230/26 - DANGB26080406 / Casa & Novidade');
    expect(candidates.map((item) => item.value)).toEqual([
      '230/26 - DANGB26080406 / Casa & Novidade',
      '230/26',
      'DANGB26080406',
    ]);
    expect(candidates.map((item) => item.kind)).toEqual(['OTHER', 'OPUS_NUMBER', 'OTHER']);
  });

  it('mantém uma referência do cliente com espaço inteira e também o pedaço numérico', () => {
    const values = extractIdentifierCandidates('SWT 0021/26').map((item) => item.value);
    expect(values).toEqual(['SWT 0021/26', '0021/26']);
  });

  it('ignora nomes (sem dígito) e o que normaliza para menos de 4 caracteres', () => {
    expect(extractIdentifierCandidates('Casa & Novidade')).toEqual([]);
    expect(extractIdentifierCandidates('BL 12')).toEqual([{ kind: 'OTHER', value: 'BL 12' }]);
    expect(extractIdentifierCandidates('12')).toEqual([]);
  });

  it('tira o rótulo de "Processo 31435/26"', () => {
    const values = extractIdentifierCandidates('Processo 31435/26').map((item) => item.value);
    expect(values).toEqual(['Processo 31435/26', '31435/26']);
  });
});
