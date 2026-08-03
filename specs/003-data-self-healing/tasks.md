# Tasks: Auto-Aprimoramento de Dados Guiado por LLM

**Input**: Design documents from `/specs/003-data-self-healing/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Testes incluídos — a spec exige estratégia de testes determinísticos (sem rede LLM) e o quickstart.md define cenários C1–C8 ponta-a-ponta. Testes são escritos PRIMEIRO e devem falhar antes da implementação.

**Organization**: Tasks agrupadas por user story para permitir implementação e teste independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência)
- **[Story]**: US1–US4 (mapeiam as user stories do spec.md)
- Caminhos de arquivo exatos em todas as descrições

## Path Conventions

- Módulo fun: `fun/` (constants, config, schema, db/, services/, llm/, dashboard/, index.js)
- Dashboard Next.js: `fun_dashboard/src/app/`
- Testes: `tests/fun-self-healing.test.js`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Infraestrutura de teste determinística para a feature

- [X] T001 Create harness de teste em `tests/fun-self-healing.test.js` (initDb + DB temporário, geradores uniqueJid/uniqueGroup, factory de stub LLM que devolve findings de fixture — sem rede, `FUN_DISABLE_LIVE_LLM=1`)

**Checkpoint**: Harness pronto — todas as fases seguintes reutilizam os helpers.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Infraestrutura que deve existir ANTES de qualquer user story: config, schema, repos, captura de evidência e params de LLM.

**⚠️ CRITICAL**: Nenhuma user story pode começar antes desta fase

- [X] T002 [P] Add defaults `selfHeal*` em `DEFAULT_FUN_CONFIG` em `fun/constants.js` (selfHealEnabled=true, selfHealDryRun=true, selfHealIntervalMs=600000, selfHealEvidenceRetentionDays=60, selfHealMaxItemsPerRun=50, selfHealMaxCallsPerRun=10) + bump `FUN_SCHEMA_VERSION` para `'29'`
- [X] T003 [P] Add normalização/merge das flags `selfHeal*` em `fun/config.js` (`normalizeFunConfig`), incluindo ranges válidos (intervalMs>0, retentionDays 1–365, maxItems/maxCalls 1–500)
- [X] T004 Add no `fun/schema.js` (padrão `${ANALYTICS_SCHEMA}`, idempotente): tabela `fun_evidence_log` (id, scope_key, message_id, author_jid, text_normalized, text_hash, created_at, expires_at + índices scope/hash/autor/expires, unique message_id por scope), tabela `fun_self_heal_audit` (id, run_id, scope_key, domain, target_table, target_id, action, risk_level, status, before_json, after_json, reason, evidence_ref, llm_confidence, mode, created_at, decided_at, decided_by + índices run/status/domain) e coluna `evidence_status TEXT` em `fun_group_memories` (valores `verified`/`unverified`/`pending`, padrão `pending`) — ver data-model.md T1/T2
- [X] T005 [P] Create `fun/db/funEvidenceRepository.js` (`createFunEvidenceRepository({ getDatabase = getDb })`: insertEvidence, findByHash, findByAuthorAndText (scope+autor+janela), countByScope, gcExpired) — ver data-model.md T1
- [X] T006 [P] Create `fun/db/funSelfHealRepository.js` (`createFunSelfHealRepository({ getDatabase = getDb })`: insertAudit, listRuns (agrupado por run_id), listAudit (filtros run/scope/status/domain/action), reviewFinding, getSummary) — ver data-model.md T2
- [X] T007 [P] Add hook de captura de evidência em `observeMessage` em `fun/services/groupMemoryService.js`: dependência opcional `evidenceRepository`; mensagens que já passam nos filtros existentes (não-comando, não-sensível, tamanho mínimo) geram linha em `fun_evidence_log` (texto truncado ~400 chars, hash SHA-256, `expires_at = now + retentionDays`) — ver research.md D2
- [X] T008 [P] Add params da tarefa `selfheal` em `fun/llm/zenTaskParams.js` (JSON estrito com tools de leitura `list_facts`/`find_evidence`/`get_stats`, saída `{ domain, findings }` conforme contracts/llm-tool-contract.md)
- [X] T009 Wire `evidenceRepository` e `selfHealRepository` no `createFunModule` em `fun/index.js` (padrão `deps.X || createX({ getDatabase })`, ver linhas ~281/301) — depende T005/T006

**Checkpoint**: Foundation pronta — user stories podem começar em paralelo

---

## Phase 3: User Story 1 - Auditoria e correção de fatos da memória do grupo (Priority: P1) 🎯 MVP

**Goal**: Validar e corrigir autonomamente os fatos/lore do grupo contra evidência persistida: autoria certa, texto fiel, fatos sem evidência marcados como não verificáveis — tudo registrado na trilha de auditoria.

**Independent Test**: Testes de serviço em `tests/fun-self-healing.test.js` com LLM stubada: (1) evidência é capturada em `observeMessage`; (2) dry-run não altera nada; (3) `fix_author` com evidência aplica sozinho e corrige a autoria; (4) fato sem evidência vira `unverified` sem exclusão; (5) LLM com JSON inválido não corrompe dados; (6) GC remove evidência expirada.

### Tests for User Story 1 (escrever PRIMEIRO — devem falhar) ⚠️

- [X] T010 [US1] Add suíte US1 em `tests/fun-self-healing.test.js` (cenários C1–C5, C8 do quickstart.md: captura de evidência, validação de schema de findings, classificador de risco, dry-run sem escrita, fix_author aplicado, flag_unverifiable, falha de LLM, GC de retenção)

### Implementation for User Story 1

- [X] T011 [P] [US1] Add métodos de atualização de lore em `fun/db/funMemoryRepository.js` (updateFactAuthor, updateFactSummary, setFactEvidenceStatus) — atualização via repo de domínio, nunca SQL da LLM (FR-005)
- [X] T012 [P] [US1] Create `fun/services/selfHealingValidators.js`: `validateFindingsPayload` (schema estrito: domain/action whitelists, confidence 0–100, targetId válido no scope) + classificador de risco determinístico (low: fix_author/fix_text/merge_duplicates/flag_unverifiable; high: delete/downgrade/suppress/integrity_fix) + regras `fix_author` (suggestedAuthorJid = evidência referenciada, similaridade ≥ limiar) e `fix_text` — conforme contracts/llm-tool-contract.md seção 3
- [X] T013 [US1] Create `fun/services/selfHealingService.js` (`createSelfHealingService({ selfHealRepository, evidenceRepository, memoryRepository, getLogger, generateZen, getConfig })`: runSweep por scope (orçamento maxItems/maxCalls, quiet hours, GC de evidência), tool registry read-only (list_facts/find_evidence/get_stats via funEvidenceRepository + funMemoryRepository), busca de evidência em lote, apply pipeline (validar → classificar risco → dry_run: `simulated` | low: `applied` via repos | high: `pending_review`) com `run_id` e trilha completa (before/after/evidence_ref/mode) — depende T011/T012/T005/T006/T009
- [X] T014 [US1] Wire `selfHealingService` no `createFunModule` (deps injetáveis para testes) + bloco de varredura no `tickWorldEvents` em `fun/index.js` (linha ~551): roda se `selfHealEnabled`, respeita `selfHealIntervalMs` (throttle por último run), quiet hours e `worldAutonomous`; falha nunca interrompe o tick (FR-009) — depende T013

**Checkpoint**: US1 funcional e testável de forma independente (MVP)

---

## Phase 4: User Story 2 - Validação de memórias de conversa (Priority: P2)

**Goal**: Promover/rebaixar/suprimir confiança de memórias de conversa conforme evidência de repetição/contradição, com deduplicação — alto risco exige revisão do admin.

**Independent Test**: Testes em `tests/fun-self-healing.test.js` com LLM stubada: memória `inferred` com múltiplas ocorrências é promovida; memória contradita é rebaixada/suprimida e cai em `pending_review`; duplicatas são consolidadas.

### Tests for User Story 2 (escrever PRIMEIRO — devem falhar) ⚠️

- [X] T015 [US2] Add suíte US2 em `tests/fun-self-healing.test.js` (promote_confidence aplicado, downgrade/suppress → `pending_review` sem escrita até revisão, merge_duplicates consolidando, sensibilidade respeitada — FR-014)

### Implementation for User Story 2

- [X] T016 [P] [US2] Add métodos em `fun/db/funConversationMemoryRepository.js` (promoteConfidence, downgradeConfidence, suppressMemory, mergeDuplicateMemories) — ver data-model.md/contracts
- [X] T017 [US2] Estender `fun/services/selfHealingValidators.js` com regras do domínio `conversation_memory` (promote/downgrade/suppress/merge_duplicates + sensibilidade; downgrade/suppress = alto risco)
- [X] T018 [US2] Estender `fun/services/selfHealingService.js` com tool `list_memories` (funConversationMemoryRepository) e apply de conversa, reusando similaridade existente (jaccard/tokenSet de `fun/services/groupMemoryService.js`) para dedup — depende T016/T017

**Checkpoint**: US1 E US2 funcionando de forma independente

---

## Phase 5: User Story 3 - Verificação de integridade socioeconômica e perfis (Priority: P2)

**Goal**: Detectar anomalias estruturais (saldo negativo, cap estourado, preço fora do range, perfil órfão) e coerência entre dados derivados; correção estrutural é alto risco → revisão do admin; divergência sem escrita → `report`.

**Independent Test**: Testes em `tests/fun-self-healing.test.js` com dados inválidos injetados (saldo negativo, ticker incoerente com jornal): anomalia detectada e registrada; `integrity_fix` fica `pending_review`; `report` não altera a fonte de verdade do motor econômico.

### Tests for User Story 3 (escrever PRIMEIRO — devem falhar) ⚠️

- [X] T019 [US3] Add suíte US3 em `tests/fun-self-healing.test.js` (invariante de saldo/ledger, range de preço de mercado, perfil órfão/duplicado, report sem escrita — US3 cenários 1–3 do spec.md)

### Implementation for User Story 3

- [X] T020 [P] [US3] Add helpers de leitura de invariantes em `fun/db/funStatsRepository.js` e `fun/db/funMarketRepository.js` (saldo por scope, min/max de preço e caps, órfãos de perfil) — somente leitura; correções econômicas sempre alto risco (research.md D3)
- [X] T021 [US3] Estender `fun/services/selfHealingValidators.js` com domínio `economy`/`profile` (integrity_fix/report; qualquer escrita em ledger/mercado = alto risco → `pending_review`)
- [X] T022 [US3] Estender `fun/services/selfHealingService.js` com domínios economy/profile (varredura de anomalias em lote, `report` de divergências derivadas como jornal↔ticker, apply de integrity_fix somente após revisão via repos de domínio) — depende T020/T021

**Checkpoint**: Todas as user stories de sistema funcionando de forma independente

---

## Phase 6: User Story 4 - Observabilidade e controle administrativo (Priority: P3)

**Goal**: Painel admin com relatório por varredura, trilha de auditoria, modo simulação e revisão de pendências — controle do sistema autônomo (User Story 4, FR-010/FR-006).

**Independent Test**: Testes de contrato dos endpoints admin em `tests/fun-self-healing.test.js`: dry-run via API não altera dados; revisão de `pending_review` grava decisão; revisão duplicada é rejeitada; endpoints exigem admin.

### Tests for User Story 4 (escrever PRIMEIRO — devem falhar) ⚠️

- [X] T023 [US4] Add suíte de contrato da API admin em `tests/fun-self-healing.test.js` (config GET/POST, run manual com dry_run, runs, audit, review apply/reject + idempotência, summary — conforme contracts/dashboard-api.md; C2/C6 do quickstart.md)

### Implementation for User Story 4

- [X] T024 [P] [US4] Add endpoints admin em `fun/dashboard/server.js` (GET/POST `/api/fun/selfheal/config`, POST `/api/fun/selfheal/run` com domain/dryRun/scopeKey + quiet hours, GET `/api/fun/selfheal/runs`, GET `/api/fun/selfheal/audit` com `includeBeforeAfter`, POST `/api/fun/selfheal/review` com idempotência `already-decided`, GET `/api/fun/selfheal/summary`) — autenticados no padrão admin existente, conforme contracts/dashboard-api.md
- [X] T025 [US4] Add página de observabilidade em `fun_dashboard/src/app/` (lista de runs, trilha de auditoria, summary por domínio, toggle dry-run/on-off, revisão de pendências com note) consumindo os endpoints de T024 — depende T024

**Checkpoint**: Sistema autônomo com controle e visibilidade completos

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentação, validação final e garantia de zero regressões

- [X] T026 [P] Atualizar `fun/docs/FUN-P1-P2-ROADMAP.md` com a seção de auto-aprimoramento (fases de cobertura: memória/lore → conversa → economia/perfis, conforme FR-015)
- [ ] T027 Run `npm run test` (zero regressões — SC-004, incluindo invariantes de economia e memória existentes) + validar cenários do `quickstart.md` (C1–C8) ponta-a-ponta

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sem dependências — inicia imediatamente
- **Foundational (Phase 2)**: Depende do Setup — BLOQUEIA todas as user stories
- **User Stories (Phase 3+)**: Dependem da Foundational
- **Polish (Phase 7)**: Depende de todas as user stories desejadas

### User Story Dependencies

- **US1 (P1)**: Inicia após Foundational — sem dependência de outras stories
- **US2 (P2)**: Inicia após Foundational; estende `selfHealingService.js`/`selfHealingValidators.js` de US1 (roda em paralelo com US3, sequencial após US1 se equipe única)
- **US3 (P2)**: Inicia após Foundational; estende os mesmos arquivos de serviço (roda em paralelo com US2)
- **US4 (P3)**: Inicia após Foundational + US1 (endpoints chamam `selfHealingService`)

### Within Each User Story

- Testes PRIMEIRO (falham antes da implementação)
- Repos antes de validators, validators antes do service, service antes do wiring/integração
- Story completa antes de avançar para a próxima prioridade

### Parallel Opportunities

- **Foundational**: T002, T003, T004, T005, T006, T007, T008 em paralelo ([P]); T009 após T005/T006 (importa os repos)
- **US1**: T010 (testes) → T011 e T012 em paralelo ([P]) → T013 → T014
- **US2**: T015 (testes) → T016 ([P]) → T017 → T018 (em paralelo com US3 após US1)
- **US3**: T019 (testes) → T020 ([P]) → T021 → T022
- **US4**: T023 (testes) → T024 ([P]) → T025

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (falham antes da implementação):
Task: "Add suíte US1 em tests/fun-self-healing.test.js (T010)"

# Launch independent implementation together:
Task: "Add métodos de lore em fun/db/funMemoryRepository.js (T011)"
Task: "Create fun/services/selfHealingValidators.js (T012)"

# Sequential after T011/T012:
Task: "Create fun/services/selfHealingService.js (T013)"
Task: "Wire selfHealingService + tickWorldEvents em fun/index.js (T014)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — bloqueia todas as stories)
3. Complete Phase 3: User Story 1
4. **STOP e VALIDE**: rodar a suíte US1 de forma independente + validar dry-run
5. Deploy/demo se estiver pronto

### Incremental Delivery

1. Setup + Foundational → foundation pronta
2. US1 → teste independente → deploy/demo (**MVP**)
3. US2 → teste independente → deploy/demo
4. US3 → teste independente → deploy/demo
5. US4 (observabilidade) → deploy/demo
6. Cada story agrega valor sem quebrar as anteriores

### Parallel Team Strategy

1. Time completa Setup + Foundational juntos
2. Com Foundational pronta:
   - Dev A: US1 (MVP)
   - Após US1: Dev B: US2, Dev C: US3
   - Dev D: US4 (após US1)
3. Stories integram de forma independente

---

## Notes

- [P] tasks = arquivos diferentes, sem dependência
- [Story] label mapeia a task para a user story (rastreabilidade)
- Cada user story é completável e testável de forma independente
- Testes devem falhar antes da implementação
- Commit após cada task ou grupo lógico (Conventional Commits, escopo `fun`)
- Parar em qualquer checkpoint para validar a story independentemente
- Evitar: tasks vagas, conflito de arquivo, dependências entre stories que quebrem a independência

---

## Phase 8: Convergence

**Purpose**: Trabalho remanescente detectado pelo `/speckit-converge` — a feature está 0% implementada no codebase (nenhum arquivo `selfHeal*`, schema `'28'`, sem testes/endpoints). Cada finding mapeia uma obrigação do spec/plan ainda não construída. CRITICAL primeiro.

- [X] T028 Implementar orquestrador de varredura autônoma de memória/lore com autonomia de guardrails (`fun/services/selfHealingService.js` + `fun/services/selfHealingValidators.js`) per FR-001, FR-002, FR-016 (missing)
- [X] T029 Implementar persistência e captura de evidência (`fun/db/funEvidenceRepository.js` + hook em `observeMessage` em `fun/services/groupMemoryService.js` + tabela `fun_evidence_log`) per FR-017, FR-007, US1/AC1 (missing)
- [X] T030 Implementar trilha de auditoria imutável (`fun/db/funSelfHealRepository.js` + tabela `fun_self_heal_audit` com antes/depois/motivo/evidência) per FR-006, SC-002 (missing)
- [X] T031 Implementar contrato de findings e validação determinística (tarefa `selfheal` em `fun/llm/zenTaskParams.js` + `validateFindingsPayload` conforme contracts/llm-tool-contract.md) per FR-004, FR-005, plan D5 (missing)
- [X] T032 Implementar acesso de leitura via tool-calling (registry de capabilities `list_facts`/`find_evidence`/`get_stats` no `selfHealingService`) per FR-003, plan D1 (missing)
- [X] T033 Implementar agendamento, orçamento, quiet hours e falha segura (flags `selfHeal*` em `fun/constants.js`/`fun/config.js` + bloco no `tickWorldEvents` em `fun/index.js` com throttle, caps e skip em falha de LLM) per FR-008, FR-009, plan D4/D6/D8 (missing)
- [X] T034 Implementar correções de lore com evidência (`updateFactAuthor`/`updateFactSummary`/`setFactEvidenceStatus` em `fun/db/funMemoryRepository.js`; `fix_author`/`fix_text`/`flag_unverifiable` no apply pipeline) per US1/AC2–AC4, FR-012 (missing)
- [X] T035 Implementar validação de memórias de conversa (`promoteConfidence`/`downgradeConfidence`/`suppressMemory`/`mergeDuplicateMemories` em `fun/db/funConversationMemoryRepository.js` + domínio `conversation_memory` no service) per US2, FR-011, FR-013 (missing)
- [X] T036 Implementar integridade econômica/perfis (helpers de invariantes em `fun/db/funStatsRepository.js`/`fun/db/funMarketRepository.js` + domínios `economy`/`profile` com `integrity_fix`/`report`) per US3, FR-015 (missing)
- [X] T037 Implementar API admin e UI de observabilidade (endpoints `/api/fun/selfheal/*` em `fun/dashboard/server.js` + página em `fun_dashboard/src/app/` com runs/audit/summary/dry-run/revisão) per US4, FR-010 (missing)
- [X] T038 Implementar testes determinísticos do self-healing (`tests/fun-self-healing.test.js` cobrindo C1–C8 do quickstart.md, LLM stubada, sem rede) per plan D7, quickstart C1–C8 (missing)
- [X] T039 Atualizar `fun/docs/FUN-P1-P2-ROADMAP.md` com a seção de auto-aprimoramento e fases de cobertura de domínios per FR-015 (missing)
