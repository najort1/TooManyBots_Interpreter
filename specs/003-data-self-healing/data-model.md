# Data Model: Auto-Aprimoramento de Dados Guiado por LLM

**Branch**: `003-data-self-healing` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

Duas tabelas novas no schema do módulo (`${ANALYTICS_SCHEMA}`, padrão `CREATE TABLE IF NOT EXISTS` + índices idempotentes). Bump `FUN_SCHEMA_VERSION` para `'29'`.

## T1. `fun_evidence_log` — Evidência de mensagens observadas

Fonte verificável para validar fatos e memórias (User Story 1/2, FR-017). Texto normalizado, sem mídia, janela de retenção configurável.

| Campo | Tipo | Regras |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | — |
| scope_key | TEXT NOT NULL | Isolamento por grupo (`@g.us`) |
| message_id | TEXT NOT NULL | ID da mensagem (dedup por mensagem) |
| author_jid | TEXT NOT NULL | Identidade canônica `@s.whatsapp.net` |
| text_normalized | TEXT NOT NULL | Texto normalizado/truncado (~400 chars), sem comandos |
| text_hash | TEXT NOT NULL | Hash determinístico (SHA-256) para busca exata |
| created_at | INTEGER NOT NULL | Timestamp (epoch ms) |
| expires_at | INTEGER NOT NULL | `created_at + retentionDays` (GC) |

**Índices**:
- `idx_evl_scope_hash` — (scope_key, text_hash) — busca de evidência por texto
- `idx_evl_author_scope` — (scope_key, author_jid) — busca por autor
- `idx_evl_expires` — (expires_at) — GC de retenção

**Constraints/relacionamentos**:
- `message_id` unique dentro de `scope_key` (evita duplicar evidência da mesma mensagem).
- Nunca armazena mídia, link cru ou conteúdo sensível (FR-014).
- Vinculada a fatos por referência (busca por hash/texto ou autor+janela de tempo), não por FK — fatos podem ser pré-existentes ao log.

## T2. `fun_self_heal_audit` — Trilha de auditoria + achados

Registro imutável de cada varredura e de cada ação (FR-006/FR-010). Cobre achados da LLM (inclui pendências de revisão de alto risco) e ações aplicadas/simuladas.

| Campo | Tipo | Regras |
|---|---|---|
| id | INTEGER PRIMARY KEY AUTOINCREMENT | — |
| run_id | TEXT NOT NULL | UUID da varredura (agrupa relatório) |
| scope_key | TEXT NOT NULL | Isolamento por grupo |
| domain | TEXT NOT NULL | Domínio auditado (`memory_lore`, `conversation_memory`, `economy`, `profile`, ...) |
| target_table | TEXT NOT NULL | Tabela alvo (ex.: `fun_group_memories`) |
| target_id | INTEGER NOT NULL | ID do item auditado |
| action | TEXT NOT NULL | Ação proposta (`fix_author`, `fix_text`, `merge_duplicates`, `promote_confidence`, `downgrade`, `suppress`, `delete`, `flag_unverifiable`, `integrity_fix`, `report`) |
| risk_level | TEXT NOT NULL | `low` / `high` (classificador determinístico — D3) |
| status | TEXT NOT NULL | `applied` / `pending_review` / `rejected` / `simulated` / `error` / `skipped` |
| before_json | TEXT | Estado antes (JSON) — nulo se nenhuma escrita |
| after_json | TEXT | Estado depois (JSON) — nulo se não aplicada |
| reason | TEXT NOT NULL | Motivo da ação (derivado da evidência + LLM) |
| evidence_ref | TEXT | Referência à evidência (ex.: `fun_evidence_log#id` ou hash) |
| llm_confidence | INTEGER | 0–100 da LLM (nunca usada para validar — apenas registro) |
| mode | TEXT NOT NULL | `live` / `dry_run` |
| created_at | INTEGER NOT NULL | Timestamp (epoch ms) |
| decided_at | INTEGER | Preenchido quando `applied`/`rejected`/`reviewed` |
| decided_by | TEXT | `system` ou `admin:<jid>` |

**Índices**:
- `idx_sha_run_scope` — (run_id, scope_key) — relatório por varredura
- `idx_sha_status` — (status) — pendências de revisão
- `idx_sha_domain` — (domain) — cobertura por domínio

**Constraints/relacionamentos**:
- `status='pending_review'` → exige `decided_by`/`decided_at` preenchidos quando revisado (não na inserção).
- Nenhum registro é atualizado no meio do caminho: cada decisão nova vira linha nova com `run_id`/`mode` próprios? **Não** — a linha do achado é criada no momento da varredura com o `status` inicial (`applied` ou `pending_review` ou `simulated`); a revisão do admin apenas atualiza `status` → `applied`/`rejected` + `decided_*`. Manter a linha original preserva o achado (imutabilidade do registro do achado), com campos de decisão à parte.

## Regras de negócio associadas (referência)

- **Captura de evidência**: no `groupMemoryService.observeMessage` (dependência opcional `evidenceRepository`), apenas mensagens que já passam nos filtros existentes (não-comando, não-sensível, tamanho mínimo) geram linha em `fun_evidence_log` (FR-017, D2).
- **Busca de evidência (memória/lore)**: para validar um fato, busca-se `fun_evidence_log` por `scope_key` + autor + similaridade de texto (Jaccard/keyword — utilitários de `groupMemoryService` já existem) dentro da janela de tempo do fato.
- **Aplicação de correções**: via repositórios de domínio existentes (ex.: `funMemoryRepository` para lore), nunca SQL direto da LLM (FR-005). Correções econômicas são alto risco → `pending_review`.
- **GC de retenção**: na varredura e no startup, `DELETE FROM fun_evidence_log WHERE expires_at < now`.

## Mudanças em tabelas existentes

- **`fun_group_memories`** (lore): sem mudança estrutural. Correções de autoria/texto usam `UPDATE` via `funMemoryRepository`; novos estados ("verificado"/"não verificável") são representados via coluna `score`/flag existente OU campo `evidence_status` — **decisão do plano técnico**: adicionar coluna `evidence_status TEXT` (`verified` / `unverified` / `pending`) na tabela de lore para suportar FR-007 sem ambiguidade. (Bump de schema já cobre.)
