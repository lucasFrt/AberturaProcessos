# 15 - Estudo: o iLog como fonte da verdade dos processos

Estudo feito em 21/09/2026 sobre o banco MySQL do iLog (sistema de comércio exterior da Opus),
com acesso somente leitura, para responder a duas perguntas: **ligar o intake ao iLog é a melhor
opção?** e, se for, **como fazer isso da forma mais eficiente?** Números abaixo foram medidos no
banco real nessa data.

> **Estado (22/09/2026):** as entregas 30a e 30b da seção 6 estão implementadas (docs/12,
> Tarefa 30). A seção 7 registra o que foi feito e onde a implementação desviou do desenho da
> seção 5 — a seção 5 fica como foi aprovada, para comparação.

## 1. O problema que motiva o estudo

Depois de duas execuções reais da rotina (docs/13, decisões 9 a 12), o gargalo do intake ficou
claro: os e-mails que importam — HBL original do agente, minuta do terminal, boleto do
despachante, instrução de carregamento — referenciam o embarque pelo **número de processo da
Opus** (`30634/26`) ou pela **referência do cliente** (`SWT 0021/26`), e o sistema não tem como
saber a que embarque nem a que cliente isso corresponde. O resultado é "documento sem processo" ou
"cliente não identificado" para a maioria do volume, e processos criados a partir de e-mail de
cliente com o cadastro da empresa pendente.

Todos esses dados existem no iLog, porque é lá que a equipe abre o processo de verdade.

## 2. O que o iLog tem (verificado)

Banco `ilog` (MySQL 8.3, 282 tabelas) + `ilogcore` (arquivos). Fuso do servidor: horário de
Brasília. Host em IP privado da rede da empresa.

### Processos — `processo` (299 colunas, 11.431 linhas, 682 em aberto, ~20 abertos por dia útil)

| Campo | O que é | Preenchido (abertos desde 01/03/2026, n = 2.548) |
| --- | --- | --- |
| `nro_pro` / `ano_pro` | **Número da Opus** (`31435/26`) — é o que aparece nos assuntos dos e-mails | 100% |
| `ident_cli_pro` | **Referência do cliente** (`SWT 0021/26`, `DUAP-014826 - 26J04-2B`) ou o próprio HBL | 99% |
| `house_nro_pro` | HBL | 88% |
| `master_nro_pro` | MBL | 10% |
| `di_pro` | DI/DUIMP | 89% |
| `MasterMercanteNumero` | CE Mercante | 81% |
| `DTANumero` | DTA | 1% |
| `booking_pro`, `invoice_nro_for_pro` | — | 0% (vivem em tabelas filhas, abaixo) |
| `cod_importador` → `empresa` | **Importador com CNPJ** (`cgc_emp`) e razão social | 100% |
| `cod_exportador`, `cod_agente`, `cod_forwader`, `cod_despachante` | Demais partes | variável |
| `dt_ab_pro`, `dt_enc_pro`, `CanceladoData`, `dt_reg_di_pro`, `dt_lib_pro` | Datas do ciclo | 82% encerrados |

Todas as colunas de identificação têm índice (`nro_pro`, `ident_cli_pro`, `house_nro_pro`,
`master_nro_pro`, `di_pro`). 99% dos processos são importação.

Tabelas filhas com mais identificadores (2026): `procequipamento.container_procequip` (3.729
contêineres, indexado), `processofatura.Numero` (3.471 faturas, indexado), ambas por
`nro_pro`/`ano_pro`.

### Empresas e contatos — `empresa`, `empcontato`

`empresa`: `cod_emp`, `razaosocial_emp`, `fantasia_emp`, `cgc_emp` (CNPJ com máscara), `cpf_emp`,
`email_emp`, `status_emp`. `empcontato`: contatos com `email_empcontato`. Dos 72 importadores com
processo em 2026, 65 têm contato com e-mail — e o **domínio** desses contatos é exatamente o que o
intake precisa para ligar remetente → cliente (`carstation.com.br` → MV5 COMERCIO,
`globoimport.com.br` → T. GLOBO, `bfbrasilinternacional.com.br` → BF BRASIL, `riomaster.com.br` →
RIO MASTER). Domínios compartilhados (`opusce.com.br`, `gmail.com`, `eclipse2003.com.br`,
`phtransportes.com`) aparecem em várias empresas e não servem de chave.

