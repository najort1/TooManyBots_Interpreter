# Tasks: Persona Memory Intelligence

**Input**: Design documents from `/specs/002-persona-memory-intelligence/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Testes são obrigatórios para esta feature, conforme a constituição do módulo `fun/` e o plano da feature.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Backend/service module no diretório `fun/`
- Testes determinísticos em `tests/`
- Artefatos da feature em `specs/002-persona-memory-intelligence/`

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preparar constantes, config e documentação de apoio da feature

- [X] T001 Atualizar catálogo da feature e referências em `specs/002-persona-memory-intelligence/plan.md` e `specs/002-persona-memory-intelligence/contracts/testing-strategy-summary.md`
- [X] T002 Adicionar constantes de tipos de memória, evidência, sensibilidade e defaults em `fun/constants.js`
- [X] T003 Ajustar normalização de configuração da feature em `fun/config.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestrutura central de dados, wiring e contratos internos que bloqueiam todas as histórias

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Atualizar schema versionado com tabelas de memória conversacional, thread ativa e identidade por grupo em `fun/schema.js`
- [X] T005 [P] Implementar persistência base de memória conversacional em `fun/db/funConversationMemoryRepository.js`
- [X] T006 [P] Implementar persistência base de thread ativa em `fun/db/funThreadContextRepository.js`
- [X] T007 [P] Implementar persistência base de identidade da persona por grupo em `fun/db/funPersonaIdentityRepository.js`
- [X] T008 Criar contratos de tipos e resultados do pacote de contexto em `fun/services/personaContextService.js`
- [X] T009 Ajustar wiring de factories/DI para novos repositórios e serviços em `fun/index.js`
- [X] T010 Criar fixture e helpers de banco isolado para memória e thread em `tests/helpers/funPersonaMemoryTestHarness.js`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Responder com contexto certo (Priority: P1) 🎯 MVP

**Goal**: Fazer a persona responder usando a thread correta, com prioridade para reply e contexto relevante da conversa atual.

**Independent Test**: Simular menções diretas e replies em conversas paralelas no mesmo grupo e verificar que a persona seleciona a thread correta, não mistura assuntos e mantém fallback seguro quando faltar contexto útil.

### Tests for User Story 1 ⚠️

- [X] T011 [P] [US1] Criar testes unitários de resolução e expiração de thread em `tests/fun-thread-context.test.js`
- [X] T012 [P] [US1] Criar testes unitários de ranking e seleção de memórias por thread em `tests/fun-memory-retrieval.test.js`
- [X] T013 [P] [US1] Criar testes de integração de continuidade por reply no pipeline em `tests/fun-persona-reply-continuity.test.js`
- [X] T014 [P] [US1] Criar testes de contexto agregado pré-resposta em `tests/fun-persona-context.test.js`

### Implementation for User Story 1

- [X] T015 [P] [US1] Implementar resolução de thread por reply e fallback por recência em `fun/services/threadContextService.js`
- [X] T016 [P] [US1] Implementar retrieval e ranking de contexto por participantes, reply e tema em `fun/services/memoryRetrievalService.js`
- [X] T017 [US1] Implementar montagem do pacote de contexto pré-resposta em `fun/services/personaContextService.js`
- [X] T018 [US1] Integrar `threadContextService` e `personaContextService` em `fun/pipeline/onIncomingMessage.js`
- [X] T019 [US1] Adaptar `personaService` para consumir `responseContextPack` sem quebrar triggers e fallback em `fun/services/personaService.js`
- [X] T020 [US1] Ajustar coleta de `quotedMessageId` e demais sinais de reply em `fun/runtime.js`
- [X] T021 [US1] Validar wiring fim-a-fim da feature no módulo em `tests/fun-persona-module-wiring.test.js`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Lembrar fatos úteis sem inventar (Priority: P1)

**Goal**: Fazer a persona persistir e reutilizar fatos úteis com distinção clara entre explícito, corroborado e inferido, evitando alucinação social.

**Independent Test**: Alimentar o sistema com fatos explícitos, repetições corroboradoras, ambiguidades e contradições; verificar que o contexto final promove apenas fatos confiáveis e não afirma inferências fracas como verdade.

### Tests for User Story 2 ⚠️

