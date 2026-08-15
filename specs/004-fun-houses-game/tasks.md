# Tasks: Jogo de Casas e Avatares do Módulo Fun

**Input**: Design documents from `/specs/004-fun-houses-game/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-web.md, quickstart.md

**Tests**: A constituição do módulo fun exige `node --test` em `tests/fun-*.test.js` para toda funcionalidade nova (determinístico, banco temporário, `FUN_DISABLE_LIVE_LLM=1`). Portanto as fases incluem tarefas de teste primeiro (fail-first), antes da implementação de cada story.

**Organization**: Tarefas agrupadas por user story para implementação/teste independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependências)
- **[Story]**: Mapa para a user story (US1–US5)
- Paths exatos dos arquivos nas descrições

---

## Phase 1: Setup (Infraestrutura Compartilhada)

**Purpose**: Fundação — catálogos, schema, repositórios e camadas base que todo story utiliza.

- [X] T001 [P] Criar catálogo de casas/móveis/mascotes em `fun/shop/houses.js` (array frozen no padrão de `fun/shop/properties.js`: id, nome, emoji, custo, categoria, capacidade, renda/limpeza por tick, durabilidade, nível de segurança; casas: grid 6×8)
- [X] T002 [P] Criar catálogo global de itens de avatar em `fun/shop/avatars.js` (slots `hair_face|outfit|optional_accessory`, unlockLevel, cost, emoji, category)
- [X] T003 [P] Adicionar chaves novas de config em `fun/constants.js` (DEFAULT_FUN_CONFIG: `housesEnabled`, `avatarEnabled`, `visitsEnabled`, `giftsEnabled`, `robberyEnabled`, `houseDailyCollectMax=1`, `houseMaxItems=24`, `houseCellGrid='6x8'`, `houseSecurityMaxLevel=3`, `houseRobberyCooldownMs`, `houseRobberyDailyMax`, `avatarShopRotationMs`) e bump `FUN_SCHEMA_VERSION` para `'31'`
- [X] T004 [P] Adicionar normalização das chaves novas em `fun/config.js` (normalizeInt/normalizeBoolean no padrão existente; reuso de `assaultCooldownMs/BaseChance/MinSteal/MaxStealRatio/FailFine*`)

**Checkpoint**: Catálogos e config prontos.

---

## Phase 2: Foundational (Blocos de base — BLOCKS todos os stories)

**Purpose**: Schema, repositórios e serviços base que todas as stories precisam.

**⚠️ CRITICAL**: Nenhuma user story pode começar sem esta fase.

- [X] T005 [P] Adicionar tabelas novas em `fun/schema.js` (create-if-not-exists + migração idempotente em `ensureFunSchema`): `fun_houses`, `fun_house_items`, `fun_house_visits`, `fun_house_gifts`, `fun_house_tokens` (token_hash), `fun_avatar_state` (slots JSON) — todas com `scope_key` (ver `data-model.md`)
- [X] T006 [P] Criar repositórios em `fun/db/`: `funHouseRepository.js` (CRUD casas/itens/posição x,y/visitas/presentes, todos por `scope_key`; factory `createFunXRepository({ getDatabase = getDb })`)
- [X] T007 [P] Criar repositório `fun/db/funAvatarRepository.js` (estado do avatar + equipamentos por `scope_key`)
- [X] T008 [P] Criar serviços base em `fun/services/`: `houseLinkService.js` (gerar token aleatório, hashear com `node:crypto` scrypt, armazenar hash, resolver token→user/scope, revogar) e `avatarService.js` (equipar/desbloquear/compra, validação de posse/nível)
- [X] T009 Criar os demais serviços em `fun/services/`: `houseService.js` (provision de casa padrão, colocar/mover/remover/vender itens, limpeza/renda por tick, coleta 1×/dia), `visitService.js` (visitar, mural, recado com filtro/limite, teto diário), `giftService.js` (dar/entregar/vender presente), `robberyService.js` (chance de roubo por `security`, multa piso/teto, `policeService` procurado; só decorativos; itens roubados não revendáveis/presenteáveis)
- [X] T010 Criar centralização de mensagens em `fun/messages/house.js` e formatação em `fun/formatters/house.js` (emoji/grid para grupo, DRY)

**Checkpoint**: Fundação pronta — stories podem começar em paralelo.

---

## Phase 3: User Story 1 — Casa própria: comprar, decorar e coletar (Priority: P1) 🎯 MVP

**Goal**: Casa padrão provisionada, decorável (comprar/colocar/mover/vender), coleta diária de limpeza, visor web.

**Independent Test**: Comando no grupo instrui DM; `/casa` no DM entrega link; no navegador provisiona casa padrão, compra um item com moedas, vê na casa, coleta a recompensa diária; invariantes de ledger/saldo testadas.

### Tests for User Story 1 (fail-first) ⚠️

- [X] T011 [P] [US1] Testes de `houseService` (provision, buy/place/move/sell, cleanliness/collect, caps, ledger atômico, saldo não-negativo) em `tests/fun-houses.test.js`
- [X] T012 [P] [US1] Teste do link/token (`houseLinkService`: gerar/revogar/hash) em `tests/fun-houses.test.js`
- [X] T013 [P] [US1] Teste do comando `/casa` grupo→DM→link em `tests/fun-houses-dm.test.js`

### Implementation for User Story 1

- [X] T014 [P] [US1] Implementar `houseService.js` (provision, buy/place/move/sell via `repository.addCoins`, cleanliness/collect com caps) em `fun/services/houseService.js`
- [X] T015 [P] [US1] Implementar `houseLinkService.js` (token aleatório + scrypt hash, resolver, revogar; entrega exclusiva no DM) em `fun/services/houseLinkService.js`
- [X] T016 [P] [US1] Registrar comandos em `fun/commands/router.js` + handler `fun/commands/handlers/house.js` (`/casa`: grupo instrui DM, DM usa `membershipService`/`dmGroups` e entrega o link) e aliases em `FUN_COMMAND_ALIASES` (`fun/constants.js`); ajudar `/avatar` base (link/info)
- [X] T017 [US1] Adicionar rotas web de casa em `fun/dashboard/server.js` (padrão bolsa, http puro): `GET /api/fun/houses/:token`, `POST .../collect`, `PUT .../items/move`, `POST .../items/place|sell`, `GET .../shop` (auth por token de posse; erros JSON padrão)
- [X] T018 [US1] Criar segmento público no frontend `fun_dashboard/src/app/casas/[token]/page.tsx` (visor da casa, provision, coletar, decorar) + `components/casas/FloorGrid.tsx` e `HouseCard.tsx` (grid CSS 6×8 + emoji, mobile-first Tailwind v4)
- [X] T019 [US1] Adicionar client em `fun_dashboard/src/lib/api.ts` (`funApi.houses.*` com `x-house-token` nos calls de escrita) e tipos em `src/lib/types.ts`; marcar `/casas/:path*` e `/api/fun/houses/:path*` como públicos em `fun_dashboard/src/middleware.ts` (padrão bolsa/job)

**Checkpoint**: US1 funcional e testável de forma independente.

---

## Phase 4: User Story 2 — Avatar customizável (Priority: P1)

**Goal**: Avatar com slots (hair_face/outfit/accessory), desbloqueio por nível (XP existente) e compra com moedas; renderizado na casa e em visitas.

**Independent Test**: `/avatar` no DM responde resumo+link; no navegador equipa peça desbloqueada/comprada, vê o avatar atualizado; peça não liberada é bloqueada.

### Tests for User Story 2 (fail-first) ⚠️

- [X] T020 [P] [US2] Testes de `avatarService` (equipar/desbloquear/compra, posse/nível, slots) em `tests/fun-avatar.test.js`
- [X] T021 [P] [US2] Teste do comando `/avatar` (DM resumo + link) em `tests/fun-avatar-dm.test.js`

### Implementation for User Story 2

- [X] T022 [P] [US2] Implementar `avatarService.js` (equipar, desbloqueio por `fun_user_stats.level`, compra via ledger) em `fun/services/avatarService.js`
- [X] T023 [P] [US2] Registrar `/avatar` no router + handler `fun/commands/handlers/avatar.js` (DM: resumo do avatar + link; grupo: instrui DM)
- [X] T024 [US2] Adicionar rotas web de avatar em `fun/dashboard/server.js`: `GET /api/fun/houses/:token/avatar` (estado + catálogo liberado), `PUT /api/fun/houses/:token/avatar` (equipar/remover, valida posse), `POST /api/fun/houses/:token/avatar/shop` (comprar)
- [X] T025 [US2] Criar editor de avatar no frontend `fun_dashboard/src/app/casas/[token]/avatar/page.tsx` + `components/casas/AvatarShowcase.tsx` (visualiza slots + loja de roupas, mobile-first)

**Checkpoint**: US1 e US2 funcionais e testáveis independentemente.

---

## Phase 5: User Story 3 — Visitar casas de outros jogadores (Priority: P2)

**Goal**: Visita a casas de membros do mesmo grupo, mural de visitas com recado, teto diário, bloqueio cross-grupo.

**Independent Test**: Membro abre casa de colega (busca/listagem no bairro), deixa recado, anfitrião vê no mural; teto diário respeitado; casa de outro grupo/link inválido negados.

### Tests for User Story 3 (fail-first) ⚠️

- [X] T026 [P] [US3] Testes de `visitService` (visitar, mural, recado com filtro/limite, teto diário, cross-grupo negado) em `tests/fun-visits.test.js`

### Implementation for User Story 3

- [X] T027 [P] [US3] Implementar `visitService.js` (registrar visita, mural, recado com blocklist/max length — sem mídia) em `fun/services/visitService.js`
- [X] T028 [US3] Adicionar rotas web em `fun/dashboard/server.js`: `POST /api/fun/houses/:token/visit` (registra visita e recado), `GET /api/fun/houses/:token/visits` (mural do dono)
- [X] T029 [US3] No frontend: listagem/busca de casas do bairro (membros do mesmo grupo) + mural de visitas — `fun_dashboard/src/components/casas/` (Navi e VisitMural)

**Checkpoint**: US1–US3 funcionais e testáveis.

---

## Phase 6: User Story 4 — Presentear itens a outros jogadores (Priority: P3)

**Goal**: Presente de itens de avatar/decorativos ou moedas a membros do grupo; entrega automática, venda do presente, teto diário; itens roubados nunca presenteáveis.

**Independent Test**: Visitante compra/envia presente, anfitrião vê o item e recebe notificação; teto diário; item roubado bloqueado.

### Tests for User Story 4 (fail-first) ⚠️

- [X] T030 [P] [US4] Testes de `giftService` (dar/entregar/vender presente, teto diário, item roubado bloqueado, ledger) em `tests/fun-gifts.test.js`

### Implementation for User Story 4

- [X] T031 [P] [US4] Implementar `giftService.js` (enviar presente de item/moedas via `transferCoins`/inventário, entrega automática, vender com fração; bloqueio de roubado) em `fun/services/giftService.js`
- [X] T032 [US4] Adicionar rota web `POST /api/fun/houses/:token/gifts` em `fun/dashboard/server.js`
- [X] T033 [US4] UI de presentes no frontend (`components/casas/GiftPanel.tsx` na casa visitada) + notificação ao anfitrião (mural/notificação no menu)

**Checkpoint**: US1–US4 funcionais.

---

## Phase 7: User Story 5 — Robo e segurança (Priority: P2)

**Goal**: Segurança da casa (upgrades por moedas); roubo de decorativos com chance determinística, sucesso com marca de roubado, falha com multa piso/teto + procurado; moedas/pets imunes; nunca kick/ban.

**Independent Test**: Casa de segurança baixa é roubável (chance determinística com `random` stub); segurança alta/bloqueado; cooldown/teto; item roubado não é vendável/presenteável; multa e procurado aplicados.

### Tests for User Story 5 (fail-first) ⚠️

- [X] T034 [P] [US5] Testes de `robberyService` (chance determinística, segurança, multa piso/teto, procurado via policeService, decorativos apenas, roubado não revendável/presenteável, cooldown/teto, nunca kick/ban) em `tests/fun-robbery.test.js`

### Implementation for User Story 5

- [X] T035 [P] [US5] Implementar `robberyService.js` (determinístico com `random` injetado; usa `assault*` configs; multa piso/teto; `policeService` para procurado; só decorativos; `stolen_flag`) em `fun/services/robberyService.js`
- [X] T036 [US5] Adicionar rotas web de roubo em `fun/dashboard/server.js`: `POST /api/fun/houses/:token/rob` (com `x-house-token` do visitante? — não; visita autenticada: roubo via sessão de visita) e `POST /api/fun/houses/:token/security` (dono compra upgrade de segurança)
- [X] T037 [US5] UI de roubo no frontend (`components/casas/RobberyPanel.tsx`) com feedback de sucesso/falha/bloqueio e copy alinhada ao resultado

**Checkpoint**: Todas as user stories funcionais e independentes.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Melhorias transversais, docs, validação e segurança.

- [X] T038 [P] Atualizar `fun/README.md` (novas tabelas, comandos `/casa` e `/avatar`, configurações) e o roadmap quando aplicável
- [X] T039 [P] Segurança/hardening: garantir `x-house-token` apenas nas rotas de escrita, rate limit por IP no middleware (padrão existente), sem vazamento de JIDs em respostas, scrypt com salt
- [X] T040 [P] Performance mobile: lazy-load do grid, sem artefatos de render no `FloorGrid` (mobile-first), build do dashboard verde
- [ ] T041 [P] Validação final: rodar `quickstart.md` (cenários 1–9); `npm test` completo, `npm run fun:dev --setup`, `npm run fun:dashboard:build` verdes
- [X] T042 [P] Revisão contra constituição e Clean Code (remover código morto, sem duplicação entre services; mensagens centralizadas)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sem dependências — começa imediatamente
- **Foundational (Phase 2)**: Depende de Setup; BLOCKS todas as user stories
- **User Stories (Phase 3+)**: Dependem de Foundational
  - Sequentialmente na prioridade (US1 → US2 → US3 → US4 → US5) ou em paralelo se houver capacidade
- **Polish (Phase 8)**: Depende das stories desejadas completas

### User Story Dependencies

- **US1 (P1)**: Começa após Foundational; sem dependência de outras stories
- **US2 (P1)**: Após Foundational; independência testável (pode integrar com US1)
- **US3 (P2)**: Após Foundational; independência testável (pode integrar com US1)
- **US4 (P3)**: Após Foundational; independente, mas usa infra de US1 (casa/inventário)
- **US5 (P2)**: Após Foundational; usa `houseService`/`security` e `policeService`

### Within Each User Story

- Testes (quando incluídos) escritos PRIMEIRO e falhando antes da implementação
- Models/repositórios antes de services; services antes de endpoints; integração por último

### Parallel Opportunities

- T001–T004 (Setup) em paralelo
- T005–T010 (Foundational) em paralelo dentro da fase
- Depois de Foundational: todas as stories em paralelo (se capacidade permitir)
- Testes de cada story marcados [P] em paralelo
- Models/repos dentro de um story marcados [P] em paralelo
- Diferentes stories em paralelo por diferentes devs

---

## Parallel Example: User Story 1

```bash
# Todos os testes de US1 juntos:
Task: "Testes de houseService em tests/fun-houses.test.js"
Task: "Teste do link/token (houseLinkService) em tests/fun-houses.test.js"
Task: "Teste do comando /casa grupo→DM→link em tests/fun-houses-dm.test.js"

