import dayjs from 'dayjs';
import 'dayjs/locale/pt-br';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

/**
 * Formatação de data/hora em `America/Sao_Paulo` (docs/08, "Formatação e
 * acessibilidade"). A API sempre devolve ISO 8601 em UTC; a conversão de
 * fuso é responsabilidade exclusiva do front.
 */
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.locale('pt-br');

const TIME_ZONE = 'America/Sao_Paulo';

/** `2026-08-07T14:32:00.000Z` -> `07/08/2026 11:32`. */
export function formatDateTime(isoValue: string | Date): string {
  return dayjs(isoValue).tz(TIME_ZONE).format('DD/MM/YYYY HH:mm');
}

/** `2026-08-07T14:32:00.000Z` -> `07/08/2026`. */
export function formatDate(isoValue: string | Date): string {
  return dayjs(isoValue).tz(TIME_ZONE).format('DD/MM/YYYY');
}

/** Tempo relativo em pt-BR, ex.: "há 3 dias". */
export function formatRelativeTime(isoValue: string | Date): string {
  return dayjs(isoValue).tz(TIME_ZONE).fromNow();
}

/** Tamanho de arquivo legível, ex.: `184.3 KB`. */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** Duração em dias/horas a partir de um total de horas, ex.: `5d 12h`. */
export function formatDurationHours(totalHours: number): string {
  const days = Math.floor(totalHours / 24);
  const hours = Math.round(totalHours % 24);
  if (days === 0) return `${hours}h`;
  return `${days}d ${hours}h`;
}