- [X] T022 [P] [US2] Criar testes unitários de ingestão e classificação de memória em `tests/fun-memory-ingestion.test.js`
- [X] T023 [P] [US2] Criar testes de fatos explícitos vs inferidos vs corroborados em `tests/fun-persona-confirmed-vs-inferred.test.js`
- [X] T024 [P] [US2] Criar testes de ranking e anti-leak por grupo em `tests/fun-persona-memory-ranking.test.js`
- [X] T025 [P] [US2] Criar testes de supressão de memórias sensíveis e stale em `tests/fun-memory-retrieval.test.js`

### Implementation for User Story 2

- [X] T026 [P] [US2] Implementar ingestão de memórias explícitas, inferidas e corroboradas em `fun/services/memoryIngestionService.js`
- [X] T027 [P] [US2] Implementar decay, expiração e supressão de memórias em `fun/services/memoryDecayService.js`
- [X] T028 [US2] Estender `fun/db/funConversationMemoryRepository.js` com operações de reinforce, expire, suppress e busca rankeável
- [X] T029 [US2] Integrar observação passiva e persistência de memória ao pipeline em `fun/pipeline/onIncomingMessage.js`
- [X] T030 [US2] Ajustar `personaContextService` para separar `confirmedFacts` e `inferredSignals` em `fun/services/personaContextService.js`
- [X] T031 [US2] Ajustar `personaService` para nunca tratar inferência fraca como fato categórico em `fun/services/personaService.js`
- [X] T032 [US2] Adicionar diagnósticos observáveis de seleção, descarte e bloqueio em `fun/services/personaContextService.js` e `fun/services/memoryRetrievalService.js`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Manter uma identidade consistente por grupo (Priority: P2)

**Goal**: Fazer a persona manter estilo consistente por grupo, aproveitando lore local sem misturar tom de grupos diferentes nem usar memória sensível como personalização.

**Independent Test**: Executar cenários equivalentes em dois grupos com climas sociais distintos e verificar que o bot adapta o tom por grupo, mantém coerência local e evita vazamento de identidade ou fatos entre escopos.

### Tests for User Story 3 ⚠️

- [X] T033 [P] [US3] Criar testes unitários de identidade por grupo e sinais sociais em `tests/fun-social-memory.test.js`
- [X] T034 [P] [US3] Criar testes de comportamento da persona por grupo em `tests/fun-persona-identity-group.test.js`
- [X] T035 [P] [US3] Criar testes de anti-leak de identidade e memória entre grupos em `tests/fun-persona-memory-ranking.test.js`

### Implementation for User Story 3

- [X] T036 [P] [US3] Implementar consolidação de sinais sociais do grupo em `fun/services/socialMemoryService.js`
- [X] T037 [P] [US3] Implementar identidade persistente da persona por grupo em `fun/services/personaIdentityService.js`
- [X] T038 [US3] Estender `fun/db/funPersonaIdentityRepository.js` para leitura e atualização da identidade por `scope_key`
- [X] T039 [US3] Integrar identidade por grupo ao pacote de contexto em `fun/services/personaContextService.js`
- [X] T040 [US3] Ajustar `personaService` para aplicar estilo por grupo preservando limites de segurança em `fun/services/personaService.js`
- [X] T041 [US3] Integrar refresh de sinais sociais e identidade ao pipeline em `fun/pipeline/onIncomingMessage.js`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Fechamentos transversais, observabilidade, documentação e validação final

- [X] T042 [P] Adicionar métricas e logs estruturados da feature em `fun/services/personaContextService.js`, `fun/services/memoryIngestionService.js` e `fun/services/memoryRetrievalService.js`
- [X] T043 Ajustar compatibilidade com serviços existentes de perfil, lore e persona em `fun/services/profileService.js`, `fun/services/groupMemoryService.js` e `fun/services/personaService.js`
- [X] T044 Atualizar documentação funcional da persona em `fun/README.md`
- [X] T045 Executar validação dos cenários descritos em `specs/002-persona-memory-intelligence/quickstart.md`
- [X] T046 Rodar suíte de testes da feature e revisar regressões em `tests/fun-*.test.js`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - **US1** é o MVP e deve vir primeiro
  - **US2** depende da camada de contexto criada em US1, mas continua testável de forma independente
  - **US3** depende da base de memória e contexto criada em US1/US2
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Pode começar após a fase Foundational - sem dependência de outras histórias
- **User Story 2 (P1)**: Depende da camada de contexto e thread criada em US1
- **User Story 3 (P2)**: Depende da base de memória e contexto já estabelecida em US1/US2

