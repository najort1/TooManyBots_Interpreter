# Quickstart — Validação do Bot Membro Vivo

Guia de validação ponta a ponta da feature. Detalhes de design em [data-model.md](./data-model.md) e
[contracts/](./contracts/). Pré-requisitos: módulo fun instalado (`npm install`), contas
Whitelist/grupos configurados em `fun/config.user.json`.

## Pré-requisitos

- Node.js 20+ e dependências instaladas na raiz.
- `fun/config.user.json` com ao menos um grupo whitelistado.
- Variável de teste: `FUN_DISABLE_LIVE_LLM=1` para testes que não podem depender de rede.

## 1. Setup e migração

```powershell
npm run fun:dev --setup
```

**Esperado**: boot sem erros; `FUN_SCHEMA_VERSION` incrementada; tabelas novas criadas
(`fun_persona_profile`, `fun_persona_thread`) e coluna `persona_enabled` presente em
`fun_group_settings`; a feature vem **ligada** por padrão nos grupos.

## 2. Testes automatizados

```powershell
npm test
# ou apenas os novos:
node --test tests/fun-persona-service.test.js tests/fun-persona-settings.test.js
```

**Esperado**: verde e determinístico (sem rede; LLM mockado via `FUN_DISABLE_LIVE_LLM=1`).

Cobre: gatilho `\bbot\b` (não casa "botão"/"robô"), @marcação normalizada via identityMap,
reply-continuação com limite de turnos, expiração por TTL, cooldown 60s, quiet hours, anti-self-loop,
toggle por grupo (default ON), fallback sem LLM, sem eco de placar.

## 3. Validação manual no grupo (runtime)

Com `npm run fun:dev` rodando:

| Cenário | Ação | Esperado |
|---------|------|----------|
| Menção por texto | Enviar: "bot, o que você acha disso?" | Resposta da persona em ≤15s, estilo do grupo, citável. |
| @marcação | Marcar o bot com @ | Resposta da persona. |
| Não-disparo | Enviar: "essa é a botão mais forte" / "vi um robô" | Silêncio do bot. |
| Precedência de comando | Enviar: "/pay bot 50" | Comando executado; persona NÃO responde. |
| Continuação | Responder (citar) a mensagem do bot | Bot continua; após 3 continuações, para. |
| Thread expirada | Citar uma resposta antiga (≥30min) | Bot não reabre a conversa. |
| Cooldown | 2 menções em <60s | Apenas 1 resposta da persona. |
| Quiet hours | Menção entre 1h–6h | Nenhuma resposta (ou adiada). |
| Self-loop | Mensagem do próprio bot | Nunca responde a si mesmo. |

## 4. Validação do dashboard

1. Abrir `fun_dashboard` (`npm run fun:dashboard:build` + servidor do dashboard) → página **Groups**.
2. Desligar "Persona (membro vivo)" de um grupo → `PUT /api/fun/groups/:jid/settings`
   `{ personaEnabled: false }` → 200.
3. No grupo, mencionar o bot → **nenhuma** resposta (surte efeito em ≤1 min; ver contrato em
   [contracts/dashboard-settings.md](./contracts/dashboard-settings.md)).
4. Religar e reiniciar o processo → o estado do toggle persiste (FR-015).

## Critérios-chave (ligação com a spec)

- Resposta em ≤15s (SC-001) e falso disparo <5% (SC-002) → validação manual + teste de gatilho.
- Continuação em ≥80% dos replies elegíveis (SC-003) → teste de thread.
- Zero self-loop (SC-005) → teste dedicado.
- Desligar por grupo interrompe em ≤1min e persiste (SC-007) → validação do dashboard.