### Arquivos — `ilogcore.ifilesystem` (311 mil linhas)

`SourceName = 'Processo'`, `SourceID = processoid` (texto), `FileName`, `FileContent` (blob),
`Folder`, `CreatedDateTime`. Um processo de agosto acumula 15 a 45 arquivos: `... FINAL OHBL.pdf`,
pré-alerta, solicitação de numerário, invoice, packing list, DANFE (XML), extratos de DUIMP,
AFRMM, termo. É o mesmo conjunto que chega por e-mail. Tipos formais em `tipoarquivo` (60) e
`dominio` (`DocumentosDiversos`).

### Ritmo — `changelog`

Toda alteração em `processo` fica em `changelog` (`TableName`, `RecordID`, `ChangedDateTime`
indexados; ~25 eventos de processo a cada 5 minutos). Serve tanto para saber **quando** um
processo nasceu quanto para sincronizar incrementalmente. `UltimaAlteracao` em `processo` é sempre
nulo (não serve).

### Latência e-mail → iLog (medida em 21/09)

| E-mail | Chegou | Processo no iLog | Criado às |
| --- | --- | --- | --- |
| "Novo Processo - 230/26" (Casa & Novidade) | 12:33 | `31435/26`, ident `DANGB26080406` (o HBL) | 19:40 (~7 h) |
| "RES: PRÉ ALERTA - SWT 0021/26" (Globo) | 09:23 | `31429/26`, ident `SWT 0021/26` | 11:57 (~2,5 h) |

Ou seja: a equipe abre o processo no iLog **no mesmo dia**, em horas — mas depois do e-mail. E
usa como identificação o **HBL** ou a **referência do cliente**, não o número interno que o cliente
escreveu (`230/26`).

### Resolução dos identificadores escalados na execução de 21/09

`30634/26` e `30620/26` → IDEAL COMERCIAL (CNPJ 50.075.764/0001-14); `31142/26` → SAINT PAUL'S;
`SWT 0020/26` → T. GLOBO. Todos os "cliente não identificado" com número da Opus no assunto
resolvem no iLog. Os HBLs de pré-alerta de agente (`NBZY26071470`) ainda não estavam no iLog — o
processo nasce depois do pré-alerta.

## 3. Opções

### A. Manter o Kanban isolado (o que existe hoje)

A IA cria processo a pedido do cliente (empresa pendente quando não conhece o domínio) e anexa
documento só a processo que já existe aqui; documento de terceiro sem processo vira "sem ação".

- Simples; nenhuma dependência nova.
- Mas: o Kanban só sabe dos processos que o **cliente** pediu por e-mail; os que a equipe abre por
  telefone/portal/agente nunca existem aqui, e a maioria dos documentos (que referencia o número da
  Opus) fica sem destino. Empresas ficam pendentes de CNPJ. Na prática, dois cadastros de processo
  paralelos (iLog e Kanban) que ninguém vai manter iguais à mão.

### B. Consulta sob demanda ao iLog (espelhar quando um documento chega)

Quando um e-mail traz identificador sem processo local, a API consulta o iLog; se acha, cria o
processo local espelhado (importador com CNPJ real) e anexa.

- Resolve os documentos de terceiro e o CNPJ sem nenhum sync.
- Mas: uma ida ao MySQL por e-mail (e por identificador), dependência do banco legado em tempo real
  na hora mais crítica, Kanban só ganha o processo quando algum documento chega, e "Novo Processo"
  de cliente continua sem CNPJ até isso acontecer. Matching por texto (`contains` na referência)
  continua sendo o mecanismo — frágil com `31435/26` × `31435-26` × `NBZY 26071470`.

### C. Espelho incremental do iLog + índice local de identificadores (recomendada)

