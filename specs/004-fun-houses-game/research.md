# Research & Technical Decisions — Jogo de Casas e Avatares (fun)

**Created**: 2026-08-14 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This document consolidates the technical decisions for the feature, resolving the unknowns raised in the Technical Context. Each decision follows: **Decision**, **Rationale**, **Alternatives considered**.

---

## 1. Roteiro técnico e camadas (ordem de implementação)

**Decision**: Implementar na ordem das camadas da constituição do módulo fun — `constants` → `schema` → `repo` → `service` → `handler` → `pipeline` → `testes` → `docs`, com design de API contratos antes do código (Phase 1).

**Rationale**: A constituição (I. Arquitetura em Camadas) exige derivar repositórios/serviços da camada inferior; regras de negócio devem viver em `fun/services/`, repositórios só persistem, handlers são finos. A fase de design (contracts) antecede o código para travar os contratos de API/comandos antes da implementação.

**Alternatives considered**: implementar em fatias verticais por user story (casa → avatar → visita → presente → roubo). Rejeitada: contratos e schema precisam ser desenhados primeiro (SRP/DRY); a fatia vertical fica para `/speckit-tasks` dentro das camadas.

---

## 2. Renderização da casa e do avatar no navegador (sem lib pesada)

**Decision**: **CSS grid + emoji** para a casa (grade fixa ~6×8, "peça 1 célula", itens com emoji como sprite); **avatar composto por emoji/SVG inline por slot** (cabelo/rosto, roupa, acessório) via `AvatarShowcase` componente; **sem canvas/WebGL** para v1.

**Rationale**: Mobile-first e leveza: emoji já são vetoriais, funcionam no WhatsApp WebView e no navegador, resolvem o requisito de render sem peso. O bolsa/job usam Tailwind + emoji/SVG, e o requisito diz "totalmente de navegador" com liberdade de libs — mas um tema 3D/canvas adicionaria complexidade sem agregar ao escopo de v1 (casas/vizinhança/avatar). Os itens são dados (id, emoji, categoria) — o grid é puro CSS.

**Alternatives considered**: (a) Canvas/WebGL (PixiJS/Three) para casa — muito mais complexo para o MVP, mobile cost; (b) SVG components por item — verboso, sem ganho; (c) imagens estáticas geradas — acopla a geração de imagem (LLM), fragilidade. Rejeitadas para v1; o design permite migrar para Sprites SVG/PNG depois sem trocar contratos (os itens são entidades).

---

## 3. Autenticação web por token (link pessoal)

**Decision**: Token por jogador por grupo (`fun_house_tokens`), aleatório e revogável, entregue somente no DM do bot (ver §5). O web usa o token como bearer no path (`/casas/[token]`) e em header `x-house-token` para escrita; o token resolve o `userJid`/`scope_key` no servidor.

**Rationale**: A identidade canônica é o JID `@s.whatsapp.net`; sem senha. O token dá posse-proof: quem tem o link é o dono. Falta de sessão persistente mantém o stateless (sem cookies do jogo); a posse do token é o sign-in. É revogável (FR-030).

**Alternatives considered**: (a) cookie httpOnly por jogador (como admin) — requer login form e fluxo de troca de token, fricção para mobile; (b) código de 6 dígitos — fricção e expiração; (c) OAuth — over-engineering para jogo de grupo. Rejeitadas; token no path é o mais simples e mobile-first.

---

## 4. Argon2 / hashing de tokens

**Decision**: **`node:crypto` `scrypt`** (built-in) para derivar chave dos tokens; guardar só o **hash** no banco; comparar com `timingSafeEqual`. Revogação = deletar/comprar novo token (hash novo).

**Rationale**: scrypt é built-in, sem dependência (constituição: minimizar deps), resistente a brute-force; guardar hash evita vazamento do token no banco (uma casa é "posse = segredo", e se o banco vazar, o token não vaza). Simples e suficiente para o requisito de privacidade.

**Alternatives considered**: armazenar o token em texto simples (mais simples, mas vaza com o banco); `bcrypt` (dependência nova). Rejeitados: hash é o padrão correto e barato.

---

## 5. Entrega do link por DM (comando privado)