### Within Each User Story

- Testes devem ser escritos antes ou junto da implementação correspondente e precisam validar comportamento determinístico
- Repositórios e estruturas de dados antes dos serviços que os consomem
- Serviços antes da integração em pipeline
- Integração em pipeline antes da validação comportamental de ponta a ponta

### Parallel Opportunities

- **Phase 2**: T005, T006 e T007 podem rodar em paralelo
- **US1**: T011, T012, T013 e T014 podem rodar em paralelo; T015 e T016 podem rodar em paralelo
- **US2**: T022, T023, T024 e T025 podem rodar em paralelo; T026 e T027 podem rodar em paralelo
- **US3**: T033, T034 e T035 podem rodar em paralelo; T036 e T037 podem rodar em paralelo
- **Polish**: T042 e T044 podem rodar em paralelo

---

## Parallel Example: User Story 1

```bash
# Testes paralelos de US1
Task: "Criar testes unitários de resolução e expiração de thread em tests/fun-thread-context.test.js"
Task: "Criar testes unitários de ranking e seleção de memórias por thread em tests/fun-memory-retrieval.test.js"
Task: "Criar testes de integração de continuidade por reply no pipeline em tests/fun-persona-reply-continuity.test.js"
Task: "Criar testes de contexto agregado pré-resposta em tests/fun-persona-context.test.js"

# Implementações paralelas de base em US1
Task: "Implementar resolução de thread por reply e fallback por recência em fun/services/threadContextService.js"
Task: "Implementar retrieval e ranking de contexto por participantes, reply e tema em fun/services/memoryRetrievalService.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Completar Phase 1: Setup
2. Completar Phase 2: Foundational
3. Completar Phase 3: User Story 1
4. **STOP and VALIDATE**: validar continuidade por reply, anti-mistura de thread e fallback seguro

### Incremental Delivery

1. Setup + Foundational
2. US1 → validar thread e contexto correto
3. US2 → validar memória confiável sem alucinação
4. US3 → validar identidade consistente por grupo
5. Polish final → métricas, docs e regressão

### Parallel Team Strategy

1. Time fecha Setup + Foundational junto
2. Depois:
   - Dev A: thread/contexto (US1)
   - Dev B: ingestão/ranking/decay (US2)
   - Dev C: identidade social por grupo (US3, após base mínima pronta)

---

## Notes

- [P] tasks = arquivos diferentes, sem dependência direta entre tarefas incompletas
- [US1]/[US2]/[US3] garantem rastreabilidade até as histórias da spec
- Cada história deve continuar validável de forma independente
- A suíte deve permanecer determinística, com banco isolado e sem dependência de rede para testes
- O escopo deve permanecer contido no módulo `fun/`, sem quebrar fallback, trigger atual e isolamento por `scope_key`

---

## Phase 7: Convergence

- [X] T047 Completar ingestão e classificação de memórias episódicas, sociais e inferidas/corroboradas com testes determinísticos em `fun/services/memoryIngestionService.js` e `tests/fun-memory-ingestion.test.js` per FR-001, FR-005 (partial)
- [X] T048 Implementar reconciliação determinística de memórias contraditórias e rebaixamento de fatos obsoletos, com testes de precedência temporal e evidencial em `fun/services/memoryDecayService.js`, `fun/db/funConversationMemoryRepository.js` e `tests/fun-persona-confirmed-vs-inferred.test.js` per FR-011, Edge Cases (partial)
- [X] T049 Derivar e persistir sinais sociais e identidade realmente distintos por grupo, preservando isolamento, com testes em `fun/services/socialMemoryService.js`, `fun/services/personaIdentityService.js` e `tests/fun-persona-identity-group.test.js` per FR-009, US3/AC1, US3/AC2 (partial)
- [X] T050 Implementar métricas agregadas e cenários de aceitação mensuráveis para continuidade, reutilização segura, anti-leak e contexto paralelo em `fun/services/personaContextService.js`, `fun/services/memoryRetrievalService.js` e `tests/fun-persona-convergence.test.js` per FR-018, SC-001, SC-002, SC-003, SC-004, SC-006 (partial)
