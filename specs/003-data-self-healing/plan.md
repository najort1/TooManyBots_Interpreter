# Implementation Plan: Auto-Aprimoramento de Dados Guiado por LLM

**Branch**: `003-data-self-healing` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-data-self-healing/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Sistema autônomo de auto-aprimoramento de dados do módulo fun, guiado por LLM. Periodicamente (via world tick) o sistema varre domínios de dados e valida cada item contra evidência persistida — corrigindo autoria, reparando texto, promovendo/rebaixando confiança e sinalizando inconclusões. A LLM acessa os dados por um registry interno de tool-calling (leitura com schema JSON, cascata Zen `jsonMode`), nunca escreve diretamente: toda correção passa por validadores determinísticos e é classificada por risco (baixo risco aplica sozinho; alto risco vai para revisão do admin). Toda ação fica registrada em trilha de auditoria imutável. A infraestrutura (evidência + auditoria + orquestrador) serve de base para cobrir os demais domínios (memória de conversa, economia, perfis) em fases seguintes.

## Technical Context

**Language/Version**: Node.js (ESM, `import/export`; `node:test` para testes)

**Primary Dependencies**: `better-sqlite3` (persistência síncrona), Express (`fun/dashboard/server.js`), LLM via proxy Zen OpenAI-compatible (`fun/llm/openaiClient.js`) com cascata Zen → template local (`FUN_DISABLE_LIVE_LLM=1` para desligar rede); `baileys` no runtime WhatsApp

**Storage**: SQLite — schema do módulo em `fun/schema.js`, `FUN_SCHEMA_VERSION = '28'` (bump para `'29'`), dados em `data/fun/runtime.db`; repositórios com factory/DI `createFunXxxRepository({ getDatabase = getDb })`

**Testing**: `node:test` em `tests/fun-*.test.js`, `initDb()` + SQLite temporária, `FUN_DISABLE_LIVE_LLM=1`, stubs de LLM via fixtures, geradores de JID/scope únicos

**Target Platform**: Node.js server (Windows dev; processo standalone `npm run fun`); WhatsApp multi-device; dashboard Express + UI `fun_dashboard/` (Next.js)

**Project Type**: módulo standalone dentro de repositório monorepo (bot WhatsApp) + dashboard admin

**Performance Goals**: varredura em background não compete com o world tick nem com a fila de mensagens; orçamento por varredura (máx. de itens auditados e chamadas LLM por domínio); sem bloqueio síncrono prolongado no event loop (lotear leituras/escritas)

**Constraints**: isolamento por `scope_key`; identidade canônica `@s.whatsapp.net`; quiet hours respeitadas; caps de custo centralizados; LLM nunca escreve no banco (apenas propõe); falha de LLM nunca corrompe dados nem trava o processo; schema idempotente e versionado; testes determinísticos sem rede

**Scale/Scope**: v1 = domínio memória/lore do grupo + infraestrutura de evidência/auditoria/orquestrador; fases seguintes cobrem memória de conversa, economia e perfis (FR-015); grupos whitelist (centenas), fatos na casa das dezenas por grupo, evidência com janela de retenção configurável (default 60 dias)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Evaluation