Um job do worker lê o `changelog` a cada poucos minutos, traz os processos novos/alterados com
importador, identificadores (número, referência do cliente, HBL, MBL, DI, CE, contêineres,
faturas) e mantém no nosso banco: o processo espelhado, um **índice de identificadores** (valor
normalizado → processo) e o mapa **domínio de e-mail → empresa** (de `empcontato`). A API e a IA
consultam só o banco local.

- Kanban = espelho fiel do iLog, sempre; nenhuma empresa pendente para clientes conhecidos.
- Matching exato e barato (uma consulta indexada local), sem tocar no MySQL durante o intake.
- Robusto: MySQL fora → o intake segue com o último snapshot; o sync retoma depois.
- Abre o caminho para etapas automáticas (DI registrada, encerrado → Concluído) e para listar os
  arquivos do iLog dentro do processo.
- Custo: sync (tabelas + job + regras de vínculo) e uma regra de conciliação para o processo que o
  cliente pediu por e-mail antes de o iLog existir (vincular pelo HBL/referência quando aparecer).

### D. Escrever no iLog (criar processo, anexar arquivo)

Fora por enquanto: 299 colunas com regras de negócio e BPM próprios; criar processo lá por fora é
risco real. Anexar arquivo em `ifilesystem` é simples (`SourceName`/`SourceID`/`FileContent`) e
pode ser a segunda fase, depois que o espelho estiver estável — precisa de usuário com escrita.

## 4. Recomendação

**C, com B como retaguarda pontual.** O que decide é o dado: 100% dos processos têm número da
Opus e importador com CNPJ, 99% têm referência do cliente, 88% HBL; o número da Opus é o que vem nos
assuntos; e a latência e-mail → iLog é de horas, no mesmo dia. Um espelho de 5 em 5 minutos cobre o
fluxo real com folga (~25 alterações de processo por ciclo), e o índice local tira o MySQL do
caminho crítico. A retaguarda B fica para um caso só: identificador com cara de número da Opus que
não está no índice — consulta direta, uma vez, e o processo entra no espelho na hora.

A regra de produto "processo só nasce a pedido do cliente" (docs/13, decisão 11) continua
verdadeira e fica **mais** verdadeira: quem cria o processo é a equipe, no iLog; o Kanban espelha.
O e-mail "Novo Processo" do cliente continua abrindo o processo aqui na hora (a equipe quer vê-lo
no funil antes das 7 horas), e o sync o **vincula** ao processo do iLog quando ele nascer.

## 5. Desenho otimizado

### 5.1 Dados locais

- `Process` ganha `ilogProcessId` (único, opcional), `ilogNumber` (`31435/26`), `ilogSyncedAt`.
- `ProcessIdentifier` (nova): `processId`, `kind` (`OPUS_NUMBER | CLIENT_REF | HBL | MBL |
  CONTAINER | INVOICE | DI | CE | DTA | OTHER`), `value` (como está), `normalized` (maiúsculas, só
  `[A-Z0-9]`), `source` (`ILOG | EMAIL | MANUAL`). Índice único em `(kind, normalized, processId)`
  e índice em `normalized`. O `lookup` do intake passa a consultar isto primeiro: **exato por
  normalizado**, depois o `contains` de hoje como segunda opção. `reference` continua sendo o texto
  de exibição.
- `Company` ganha `ilogCompanyId`; `EmailDomain` passa a poder nascer do sync (`empcontato`), com
  `autoApprove = false`, só para domínios que aparecem em **uma** empresa e não estão na lista de
  domínios públicos/compartilhados.
- `IntakeSyncState` (uma linha): `lastChangelogAt`, `lastRunAt`, `lastError`.

### 5.2 O job de sync (worker, a cada 5 min; `ILOG_SYNC_ENABLED`)

1. **Backfill inicial** (uma vez): todos os processos com `dt_enc_pro IS NULL AND CanceladoData IS
   NULL` (682) + encerrados dos últimos 90 dias, em lotes de 200 por `processoid`.
