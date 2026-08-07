# Prompt — Tarefa 5: Login social e provisionamento por domínio

Cole o texto abaixo para a IA que for continuar o projeto.

---

Você está continuando o desenvolvimento do backend do projeto **AberturaProcessos**. Leia
`CLAUDE.md` na raiz do repositório antes de qualquer coisa — ele tem as regras de arquitetura,
convenções e decisões técnicas que não devem ser reabertas.

## Tarefa a implementar

**Tarefa 5 do plano** (`docs/12-plano-de-tarefas.md`): Login social e provisionamento por domínio.

Leia antes de codificar:
- `docs/06-autenticacao-autorizacao.md`, seções "Login social" e "Provisionamento por domínio"
  (tem o diagrama de fluxo completo)
- `docs/05-contrato-api.md`, seções `GET /auth/providers`, `GET /auth/google` /
  `GET /auth/microsoft`, `GET /auth/google/callback` / `GET /auth/microsoft/callback`
- `docs/10-ambiente-e-configuracao.md`, seção "Configuração dos provedores OAuth"
- O código já existente de `AuthService` (`backend/src/services/auth-service.ts`) e
  `DomainProvisioningService` (`backend/src/services/domain-provisioning-service.ts`) — o
  provisionamento por domínio já está implementado e deve ser **reaproveitado**, não duplicado.

## O que implementar

1. Estratégias Passport para Google (`passport-google-oauth20`) e Microsoft
   (`passport-microsoft` ou `passport-azure-ad`), configuradas em `backend/src/passport/`.
2. `SocialAuthService` (novo arquivo em `src/services/`) implementando a resolução em três passos
   descrita no doc 06:
   1. Busca `UserIdentity` por `(provider, providerUserId)` → usuário já vinculado.
   2. Sem achar, busca `User` pelo e-mail → cria nova `UserIdentity` vinculando o provedor à conta
      existente (RF-09: mesmo e-mail, múltiplos provedores).
   3. Sem achar nenhum dos dois → cria usuário novo aplicando `DomainProvisioningService`
      (mesmo fluxo do registro local).
3. Rotas `GET /auth/google`, `GET /auth/microsoft` (redirect 302, aceitam `?redirect=` validado
   contra lista de caminhos internos permitidos) e os callbacks correspondentes.
4. Callback processa o retorno do Passport, grava o cookie de refresh (reaproveitar
   `setRefreshTokenCookie` de `auth-cookies.ts`) e redireciona para
   `{FRONTEND_URL}/auth/callback?status=ok|pending|error&code=...`.
5. `GET /auth/providers` — endpoint público informando quais provedores estão configurados
   (`{ local: true, google: boolean, microsoft: boolean }`), baseado na presença das credenciais no
   env.
6. Adicionar `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`,
   `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`,
   `MICROSOFT_CALLBACK_URL` ao `env.ts` como **opcionais** — a ausência de credenciais de um
   provedor não deve impedir a subida da API (é um critério de aceite explícito).
7. Atualizar `container.ts` e `app.ts` para montar as novas rotas e o Passport.

## Critérios de aceite (copiados do plano, não negociáveis)

- Com perfil de provedor mockado, domínio conhecido cria usuário `ACTIVE` na organização correta,
  com o papel (`defaultRole`) daquele domínio.
- Domínio desconhecido cria usuário `PENDING`, sem emissão de token.
- E-mail já existente (de conta local ou de outro provedor) ganha uma `UserIdentity` nova — não
  duplica o usuário.
- `EmailDomain.autoApprove = false` força `PENDING` mesmo com domínio reconhecido.
- Provedor sem credencial configurada não impede a subida da API (não deve lançar erro no
  `env.ts` nem no bootstrap do Passport).

## Testes obrigatórios

- Unitários do `SocialAuthService` com fakes (reaproveitar os fakes existentes em
  `tests/helpers/fakes/`), cobrindo os 5 critérios de aceite acima. Não é viável mockar a
  estratégia Passport real em teste unitário — teste a lógica de resolução do service isolada do
  Passport, passando o "perfil" (nome, e-mail, id do provedor) como argumento direto.
- Integração: se possível, teste o fluxo completo mockando a resposta do provedor (verificar como
  o Passport permite injetar uma estratégia fake, ou testar via chamada direta ao service +
  verificação do efeito no banco). Se não for viável mockar o provider de forma limpa em teste de
  integração, documente a limitação no PR/commit e garanta cobertura completa nos unitários.

## Verificação antes de finalizar

Rodar (dentro de `backend/`): `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` —
todos devem passar sem erro antes de considerar a tarefa concluída. Testar manualmente com
`npm run dev` não é possível sem credenciais OAuth reais; documente no commit que a validação
end-to-end com provedor real depende de credenciais que serão configuradas em ambiente próprio.

## Ao finalizar

- Se o contrato de alguma rota mudar em relação ao que está em `docs/05-contrato-api.md`, atualize
  o documento.
- Commit em Conventional Commits (ex.: `feat(auth): login social google/microsoft e provisionamento por dominio`).
- Não faça push automático sem confirmar com o usuário, salvo se o fluxo de trabalho já estabelecido
  for de push direto (confira o histórico de commits anteriores no repositório para saber o padrão
  seguido até aqui).
