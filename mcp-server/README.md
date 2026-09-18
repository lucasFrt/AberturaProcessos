# abertura-processos-mcp

Servidor MCP (stdio) que expõe o **intake** da API de abertura de processos ao agente de IA que
lê a caixa de e-mail (docs/13, decisão 8). Fino de propósito: cada ferramenta vira uma requisição
HTTP autenticada por chave de API contra `/intake/*` (docs/05, seção "Intake"). Nenhuma regra de
negócio vive aqui.

## Ferramentas

| Ferramenta | Rota | Quando o agente usa |
| --- | --- | --- |
| `get_intake_event` | `GET /intake/events?externalId=` | Antes de tratar um e-mail: já foi processado? |
| `lookup_process` | `GET /intake/processes/lookup` | E-mail parece complemento: confirmar qual processo. |
| `create_process_from_email` | `POST /intake/processes` | E-mail é uma solicitação nova. |
| `attach_to_process` | `POST /intake/attachments` | "Processo X, documento em anexo". |
| `get_process` | `GET /processes/:id` | Conferir o resultado antes de relatar/responder. |

Erros de negócio (404 com candidatos, 409 ambíguo, 503 Graph desligado) **não** são erros de
ferramenta: voltam como `{ ok: false, code, message, details, hint }` para o modelo ler e decidir.
Só falha de rede/chave inválida vira `isError`.

## Configuração

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `AP_API_URL` | sim | Base da API, ex.: `https://processos.opusce.com.br/api/v1` |
| `AP_API_KEY` | sim | Chave criada em **Administração → Chaves de API**, vinculada ao usuário interno "Agente de E-mail" |
| `AP_TIMEOUT_MS` | não | Padrão `120000`. O servidor baixa os anexos do Graph dentro da chamada. |

## Build e teste

```powershell
cd mcp-server
npm install
npm run build      # gera dist/index.js
npm test           # sobe o servidor por stdio e confere as ferramentas
npm run inspector  # UI do MCP Inspector para chamar as ferramentas à mão
```

## Registro no Claude Code

```powershell
claude mcp add abertura-processos `
  --env AP_API_URL=https://processos.opusce.com.br/api/v1 `
  --env AP_API_KEY=apk_... `
  -- node C:\caminho\AberturaProcessos\mcp-server\dist\index.js
```

Ou em `.mcp.json` / `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "abertura-processos": {
      "command": "node",
      "args": ["C:/caminho/AberturaProcessos/mcp-server/dist/index.js"],
      "env": { "AP_API_URL": "https://processos.opusce.com.br/api/v1", "AP_API_KEY": "apk_..." }
    }
  }
}
```

O prompt operacional do agente (classificação do e-mail, extração dos campos, o que fazer em cada
desfecho) está em `docs/prompts/agente-email-haiku.md`.

## Anexos: dois modos

- **Padrão** — `fetchAttachments: true`: o agente só passa o id da mensagem; o backend baixa os
  anexos pelo Microsoft Graph (`GRAPH_*` no `.env` da API, docs/10). Os bytes nunca passam pelo
  modelo.
- **Arquivos em disco** — `filePaths: [...]` com `fetchAttachments: false`: para orquestradores
  cujo conector de e-mail salva os anexos localmente. O MCP envia por multipart.
