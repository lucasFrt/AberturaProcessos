# 08 - Frontend

React 18 + TypeScript + Vite. Saída estática servida pelo IIS; chamadas de API e WebSocket passam
pelo mesmo host via reverse proxy, então em produção não há CORS entre front e API.

## Estrutura de pastas

Organização por feature. Cada feature é autocontida (api, componentes, hooks, páginas); o que é
transversal fica em `shared/`.

```
frontend/
├── index.html
├── vite.config.ts
├── tsconfig.json
├── .env.example
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── app/
    │   ├── router.tsx           # rotas + proteção por papel
    │   ├── providers.tsx        # QueryClient, ConfigProvider (AntD), SocketProvider
    │   └── query-client.ts
    ├── shared/
    │   ├── api/
    │   │   ├── http-client.ts   # axios + interceptors (bearer, refresh, erro)
    │   │   └── errors.ts        # mapeia error.code -> mensagem em pt-BR
    │   ├── components/
    │   │   ├── AppLayout.tsx
    │   │   ├── PageHeader.tsx
    │   │   ├── EmptyState.tsx
    │   │   ├── ErrorBoundary.tsx
    │   │   └── Can.tsx          # renderização condicional por permissão
    │   ├── hooks/
    │   │   ├── usePermissions.ts
    │   │   └── useDebounce.ts
    │   ├── lib/
    │   │   ├── format.ts        # datas (America/Sao_Paulo), CNPJ, bytes, duração
    │   │   └── cnpj.ts
    │   └── types/
    ├── features/
    │   ├── auth/
    │   │   ├── api/
    │   │   ├── components/      # LoginForm, SocialButtons, PendingApprovalCard
    │   │   ├── pages/           # LoginPage, RegisterPage, OAuthCallbackPage, PendingPage
    │   │   └── store/auth-store.ts   # Zustand
    │   ├── processes/
    │   │   ├── api/
    │   │   ├── components/      # KanbanBoard, KanbanColumn, ProcessCard,
    │   │   │                    # ProcessDrawer, ProcessForm, DocumentUploader,
    │   │   │                    # DocumentList, HistoryTimeline, ProcessFilters
    │   │   ├── hooks/           # useBoard, useProcess, useMoveStage, useProcessSocket
    │   │   └── pages/           # NewProcessPage, BoardPage, ProcessListPage
    │   ├── stages/
    │   ├── admin/               # organizações, empresas, usuários, pendentes
    │   └── dashboard/
    └── styles/
```

## Cliente HTTP

Axios com dois interceptors. O de resposta implementa refresh transparente com fila, para que várias
requisições que falhem juntas em `401` disparem apenas um refresh:

```ts
// shared/api/http-client.ts
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // "/api/v1" em produção
  withCredentials: true,                 // necessário para o cookie de refresh
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as RetriableConfig | undefined;
    const code = error.response?.data?.error?.code;

    if (error.response?.status === 401 && code === 'UNAUTHENTICATED' && original && !original._retried) {
      original._retried = true;
      refreshing ??= refreshAccessToken().finally(() => { refreshing = null; });
      try {
        const token = await refreshing;
        original.headers = { ...original.headers, Authorization: `Bearer ${token}` };
        return api(original);
      } catch {
        useAuthStore.getState().clear();
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  },
);
```

O access token vive apenas em memória (store Zustand, sem `persist`). Ao recarregar a página, o front
chama `POST /auth/refresh` no bootstrap: o cookie `httpOnly` reconstrói a sessão. Isso mantém o token
fora do `localStorage` sem custo de UX.

`shared/api/errors.ts` traduz `error.code` para mensagem em português. A UI nunca exibe
`error.message` cru da API.

## Rotas e proteção

```tsx
<Route element={<RequireAuth />}>
  <Route element={<AppLayout />}>
    <Route index element={<Navigate to="/board" replace />} />
    <Route path="/board" element={<BoardPage />} />
    <Route path="/processes" element={<ProcessListPage />} />
    <Route path="/processes/new" element={<NewProcessPage />} />
    <Route path="/processes/:id" element={<BoardPage />} />  {/* abre a gaveta */}

    <Route element={<RequireRole roles={['ADMIN']} />}>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/admin/organizations" element={<OrganizationsPage />} />
      <Route path="/admin/companies" element={<CompaniesPage />} />
      <Route path="/admin/users" element={<UsersPage />} />
      <Route path="/admin/stages" element={<StagesPage />} />
    </Route>
  </Route>
</Route>

<Route path="/login" element={<LoginPage />} />
<Route path="/register" element={<RegisterPage />} />
<Route path="/auth/callback" element={<OAuthCallbackPage />} />
<Route path="/pending" element={<PendingPage />} />
```