**Decision**: Novo comando `/casa` (grupo e DM). Em grupo, o handler responde instruindo o usuário a **iniciar uma conversa privada** com o bot e usar `/casa` lá. Em DM (`isGroup=false`), o handler usa `membershipService`/`dmGroups` para resolver o grupo de interesse e responde com o link pessoal via `replyPrivate` — **nunca** envia link em grupo e **nunca** inicia conversa privada (violaria a regra do WhatsApp).

**Rationale**: O router já distingue DM (`isGroup`, `scopeKey='dm'`, `dmGroups`); a infraestrutura de comandos privados existe (despedir, groupScope etc.). O usuário digitou `/casa` no privado — o bot só responde no privado. Isso satisfaz FR-027/028/033.

**Alternatives considered**: (a) enviar o link no grupo (expõe e contra a regra de privacidade/banimento); (b) só DM sem instrução em grupo (fricção de descoberta). Rejeitados; instrução em grupo + entrega em DM é o caminho.

---

## 6. Catálogo de casas/itens (estático vs motor econômico)

**Decision**: Catálogo **estático** em `fun/shop/houses.js` (constantes frozen, padrão de `fun/shop/properties.js`): casas com capacidade, custo, renda/limpeza, descrição, emoji; móveis/mascotes com categoria, custo, durabilidade, emoji. Sem motor econômico de preços (isso é exclusivo da bolsa/empresas — constituição II).

**Rationale**: Preços de itens de loja são fixos; não há tick de preço nem arquétipos. Reusar o padrão de catálogo do property; DRY.

**Alternatives considered**: gerar preços por motor econômico — over-engineering e contradiz a constituição (o motor é para ativos de mercado).

---

## 7. Schema — novas tabelas

**Decision**: Adicionar em `fun/schema.js` (e bump `FUN_SCHEMA_VERSION` para `'31'` + migração idempotente em `ensureFunSchema`):

- `fun_houses` — casa por jogador/scope (id, scope_key, user_jid, house_type, cleanliness_percent, last_clean_at, last_collect_at, security_level, created_at, updated_at)
- `fun_house_items` — itens posicionados (id, scope_key, user_jid, house_id, item_id, x, y, rotated, acquired_at, condition, stolen_flag)
- `fun_house_visits` — visitas/recados (id, scope_key, visitor_jid, host_jid, note, created_at)
- `fun_house_gifts` — presentes (id, scope_key, from_jid, to_jid, item_id, coins, status: pending/delivered/sold, created_at)
- `fun_house_tokens` — tokens de acesso (token_hash, scope_key, user_jid, created_at, revoked_at)
- `fun_avatar_state` — estado de avatar+equipamentos (scope_key, user_jid, slots_equipped JSON, updated_at)

Detalhes/validação em [data-model.md](./data-model.md).

**Rationale**: padrão do módulo (create-if-not-exists, idempotente, `scope_key` em todas, migração incremental no boot). Tokens com hash (scrypt).

**Alternatives considered**: tabela única de JSON genérico (perde indexação/validação); tokens em texto puro (vazamento). Rejeitados.

---

## 8. Serviços e repositórios

**Decision**: Services em `fun/services/` — `houseService`, `avatarService`, `visitService`, `giftService`, `robberyService`, `houseLinkService` — cada um com factory `createXService({ repository, ...deps })` (padrão do módulo). Repositórios em `fun/db/` — `funHouseRepository`, `funAvatarRepository` — factories `createFunXRepository({ getDatabase = getDb })`. Wiring em `fun/index.js` (`createFunModule`) injetando os novos serviços no `_services` e no `ctx` do router.

**Rationale**: SPR/DIP; serviços são testáveis via DI determinística (injetar `random`, relógio); repositórios só persistem; handler finos. Reuso de `repository.addCoins`/`transferCoins` para todas as movimentações.

**Alternatives considered**: um único `houseService` gigante com tudo — viola SRP; sem services (regras no handler) — viola a constituição.

---

## 9. Comandos e rotas no servidor web