2. **Incremental**: `SELECT DISTINCT RecordID FROM changelog WHERE TableName='processo' AND
   ChangedDateTime > :last` (índice em `ChangedDateTime`), depois `processo` + `empresa` +
   `procequipamento` + `processofatura` só desses ids (`WHERE processoid IN (...)`, lotes de 200).
   Marca `lastChangelogAt` = maior `ChangedDateTime` visto, com 2 minutos de sobreposição
   (idempotente: upsert por `ilogProcessId`).
3. **Upsert** do processo: cria (etapa inicial) ou atualiza referência/identificadores/empresa;
   `source = 'API'`? Não — novo valor `ILOG` em `RECORD_SOURCES` (CHECK constraint em migration),
   para o front mostrar "iLog" na origem.
4. **Empresa**: por CNPJ (`cgc_emp` normalizado). Existe → vincula `ilogCompanyId`; existe
   **pendente** com o mesmo nome/domínio → conclui o cadastro; não existe → cria organização +
   empresa (razão social e CNPJ reais) e os domínios de contato exclusivos.
5. **Vínculo com processo criado por e-mail antes**: se um processo local sem `ilogProcessId` tem
   identificador (HBL, referência do cliente, número que o cliente escreveu) igual a um do iLog e a
   mesma empresa (ou empresa pendente com nome parecido) → vincula em vez de criar duplicado;
   documentos e histórico ficam.
6. **Etapa** (fase seguinte): `CanceladoData` → marca cancelado; `dt_enc_pro` → etapa final;
   `dt_reg_di_pro` → etapa "Em andamento" — mapeamento configurável por etapa, desligado por
   padrão.

### 5.3 Otimizações

- **Zero MySQL no caminho do e-mail**: a IA e a API só leem o índice local. A retaguarda B é uma
  chamada `GET /intake/ilog/lookup?ref=` explícita, com timeout curto, usada só quando o índice
  não tem o identificador e ele parece número da Opus (`^\d{4,6}/\d{2}$`).
- **Consultas só por coluna indexada** no iLog, `LIMIT` sempre, pool de 2 conexões, usuário só
  leitura, `SET SESSION TRANSACTION READ ONLY`, `max_execution_time` de 10 s.
- **Normalização única** dos identificadores nos dois lados (sync e prompt): maiúsculas, remove
  espaços/hífens/barras/pontos → `31435/26` = `31435-26` = `3143526`... — cuidado: `3143526` sozinho
  não é ambíguo porque o `kind` separa número da Opus de HBL. O `lookup` devolve o `kind` casado
  (`OPUS_NUMBER`, `HBL`...) em vez de `CODE/REFERENCE/PARTIAL`.
- **Domínio → empresa** vindo do iLog elimina o "cadastro pendente" para clientes recorrentes e
  o `COMPANY_REQUIRED` para remetente de cliente sem CNPJ; o pendente fica só para cliente novo de
  verdade (primeiro e-mail antes do primeiro processo no iLog) — e é concluído pelo sync.
- **Prompt menor**: a ficha continua, mas a regra "documento sem processo" vira exceção; a IA
  passa a informar `identifiers: [{kind, value}]` já classificados, o que também alimenta o índice
  (`source = EMAIL`) para o próximo documento.
- **Arquivos do iLog no processo** (fase seguinte): `GET /processes/:id/ilog-files` lista
  `ifilesystem` do `ilogProcessId` (nome, tamanho, data) e um proxy de download lê o blob sob
  demanda — sem copiar 311 mil arquivos. O processo passa a mostrar o que está lá **e** o que
  chegou por e-mail.
- **Métrica de sucesso**: na tela "Intake IA", a fração de `IGNORED` com motivo "sem processo"
  deve cair de ~40% (execução de 21/09) para perto de zero nos processos existentes; escalados
  por "cliente não identificado" idem.

### 5.4 O que fica de fora agora

Escrita no iLog (criar processo ou anexar arquivo), sincronização de etapas em tempo real e
mercadorias/valores — nada disso é necessário para o intake acertar o processo e o cliente.

## 6. Plano (Tarefa 30, três entregas)

