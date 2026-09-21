import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { ApiClient, ApiResult } from './api-client.js';

/**
 * Ferramentas expostas ao agente (docs/13, decisão 8). Cada uma é uma
 * tradução direta de uma rota de `/intake/*` (docs/05); as descrições são
 * escritas para o modelo — dizem quando usar, o que passar e o que fazer
 * com cada desfecho.
 */

const externalIdField = z
  .string()
  .min(1)
  .describe(
    'Id da mensagem no Microsoft Graph, exatamente como o conector de Outlook devolveu (ex.: o trecho depois de "mail:///messages/"). É a chave de idempotência: a mesma mensagem nunca é processada duas vezes.',
  );

const receivedAtField = z
  .string()
  .min(1)
  .describe('Data/hora em que o e-mail foi recebido, em ISO 8601 (ex.: "2026-09-18T10:32:00Z").');

const internetMessageIdField = z
  .string()
  .optional()
  .describe(
    'Message-ID RFC 5322 da mensagem (campo internetMessageId do conector, com os "<" ">"). Chave secundária de idempotência: sobrevive à mensagem ser movida de pasta. Envie sempre que disponível.',
  );

const requesterFields = {
  requesterEmail: z.string().email().describe('E-mail do remetente (quem pediu).'),
  requesterName: z.string().optional().describe('Nome do remetente, se aparecer no e-mail.'),
};

const attachmentFields = {
  fetchAttachments: z
    .boolean()
    .default(true)
    .describe(
      'true (padrão): o servidor baixa os anexos da mensagem direto do Outlook. Use false se você mesmo vai enviar arquivos em filePaths, ou se o e-mail não tem anexo.',
    ),
  filePaths: z
    .array(z.string())
    .optional()
    .describe(
      'Caminhos locais de arquivos a anexar (só quando o conector salvou os anexos em disco).',
    ),
};

/** Resposta uniforme: sucesso e erro de negócio vão como texto JSON legível pelo modelo. */
function toToolResult(result: ApiResult<unknown>): CallToolResult {
  if (result.ok) {
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ok: true, ...wrap(result.data) }, null, 2) },
      ],
    };
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            ok: false,
            status: result.status,
            code: result.error.code,
            message: result.error.message,
            details: result.error.details ?? null,
            hint: hintFor(result.error.code),
          },
          null,
          2,
        ),
      },
    ],
    // Não é erro de transporte: o modelo deve LER o código e decidir (ex.: 409 com candidatos).
    isError: false,
  };
}

function wrap(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { data };
}

function hintFor(code: string): string {
  switch (code) {
    case 'PROCESS_REF_AMBIGUOUS':
      return 'Mais de um processo tem essa referência. Escolha o candidato certo em details.candidates (compare empresa e data) e chame attach_to_process de novo com processId.';
    case 'PROCESS_REF_NOT_FOUND':
      return 'Nenhum processo com esse código/referência. Se details.candidates tiver um que claramente corresponde, use o id dele; senão trate o e-mail como novo processo ou escale para o operacional.';
    case 'COMPANY_INACTIVE':
      return 'A empresa está desativada no sistema por decisão humana. Não tente contornar: escale para o operacional.';
    case 'COMPANY_AMBIGUOUS':
      return 'O domínio do remetente tem mais de uma empresa. Escolha em details.candidates pela razão social/nome fantasia da assinatura e chame de novo com companyDocument = o cnpj dela; sem certeza, escale.';
    case 'COMPANY_REQUIRED':
      return 'Não dá para identificar a empresa: remetente de webmail sem CNPJ, ou remetente terceiro sem companyName. Se o e-mail nomeia o cliente, chame de novo com companyName (e senderIsClient=false); senão escale (skip_email com ESCALATED).';
    case 'MAIL_READ_DISABLED':
      return 'O servidor não está configurado para ler a caixa (GRAPH_INTAKE_ENABLED=false). Use as ferramentas do conector de e-mail para listar e ler.';
    case 'MAIL_UNAVAILABLE':
      return 'O Microsoft Graph não respondeu. Tente uma vez mais após 30 s; persistindo, relate como problema de configuração.';
    case 'INTAKE_IN_PROGRESS':
      return 'Outra execução está processando esta mensagem. Não repita agora; siga para o próximo e-mail.';
    case 'MAIL_ATTACHMENTS_DISABLED':
      return 'O servidor não está configurado para baixar anexos do Outlook. Chame de novo com fetchAttachments=false (e filePaths, se tiver os arquivos em disco).';
    case 'MAIL_MESSAGE_NOT_FOUND':
      return 'O id da mensagem não existe na caixa configurada. Confira se passou o id correto e a caixa certa.';
    case 'INVALID_CNPJ':
    case 'INVALID_CPF':
      return 'O documento tem dígitos verificadores inválidos. Releia o e-mail; se o número estiver realmente errado, escale para o operacional em vez de inventar outro.';
    case 'UNAUTHENTICATED':
      return 'Chave de API inválida ou revogada (AP_API_KEY).';
    default:
      return 'Consulte a mensagem e o código do erro; se persistir, escale para o operacional.';
  }
}