**Decision**: 
- **Comandos WhatsApp** (router): adicionar `FUN_COMMANDS.HOUSE` (`/casa`), `FUN_COMMANDS.AVATAR` (`/avatar`), aliases em `FUN_COMMAND_ALIASES`; handlers `fun/commands/handlers/house.js` e `avatar.js`; casos no switch do `router.js`; mensagens em `fun/messages/house.js` e formatação em `fun/formatters/house.js` (padrão).
- **API web** (`fun/dashboard/server.js`, http puro): prefixo `/api/fun/houses/*` com os endpoints em [contracts/api-web.md](./contracts/api-web.md):
  - `GET /api/fun/houses/:token` — visor completo da casa (dono ou visitante, conforme posse)
  - `POST /api/fun/houses/:token/collect` — coleta diária (dono)
  - `PUT /api/fun/houses/:token/items` — reposicionar itens (dono)
  - `POST /api/fun/houses/:token/items/:itemId/place|sell` — colocar/vender (dono)
  - `GET /api/fun/houses/:token/visit|POST /visit` — visitar (outro membro do grupo)
  - `POST /api/fun/houses/:token/gifts` — enviar presente (visita)
  - `POST /api/fun/houses/:token/rob` — roubar (outro membro)
  - `GET /api/fun/houses/:token/shop` — catálogo (dono)
  - Auth: leitura pública do bairro (membro do grupo); escrita exige bearer `x-house-token` correto; dados pessoais fora do escopo nunca expostos (FR-029/032).
- **Frontend** (`fun_dashboard/src/middleware.ts`): declarar `/casas/:path*` como público (`isProtectedPath` retorna false; padrão bolsa/job). `fun_dashboard/src/lib/api.ts` + `types.ts` crescem com `funApi.houses.*` (proxy rewrite existente).

**Rationale**: separa os dois públicos — admin (com auth) e jogador (com token do link). Reusa `requireAdmin` para rotas admin; o novo guard de token é específico do jogo. O Next já proxy `/api/fun/:path*` para o dashboard server (rewrites), então o frontend chama `/api/fun/houses/...` e o backend responde.

**Alternatives considered**: rotas em novo arquivo Express (dependência); o servidor atual é http puro (`server.js`) — manter no mesmo handler com `if` por path (padrão existente) é o suficiente.

---

## 10. Robo e segurança (parâmetros reutilizados)

**Decision**: Reusar os parâmetros existentes de assault no `fun/config.js`: `assaultCooldownMs`, `assaultBaseChance`, `assaultMinSteal`, `assaultMaxStealRatio`, `assaultFailFinePct/Min/Max` (já NormalizeInt). Novos: `houseRobberyEnabled`, `houseRobberyCooldownMs`, `houseRobberyDailyMax`, `houseSecurityMaxLevel`, `houseRobberyStealablePredicate` (decorativos apenas). Penalidade = multa com piso/teto + `policeService` (aumento de procurado) — nunca kick/ban. Copy pública alinhada ao resultado real.

**Rationale**: caps/cooldowns centralizados (constituição II); reuso do existente reduz configuração nova. Robar só decorativos (decisão do usuário C); moedas/pets imunes; roubado não revendável/presenteável (FR-021/024).

**Alternatives considered**: tributar novamente com chaves novas — desnecessário; motor random duplicado — reusar `random` injetado.

---

## 11. Coleta diária / limpeza (tick do jogo)

**Decision**: Tabela `fun_houses` inclui `cleanliness_percent`, `last_clean_at`, `last_collect_at`. Uma rotina diária (job do módulo, respeitando `worldQuietHours` e `worldTickMs` — constituição III) decrementa limpeza ao longo do dia; `collect` só creditável 1×/dia (reset diário) e somente com limpeza ≥ mínimo. `security_level` influencia chance de roubo (FR-022/023).

**Rationale**: mecânica de jogo com tempo e sink de moedas; caps/cooldowns centralizados; quiet hours respeitadas.

**Alternatives considered**: evento de tick por mensagem (acoplado ao uso), pior para jogadores inativos; coleta ilimitada — quebra economia.

---

## 12. Middleware do Next e rotas públicas