- **30a — Índice de identificadores + espelho + sync**: model `ProcessIdentifier`, campos `ilog*`
  em `Process`, `RECORD_SOURCES` com `ILOG`, `ILOG_*` no env, provider MySQL (leitura) em
  `infra/ilog/`, `IlogSyncService` com backfill + incremental, job no worker, `lookup` pelo índice,
  retaguarda `GET /intake/ilog/lookup`. Testes: unit com fake do provider; integração do lookup e do
  upsert com fixtures.
- **30b — Empresas e domínios**: CNPJ do importador, conclusão de pendentes, `EmailDomain` de
  `empcontato` (só domínios exclusivos), vínculo de processo criado por e-mail.
- **30c — Arquivos do iLog e etapas**: listagem/proxy de `ifilesystem` no processo; mapeamento
  opcional de etapas.

Pré-requisitos: usuário MySQL **somente leitura** para o servidor da API (com `SELECT` em `ilog` e
`ilogcore`), conectividade do Windows Server com o IP privado do MySQL, e as variáveis `ILOG_*` no
`.env`.

> **Feito (22/09/2026):** o usuário fornecido já é somente leitura — `GRANT SELECT ON *.*`, sem
> nenhuma permissão de escrita, e sem restrição de host (`@'%'`), então o Windows Server pode usar
> o mesmo. O `SELECT` global cobre `ilogcore` (arquivos da fase 30c) sem pedir nada novo.
> Verificado com `SHOW GRANTS FOR CURRENT_USER()`. Resta a conectividade e as variáveis `ILOG_*`
> no `.env` do servidor.

## 7. O que foi implementado (30a + 30b) e os desvios do desenho

Código: `domain/entities/process-identifier.ts` (normalização, classificação por formato,
extração de candidatos de uma referência livre), `domain/ilog/ilog-process-source.ts` (interface),
`infra/ilog/mysql-ilog-process-source.ts` (mysql2), `services/ilog-sync-service.ts`,
`jobs/ilog-sync-job.ts`, `infra/prisma/repositories/prisma-process-identifier-repository.ts` e
`prisma-ilog-sync-state-repository.ts`, migrations `20260922100000_add_ilog_mirror` e
`20260922100100_add_check_constraints_ilog_mirror`. Contratos em docs/04, docs/05 e docs/10.

Desvios (todos deliberados):

- **Backfill só dos processos em aberto abertos nos últimos `ILOG_BACKFILL_DAYS` dias (padrão
  90)**, não "todos os abertos + encerrados de 90 dias". Dos 682 abertos em 21/09, 373 foram
  abertos em jul–set; os ~300 restantes são de 2024–2025 e nunca foram encerrados no iLog — no
  funil seriam ruído. Eles entram quando forem alterados no iLog ou quando um e-mail citar um
  identificador deles (retaguarda). Processos já encerrados/cancelados que apareçam no incremental
  e ainda não existam aqui **não são criados**; os que já existem só são atualizados (etapa fica
  para a 30c).
- **Retaguarda B implícita, não um endpoint `GET /intake/ilog/lookup`**: `lookup` e `attach` do
  intake consultam o iLog sozinhos quando o índice não tem o identificador (só para `ref` com
  dígito e ≥ 4 caracteres normalizados; nome de empresa nunca vai ao iLog). Menos uma ferramenta e
  menos uma decisão para o agente; o custo é uma consulta MySQL por identificador desconhecido
  (colunas indexadas, `LIMIT`, `max_execution_time`). Falha do iLog vira `lastError`, não erro —
  e **pausa a retaguarda por 5 minutos** (`IlogSyncService.isLookupAvailable`): com o MySQL
  inalcançável cada tentativa custa o timeout de conexão inteiro (`ILOG_MYSQL_TIMEOUT_MS`, 10 s),
  e em 23/09 isso foi 42% de uma execução da rotina, um identificador por vez. Uma falha do ciclo
  periódico também pausa; um ciclo bem-sucedido religa na hora. Enquanto pausada, o `lookup`
  responde `ilogAvailable: false`, e o agente registra o "sem processo" dizendo que o iLog estava
  fora (docs/13, decisão 9).