# Todos os models/services de US1 juntos:
Task: "Implementar houseService.js em fun/services/houseService.js"
Task: "Implementar houseLinkService.js em fun/services/houseLinkService.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational (CRITICAL)
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: Testar US1 independentemente
5. Deploy/demo se pronto

### Incremental Delivery

1. Setup + Foundational → Foundation pronta
2. + US1 → testar independente → Deploy/Demo (MVP!)
3. + US2 → testar independente → Deploy/Demo
4. + US3 → testar independente → Deploy/Demo
5. + US4 → testar independente → Deploy/Demo
6. + US5 → testar independente → Deploy/Demo

Cada story entrega valor sem quebrar os anteriores.

### Parallel Team Strategy

Com múltiplos devs:
1. Time completa Setup + Foundational juntos
2. Depois de Foundational:
   - Dev A: US1; Dev B: US2; Dev C: US3; Dev D: US4; Dev E: US5
3. Stories integram independentemente

---

## Notes

- [P] = arquivos diferentes, sem dependências
- Mapa [Story] → user story da spec (US1–US5)
- Cada story completável e testável independentemente
- Verificar que testes falham antes de implementar
- Commit após cada task ou grupo lógico; commits `fun`/`fun-*` Conventional Commits
- Parar em qualquer checkpoint para validar story independentemente
- Gates do módulo: `npm test`, `npm run fun:dev --setup`, `npm run fun:dashboard:build` (se UI mudar)