**Decision**: Em `fun_dashboard/src/middleware.ts`, adicionar `/casas/:path*` e `/api/fun/houses/:path*` ao conjunto público (como `/bolsa`, `/job`); manter `isProtectedPath` para o resto (admin). Escrita de dados exige o token via header no client (`funApi` já manda `credentials: 'same-origin'`; adicionar `x-house-token` nos calls de escrita).

**Rationale**: o proxy de rewrites já roteia `/api/fun/:path*` para o backend; declarar público evita o middleware forçar auth admin em `/casas/*`. Padrão existente de isProtectedPath.

**Alternatives considered**: mover o server para dar auth nas rotas — quebraria o padrão bolsa; não recomendado.

---

## 13. Testes (plano de suíte)

**Decision**: Novos arquivos em `tests/` seguindo o padrão `node --test` + banco temporário + `FUN_DISABLE_LIVE_LLM=1`:

- `tests/fun-houses.test.js` — provision, buy/place/sell, cleanliness/collect (caps), visita (mural, teto), gift (entrega, venda), token (gerar/revogar/hash), roubo (chance determinística com `random` stub, multa piso/teto, procurado, decorativos apenas, não revendável)
- `tests/fun-houses-api.test.js` — endpoints web (auth por token, validação de escopo, read-only vs escrita)
- `tests/fun-houses-dm.test.js` — `/casa` (grupo instrui DM, DM entrega link), `/avatar` (link/info)
- Invariantes: ledger atômico, saldo não-negativo, caps de cooldown, `security` e `robbery` (padrão dos testes existentes de property/assault)

**Rationale**: determinístico, sem rede, isolação por JID/grupo único; cobre os acceptance scenarios da spec.

**Alternatives considered**: E2E com playwright (não há na stack; build do dashboard cobre); testes de chat com LLM real (proibido pela constituição).

---

## 14. Config e chaves novas (fun/config.js + fun/constants.js)

**Decision**: Novas chaves normalizadas em `fun/config.js` (padrão `normalizeInt`/`normalizeBoolean` com defaults em `DEFAULT_FUN_CONFIG` em `fun/constants.js`): `housesEnabled`, `avatarEnabled`, `visitsEnabled`, `giftsEnabled`, `robberyEnabled`, `houseDailyCollectMax`, `houseMaxItems`, `houseCellGrid (6x8)`, `houseSecurityMaxLevel (3)`, `houseRobberyCooldownMs`, `houseRobberyDailyMax`, `avatarShopRotationMs`, `worldQuietHours` reuso. Expostas publicamente (não-secretas) via `config.public.json` apenas o baseUrl público (existente) — nada de segredo.

**Rationale**: caps/cooldowns centralizados (constituição II); secretos nunca em config público (constituição IV).

**Alternatives considered**: claves hardcoded — viola a constituição; config por feature-gate (disable sem remover código).

---

## 15. Compatibilidade e sem regressão

**Decision**: Nenhuma mudança em contratos existentes: `FUN_COMMANDS` ganha novos rótulos sem renomear; `router.js` só adiciona cases; novas rotas web usam prefixo próprio `/api/fun/houses/*` sem tocar nas existentes; `isProtectedPath` apenas marca `/casas/*` como público; build e testes existentes devem permanecer verdes. UI nova em segmentos próprios (`/casas`), sem alterar páginas admin. Rotina diária respeita quiet hours e não envia mensagens automáticas fora delas.

**Rationale**: Expandir sem quebrar (requisito explícito do usuário e da constituição). O design isola tudo o que é novo.

**Alternatives considered**: refatorar rotas/commands existentes — rejeitado (seria risco de regressão sem necessidade).

---

## Decisões pendentes (resolvidas na spec)

- **Escopo**: mundo por grupo (bairro), `scope_key` em todas as tabelas — decisão do usuário A.
- **Autenticação web**: link pessoal por DM; bot nunca inicia conversa — decisão do usuário B.
- **Roubo**: apenas itens decorativos (moedas/pets imunes); multa in-game + procurado; nunca kick/ban — decisão do usuário C.
- Preenchimentos assumidos documentados na seção **Assumptions** da [spec](./spec.md) (segurança como progressão, leitura do bairro aberta, fallback de LLM, saldo existente, multi-dispositivo).