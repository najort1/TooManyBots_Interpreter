# Data Model — Bot Membro Vivo

Entidades da feature derivadas da spec (`specs/001-bot-membro-vivo/spec.md`) e das decisões de
`research.md`. Persistência em SQLite (better-sqlite3) em `data/fun/`, schema centralizado em
`fun/schema.js` (create-if-not-exists, `FUN_SCHEMA_VERSION` incrementada).

## 1. fun_group_settings (extendida)

Tabela existente do módulo (schema analytics). Ganha **1 coluna nova**:

| Campo | Tipo | Regra / Validação |
|-------|------|-------------------|
| `persona_enabled` | INTEGER (0/1) | Default **1** (ligado). Só desliga se enviado explicitamente `false`/`0` — mesmo padrão de `world_events_enabled` (FR-012). |

**Validação**: `group_jid` obrigatório e deve terminar em `@g.us` (já validado no repo). Os demais
campos existentes não mudam.

**Regra efetiva no runtime**: `personaAtiva = settings.persona_enabled !== 0 && funConfig.personaEnabled !== false`.

## 2. fun_persona_profile (nova)

Perfil de voz derivado do grupo — **derivado e anonimizado, nunca textos crus** (FR-014).

| Campo | Tipo | Regra / Validação |
|-------|------|-------------------|
| `scope_key` | TEXT (PK) | JID do grupo (`@g.us`) — isolamento por escopo (FR-009). |
| `top_tokens` | TEXT (JSON array) | Até 30 tokens frequentes (sem stopwords), min. comprimento 3. |
| `emojis` | TEXT (JSON array) | Emojis mais usados (até 10) com contagem. |
| `avg_len` | REAL | Tamanho médio das mensagens da janela (não usado como regra, só estilo). |
| `style_lines` | TEXT (JSON array) | Até 3 linhas de exemplo **anonimizadas** (nomes trocados por "[nome]"), só para injetar tom no prompt. |
| `sample_ts` | INTEGER | Timestamp da última amostra. |
| `updated_at` | INTEGER | Timestamp da última atualização do perfil. |

**Validações**: `scope_key` termina em `@g.us`; `top_tokens` ≤ 30 itens; `style_lines` ≤ 3 e
sempre anonimizadas antes de persistir; nenhum texto cru de mensagem é armazenado (FR-014).

## 3. fun_persona_thread (nova)

Conversa contínua da persona com o grupo (FR-006, FR-007, FR-015).

| Campo | Tipo | Regra / Validação |
|-------|------|-------------------|
| `id` | INTEGER (PK autoincrement) | Identificador interno. |
| `scope_key` | TEXT | JID do grupo — isolamento por escopo (FR-009). |
| `turn_count` | INTEGER | Nº de continuações já usadas. `0 ≤ turn_count ≤ max_turns` (FR-006). |
| `max_turns` | INTEGER | Limite configurável (default 3, clamp 2–4). |
| `last_activity_at` | INTEGER | Última troca (resposta do bot). Usado p/ expiração por inatividade. |
| `context` | TEXT (JSON) | Últimas trocas da conversa (autor anonimizado + texto curto), injetado no prompt de continuação. |
| `created_at` | INTEGER | Criação da thread. |

**Regras de estado**:
- **Abrir**: primeira resposta da persona após menção sem thread ativa.
- **Continuar**: reply citando mensagem do bot + thread ativa (não expirada, `turn_count < max_turns`).
- **Expirada**: `now - last_activity_at > personaThreadTtlMs` (default 30min) → reply antigo NÃO
  continua (FR-007); trata como menção nova apenas se houver menção direta.
- **Encerrar**: `turn_count ≥ max_turns` → para de responder, mesmo com reply (FR-006/SC-003).

## Relacionamentos

- `fun_group_settings.persona_enabled` → habilita/desabilita toda a feature no grupo.
- `fun_persona_profile.scope_key` e `fun_persona_thread.scope_key` → 1:1 com o grupo (por `scope_key`).
- Janela de amostras (estilo) é **em memória** no `personaService` (≤100 msgs/24h por grupo) e não é
  uma tabela — só o perfil derivado persiste (FR-014/FR-015).
