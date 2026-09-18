# 14 - Viabilidade: agente de intake como rotina na nuvem (Claude Max)

Estudo feito em 18/09/2026 contra documentação oficial (code.claude.com, support.claude.com,
platform.claude.com, learn.microsoft.com), o código deste repositório e a própria conta claude.ai
(escopos do conector, histórico de uma rotina existente). Cada afirmação decisiva passou por
verificação independente; o que não pôde ser confirmado está marcado como **não verificado**.

## Veredito

**Viável para a fase de validação**, com quatro condições que mudam o desenho original:

| # | Condição | Por quê |
| --- | --- | --- |
| 1 | A rotina chama a API por **`curl`**, não pelo `mcp-server/` | Rotinas só enxergam conectores claude.ai por HTTPS; MCP local (stdio) não existe na nuvem. Expor o MCP como conector remoto exigiria Streamable HTTP + OAuth — desproporcional agora. |
| 2 | A chave de API entra como **API credential do ambiente** (recurso Pro/Max) | O ambiente Default bloqueia qualquer host fora da allowlist (`403 host_not_allowed`). A API credential libera o host e injeta `X-Api-Key` por proxy: a chave nunca chega ao modelo, ao shell nem ao prompt. |
| 3 | A API precisa estar **pública em HTTPS com certificado de CA pública** | O `curl` da sandbox (Ubuntu 24.04) valida contra o bundle Mozilla; self-signed falha. Requisições saem da rede da Anthropic (faixa publicada `160.79.104.0/21` — **não verificado** que o curl da sandbox use exatamente essa faixa). |
| 4 | **12 execuções/dia, de hora em hora, em horário comercial** | Intervalo mínimo de cron é 1 hora e o Max tem cap de **15 execuções agendadas/dia** (Pro 5, Team/Enterprise 25). "Executar agora" (one-off) não conta no cap — use para validar. |

O que **não** é viável como imaginado: "ler a caixa o dia inteiro a cada 15 minutos" (mínimo 1 h) e
"usar o MCP na rotina". Ambos têm substituto direto (janela de 3 h com idempotência; curl).

## Achados por dimensão

### Plataforma de rotinas (Claude Code cloud)