`RequireAuth` aguarda o bootstrap (`/auth/refresh` + `/auth/me`) antes de decidir, para não piscar a
tela de login em um F5. `RequireRole` redireciona para `/board` com aviso quando o papel não permite.

`/processes/:id` reaproveita `BoardPage` e abre a gaveta de detalhe: o card fica linkável e
compartilhável, sem duplicar a tela.

## Permissões na UI

A UI **espelha** as permissões vindas do servidor; nunca as decide sozinha.

```tsx
// shared/components/Can.tsx
export function Can({ perform, children, fallback = null }: CanProps) {
  const { has } = usePermissions();     // lê permissions de /auth/me
  return has(perform) ? <>{children}</> : <>{fallback}</>;
}
```

```tsx
<Can perform="process:move">
  <Button onClick={openMoveModal}>Mover etapa</Button>
</Can>
```

Para ações a nível de recurso, usar o objeto `permissions` de `GET /processes/:id`
(`canEdit`, `canMove`, `canDelete`, `canAssign`, `canUploadDocument`), que já considera o papel e o
escopo daquele processo específico. Esconder botão é conforto de UX; a autorização real é da API.

## Telas

### Login (`/login`)

Card centralizado com:

- Formulário e-mail + senha (React Hook Form + Zod, mesmo schema de senha do backend).
- Botões "Entrar com Google" e "Entrar com Microsoft" → navegação direta para
  `{VITE_API_URL}/auth/google?redirect=/board` (navegação de página, não fetch — é um fluxo OAuth).
- Link para cadastro.
- Erros por `code`: credencial inválida, conta pendente (redireciona para `/pending`), conta
  desativada.

`/auth/callback` lê `?status` da querystring: `ok` → chama refresh + `/auth/me` e vai para o destino;
`pending` → `/pending`; `error` → volta ao login com a mensagem traduzida.

### Abertura de processo (`/processes/new`)

O entry point. Campos, na ordem do formulário:

| Campo | Componente | Regras |
| --- | --- | --- |
| CNPJ Cliente | `Select` com busca | Obrigatório. `GET /companies` é restrito a ADMIN no backend (docs/05); CLIENT usa a lista `companies` já devolvida por `/auth/me` (seu próprio escopo), filtrada localmente. OPERATIONAL/ADMIN buscam via `GET /companies?q=`. Se o CLIENT tiver só um CNPJ, vem pré-selecionado. |
| CNPJ Solicitante | `Select` com busca, opcional | Aparece atrás de "Este processo foi solicitado por outra empresa?" para não poluir o caso comum. |
| Referência | `Input` | Obrigatório, 3–255 caracteres. |
| Adicionais | `TextArea` (6 linhas, contador) | Opcional, até 10.000 caracteres. |
| Documentos | `Upload.Dragger` múltiplo | Opcional. Qualquer tipo de arquivo. |

Fluxo de submissão: `POST /processes` → com o `id` retornado, `POST /processes/:id/documents` com os
arquivos selecionados → mensagem de sucesso com o código gerado (`PRC-2026-00042`) → redireciona para
a gaveta do processo criado.

Se o processo é criado e o upload falha, a UI informa que o processo foi criado e que os anexos
precisam ser reenviados na tela de detalhe, mantendo o usuário na gaveta com a lista de arquivos que
falharam. O processo não é desfeito.

O botão de submit fica desabilitado durante o envio, e um `beforeunload` avisa se houver upload em
andamento.

### Board Kanban (`/board`)

- Colunas montadas a partir de `GET /processes/board`, na ordem de `stage.order`.
- Cabeçalho da coluna: nome, bolinha na cor da etapa e contador (`total`).
- `ProcessCard`: código, referência (2 linhas com ellipsis), tag do CNPJ cliente, avatar do
  responsável, ícone com contagem de documentos e tempo na etapa ("há 3 dias", derivado de
  `stageChangedAt`). Card com mais de X dias na mesma etapa recebe destaque discreto.