function toIso(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function registerTools(server: McpServer, api: ApiClient): void {
  server.registerTool(
    'get_intake_event',
    {
      title: 'Verificar se um e-mail já foi processado',
      description:
        'Consulta se a mensagem (externalId) já passou pelo intake. Chame ANTES de decidir o que fazer com um e-mail: se já existir um evento COMPLETED, o e-mail já foi tratado — pule-o. FAILED significa que uma tentativa anterior falhou e pode ser refeita.',
      inputSchema: { externalId: externalIdField },
    },
    async ({ externalId }) => {
      const result = await api.get<{ data: unknown[] }>('/intake/events', {
        externalId,
        pageSize: 1,
      });
      if (result.ok) {
        const event = result.data.data[0] ?? null;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, processed: event !== null, event }, null, 2),
            },
          ],
        };
      }
      return toToolResult(result);
    },
  );

  server.registerTool(
    'lookup_process',
    {
      title: 'Procurar processo existente',
      description:
        'Procura processos por código (PRC-2026-00042) ou por referência citada no e-mail, opcionalmente filtrando pelo CNPJ/CPF do cliente. Use quando o e-mail parece ser complemento de um processo já aberto ("segue documento do processo X") para confirmar qual é antes de anexar. matchedBy: CODE e REFERENCE são exatos; PARTIAL é aproximado.',
      inputSchema: {
        ref: z
          .string()
          .optional()
          .describe('Código ou referência do processo, como está no e-mail.'),
        companyDocument: z
          .string()
          .optional()
          .describe('CNPJ ou CPF do cliente, com ou sem máscara.'),
        limit: z.number().int().min(1).max(20).default(5),
      },
    },
    async ({ ref, companyDocument, limit }) =>
      toToolResult(await api.get('/intake/processes/lookup', { ref, companyDocument, limit })),
  );

  server.registerTool(
    'create_process_from_email',
    {
      title: 'Abrir processo a partir de um e-mail',
      description:
        'Abre um processo novo com os dados extraídos do e-mail. A empresa é identificada pelo CNPJ/CPF: se não estiver cadastrada, o servidor cadastra (empresa, organização e domínio) e relata em warnings. Idempotente por externalId: repetir a chamada para a mesma mensagem devolve duplicate=true sem criar nada. Anexos são baixados pelo servidor (fetchAttachments=true).',
      inputSchema: {
        externalId: externalIdField,
        internetMessageId: internetMessageIdField,
        receivedAt: receivedAtField,
        subject: z.string().optional().describe('Assunto do e-mail.'),
        ...requesterFields,
        companyDocument: z
          .string()
          .min(11)
          .optional()
          .describe(
            'CNPJ (14 dígitos) ou CPF (11) da empresa/pessoa para quem o processo é aberto, com ou sem máscara. OMITA se o e-mail não trouxer: o servidor identifica a empresa pelo domínio do remetente e, se ela ainda não existir, cria em "cadastro pendente" (sem CNPJ) para o processo abrir mesmo assim.',
          ),
        companyName: z
          .string()
          .optional()
          .describe(
            'Razão social ou nome da empresa, como aparece no e-mail ou na assinatura. Usado se a Receita não responder, se for CPF, e como nome do cadastro pendente quando não há CNPJ.',
          ),
        senderIsClient: z
          .boolean()
          .default(true)
          .describe(
            'false quando quem escreveu NÃO é o cliente (agente de carga, armador, despachante, terminal). Aí, sem CNPJ, a empresa é resolvida pelo companyName — nunca pelo domínio do remetente.',
          ),
        requestingCompanyDocument: z
          .string()
          .optional()
          .describe(
            'CNPJ/CPF de quem SOLICITA em nome do cliente (modelo trading), se for diferente do cliente.',
          ),
        requestingCompanyName: z.string().optional(),
        reference: z
          .string()
          .min(3)
          .describe(
            'Referência do processo informada pelo cliente (número de pedido, invoice, contêiner...). 3 a 255 caracteres.',
          ),
        additionalInfo: z
          .string()
          .optional()
          .describe(
            'Resumo fiel do corpo do e-mail com tudo que o operacional precisa saber (contatos, prazos, pendências). Até 10.000 caracteres.',
          ),
        ...attachmentFields,
      },
    },
    async (input) => {
      const payload = {
        source: {
          channel: 'EMAIL',
          externalId: input.externalId,
          internetMessageId: input.internetMessageId ?? null,
          subject: input.subject ?? null,
          receivedAt: toIso(input.receivedAt),
        },
        requester: { email: input.requesterEmail, name: input.requesterName ?? null },
        company: {
          document: input.companyDocument ?? null,
          name: input.companyName ?? null,
          senderIsClient: input.senderIsClient,
        },
        requestingCompany: input.requestingCompanyDocument
          ? { document: input.requestingCompanyDocument, name: input.requestingCompanyName ?? null }
          : null,
        reference: input.reference,
        additionalInfo: input.additionalInfo ?? null,
        fetchAttachments: input.fetchAttachments,
      };
      const files = input.filePaths ?? [];
      const result =
        files.length > 0
          ? await api.postMultipart('/intake/processes', payload, files)
          : await api.postJson('/intake/processes', payload);
      return toToolResult(result);
    },
  );

  server.registerTool(
    'attach_to_process',
    {
      title: 'Anexar documentos/informação a processo existente',
      description:
        'Anexa os anexos do e-mail e/ou uma nota a um processo já aberto, identificado pelo código ou pela referência citada ("Processo 123123 documento em anexo"). Se a referência for ambígua a resposta traz candidatos (code PROCESS_REF_AMBIGUOUS): escolha e chame de novo com processId. Se não existir (PROCESS_REF_NOT_FOUND) avalie os candidatos parciais ou trate como processo novo. Idempotente por externalId.',
      inputSchema: {
        externalId: externalIdField,
        internetMessageId: internetMessageIdField,
        receivedAt: receivedAtField,
        subject: z.string().optional(),
        ...requesterFields,
        processRef: z
          .string()
          .optional()
          .describe('Código (PRC-2026-00042) ou referência do processo, como está no e-mail.'),
        processId: z
          .string()
          .optional()
          .describe(
            'Id do processo, quando já se sabe qual é (ex.: escolhido entre candidatos). Tem precedência sobre processRef.',
          ),
        note: z
          .string()
          .optional()
          .describe(
            'Informação relevante do corpo do e-mail para registrar no processo (será carimbada com remetente e data).',
          ),
        addReferences: z
          .array(z.string().min(3).max(100))
          .max(10)
          .optional()
          .describe(
            'Identificadores do embarque que este e-mail revelou e ainda não estão na referência do processo (HBL, contêiner, número do agente, PO): são acrescentados à referência para os próximos documentos casarem.',
          ),
        ...attachmentFields,
      },
    },
    async (input) => {
      const payload = {
        source: {
          channel: 'EMAIL',
          externalId: input.externalId,
          internetMessageId: input.internetMessageId ?? null,
          subject: input.subject ?? null,
          receivedAt: toIso(input.receivedAt),
        },
        requester: { email: input.requesterEmail, name: input.requesterName ?? null },
        processRef: input.processRef ?? null,
        processId: input.processId ?? null,
        note: input.note ?? null,
        addReferences: input.addReferences ?? null,
        fetchAttachments: input.fetchAttachments,
      };
      const files = input.filePaths ?? [];
      const result =
        files.length > 0
          ? await api.postMultipart('/intake/attachments', payload, files)
          : await api.postJson('/intake/attachments', payload);
      return toToolResult(result);
    },
  );

  server.registerTool(
    'list_mailbox',
    {
      title: 'Listar e-mails novos da caixa (pelo servidor)',
      description:
        'Lista a caixa de entrada a partir de um instante (o cursor), do mais antigo para o mais novo, já sem os remetentes bloqueados — lista enxuta: id, remetente, assunto, prévia, data, tem anexo. Use em vez da busca do conector. Devolve nextAfter (o receivedAt da última listada, bloqueada ou não — grave-o com advance_intake_cursor ao terminar a página) e hasMore.',
      inputSchema: {
        after: z
          .string()
          .min(1)
          .describe(
            'ISO 8601: só e-mails recebidos depois deste instante (o cursor menos 1 minuto).',
          ),
        limit: z.number().int().min(1).max(100).default(50),
        excludeSenders: z
          .array(z.string().min(1))
          .default([])
          .describe(
            'Termos que, contidos no e-mail ou no nome do remetente, descartam a mensagem (ex.: "@opusce.com.br", "noreply").',
          ),
      },
    },
    async ({ after, limit, excludeSenders }) =>
      toToolResult(
        await api.get('/intake/mailbox/messages', {
          after: toIso(after),
          limit,
          exclude: excludeSenders.join(','),
        }),
      ),
  );

  server.registerTool(
    'get_mailbox_message',
    {
      title: 'Ler um e-mail (corpo limpo, pelo servidor)',
      description:
        'Corpo do e-mail em texto, sem histórico citado e limitado em tamanho, mais destinatários e a lista de anexos (nome, tipo, tamanho). Use em vez do read_resource do conector.',
      inputSchema: {
        messageId: externalIdField,
        maxChars: z.number().int().min(500).max(50_000).default(6000),
      },
    },
    async ({ messageId, maxChars }) =>
      toToolResult(
        await api.get(`/intake/mailbox/messages/${encodeURIComponent(messageId)}`, { maxChars }),
      ),
  );

  server.registerTool(
    'get_intake_cursor',
    {
      title: 'De onde continuar a leitura da pasta de intake',
      description:
        'Devolve o receivedAt mais recente entre os e-mails já concluídos (processados, ignorados ou escalados). Chame no INÍCIO da execução e busque na pasta de intake só o que chegou depois dessa data (com 1 minuto de folga). receivedAt=null significa que nada foi tratado ainda. E-mails com tentativa FAILED não avançam o cursor: são relidos até serem concluídos ou escalados (skip_email).',
      inputSchema: {},
    },
    async () => toToolResult(await api.get('/intake/cursor', { channel: 'EMAIL' })),
  );

  server.registerTool(
    'advance_intake_cursor',
    {
      title: 'Gravar até onde a leitura chegou',
      description:
        'Grava o receivedAt do último e-mail examinado da página atual (chame ao terminar cada página da busca). A próxima execução começa dali. E-mails de remetentes bloqueados não precisam de skip_email: basta o cursor passar por eles. Só anda para a frente: um valor mais antigo que o gravado é ignorado (advanced=false).',
      inputSchema: {
        receivedAt: receivedAtField,
        externalId: z
          .string()
          .optional()
          .describe('Id da última mensagem examinada (só para diagnóstico).'),
      },
    },
    async ({ receivedAt, externalId }) =>
      toToolResult(
        await api.put('/intake/cursor', {
          channel: 'EMAIL',
          receivedAt: toIso(receivedAt),
          externalId: externalId ?? null,
        }),
      ),
  );

  server.registerTool(
    'skip_email',
    {
      title: 'Registrar e-mail ignorado ou escalado',
      description:
        'Registra que o e-mail NÃO vira processo: IGNORED (ruído: notificação automática, newsletter, interno sem pedido) ou ESCALATED (precisa de uma pessoa: sem CNPJ/CPF, sem referência, pedido que não é abrir/complementar, dúvida na classificação, ou tentativa que falhou de novo). Obrigatório para cada e-mail examinado que não foi processado — sem isso o cursor não avança e o e-mail seria relido na próxima execução. Idempotente: se a mensagem já tem desfecho, devolve duplicate=true sem alterar nada.',
      inputSchema: {
        externalId: externalIdField,
        internetMessageId: internetMessageIdField,
        receivedAt: receivedAtField,
        subject: z.string().optional().describe('Assunto do e-mail.'),
        requesterEmail: z
          .string()
          .email()
          .optional()
          .describe('E-mail do remetente, quando fizer sentido guardar.'),
        requesterName: z.string().optional(),
        outcome: z
          .enum(['IGNORED', 'ESCALATED'])
          .describe('IGNORED = descartado como ruído; ESCALATED = uma pessoa precisa olhar.'),
        reason: z
          .string()
          .min(3)
          .max(1000)
          .describe('Motivo curto e concreto (aparece para o operacional).'),
      },
    },
    async (input) => {
      const payload = {
        source: {
          channel: 'EMAIL',
          externalId: input.externalId,
          internetMessageId: input.internetMessageId ?? null,
          subject: input.subject ?? null,
          receivedAt: toIso(input.receivedAt),
        },
        requester: input.requesterEmail
          ? { email: input.requesterEmail, name: input.requesterName ?? null }
          : null,
        outcome: input.outcome,
        reason: input.reason,
      };
      return toToolResult(await api.postJson('/intake/events/skip', payload));
    },
  );

  server.registerTool(
    'get_process',
    {
      title: 'Ver detalhe de um processo',
      description:
        'Detalhe completo de um processo (dados, etapa, documentos, histórico). Útil para confirmar o que foi feito antes de responder ao cliente ou relatar ao operacional.',
      inputSchema: { processId: z.string().min(1) },
    },
    async ({ processId }) =>
      toToolResult(await api.get(`/processes/${encodeURIComponent(processId)}`)),
  );
}
