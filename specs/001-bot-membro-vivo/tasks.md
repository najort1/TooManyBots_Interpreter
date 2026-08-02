# Tasks: Bot Membro Vivo

**Input**: Design documents from `/specs/001-bot-membro-vivo/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks **são incluídas** — exigidas pela Constituição do módulo fun (Princípio IV:
"Toda funcionalidade nova DEVE ter testes node --test ... FUN_DISABLE_LIVE_LLM=1") e pelo
`quickstart.md`. Determinismo com banco SQLite temporário e LLM mockado.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Módulo: `fun/` (backend standalone) + `fun_dashboard/` (Next.js) — ver `plan.md`
- Testes: `tests/fun-*.test.js` na raiz do repositório

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Constantes e configuração compartilhadas por todas as user stories (decisão R7 do research)

- [X] T001 Add persona constants to `fun/constants.js` (`personaCooldownMs=60000`, `personaMaxTurns=3`, `personaThreadTtlMs=1800000`, `personaWindowSize=100`, `personaWindowMs=86400000`, `personaTimeoutMs=28000`, `personaMaxChars=400`)
- [X] T002 Add persona config defaults to `fun/config.js` (`personaEnabled` global default true, sobreposições das constantes via `overrides`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema e persistência — bloqueiam TODAS as user stories

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase (US1 usa `persona_enabled`; US2 usa threads; US3 usa perfil)

- [X] T003 Extend schema in `fun/schema.js`: criar tabelas `fun_persona_profile` e `fun_persona_thread`, adicionar coluna `persona_enabled` (default 1) em `fun_group_settings`, incrementar `FUN_SCHEMA_VERSION` (create-if-not-exists idempotente)
- [X] T004 Create `funPersonaRepository` in `fun/db/funPersonaRepository.js` (CRUD de perfil e thread por `scope_key`, padrão do módulo `fun*Repository`)
- [X] T005 Add `persona_enabled` ao mapa de colunas e ao `upsertGroupSettings` (padrão "default ON", como `world_events_enabled`) in `fun/db/funGroupRepository.js`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - O bot responde quando é citado (Priority: P1) 🎯 MVP

**Goal**: Detecção de menção ("bot" palavra inteira ou @marcação), guardas básicas (feature ligada, sem self-loop, fora de quiet hours, fora de cooldown), geração via cascata Zen → template e envio da resposta — precedência de comandos garantida.

**Independent Test**: Enviar "bot, o que acha disso?" em grupo whitelistado → resposta da persona ≤15s; "botão"/"robô" → silêncio; comando `/pay` → não responde como persona. Ver `quickstart.md` cenários 1–4.

### Tests for User Story 1 (exigidos pela constituição) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [X] T006 [P] [US1] Unit tests de detecção/guardas (regex `\bbot\b` não casa "botão"/"robô"/"botox"; @marcação via `identityMap`; cooldown; quiet hours; anti-self-loop) em `tests/fun-persona-service.test.js`
- [X] T007 [P] [US1] Integration test do hook (comando tem precedência; persona nunca quebra o pipeline; falha de LLM → fallback) em `tests/fun-persona-pipeline.test.js`

### Implementation for User Story 1

- [ ] T008 [US1] Implement `personaService.tryRespond(ctx)` core (detecção T5a + guardas T1–T4 + geração Zen→template reutilizando `openaiChatComplete`/`sanitizeFlavor`/`looksLikeScoreboardEcho` + fallback estático local) in `fun/services/personaService.js` (depends on T003, T004, T005, T001, T002)
- [ ] T009 [US1] Implement hook passivo em `fun/pipeline/onIncomingMessage.js` (seção passiva após roteamento de comandos e `isCountableMessage`, try/catch, fire-and-forget, passando `ctx` completo)

**Checkpoint**: At this point, User Story 1 deve estar funcional e testável de forma independente (MVP)

---

## Phase 4: User Story 2 - O bot mantém a conversa quando respondem (Priority: P1)

**Goal**: Quando um membro responde citando a mensagem do bot (`quotedParticipant` = JID do bot), o bot continua a conversa, até o limite de turnos; thread expira por inatividade (TTL).

**Independent Test**: Após resposta da persona, citar a mensagem dela → o bot responde de novo; após 3 continuações, para; citar mensagem expirada (≥30min) → não reabre. Ver `quickstart.md` cenários 5–6.

### Tests for User Story 2 (exigidos pela constituição) ⚠️

- [ ] T010 [P] [US2] Unit tests de thread (abrir, continuar, limite de turnos, expiração por TTL, reply antigo não reabre) em `tests/fun-persona-service.test.js`

### Implementation for User Story 2

- [ ] T011 [US2] Implement gestão de threads em `fun/services/personaService.js` (abrir/continuar/expirada/limite via `funPersonaRepository`, gatilho T5b, atualização de `turn_count`/`last_activity_at`) (depends on T008)
- [ ] T012 [US2] Injetar contexto da thread (últimas trocas, autor anonimizado) no prompt de continuação em `fun/services/personaService.js`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - O bot aprende a falar como o grupo (Priority: P2)

**Goal**: Janela rolante em memória (≤100 msgs/24h por grupo) alimentada no mesmo ponto do `groupMemoryService.observeMessage`; derivação de perfil de voz compacto e anonimizado persistido em `fun_persona_profile`; injeção do estilo no prompt.

**Independent Test**: Grupo com gírias/emojis próprios → após período de amostragem, respostas incorporam o estilo; grupos diferentes não misturam estilos; perfil persiste após reinício. Ver `quickstart.md` cenário 3.

### Tests for User Story 3 (exigidos pela constituição) ⚠️

- [ ] T013 [P] [US3] Unit tests de janela/perfil (janela rolante por `scope_key`, isolamento entre grupos, anonimização de `style_lines`, persistência do perfil, limites de tamanho) em `tests/fun-persona-service.test.js`

### Implementation for User Story 3

- [ ] T014 [US3] Implement `observeMessage` + janela em memória + derivação/persistência do perfil anonimizado em `fun/services/personaService.js` (depends on T004)
- [ ] T015 [US3] Wire `personaService.observeMessage` no mesmo ponto do `groupMemoryService.observeMessage` em `fun/pipeline/onIncomingMessage.js` (fire-and-forget)
- [ ] T016 [US3] Injetar perfil de voz + `style_lines` anonimizadas no prompt da persona em `fun/services/personaService.js`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: User Story 4 - Guardas anti-spam e controle por grupo (Priority: P2)

**Goal**: Toggle por grupo `persona_enabled` propagado no dashboard (API + UI), com default ON; leitura efetiva no runtime (`settings.persona_enabled !== 0 && config.personaEnabled !== false`).

**Independent Test**: Desligar no dashboard → nenhuma resposta da persona em ≤1min; religar + reiniciar → estado persiste. Ver `quickstart.md` seção 4.

### Tests for User Story 4 (exigidos pela constituição) ⚠️

- [X] T017 [P] [US4] Unit tests do toggle (upsert default ON, leitura efetiva combinando settings + config global) em `tests/fun-persona-settings.test.js`
- [X] T018 [P] [US4] Propagar `personaEnabled` do body no handler `PUT /api/fun/groups/:jid/settings` em `fun/dashboard/server.js` (contrato em `contracts/dashboard-settings.md`)
- [X] T019 [US4] Adicionar toggle "Persona (membro vivo)" na página de grupos em `fun_dashboard/src/app/groups/page.tsx` (chama PUT com `personaEnabled`)

**Checkpoint**: All user stories now complete and independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Melhorias que afetam múltiplas user stories

- [X] T020 [P] Documentar a feature no `fun/README.md` (comportamento, gatilhos, guardas, configuração `persona*`)
- [ ] T021 [P] Validar conformidade com a constituição (sem eco de placar via `looksLikeScoreboardEcho`, sem doxxing, quiet hours, commits `fun/fun-*`) — revisão manual
- [ ] T022 Run `quickstart.md` end-to-end: `npm test`, `npm run fun:dev --setup`, `npm run fun:dashboard:build` e cenários manuais no grupo

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sem dependências — pode começar imediatamente
- **Foundational (Phase 2)**: Depende do Setup — BLOQUEIA todas as user stories
- **User Stories (Phase 3+)**:
  - US1 (P1) — depende da Foundational
  - US2 (P1) — depende de US1 (usa o mecanismo de resposta) e da Foundational
  - US3 (P2) — depende de US1 (alimenta a geração) e da Foundational; testável isoladamente via unidade
  - US4 (P2) — depende apenas da Foundational (coluna/settings) — independente das demais
- **Polish (Final Phase)**: Depende das user stories desejadas

### User Story Dependencies

- **User Story 1 (P1)**: Pode começar após Foundational — sem dependência de outras stories (MVP)
- **User Story 2 (P1)**: Depende de US1 (resposta/thread sobre o mecanismo de menção)
- **User Story 3 (P2)**: Depende de US1 (injeção de estilo na geração); janela/perfil testável por unidade isoladamente
- **User Story 4 (P2)**: Independente de US1–US3 (apenas Foundational) — pode rodar em paralelo

### Within Each User Story

- Testes DEVEM ser escritos primeiro e FALHAR antes da implementação (TDD conforme constituição)
- Models/persistência antes de serviços; serviços antes de integração
- Story completa antes de passar para a próxima prioridade

### Parallel Opportunities

- Setup: T001 e T002 em paralelo
- Foundational: T003 e T005 em paralelo (T004 depende de T003)
- US1: T006 e T007 (testes) em paralelo; T008→T009 sequencial (T009 usa a API do T008)
- US2/US3: T010 e T013 (testes) em paralelo
- US4: T017 e T018 em paralelo (T019 depende do T018)
- US4 pode ser feita em paralelo com US2/US3 (arquivos distintos: dashboard/server.js, groups/page.tsx)

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together:
Task: "Unit tests de detecção/guardas em tests/fun-persona-service.test.js"
Task: "Integration test do hook em tests/fun-persona-pipeline.test.js"

# Implementation (sequencial — T009 depende da API do T008):
Task: "personaService.tryRespond core em fun/services/personaService.js"
Task: "Hook passivo em fun/pipeline/onIncomingMessage.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001, T002)
2. Complete Phase 2: Foundational (T003–T005 — CRITICAL, bloqueia tudo)
3. Complete Phase 3: User Story 1 (T006–T009)
4. **STOP and VALIDATE**: Test User Story 1 independently (`node --test tests/fun-persona-service.test.js tests/fun-persona-pipeline.test.js`)
5. Deploy/demo se estiver pronto — o bot já responde a menções sem spam

### Incremental Delivery

1. Setup + Foundational → base pronta
2. User Story 1 → testar isoladamente → deploy (MVP!)
3. User Story 2 → testar isoladamente → deploy (conversa contínua)
4. User Story 3 → testar isoladamente → deploy (estilo do grupo)
5. User Story 4 → testar isoladamente → deploy (controle por grupo no dashboard)
6. Cada story agrega valor sem quebrar as anteriores

### Parallel Team Strategy

Com múltiplos desenvolvedores:

1. Time conclui Setup + Foundational juntos
2. Após a Foundational:
   - Developer A: User Story 1 → 2 (núcleo da persona)
   - Developer B: User Story 4 (dashboard — arquivos distintos)
3. Após US1: Developer C: User Story 3 (janela/perfil + injeção no prompt)
4. Stories completam e integram de forma independente

---

## Notes

- [P] tasks = arquivos diferentes, sem dependências
- [Story] label mapeia a task para a user story (rastreabilidade)
- Cada user story deve ser completável e testável de forma independente
- Verifique os testes falhando antes de implementar (TDD)
- Commit após cada task ou grupo lógico (`feat(fun): ...`, escopo `fun`/`fun-*`)
- Pare em qualquer checkpoint para validar a story independentemente
- Evitar: tasks vagas, conflito no mesmo arquivo, dependências cruzadas que quebrem a independência

## Phase 8: Convergence

- [X] T023 [US4] CRITICAL Corrigir hidratação do toggle `personaEnabled` no formulário de grupos em `fun_dashboard/src/components/groups/GroupSettingsForm.tsx` para refletir corretamente o valor persistido por grupo per FR-012 / SC-007 (partial)
- [X] T024 [US3] Automatizar derivação e persistência do perfil de voz no fluxo real em `fun/services/personaService.js` + `fun/pipeline/onIncomingMessage.js` para que o estilo aprendido sobreviva a reinícios per FR-005 / FR-008 / FR-015 (partial)
- [X] T025 [US1] CRITICAL Adequar a geração da persona ao fluxo vigente (Zen + fallback estático local, com timeout/retry) em `fun/services/personaService.js` per Constitution IV / plan: cascata LLM existente (contradicts)
- [X] T026 [US1] Restringir o disparo da persona a mensagens de texto normais de membros em `fun/pipeline/onIncomingMessage.js` e `fun/services/personaService.js` per edge case de `spec.md` (partial)
- [X] T027 [US4] Adicionar guarda anti-concorrência/in-flight por grupo em `fun/services/personaService.js` para impedir respostas duplicadas sob menções simultâneas per FR-010 / edge cases (partial)
- [X] T028 [US1] Alinhar `personaTimeoutMs` e o orçamento real de geração para resposta em até 15 segundos em `fun/constants.js`, `fun/config.js` e `fun/services/personaService.js` per FR-004 / SC-001 (contradicts)