- Drag-and-drop com `@hello-pangea/dnd`. Somente quem tem `process:move` recebe `isDragDisabled=false`.
- Filtros no topo (persistidos na querystring, para o link ser compartilhável): busca por
  código/referência, CNPJ, responsável, período.
- Coluna com `total > processes.length` mostra "Carregar mais".

Movimentação otimista:

```ts
const { mutate: moveStage } = useMutation({
  mutationFn: ({ processId, toStageId }: MoveArgs) =>
    api.patch(`/processes/${processId}/stage`, { toStageId }),

  onMutate: async ({ processId, toStageId }) => {
    await queryClient.cancelQueries({ queryKey: boardKey(filters) });
    const previous = queryClient.getQueryData<BoardResponse>(boardKey(filters));
    queryClient.setQueryData<BoardResponse>(boardKey(filters), (b) => moveCard(b, processId, toStageId));
    return { previous };
  },

  onError: (error, _vars, context) => {
    queryClient.setQueryData(boardKey(filters), context?.previous); // devolve o card
    message.error(translateError(error));
  },

  onSettled: () => queryClient.invalidateQueries({ queryKey: boardKey(filters) }),
});
```

O rollback em `onError` é o que evita o card "sumir" para uma coluna onde o backend não aceitou.

### Gaveta de detalhe (`ProcessDrawer`)

`Drawer` lateral (largura 720px, largura total no mobile) com três abas:

1. **Dados** — edição inline de referência/adicionais (salva no blur, com indicador de estado),
   CNPJs, responsável (`Select` alimentado por `GET /users/operational`, só com `canAssign`), etapa
   atual e botão de mover.
2. **Documentos** — uploader, lista com nome, tamanho formatado, tipo, autor, data, botão de download
   e de excluir (conforme permissão). Download via link direto para
   `/api/v1/documents/:id/download`, com o header `Authorization` — como `<a>` não envia header, o
   download é feito por `fetch` + `blob` + `URL.createObjectURL`, com revogação depois.
3. **Histórico** — `Timeline` a partir de `history`, com ícone por `action`, autor, data/hora
   formatada em `America/Sao_Paulo` e, em `STAGE_CHANGED`, as etapas de origem e destino.

### Lista de processos (`/processes`)

`Table` com colunas ordenáveis, paginação servidor e os mesmos filtros do board. É a visão preferida
para volume alto e para o cliente que só quer acompanhar status. Clique na linha abre a mesma gaveta.

### Administração (`/admin/*`, ADMIN)

- **Organizações** — tabela + modal de criação/edição; painel de domínios com `defaultRole` e
  `autoApprove` por domínio.
- **Empresas** — tabela com CNPJ mascarado, razão social, organização, status; modal com validação de
  CNPJ no cliente (mesma função do backend, em `shared/lib/cnpj.ts`).
- **Usuários** — abas "Pendentes" (com badge de contagem) e "Todos". Aprovação em modal: papel,
  organização, `accessScope` e, quando `COMPANIES`, seletor múltiplo de CNPJs.
- **Etapas** — lista reordenável por drag-and-drop; `PATCH /stages/reorder` disparado ao soltar, com
  os ids na nova ordem. Toggle `isFinal`, seletor de cor, exclusão com aviso de `STAGE_NOT_EMPTY`
  mostrando quantos processos bloqueiam.

### Dashboard (`/dashboard`, ADMIN)

- Filtro de período (`DatePicker.RangePicker`, presets 7/30/90 dias) e de organização.
- Cartões: total de processos, ativos, concluídos no período, **tempo médio de conclusão**
  (`completionTime.formatted`, com a média em horas no tooltip).
- Gráfico de barras: processos por etapa (cores das próprias etapas).
- Gráfico de barras horizontal: top 10 CNPJs por volume.
- Gráfico de linha: criados vs. concluídos por dia (`throughputByDay`).
- Tabela: tempo médio por etapa, com `sampleSize` para dar contexto à média.

## Tempo real

Um provider único mantém a conexão e traduz eventos em invalidações de cache:

```tsx
// app/providers.tsx (SocketProvider)
useEffect(() => {
  if (!accessToken) return;

  const socket = io(import.meta.env.VITE_SOCKET_URL, {
    auth: { token: accessToken },
    withCredentials: true,
  });

  socket.on('process:created', () => queryClient.invalidateQueries({ queryKey: ['board'] }));
  socket.on('process:deleted', () => queryClient.invalidateQueries({ queryKey: ['board'] }));

  socket.on('process:moved', (payload: ProcessMovedPayload) => {
    queryClient.invalidateQueries({ queryKey: ['board'] });
    queryClient.invalidateQueries({ queryKey: ['process', payload.processId] });
  });

  socket.on('process:updated', ({ processId }: { processId: string }) => {
    queryClient.invalidateQueries({ queryKey: ['process', processId] });
    queryClient.invalidateQueries({ queryKey: ['board'] });
  });

  socket.on('stages:changed', () => queryClient.invalidateQueries({ queryKey: ['stages'] }));

  return () => { socket.disconnect(); };
}, [accessToken, queryClient]);
```

O evento serve como gatilho de invalidação, não como fonte de dados. Cada cliente refaz a busca e
recebe apenas o que o seu escopo permite. Como o próprio autor da ação também recebe o evento, a
invalidação precisa ser idempotente com a atualização otimista — o `invalidateQueries` do `onSettled`
resolve isso convergindo para o estado do servidor.

## Estado

| Tipo de estado | Onde |
| --- | --- |
| Dados de servidor (processos, etapas, empresas, métricas) | TanStack Query |
| Sessão (access token, usuário, permissões) | Zustand, sem persistência |
| Filtros do board/lista | Querystring (`useSearchParams`) |
| UI efêmera (gaveta aberta, aba ativa, modais) | `useState` local |

Chaves de query centralizadas em `features/*/api/keys.ts`, para que invalidação e leitura não
divirjam:

```ts
export const processKeys = {
  all: ['processes'] as const,
  board: (filters: BoardFilters) => ['board', filters] as const,
  list: (filters: ListFilters) => ['processes', 'list', filters] as const,
  detail: (id: string) => ['process', id] as const,
};
```

Defaults do `QueryClient`: `staleTime` de 30 s, `refetchOnWindowFocus: true`, `retry: 1`. Com socket
ativo, a atualização vem por evento; o refetch no foco é a rede de segurança para quando o socket cai.

## Formatação e acessibilidade

`shared/lib/format.ts` concentra: data/hora em `America/Sao_Paulo` (`dayjs` + plugin `timezone`),
tempo relativo em pt-BR, CNPJ mascarado (`00.000.000/0000-00`), tamanho de arquivo e duração em
dias/horas.

Acessibilidade:

- `ConfigProvider` do AntD com `locale: ptBR`.
- Todo campo de formulário com `<label>` associado; erro ligado ao campo por `aria-describedby`
  (o `Form.Item` do AntD faz isso quando `name` é usado corretamente).
- Board navegável por teclado: `@hello-pangea/dnd` traz suporte a teclado nativo (espaço para pegar,
  setas para mover, espaço para soltar) e anúncios via região `aria-live`. Manter as mensagens
  padrão traduzidas.
- Ícone nunca é o único portador de informação: sempre acompanha texto ou `aria-label`.
- Contraste mínimo AA nas cores das etapas: a paleta oferecida no seletor de cor é pré-validada, e o
  texto sobre a cor é calculado (claro/escuro) pela luminância.
- Foco visível preservado (não remover `outline`), e a gaveta devolve o foco ao card de origem quando
  fechada.

> Validação completa de WCAG exige teste manual com leitor de tela e revisão por especialista. Os
> pontos acima cobrem o que é verificável em código.

## Build e servir

```
npm run dev      # Vite em :5173, proxy /api e /socket.io para :3000
npm run build    # tsc --noEmit && vite build -> dist/
npm run preview
```

`vite.config.ts` em desenvolvimento:

```ts
server: {
  port: 5173,
  proxy: {
    '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
  },
}
```

O target é `127.0.0.1`, nunca `localhost`. A API faz bind explícito em `127.0.0.1`
(`server.listen(env.PORT, '127.0.0.1')`, exigido por `docs/11`, seção "Superfície de rede"), e no
Windows o resolvedor de nome do Node devolve `::1` antes de `127.0.0.1` para `localhost` — com
`localhost` no target, todas as chamadas do proxy falham com
`http proxy error: ECONNREFUSED ::1:3000` e o front mostra "Ocorreu um erro inesperado" no login.

Usar proxy em dev (em vez de apontar `VITE_API_URL` para outra origem) faz o ambiente local se
comportar como produção: mesma origem, cookie de refresh funcionando, sem CORS. `dist/` é publicado
no IIS com regra de fallback para `index.html`, necessária para as rotas do React Router.