- **O job roda no processo da API, não no worker.** O `RealtimeProvider` (Socket.IO) só existe
  no processo da API; no worker o board não receberia `process:created` dos espelhados. É um
  `setInterval` com `unref`, atraso inicial de 15 s, e o service rejeita ciclos sobrepostos.
- **Cursor do `changelog` guardado como texto no formato do MySQL** (`IlogSyncState.lastChangelogAt`,
  `NVARCHAR(30)`), devolvido tal qual na próxima consulta — nenhuma conversão de fuso em nenhum
  lado. As DATETIME do processo (`dt_ab_pro`…) são convertidas com o fuso fixo de Brasília
  (`-03:00`, sem horário de verão desde 2019) no provider, não pelo fuso do Node. O incremental
  também lê `processofatura` e `procequipamento` (identificadores nas filhas) e o cursor só
  avança até o menor "máximo" das consultas que bateram no `ILOG_CHANGELOG_LIMIT`.
- **Referência do processo espelhado** = `ident_cli_pro` + HBL (quando diferente), ou o número
  da Opus; o número fica em `ilogNumber` (tag "iLog 31435/26" no card e busca por `q`). A
  referência de um processo aberto por e-mail é do agente e **não** é sobrescrita ao vincular.
- **Vínculo** exige mesma empresa (`ilogCompanyId` ou CNPJ) **ou** empresa em cadastro pendente;
  identificador igual em empresa com CNPJ diferente é colisão e o processo do iLog é espelhado à
  parte (aviso no log). Ao vincular com empresa pendente, o cadastro é concluído com razão social,
  nome fantasia, CNPJ e `ilogCompanyId` do iLog. Um cadastro pendente também é concluído por nome
  (normalizado, sem sufixos societários) ou por domínio de contato já registrado na organização.
- **Domínios de contato** viram `EmailDomain` quando corporativos, ainda desconhecidos aqui e
  **não** usados por 4+ raízes de CNPJ sem relação entre si no iLog (`listSharedContactDomains`
  lê `empcontato` inteira — 527 linhas — uma vez por execução); `autoApprove = false`. O limiar
  veio do dado: em 21/09, os domínios com 2–3 raízes eram grupos/filiais (`carstation.com.br` =
  MV5 + V. TECH + MOBI RIO, `globoimport.com.br`, `riomaster.com.br`); os com 4+ eram webmail,
  `opusce.com.br` (60 raízes) e uma transportadora. Um domínio já registrado por outra empresa
  do grupo faz a empresa nova entrar na **mesma organização** — é o que "organização" significa
  (docs/01): o domínio agrupa os CNPJs. A regra antiga ("só domínio exclusivo de uma empresa")
  teria deixado de fora quase todos os clientes recorrentes.
- **Índice também para WEB/API**: toda criação/edição de `reference` (formulário, chave de API)
  alimenta o índice com `source = MANUAL`; `identifiers`/`addReferences` do intake, com `EMAIL`; o
  espelho regrava os `ILOG` a cada leitura (e "promove" para `ILOG` o que o e-mail já tinha e o
  iLog confirma). Os `kind` são só orientação — o casamento é pelo valor normalizado, sem
  distinção de tipo; a unicidade é `(processId, kind, normalized)`.
- **Um processo por BL no servidor**: `POST /intake/processes` com identificador já existente na
  mesma empresa vira complemento (`event.kind = ATTACHMENT`), mesmo que o agente tenha errado a
  classificação.

Quem assina as escritas do espelho (`createdBy`, histórico): `ILOG_SYNC_ACTOR_EMAIL`, ou o
primeiro ADMIN ativo. Vale criar um usuário interno "Espelho iLog" para isso ficar legível na
timeline.

Fica para a 30c: listagem/proxy dos arquivos do `ifilesystem` no processo (exige `SELECT` em
`ilogcore`), mapeamento de etapas (`CanceladoData`/`dt_enc_pro`/`dt_reg_di_pro`) e um painel do
estado do sync (`IlogSyncState`) na tela "Intake IA".
