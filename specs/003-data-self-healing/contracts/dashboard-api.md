# Dashboard Admin API: Auto-Aprimoramento

**Branch**: `003-data-self-healing` | **Date**: 2026-08-03 | **Spec**: [spec.md](../spec.md)

Endpoints no `fun/dashboard/server.js` (Express), autenticados no padrão admin existente (cookie/API key). Consumidos pela UI `fun_dashboard/` (página de observabilidade — Fase 3). Cobertura: User Story 4 (FR-010, FR-006, SC-002/SC-007).

## Endpoints

### GET `/api/fun/selfheal/config`

Retorna flags atuais do sistema.

```json
{
  "enabled": true,
  "intervalMs": 600000,
  "dryRun": true,
  "evidenceRetentionDays": 60,
  "maxItemsPerRun": 50,
  "maxCallsPerRun": 10,
  "quietHoursRespected": true
}
```

### POST `/api/fun/selfheal/config`

Atualiza flags (admin). Body parcial; validação de range/normalização via `normalizeFunConfig`.

```json
{ "dryRun": false, "intervalMs": 1200000 }
```

**Resposta**: `{ "ok": true, "config": { ... } }` (config completo atualizado)

### POST `/api/fun/selfheal/run`

Dispara varredura manual (admin). Body opcional:

```json
{ "domain": "memory_lore", "dryRun": true, "scopeKey": "120363...@g.us" }
```

- `domain` ausente → todos os domínios habilitados.
- `dryRun` ausente → respeita config global.
- `scopeKey` ausente → todos os scopes whitelist (em lotes).
- Respeita quiet hours e orçamento; se bloqueado, retorna `{ "ok": false, "reason": "quiet-hours" }`.

**Resposta**: `{ "ok": true, "runId": "uuid", "mode": "dry_run" }`

### GET `/api/fun/selfheal/runs`

Relatório por varredura (User Story 4, cenário 3). Filtros: `?domain=&scope=&from=&to=`.

```json
{
  "runs": [
    {
      "runId": "uuid",
      "domain": "memory_lore",
      "mode": "live",
      "startedAt": 1783000000000,
      "finishedAt": 1783000015000,
      "itemsAudited": 12,
      "applied": 3,
      "pendingReview": 1,
      "rejected": 0,
      "simulated": 0,
      "errors": 0,
      "llmCalls": 2,
      "status": "done"
    }
  ]
}
```

### GET `/api/fun/selfheal/audit`

Trilha de auditoria (FR-006). Filtros: `?runId=&scope=&status=&domain=&action=`. Linhas conforme `fun_self_heal_audit` (data-model T2), sem `before_json`/`after_json` pesados por padrão — `?includeBeforeAfter=true` para inspeção.

```json
{ "entries": [ { "id": 1, "runId": "uuid", "domain": "memory_lore", "targetTable": "fun_group_memories", "targetId": 123, "action": "fix_author", "riskLevel": "low", "status": "applied", "reason": "...", "evidenceRef": "fun_evidence_log#456", "llmConfidence": 98, "mode": "live", "createdAt": 1783000000000, "decidedAt": 1783000010000, "decidedBy": "system" } ] }
```

### POST `/api/fun/selfheal/review`

Decisão do admin sobre achado de alto risco (`pending_review`). Body:

```json
{ "findingId": 42, "decision": "apply", "note": "evidência confirma" }
```

`decision` ∈ `apply` | `reject`. Grava `status` final + `decided_at` + `decided_by: admin:<jid>` (FR-016, Q3).

**Resposta**: `{ "ok": true, "entry": { ... } }` (linha atualizada)

### GET `/api/fun/selfheal/summary`

Métricas para o painel (User Story 4, cenário 3):

```json
{
  "totals": { "runs": 10, "applied": 21, "pendingReview": 4, "rejected": 2, "simulated": 0, "errors": 1 },
  "byDomain": { "memory_lore": { "applied": 18, "pendingReview": 2 } },
  "evidence": { "rows": 480, "oldest": 1782000000000, "retentionDays": 60 }
}
```

## Regras de segurança

- Todos os endpoints exigem admin (mesmo mecanismo dos endpoints existentes do dashboard fun).
- Nenhum endpoint expõe `before_json`/`after_json` com conteúdo sensível fora de `includeBeforeAfter` explícito (FR-014).
- `POST /run` e `POST /review` são idempotentes-por-execução: `review` só transita `pending_review` → final; rejeita revisões duplicadas com `{ "ok": false, "reason": "already-decided" }`.
