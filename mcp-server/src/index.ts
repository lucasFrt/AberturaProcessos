#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ApiClient } from './api-client.js';
import { registerTools } from './tools.js';

/**
 * MCP server (stdio) do intake de processos (docs/13, decisão 8). Zero
 * regra de negócio: cada ferramenta vira uma requisição HTTP autenticada
 * por chave de API contra `/intake/*`. Configuração só por ambiente:
 *
 * - AP_API_URL   base da API, ex.: https://processos.opusce.com.br/api/v1
 * - AP_API_KEY   chave criada em POST /api-keys (usuário interno "Agente de E-mail")
 * - AP_TIMEOUT_MS opcional, padrão 120000 (o servidor baixa anexos do Graph dentro da chamada)
 *
 * Logs vão para stderr: stdout é o canal do protocolo MCP.
 */
function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    process.stderr.write(`[abertura-processos-mcp] variável obrigatória ausente: ${name}\n`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const baseUrl = requiredEnv('AP_API_URL').replace(/\/+$/, '');
  const apiKey = requiredEnv('AP_API_KEY');
  const timeoutMs = Number(process.env.AP_TIMEOUT_MS ?? '120000');

  const api = new ApiClient({ baseUrl, apiKey, timeoutMs });
  const server = new McpServer({ name: 'abertura-processos', version: '1.0.0' });
  registerTools(server, api);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[abertura-processos-mcp] conectado a ${baseUrl}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`[abertura-processos-mcp] falha fatal: ${String(error)}\n`);
  process.exit(1);
});
