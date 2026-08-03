# LLM Tool-Calling Contract: Auto-Aprimoramento

**Branch**: `003-data-self-healing` | **Date**: 2026-08-03 | **Spec**: [spec.md](../spec.md)

Contrato entre o orquestrador (`fun/services/selfHealingService.js`) e a LLM (cascata Zen, tarefa `selfheal` em `zenTaskParams.js`). A LLM recebe **somente tools de leitura**; toda escrita é proposta no `findings` e passa por validação determinística + classificador de risco antes de qualquer efeito (FR-003/FR-004/FR-005/FR-016).

## 1. Tools de leitura (capabilities)

Invocações síncronas locais, em lote por scope antes da chamada LLM (D6 — reduz chamadas/custo). Schema JSON estilo function-calling.

### `list_facts`

Lista fatos/lore do grupo para auditoria.

```json
{
  "tool": "list_facts",
  "args": { "scope_key": "120363...@g.us", "limit": 50 }
}
```

**Resposta**: `{ "facts": [ { "id": 123, "authorJid": "5511...@s.whatsapp.net", "summary": "...", "score": 95, "hits": 3, "createdAt": 1783000000000 } ] }`

### `find_evidence`

Busca evidência (mensagens observadas) que corrobore/contradiga um item.

```json
{
  "tool": "find_evidence",
  "args": {
    "scope_key": "120363...@g.us",
    "authorJid": "5511...@s.whatsapp.net",
    "text": "resumo do fato para busca",
    "windowMs": 2592000000
  }
}
```

**Resposta**: `{ "matches": [ { "id": 456, "authorJid": "...", "text": "...", "createdAt": 1783000000000, "similarity": 0.93 } ] }`

### `list_memories`

(domínios futuros) Lista memórias de conversa para validação de confiança.

```json
{ "tool": "list_memories", "args": { "scope_key": "...", "limit": 50, "minConfidence": 0.4 } }
```

### `get_stats`

Métricas do domínio para decisão de varredura.

```json
{ "tool": "get_stats", "args": { "scope_key": "...", "domain": "memory_lore" } }
```

**Resposta**: `{ "facts": 12, "verified": 2, "unverified": 5, "pending": 3, "evidenceRows": 480 }`

## 2. Contrato de saída (findings)

A LLM DEVE responder JSON com este formato exato (validação estrita `validateFindingsPayload` — schema rígido, D5):

```json
{
  "domain": "memory_lore",
  "findings": [
    {
      "targetId": 123,
      "action": "fix_author",
      "confidence": 98,
      "evidenceRef": "fun_evidence_log#456",
      "reason": "Evidência mostra autor 5511...@s.whatsapp.net; fato gravado com autoria divergente.",
      "suggestedAuthorJid": "5511...@s.whatsapp.net",
      "suggestedText": "texto corrigido (quando action = fix_text)"
    }
  ]
}
```

### Enumeradores

**`domain`** (whitelist): `memory_lore`, `conversation_memory`, `economy`, `profile`

**`action`** (whitelist por domínio):

| Action | Domínios | Risco | Efeito (sempre via repo de domínio) |
|---|---|---|---|
| `fix_author` | memory_lore | low | Corrige autoria (UPDATE via `funMemoryRepository`) |
| `fix_text` | memory_lore | low | Repara resumo/texto do fato |
| `merge_duplicates` | memory_lore, conversation_memory | low | Consolida duplicatas |
| `promote_confidence` | conversation_memory | low | Promove nível de confiança |
| `downgrade` | conversation_memory | high | Rebaixa confiança → **revisão** |
| `suppress` | conversation_memory | high | Suprime memória → **revisão** |
| `delete` | qualquer | high | Exclusão → **revisão** |
| `flag_unverifiable` | memory_lore | low | Marca fato como não verificável (sem exclusão) |
| `integrity_fix` | economy, profile | high | Correção estrutural → **revisão** |
| `report` | qualquer | low | Sinaliza divergência sem escrita (US3 cenário 2) |

**`confidence`**: inteiro 0–100 (registro informativo; nunca substitui validadores determinísticos — FR-005).

**`evidenceRef`**: formato `fun_evidence_log#<id>` ou hash (`evl:<sha256>`); `null` quando não há evidência.

## 3. Regras de validação determinística (antes de qualquer escrita)

1. `domain` e `action` ∈ whitelists; `targetId` existe no `scope_key` auditado.
2. `fix_author`: `suggestedAuthorJid` DEVE ser JID canônico `@s.whatsapp.net` E corresponder à evidência referenciada (mesmo autor + similaridade ≥ limiar). Senão → rejeitado (`rejected`) e registrado.
3. `fix_text`: `suggestedText` deve ter tamanho mínimo e ser subconjunto/paráfrase da evidência referenciada (similaridade ≥ limiar); senão → rejeitado.
4. Qualquer ação com `evidenceRef = null` em domínio que exige evidência → `flag_unverifiable`/`report` (nunca escrita).
5. Ação desconhecida, domínio desconhecido, JSON inválido ou payload fora do schema → varredura registra `error`/`skipped` e continua (FR-009).
