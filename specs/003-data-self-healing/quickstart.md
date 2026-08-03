# Quickstart: Auto-Aprimoramento de Dados Guiado por LLM

**Branch**: `003-data-self-healing` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

Guia de validação ponta-a-ponta. Detalhes de implementação em `tasks.md` (fase de implementação). Contratos em [contracts/](./contracts/), modelo de dados em [data-model.md](./data-model.md).

## Pré-requisitos

- Repositório clonado com dependências instaladas (`npm install`).
- Módulo fun inicializado: `npm run fun -- --setup` (cria `data/fun/runtime.db` com schema `'29'`).
- Config em `fun/config.user.json` (não commitar):
  ```json
  {
    "fun": {
      "selfHealEnabled": true,
      "selfHealDryRun": true,
      "selfHealIntervalMs": 600000,
      "selfHealEvidenceRetentionDays": 60,
      "selfHealMaxItemsPerRun": 50,
      "selfHealMaxCallsPerRun": 10
    }
  }
  ```
  **Comece com `dryRun: true`** — primeira validação de autonomia real só depois de revisar o relatório.

## Cenários de validação

### C1. Captura de evidência

- **Como rodar**: teste automatizado — `npx node --test tests/fun-self-healing.test.js` (cenário "evidência é capturada em observeMessage").
- **Setup manual**: enviar mensagens de texto (não-comando, não-sensível) em grupo whitelist.
- **Esperado**: cada mensagem elegível gera linha em `fun_evidence_log` (texto truncado, hash, autor, `expires_at`); comandos e conteúdo sensível **não** geram evidência; a mesma `message_id` não duplica.

### C2. Varredura em modo de simulação (dry-run)

- **Como rodar**: `POST /api/fun/selfheal/run` com `{ "domain": "memory_lore", "dryRun": true }` (ou config global `dryRun: true`).
- **Esperado**: resposta `{ ok: true, runId, mode: "dry_run" }`; `GET /api/fun/selfheal/runs` mostra a run; **nenhum** dado foi alterado (SC-007); `GET /api/fun/selfheal/audit?runId=...&mode=dry_run` lista todas as propostas com `status: "simulated"`.

### C3. Correção de autoria com evidência (baixo risco → aplica sozinho)

- **Setup**: fato em `fun_group_memories` com autor errado + evidência real (mesma `scope_key`, mesmo autor, similaridade alta) em `fun_evidence_log`.
- **Como rodar**: varredura `memory_lore` (dry-run primeiro, depois live).
- **Esperado**: `fix_author` aplicado autonomamente (`status: applied`, `decided_by: system`); autoria corrigida no fato; trilha com `before_json`/`after_json`/`evidence_ref` (SC-002); correção corresponde ao autor real da evidência (SC-003).

### C4. Fato sem evidência → não verificável (sem exclusão)

- **Setup**: fato antigo sem evidência correspondente.
- **Esperado**: achado `flag_unverifiable` (`status: applied`), fato marcado como não verificável, **nada excluído** (spec US1 cenário 4); relatório registra a inconclusão (SC-001).

### C5. Falha de LLM não corrompe nada

- **Setup**: LLM devolve JSON inválido/fora do schema (em teste: stub que retorna payload inválido; em runtime: configurar `FUN_DISABLE_LIVE_LLM=1`).
- **Esperado**: varredura registra `status: error`/`skipped` e conclui; nenhuma escrita ocorre; processo não trava (FR-009, SC-005).

### C6. Alto risco → revisão do admin

- **Setup**: achado `delete` ou `integrity_fix` (economia) gerado pela LLM.
- **Esperado**: linha com `risk_level: high`, `status: pending_review`; `POST /api/fun/selfheal/review` com `decision: apply|reject` grava `decided_by: admin:<jid>`; revisão duplicada rejeitada (`already-decided`); sem revisão, nada é aplicado (FR-016, Q3).

### C7. Quiet hours bloqueiam varredura

- **Setup**: janela de quiet hours ativa.
- **Esperado**: `POST /api/fun/selfheal/run` → `{ ok: false, reason: "quiet-hours" }`; tick agendado não inicia varredura.

### C8. GC de retenção

- **Setup**: linhas em `fun_evidence_log` com `expires_at` no passado (teste injeta data antiga).
- **Esperado**: na varredura/startup, linhas expiradas são removidas; evidência dentro da janela permanece.

## Verificação final (métricas)

- `GET /api/fun/selfheal/summary` mostra: total de runs, aplicadas, pendentes, rejeitadas, simuladas, erros e contagem/idade da evidência.
- Rodar a suíte completa do módulo fun para garantir zero regressões: `npm run test` (SC-004).
