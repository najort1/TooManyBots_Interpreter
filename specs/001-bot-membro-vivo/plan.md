# Implementation Plan: Bot Membro Vivo

**Branch**: `001-bot-membro-vivo` | **Date**: 2026-08-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-bot-membro-vivo/spec.md`

## Summary

Tornar o bot do módulo fun "um membro a mais" do grupo: quando citado como "bot" (palavra inteira) ou
marcado via @, ele responde no estilo de fala aprendido do grupo (janela recente de mensagens),
sem fazer spam (cooldown por grupo, quiet hours, controle por grupo via dashboard). Quando um membro
responde citando a mensagem do bot, a conversa continua por um número limitado de turnos e expira por
inatividade.

Abordagem técnica: hook passivo no pipeline (`fun/pipeline/onIncomingMessage.js`) após o roteamento de
comandos (comandos têm precedência), novo `personaService` que amostra mensagens do grupo para derivar
um perfil de voz, gerencia threads e cooldown, e gera respostas via cascata LLM existente
(Zen → template) reutilizando sanitizers do `flavorService` (OCP — sem modificar a camada de LLM).
Toggle por grupo via coluna `persona_enabled` em `fun_group_settings`, exposto pelo dashboard
(`PUT /api/fun/groups/:jid/settings`) e UI em `fun_dashboard/src/app/groups`.

## Technical Context

**Language/Version**: Node.js (ESM; processo standalone `npm run fun` / `npm run fun:dev`)

**Primary Dependencies**: baileys (WhatsApp), better-sqlite3 (SQLite), pino (logs), Zen LLM via
`fun/llm/openaiClient.js` (compatível com OpenAI), `node:test` (testes)

**Storage**: SQLite em `data/fun/` via `better-sqlite3`; schema centralizado em `fun/schema.js`
(create-if-not-exists, `FUN_SCHEMA_VERSION`); repos em `fun/db/fun*Repository.js`

**Testing**: `node --test` (runner nativo) em `tests/fun-*.test.js`, isolamento de banco (SQLite
temporário), `FUN_DISABLE_LIVE_LLM=1` + mocks injetados para LLM

**Target Platform**: Servidor Node.js (bot WhatsApp standalone) + dashboard Next.js (`fun_dashboard`)

**Project Type**: Feature do módulo fun (bot de WhatsApp com backend `fun/` e dashboard admin)

**Performance Goals**: resposta da persona em ≤15s (SC-001); detecção de gatilho barata
(regex + Map em memória, O(1)); custo zero quando a feature está desligada no grupo

**Constraints**: cooldown 60s por grupo; quiet hours 1h–6h (`isWorldQuietHours`); ≤3 continuações por
thread; TTL de thread 30min; sem self-loop; comandos têm precedência; sem LLM → fallback local;
amostras de estilo nunca reproduzidas; janela ≤100 msgs/24h por grupo em memória

**Scale/Scope**: por grupo (whitelist); no máximo 1 resposta por cooldown por grupo; threads curtas
(2–4 turnos); persistência leve (perfil derivado + threads ativas)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **G1 — Arquitetura em Camadas** (Princípio I): a feature segue a ordem de camadas
  `constants → schema → repo → service → handler(pipeline) → testes → docs`; regras de negócio
  ficam no `personaService` (services), persistência em `funPersonaRepository` (db), gatilho no
  pipeline (handler fino). **PASS**.
- **G2 — Economia Anti-Exploit** (Princípio II): N/A — a feature não mexe em coins/XP/ledger. Guarda
  adicional: respostas da persona NUNCA ecoam placar/saldo (reuso de `sanitizeFlavor` +
  `looksLikeScoreboardEcho`). **PASS**.
- **G3 — Produto & Comportamento** (Princípio III): quiet hours respeitado; sem doxxing — o perfil
  de voz é derivado e anonimizado, amostras não são reproduzidas; opt-out por grupo
  (`persona_enabled`, default ON) via dashboard; anti-spam por cooldown. **PASS**.
- **G4 — Qualidade & Engenharia** (Princípio IV): testes `node --test` determinísticos com
  `FUN_DISABLE_LIVE_LLM=1` e LLM mockado; cascata Zen → template com timeout/retry; convenção de
  commit `fun/fun-*`; gates `npm test`, `npm run fun:dev --setup`, `npm run fun:dashboard:build`.
  **PASS**.
- **G5 — Restrições do módulo**: mensagens de cooldown/erro centralizadas (reuso de
  `fun/messages/cooldown.js`); formatters existentes reutilizados; dados isolados em `data/fun/`;
  escopo por `scope_key`. **PASS**.

Sem violações — **Complexity Tracking não preenchido**.

**Re-avaliação pós-design (Fase 1)**: o design manteve as 5 gates verdes — sem mudanças na camada de
LLM (OCP: `flavorService` reutilizado, prompt próprio no `personaService`), persistência nova isolada
em `funPersonaRepository` com `scope_key`, guardas anti-spam (cooldown/quiet hours), opt-out por
grupo default ON e testes `node --test` com LLM mockado.

## Project Structure

### Documentation (this feature)

```text
specs/001-bot-membro-vivo/
├── plan.md              # Este arquivo (/speckit-plan)
├── research.md          # Fase 0 — decisões técnicas
├── data-model.md        # Fase 1 — entidades e validações
├── quickstart.md        # Fase 1 — guia de validação
├── contracts/           # Fase 1 — contratos de interface
└── tasks.md             # Fase 2 (/speckit-tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
fun/
├── constants.js                        # + constantes da persona (cooldown, turnos, TTL, janela)
├── config.js                           # + defaults configuráveis (persona*)
├── schema.js                           # + fun_persona_profile, fun_persona_thread, coluna persona_enabled
├── db/
│   ├── funGroupRepository.js           # + persona_enabled no upsert/read (padrão "default ON")
│   └── funPersonaRepository.js         # NOVO — perfil de voz + threads
├── services/
│   └── personaService.js               # NOVO — detecção, guardas, threads, geração de resposta
├── pipeline/
│   └── onIncomingMessage.js            # + hook passivo após roteamento de comandos
├── llm/
│   ├── flavorService.js                # REUTILIZADO (sanitizeFlavor, looksLikeScoreboardEcho)
│   └── openaiClient.js                 # REUTILIZADO (cascata Zen)
├── dashboard/
│   └── server.js                       # + passa personaEnabled no PUT settings
└── messages/
    └── cooldown.js                     # REUTILIZADO (formatCooldown)

fun_dashboard/
└── src/app/groups/page.tsx             # + toggle "Persona (membro vivo)"

tests/
├── fun-persona-service.test.js         # NOVO — gatilhos, guardas, threads, geração (LLM mock)
└── fun-persona-settings.test.js        # NOVO — toggle por grupo (repo + dashboard contract)
```

**Structure Decision**: projeto único (módulo fun + dashboard), seguindo o padrão de camadas do
módulo (`constants → schema → repo → service → handler(pipeline) → testes → docs`). A persona
NÃO modifica a camada de LLM existente (`flavorService`) — reutiliza sanitizers/clientes e adiciona
prompt próprio no `personaService` (OCP). Persistência nova fica em repositório próprio
(`funPersonaRepository`), mantendo o isolamento por `scope_key` da constituição.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _nenhuma_ | — | — |