- Disponível no Max; consome a **mesma cota** das sessões interativas (janelas de 5 h e limite
  semanal, compartilhados com claude.ai/Claude Code da mesma conta); cap diário de execuções; há
  "usage credits" opcionais a preço de API para não parar ao estourar.
  [routines#usage-and-limits](https://code.claude.com/docs/en/routines#usage-and-limits)
- Rede: Default = "Trusted" (só registries/GitHub/SDKs). Níveis None/Trusted/Full/Custom. API
  credentials liberam o host mesmo sem mudar o nível.
  [cloud-environments#access-levels](https://code.claude.com/docs/en/cloud-environments#access-levels),
  [#add-api-credentials](https://code.claude.com/docs/en/cloud-environments#add-api-credentials)
- Variáveis de ambiente existem, mas a doc manda **não** guardar segredos nelas (qualquer sessão do
  ambiente lê).
- **Roda sem repositório**: a rotina "Resumo de e-mails novos" desta conta (criada pelo Cowork, hoje
  desativada) tem `sources: []` e rodou 27 vezes com o conector Microsoft 365 sem intervenção
  humana, lendo caixa pessoal **e compartilhada** (`mailboxOwnerEmail`), com execuções de 1 a 85 min
  e sem estourar 15/dia em nenhum dia UTC. GitHub desconectado não impede o plano — só exige prompt
  autocontido.
- Rotinas rodam **sem prompts de permissão** e podem usar **qualquer ferramenta** de qualquer conector
  anexado, inclusive escrita (`Mail.Send`, Teams). Mitigação: anexar só o Microsoft-365 e proibir
  escrita no prompt (regra 4 do prompt). Tráfego de conector não passa pela allowlist de rede.
  [routines#review-connectors](https://code.claude.com/docs/en/routines#review-connectors)
- Conector Microsoft 365 em rotina: tokens renovados pelo backend da Anthropic (access 60–90 min;
  refresh expira após 90 dias sem uso ou por política do tenant).
  [Microsoft 365 connector security guide](https://support.claude.com/en/articles/12684923-microsoft-365-connector-security-guide)
- Modelo: há seletor na UI e o alias `haiku` = Haiku 4.5; a string exata aceita em
  `session_context.model` para Haiku **não foi verificada** (padrão `claude-sonnet-5`).
- Sandbox: Ubuntu 24.04, `curl`, `jq`, Node, Python pré-instalados; ~4 vCPU/16 GB. Sem limite
  documentado de duração/concorrência (**não verificado**; empiricamente 85 min e sobreposição
  passaram).
- Status verde na lista de execuções **não** significa que a tarefa funcionou — 403 de rede e
  falhas de ferramenta só aparecem no transcript. Validar as primeiras execuções lendo o log.
- Custom connector (MCP remoto) existe no Max: "sem login" ou OAuth; modo "request headers" (chave
  estática) está em beta restrito. Por isso o MCP fica fora desta fase.

### Microsoft Graph / Exchange (backend baixa anexos)

- **`ApplicationAccessPolicy` é legado**; usar **RBAC for Applications** (`New-ServicePrincipal`,
  `New-ManagementScope`, `New-ManagementRoleAssignment -Role "Application Mail.Read"
  -CustomResourceScope`), e **não** conceder `Mail.Read` no Entra (anularia o escopo). Propagação
  30 min–2 h; `Test-ServicePrincipalAuthorization` ignora o cache. docs/13 foi corrigido.
  [application-rbac](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
- **Id de mensagem é por caixa**: `GRAPH_MAILBOX` tem de ser a mesma caixa que o conector lê. Ids
  mudam ao mover de pasta; `Prefer: IdType="ImmutableId"` não é exposto pelo conector. O conector
  devolve também `internetMessageId` (estável) — candidato a chave secundária de idempotência.
  [outlook-immutable-id](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)
- Premissa central **deduzida, não documentada**: o id lido por chamada delegada (conector) abre em
  `GET /users/{caixa}/messages/{id}` com token de aplicação. O formato (restId) é atributo do
  item/caixa, não do token — mas precisa de **smoke test** assim que o app estiver registrado.
- Download por `/attachments/{id}/$value` não tem limite documentado de tamanho (os limites de 3 MB
  / 150 MB são para *adicionar* anexos). É exatamente o que o provider faz.
- Identidade do conector nesta conta: **`lucas@opusce.com.br`** (não `josy@`). Id observado: 152
  caracteres, cabe em `NVarChar(400)`; usar o campo `id` bruto (termina em `=`), não a URI (`%3D`).
- **Categorizar/mover e-mail em caixa compartilhada não é possível pelo conector** (as ferramentas
  de label não aceitam `mailboxOwnerEmail` e `Mail.ReadWrite.Shared` não está concedido). A
  idempotência já é o `IntakeEvent`; a marcação visual para humanos fica para o backend (papel
  `Application Mail.ReadWrite` via RBAC) ou é dispensada.
- Ler caixa compartilhada pelo conector exige Full Access do usuário na caixa:
  `Add-MailboxPermission -Identity opusoperacional@opusce.com.br -User lucas@opusce.com.br -AccessRights FullAccess -AutoMapping $false` (já vale para o usuário atual do conector).

### Alternativa: Claude Code headless no próprio Windows Server

Tecnicamente viável (`claude -p`, Windows Server 2019+, Agendador de Tarefas, MCP stdio já pronto,
intervalo livre, API por localhost), mas com riscos que a rotina na nuvem não tem:

- Conectores claude.ai só funcionam com o login `/login` de assinatura (não com `setup-token`,
  `ANTHROPIC_API_KEY` ou `--bare`); a credencial fica em `%USERPROFILE%\.claude\.credentials.json`
  (texto claro), a duração do login **não é documentada** e sessões não assistidas param quando
  expira. [authentication](https://code.claude.com/docs/en/authentication),
  [mcp](https://code.claude.com/docs/en/mcp)
- `--bare` será o padrão futuro de `-p` e não lê OAuth; a instalação nativa se auto-atualiza —
  fixar versão/canal. [headless](https://code.claude.com/docs/en/headless)
- Termos: os Consumer Terms vedam acesso automatizado "exceto via API key ou onde explicitamente
  permitido"; **rotinas são uma permissão explícita** (documentadas para Pro/Max); um job a cada 15
  min com a conta pessoal fica numa zona cinzenta de "uso ordinário individual".
  [legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)
- `claude -p` ainda consome a cota da assinatura (mudança para crédito separado foi pausada em
  16/06/2026). [Agent SDK with your plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

Conclusão: para validação, **rotina na nuvem**; o caminho local só compensa se o intervalo de 1 h for
inaceitável antes de haver API paga.

### Custo e qualidade

- Preços (18/09/2026): Haiku 4.5 US$1/US$5 por MTok; Sonnet 5 US$2/US$10; Opus 5 US$5/US$25; cache
  read 10%. Sonnet/Opus 5 usam tokenizer ~30% mais denso.
  [pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Calibrado no log real da rotina existente (5 e-mails = 24 turnos/257 s; corpos de 5–24k chars):
  custo-equivalente por execução N=5 ≈ US$0,22 (Haiku) / US$0,58 (Sonnet); N=20 ≈ US$0,98 / US$2,56.
  Mês realista (220 execuções, maioria ociosa) ≈ US$46 Haiku / US$121 Sonnet — cabe no Max, mas
  **compete com o uso humano** da mesma conta.
- **Haiku 4.5 não é indicado para o loop agêntico** (a própria Anthropic o posiciona para tarefas
  verificáveis de alto volume, não loops longos); contexto de 200K limita o lote (N=20 já ~160K).
  Recomendação: **Sonnet 5 na rotina** (padrão), lote ≤ 12 e-mails; Haiku 4.5 fica para
  classificação/extração em chamada única com structured outputs quando migrar para API. Haiku 4.5
  tem piso de retirada "não antes de 15/10/2026" — não apostar o desenho nele.
- Ponto de virada para API paga: ~2.000 e-mails/mês com Sonnet no loop (≈ US$200) — ou antes, por
  previsibilidade. O caminho de API mais barato **não passa por Claude Code**: um worker no backend
  lendo a caixa pelo Graph (credenciais já existem) e chamando a Messages API uma vez por e-mail
  (≈ US$0,01–0,03/e-mail).

### Prontidão do repositório (o que falta)

| Item | Impacto | Ação |
| --- | --- | --- |
| Timeout do ARR (IIS) padrão 30 s < intake com anexos (token + listagem + N downloads + ReceitaWS) | 502 em e-mails com anexos grandes | `proxy timeout` ≥ 300 s no server farm; documentar em docs/11 |
| Certificado TLS de CA pública | curl da sandbox falha com self-signed | win-acme / Let's Encrypt no IIS (docs/11) |
| `/intake/*` sem limitador antes de `authenticate` | chave inválida ilimitada (DoS barato) | `anonymousLimiter` antes de `authenticate` no router de intake e/ou IP allowlist no IIS |
| Prompt `agente-email-haiku.md` pressupõe MCP | não serve para a rotina | criado `rotina-intake-claude-max.md` (curl) |
| `GRAPH_MAILBOX` ≠ caixa lida pelo conector | `MAIL_MESSAGE_NOT_FOUND` em tudo | **Decidido: `opusoperacional@opusce.com.br`** (compartilhada) — env, docs e prompt atualizados |
| Idempotência só por id do Graph | e-mail movido de pasta = evento novo | **Feito**: `source.internetMessageId` como chave secundária (claim + fallback de busca no Graph) |
| `/intake/*` sem limitador antes de `authenticate` | chave inválida ilimitada | **Feito**: `apiKeyFailureLimiter` (só 401 contam, por IP, 50/5 min) |
| `requesterEmail` aceito em `/lookup` e ignorado; retomada de `FAILED` mantém `kind` original | cosmético | **Feito**: campo removido; retomada atualiza `kind` e `externalId` |

## Próximos passos (ordem recomendada)

1. ~~Decidir a caixa~~ **Decidido: `opusoperacional@opusce.com.br`** (compartilhada). O usuário do conector
   (lucas@) já a lê — a rotina antiga do Cowork usava `mailboxOwnerEmail` nessa caixa com sucesso;
   se um dia trocar o usuário do conector, conceder `Add-MailboxPermission ... -AccessRights FullAccess`.
2. **Entra ID + Exchange**: registrar o app, RBAC for Applications com escopo na caixa (seção
   "Configuração" de docs/13), preencher `GRAPH_*` no `.env`, esperar propagação.
3. **Smoke test do Graph**: com a API em dev, `POST /intake/processes` com `fetchAttachments: true`
   usando um `id` lido pelo conector — prova a premissa central (id delegado ↔ app-only).
4. **Publicar a API** no Windows Server (docs/11) com HTTPS de CA pública e timeout do ARR; opcional
   IP allowlist para `/api/v1/intake` após confirmar a origem no log do IIS.
5. **Chave de API** para o usuário "Agente de E-mail" (Administração → Chaves de API) e cadastro
   como **API credential** do ambiente Default em claude.ai/code (host = API, header `X-Api-Key`).
6. **Criar a rotina** com `docs/prompts/rotina-intake-claude-max.md`, modelo Sonnet 5, só o
   conector Microsoft-365, cron `0 10-21 * * 1-5` (07h–18h SP). Antes de ativar o cron, **"Executar
   agora"** 2–3 vezes com e-mails de teste e ler o log de cada execução.
7. Medir: consumo em claude.ai/settings/usage antes/depois de algumas execuções; `warnings` e
   eventos `FAILED` em `GET /intake/events`; qualidade das classificações por uma semana.
8. Depois da validação: decidir entre manter no Max (com usage credits como rede) ou migrar para
   API — preferencialmente o worker no backend (Graph + Messages API), que dispensa conector e cota.
