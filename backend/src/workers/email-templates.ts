import type {
  ProcessStageChangedPayload,
  UserPendingApprovalPayload,
} from '@/domain/queue/queue-provider';

/** `America/Sao_Paulo`, formato dd/mm/aaaa hh:mm (docs/07, template de e-mail). */
function formatDateTimeSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Template de mudança de etapa (RF-50; docs/07). Assunto:
 * `[{code}] {fromStage} → {toStage} — {clientCompanyName}`. Corpo com
 * código/referência, CNPJ+razão social, etapa origem→destino, autor e
 * timestamp em America/Sao_Paulo, nota opcional e link direto ao processo.
 * HTML simples e inline (sem framework de template), sempre acompanhado da
 * versão `text`.
 */
export function renderProcessStageChangedEmail(
  payload: ProcessStageChangedPayload,
  frontendUrl: string,
): RenderedEmail {
  const fromStage = payload.fromStageName ?? 'Entrada';
  const occurredAt = formatDateTimeSaoPaulo(payload.occurredAt);
  const link = `${frontendUrl}/processes/${payload.processId}`;

  const subject = `[${payload.processCode}] ${fromStage} → ${payload.toStageName} — ${payload.clientCompanyName}`;

  const noteHtml = payload.note
    ? `<p><strong>Observação:</strong> ${escapeHtml(payload.note)}</p>`
    : '';
  const noteText = payload.note ? `Observação: ${payload.note}\n` : '';

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1f1f1f;">
      <p><strong>Processo:</strong> ${escapeHtml(payload.processCode)} — ${escapeHtml(payload.reference)}</p>
      <p><strong>Cliente:</strong> ${escapeHtml(payload.clientCompanyName)} (CNPJ ${escapeHtml(payload.clientCompanyCnpj)})</p>
      <p><strong>Etapa:</strong> ${escapeHtml(fromStage)} → ${escapeHtml(payload.toStageName)}</p>
      <p><strong>Movimentado por:</strong> ${escapeHtml(payload.actorName)} em ${occurredAt}</p>
      ${noteHtml}
      <p><a href="${link}">Ver processo</a></p>
    </div>
  `.trim();

  const text = [
    `Processo: ${payload.processCode} — ${payload.reference}`,
    `Cliente: ${payload.clientCompanyName} (CNPJ ${payload.clientCompanyCnpj})`,
    `Etapa: ${fromStage} → ${payload.toStageName}`,
    `Movimentado por: ${payload.actorName} em ${occurredAt}`,
    noteText,
    `Ver processo: ${link}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

/** Template de aviso de cadastro pendente aos administradores (RF-52; docs/07). */
export function renderUserPendingApprovalEmail(
  payload: UserPendingApprovalPayload,
  frontendUrl: string,
): RenderedEmail {
  const occurredAt = formatDateTimeSaoPaulo(payload.occurredAt);
  const link = `${frontendUrl}/admin/users`;

  const subject = `Novo cadastro pendente de aprovação — ${payload.userName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1f1f1f;">
      <p>Um novo cadastro está aguardando aprovação:</p>
      <p><strong>Nome:</strong> ${escapeHtml(payload.userName)}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(payload.userEmail)}</p>
      <p><strong>Provedor:</strong> ${escapeHtml(payload.provider)}</p>
      <p><strong>Data:</strong> ${occurredAt}</p>
      <p><a href="${link}">Ver usuários pendentes</a></p>
    </div>
  `.trim();

  const text = [
    'Um novo cadastro está aguardando aprovação:',
    `Nome: ${payload.userName}`,
    `E-mail: ${payload.userEmail}`,
    `Provedor: ${payload.provider}`,
    `Data: ${occurredAt}`,
    `Ver usuários pendentes: ${link}`,
  ].join('\n');

  return { subject, html, text };
}