| Gate (Constituição) | Status | Justificativa |
|---|---|---|
| Camadas: constants → schema → repo → service → handler → pipeline → testes → docs | PASS | Novos arquivos seguem exatamente a ordem: `constants.js`/`schema.js` → `db/funEvidenceRepository.js` + `db/funSelfHealRepository.js` → `services/selfHealingService.js` → endpoints admin no `dashboard/server.js` → hook no `pipeline/onIncomingMessage.js` → `tests/fun-self-healing.test.js` → docs |
| Repos só persistência; services regras de negócio; handlers finos | PASS | Evidência e auditoria vivem em repos; orquestração/validação/risco no service; endpoints admin finos |
| Standalone: dados em `data/fun/`, isolamento `scope_key` | PASS | Tabelas novas com `scope_key` obrigatório; varredura roda por scope isolado |
| Economia anti-exploit: movimentação via ledger atômico; IA nunca inventa valores | PASS | Correções de domínio econômico são **alto risco** e exigem revisão do admin; validadores determinísticos; a LLM propõe, nunca aplica valor |
| Cascata LLM Zen → template; falha não quebra comando | PASS | Tarefa `selfheal` na cascata; falha/timeout/JSON inválido → skip com registro, varredura continua (FR-009) |
| Testes determinísticos, sem rede, banco isolado | PASS | Mesmo padrão dos testes existentes: `FUN_DISABLE_LIVE_LLM=1`, fixtures de achados, DB temporário |
| Config centralizada; segredos fora do repo | PASS | Flags `selfHeal*` em `config.js`/`constants.js` (defaults), sem segredo novo |
| Schema versionado, migrações idempotentes | PASS | Bump `FUN_SCHEMA_VERSION` para `'29'`, `CREATE TABLE IF NOT EXISTS` no padrão existente |
| Quiet hours para eventos autônomos | PASS | Varredura não inicia/continua em quiet hours (reuso de `worldQuietHours`) |
| Sem doxxing; dados sensíveis fora do prompt | PASS | Evidência é texto normalizado sem mídia/sensível; FR-014 limita o que entra no prompt |

**Resultado**: Nenhuma violação. Gates aprovados antes da pesquisa e re-avaliados após o design.

*Re-check pós-design (Phase 1):* o data model (duas tabelas com `scope_key` + índices idempotentes), os contratos (tools de leitura exclusivas, findings validados por schema, endpoints admin autenticados) e a pesquisa (captura de evidência via `observeMessage`, correções via repos de domínio, alto risco em `pending_review`, quiet hours, LLM sem rede em testes) mantêm todos os gates PASS. Nenhuma violação nova introduzida.

## Project Structure

### Documentation (this feature)

```text
specs/003-data-self-healing/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── llm-tool-contract.md
│   └── dashboard-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
fun/
├── constants.js                        # + DEFAULT_FUN_CONFIG selfHeal*; FUN_SCHEMA_VERSION -> '29'
├── config.js                           # + normalizeFunConfig selfHeal* (selfHealEnabled, intervalMs, dryRun, budget, retentionDays, risk policy)
├── schema.js                           # + fun_evidence_log, fun_self_heal_audit (idempotente)
├── db/
│   ├── funEvidenceRepository.js        # NOVO: log de evidência (insert/busca por hash e texto/GC retenção)
│   └── funSelfHealRepository.js        # NOVO: trilha de auditoria + achados pendentes (insert/consulta/status)
├── llm/
│   └── zenTaskParams.js                # + tarefa 'selfheal' (params JSON estrito)
├── services/
│   └── selfHealingService.js           # NOVO: orquestrador (sweep, tool registry read-only, validators, risk classifier, apply, dry-run)
├── services/groupMemoryService.js      # + dependência opcional evidenceRepository em observeMessage (captura evidência reusando filtros)
├── dashboard/server.js                 # + endpoints admin: runs, audit, run manual, review, dry-run, toggle (contrato em contracts/dashboard-api.md)
├── index.js                            # + wiring: selfHealingService no tickWorldEvents (intervalo configurável)
├── docs/
│   └── FUN-P1-P2-ROADMAP.md            # + seção do roadmap para auto-aprimoramento
fun_dashboard/
└── src/                                # (Fase 3) página de observabilidade/controle do self-healing
tests/
└── fun-self-healing.test.js            # NOVO: evidência, auditoria, validação determinística, risco, dry-run, invariantes
```

**Structure Decision**: Padrão existente do módulo fun (camadas constants → schema → repo → service → handler/pipeline). O orquestrador vive em `services/selfHealingService.js` com um registry interno de capabilities de leitura (tool-calling) — sem servidor MCP externo (decisão Q2). Evidência é capturada no mesmo ponto onde a memória é observada (`groupMemoryService.observeMessage`) para reusar os filtros já existentes (commands, sensibilidade, mínimo de caracteres) — DRY.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Nenhuma violação de constituição identificada. A complexidade introduzida (registry de tools, camada de validação determinística, classificador de risco) é exigida pelas FRs de segurança (FR-004/FR-005/FR-009/FR-016) e reutiliza padrões existentes do módulo.
