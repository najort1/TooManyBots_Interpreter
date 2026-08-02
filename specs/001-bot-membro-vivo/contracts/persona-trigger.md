# Contract — Gatilho da persona (pipeline ↔ personaService)

Contrato entre o pipeline (`fun/pipeline/onIncomingMessage.js`) e o `personaService`
(`fun/services/personaService.js`). Define **quando** a persona responde e o que o pipeline
precisa passar.

## Entrada (o que o pipeline fornece)

O pipeline chama `personaService.tryRespond(ctx)` na seção passiva (após roteamento de comandos),
passando um objeto `ctx` com:

| Campo | Fonte | Descrição |
|-------|-------|-----------|
| `scopeKey` | `scope.scopeKey` | JID do grupo (`@g.us`). |
| `text` | `rawMessage.text` | Texto normalizado da mensagem. |
| `mentionedJids` | `ctx.mentionedJids` | JIDs (LID) mencionados via @. |
| `quotedParticipant` | `ctx.quotedParticipant` | Autor (JID) da mensagem citada, se houver. |
| `authorJid` | `rawMessage.key.participant` | Autor da mensagem atual (normalizado). |
| `sock` | `deps.sock` | Sessão Baileys (para obter o JID do bot e enviar). |
| `identityMap` | `deps.identityMap` | Resolução LID→SID. |
| `groupSettings` | `groupRepository.getGroupSettings(scopeKey)` | Settings do grupo. |
| `funConfig` | `deps.config` | Config do módulo. |

## Decisão (tabela de gatilhos)

`tryRespond` responde **só se** TODAS as condições forem verdadeiras:

| # | Condição | Regra (spec) | Custo |
|---|----------|--------------|-------|
| T1 | Feature global ligada e `persona_enabled` do grupo ≠ 0 | FR-012 | O(1) |
| T2 | Mensagem é de membro normal, em grupo, autor ≠ bot (anti-self-loop) | FR-003 | O(1) |
| T3 | Fora de quiet hours (`isWorldQuietHours`) | FR-011 | O(1) |
| T4 | Fora de cooldown do grupo (≥ 60s desde a última resposta da persona) | FR-010 | O(1) |
| T5a | **Menção**: `/\bbot\b/i` no texto **OU** JID do bot ∈ `mentionedJids` (normalizado) | FR-001/FR-002 | O(len) |
| T5b | **Continuar**: `quotedParticipant` === JID do bot **E** thread ativa (não expirada, `turn_count < max_turns`) | FR-006/FR-007 | O(1) |

- Se `T5a` → abre nova thread (ou reusa ativa) e responde, incrementando `turn_count` se houver
  thread ativa.
- Se apenas `T5b` → continua a thread ativa (sem contar como menção nova). Se a thread estiver
  expirada ou no limite, **não responde** (FR-007) — reply antigo não reabre conversa.
- Mensagens que são comandos reconhecidos nunca chegam aqui (já roteadas antes) → precedência de
  comando garantida (FR-002).

## Saída

| Caso | Comportamento |
|------|---------------|
| Responde | Envia mensagem de texto via `sock.sendMessage(scopeKey, ...)` (a mensagem do bot fica "citável", habilitando continuação por reply). Atualiza cooldown e thread. |
| Não responde | Retorna silenciosamente — **nunca** quebra o pipeline (try/catch) nem bloqueia XP/outros passivos. |

## Regras transversais

- **Sem eco de placar/economia**: resposta passa por `sanitizeFlavor` + `looksLikeScoreboardEcho`
  (reuso do `flavorService`) — se o LLM vazar placar/saldo, usa fallback (G2).
- **Sem doxxing**: perfil de voz é anonimizado; amostras não são reproduzidas (FR-014).
- **Fallback**: sem LLM disponível ou timeout → linha estática local respeitando as mesmas guardas
  (FR-013).
- **Limite de turnos**: `turn_count ≥ max_turns` (default 3, clamp 2–4) encerra a thread (FR-006).
