import type { ProcessIdentifierKind, ProcessIdentifierSource } from '@/domain/enums';

/**
 * Um identificador do embarque ligado a um processo (docs/15, seção 5.1):
 * número da Opus, referência do cliente, HBL, contêiner... É por aqui que
 * o intake casa "seu processo 31435/26" ou um BL avulso com o processo certo.
 */
export interface ProcessIdentifier {
  id: string;
  processId: string;
  kind: ProcessIdentifierKind;
  /** Como veio ("SWT 0021/26"). */
  value: string;
  /** Maiúsculas, só `[A-Z0-9]` ("SWT002126") — chave de busca. */
  normalized: string;
  source: ProcessIdentifierSource;
  createdAt: Date;
}

export interface ProcessIdentifierInput {
  kind: ProcessIdentifierKind;
  value: string;
}

/** Resultado de busca no índice: só o que o chamador precisa para achar o processo. */
export interface ProcessIdentifierMatch {
  processId: string;
  kind: ProcessIdentifierKind;
  value: string;
  normalized: string;
}

/**
 * Normalização única dos dois lados (sync e intake, docs/15 seção 5.3):
 * "31435/26" = "31435-26" = "31435 / 26". Acentos caem junto com o resto.
 */
export function normalizeIdentifier(value: string): string {
  return value
    .normalize('NFD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const OPUS_NUMBER = /^\d{3,6}\s*[/-]\s*\d{2}$/;
const CONTAINER = /^[A-Z]{4}\s?\d{7}$/;
const DI = /^\d{2}BR\d{8,}$/;
const DUIMP = /^\d{2}BR\d{10}[A-Z0-9]?$/;
const CE_MERCANTE = /^\d{15}$/;
const DTA = /^\d{2}[A-Z]{2}\d{9,10}$/;

/**
 * Classificação por formato, para o que o formato entrega sozinho. O que
 * não bate em nada é `OTHER`: um HBL/MBL não tem formato fixo (só o iLog
 * sabe qual coluna é), e "230/26" tanto pode ser número da Opus quanto o
 * número interno do cliente — o `kind` orienta, quem decide o casamento é
 * o `normalized`.
 */
export function classifyIdentifier(value: string): ProcessIdentifierKind {
  const trimmed = value.trim().toUpperCase();
  if (OPUS_NUMBER.test(trimmed)) return 'OPUS_NUMBER';
  if (CONTAINER.test(trimmed)) return 'CONTAINER';
  if (DI.test(trimmed) || DUIMP.test(trimmed)) return 'DI';
  if (CE_MERCANTE.test(trimmed)) return 'CE';
  if (DTA.test(trimmed)) return 'DTA';
  return 'OTHER';
}

/** Curto demais para identificar alguma coisa ("26", "BL", "RES"). */
const MIN_NORMALIZED_LENGTH = 4;

/**
 * Extrai candidatos a identificador de um texto de referência livre
 * ("230/26 - DANGB26080406 / Casa & Novidade"): o texto inteiro (uma
 * referência do cliente com espaço, "SWT 0021/26", só casa inteira) e cada
 * pedaço separado por delimitadores comuns. Nomes (sem dígito) e pedaços
 * curtos ficam de fora — o índice é para casar exato, não para busca textual.
 */
export function extractIdentifierCandidates(reference: string): ProcessIdentifierInput[] {
  const seen = new Set<string>();
  const out: ProcessIdentifierInput[] = [];

  const push = (raw: string): void => {
    const value = raw.trim().replace(/^[\s:;,|]+|[\s:;,|.]+$/g, '');
    if (value.length === 0) return;
    const normalized = normalizeIdentifier(value);
    // Sem dígito é nome ("Casa & Novidade", "PRÉ ALERTA"), não identificador.
    if (normalized.length < MIN_NORMALIZED_LENGTH || !/\d/.test(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ kind: classifyIdentifier(value), value });
  };

  push(reference);
  for (const piece of reference.split(/\s+[-–—|/]\s+|[,;|]|\s{2,}|\n/)) {
    push(piece);
    // "Processo 31435/26" → "31435/26"; "BL DANGB26080406" → "DANGB26080406"
    for (const token of piece.trim().split(/\s+/)) {
      if (/\d/.test(token)) push(token);
    }
  }

  return out;
}
