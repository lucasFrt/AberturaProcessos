import type { IntakeChannel } from '@/domain/enums';

/**
 * Ponteiro de leitura da caixa (docs/13, decisão 9). O agente lista a caixa
 * "a partir daqui" e avança o ponteiro a cada página examinada; e-mails de
 * remetentes bloqueados passam sem gerar `IntakeEvent`, então o cursor não
 * pode ser deduzido só dos eventos.
 */
export interface IntakeCursorRecord {
  channel: IntakeChannel;
  receivedAt: Date;
  externalId: string | null;
  updatedAt: Date;
}
