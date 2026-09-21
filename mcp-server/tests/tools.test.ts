import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Sobe o servidor compilado (dist/) por stdio, como o Claude faria, e
 * confere que as ferramentas do docs/13 (decisão 8) estão registradas com
 * os campos essenciais. Não chama a API: o contrato HTTP é coberto pelos
 * testes de integração do backend.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

test('lista as ferramentas do intake com seus campos obrigatórios', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(here, '..', 'dist', 'index.js')],
    env: { ...process.env, AP_API_URL: 'http://127.0.0.1:1', AP_API_KEY: 'apk_teste' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'teste', version: '0.0.0' });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      'attach_to_process',
      'create_process_from_email',
      'get_intake_cursor',
      'get_intake_event',
      'get_process',
      'lookup_process',
      'skip_email',
    ]);

    const skip = tools.find((tool) => tool.name === 'skip_email');
    const skipRequired = (skip?.inputSchema as { required?: string[] }).required ?? [];
    for (const field of ['externalId', 'receivedAt', 'outcome', 'reason']) {
      assert.ok(skipRequired.includes(field), `campo obrigatório ausente em skip_email: ${field}`);
    }

    const create = tools.find((tool) => tool.name === 'create_process_from_email');
    const required = (create?.inputSchema as { required?: string[] }).required ?? [];
    for (const field of ['externalId', 'receivedAt', 'requesterEmail', 'reference']) {
      assert.ok(required.includes(field), `campo obrigatório ausente: ${field}`);
    }
    // Tarefa 27: sem CNPJ no e-mail a empresa vem do domínio do remetente.
    assert.ok(!required.includes('companyDocument'), 'companyDocument deve ser opcional');
  } finally {
    await client.close();
  }
});

test('erro de rede da API vira exceção da ferramenta, não travamento', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(here, '..', 'dist', 'index.js')],
    env: {
      ...process.env,
      AP_API_URL: 'http://127.0.0.1:1',
      AP_API_KEY: 'apk_teste',
      AP_TIMEOUT_MS: '2000',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'teste', version: '0.0.0' });
  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'get_intake_event',
      arguments: { externalId: 'x' },
    });
    assert.equal(result.isError, true);
  } finally {
    await client.close();
  }
});
