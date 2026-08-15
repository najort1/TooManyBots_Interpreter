# Data Model — Jogo de Casas e Avatares (fun)

**Created**: 2026-08-14 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Schema: SQLite via better-sqlite3, banco em `data/fun/` (TMB_DATA_DIR), schema `analytics.*`. Novas tabelas em `fun/schema.js` (create-if-not-exists) + bump `FUN_SCHEMA_VERSION` → `'31'` + migração idempotente em `ensureFunSchema` (arquivo `fun/schema.js:956`). Todas as tabelas do jogo têm `scope_key` (JID do grupo); identidade canônica de usuário = JID `@s.whatsapp.net`.

## Entidades

### House (Casa)

- **id** TEXT PK — UUID (padrão `fun_properties.id`)
- **scope_key** TEXT NOT NULL — JID do grupo
- **user_jid** TEXT NOT NULL — dono (`@s.whatsapp.net`)
- **house_type** TEXT NOT NULL — tipo da casa (do catálogo `fun/shop/houses.js`); default provisório `default`
- **cleanliness_percent** INTEGER NOT NULL DEFAULT 100 — sujeira: 0–100
- **last_clean_at** INTEGER NOT NULL DEFAULT 0 — último reset de limpeza
- **last_collect_at** INTEGER NOT NULL DEFAULT 0 — última coleta
- **security_level** INTEGER NOT NULL DEFAULT 0 — nível de segurança (upgrades por moedas, FR-022)
- **created_at** INTEGER NOT NULL
- **updated_at** INTEGER NOT NULL

UNIQUE `(scope_key, user_jid)`; índice `idx_fun_house_scope` em `(scope_key)`.

**Validação** (FR-001/005/008/022):
- `house_type` ∈ catálogo; provision automática quando dono acessa (FR-001)
- `cleanliness_percent` clamp 0–100; coletar 1×/dia (reset diário) e apenas com limpeza ≥ mínimo (FR-005)
- `security_level` ∈ 0..`houseSecurityMaxLevel` (config)
- casa única por jogador/scope

### Item de casa / decorativo (Item)

Representa móvel, decoração, pet (pets nunca roubados — FR-023).

- **id** TEXT PK — UUID
- **scope_key** TEXT NOT NULL
- **user_jid** TEXT NOT NULL
- **house_id** TEXT NOT NULL — FK lógica → fun_houses.id
- **item_id** TEXT NOT NULL — id do catálogo
- **x** INTEGER NOT NULL — célula coluna
- **y** INTEGER NOT NULL — célula linha
- **rotated** INTEGER NOT NULL DEFAULT 0 — rotação (0/1)
- **acquired_at** INTEGER NOT NULL
- **condition** TEXT NOT NULL DEFAULT 'ok' — 'ok' | 'clean' | 'dirty' | 'broken' (FR-004)
- **stolen_flag** INTEGER NOT NULL DEFAULT 0 — 1 = roubado (FR-021/024/025)
- **quantity** INTEGER NOT NULL DEFAULT 1 — número de cópias empilhadas (mesma posição)

UNIQUE `(scope_key, user_jid, house_id, item_id)`; índice `idx_fun_house_items_owner` em `(scope_key, user_jid)`.

**Validação**:
- `x`/`y` dentro do grid (ex.: casa padrão 6×8) — FR-002
- `item_id` ∈ catálogo; `condition` só dos valores; `stolen_flag` 1 ⇒ não revendável/não presenteável (FR-021)
- `quantity` ≥ 1; pets imunes a roubo (FR-023)

### Pet (Item especial)

Relações: um pet é um `Item` de casa com `stolen_flag` sempre 0 (não roubável). Tem estado de interação (alimentar/carinhar) conforme catálogo; não é roubável.

### Item de avatar (Roupa / Acessório)

Peças para slots: `hair_face`, `outfit`, `optional_accessory`.

- (não é tabela — vem do catálogo global `fun/shop/avatars.js`)
- Atributos: **slot**, **id**, **emoji**, **unlockLevel** (nulo = sempre), **cost** (0 = desbloqueio por nível), **category**

### Avatar (estado do jogador)

- **scope_key** TEXT NOT NULL
- **user_jid** TEXT NOT NULL
- **equipped_slots** TEXT NOT NULL DEFAULT '{}' — JSON `{ hair_face: string|null, outfit: string|null, optional_accessory: string|null }` (ids válidos)
- **updated_at** INTEGER NOT NULL

UNIQUE `(scope_key, user_jid)`.

**Validação** (FR-011/012/013/014):
- slots fixos (3); ids ∈ catálogo; equipar exige posse/desbloqueio (comprado ou nível atingido)
- nível vem de `fun_user_stats.level` existente (FR-013)

### Visita

- **id** TEXT PK — UUID
- **scope_key** TEXT NOT NULL
- **visitor_jid** TEXT NOT NULL
- **host_jid** TEXT NOT NULL
- **note** TEXT NOT NULL DEFAULT '' — recado (filtro/limite)
- **created_at** INTEGER NOT NULL

Índice `idx_fun_house_visits_host` em `(scope_key, host_jid, created_at)`.

**Validação** (FR-016/017/018):
- visitor ≠ host (não visita a si); visitor e host do mesmo scope (FR-018)
- teto diário de visitas (config) — FR-016
- `note`: max length + blocklist (FR-031); sem mídia

### Presente (Gift)

- **id** TEXT PK — UUID
- **scope_key** TEXT NOT NULL
- **from_jid** TEXT NOT NULL
- **to_jid** TEXT NOT NULL
- **item_id** TEXT NULL — item de avatar ou decoração (null p/ moedas)
- **coins** INTEGER NOT NULL DEFAULT 0 — moedas presenteadas (sink, FR-019)
- **status** TEXT NOT NULL DEFAULT 'pending' — 'pending' | 'delivered' | 'sold'
- **created_at** INTEGER NOT NULL

**Validação** (FR-019/020/021):
- from ≠ to; mesmo scope; teto diário de envio (config)
- `coins` ≥ 0; se `item_id` presente, pertence ao inventário do remetente (FR-019); item roubado (stolen_flag=1) nunca é presenteável (FR-021)
- entregue automático ao host (FR-020); vendável com fração do valor (FR-009)

### Token de acesso (Link pessoal)

- **token_hash** TEXT PK — hash do token (scrypt)
- **scope_key** TEXT NOT NULL
- **user_jid** TEXT NOT NULL
- **created_at** INTEGER NOT NULL
- **revoked_at** INTEGER NULL

Índice `idx_fun_house_tokens_owner` em `(scope_key, user_jid)`.

**Validação** (FR-027/028/030):
- um token ativo por (user, scope); gerar/revogar (deleta o ativo e cria novo) — FR-030
- entrega só em DM (FR-028); token nunca em grupo
- comparação hash com `timingSafeEqual`; não há vazamento do token (só hash no banco)

### Ledger (moedas) — reuso

**fun_coin_ledger** (existente) — toda compra/venda/recompensa/multa/presente de moedas por `addCoins`/`transferCoins` (FR-007/008). Sem tabela nova; invariante: saldo nunca negativo (floor do `addCoins`).

## Inventário legado

- **fun_inventory** (existente) — usado para presentes que transferem; presente de **moedas** via `transferCoins` (sem inventário). Para itens de avatar/decoração, a compra cria um Item do catálogo com `acquired_price` (= inventário do jogo); vendas creditam fração (FR-009).

## Estado e transições

### Casa
`provision (default)` → `decorated` (comprar/colocar) → `cleanliness decai ao longo do dia` (job, quiet hours) → `collect` (1×/dia, exige limpeza ≥ mínimo → decrementa clean? Não: `collect` zera `last_collect_at` e credita; `cleanliness` continua) → `sell` (remove item; sem itens → casa válida/provisível)

### Roubo
`robar (outro membro)` → `sucesso` (item transferido com `stolen_flag=1`; multa N te) | `falha` (multa piso/teto + `${procurado}` via policeService) | `bloqueado` (segurança alta, cooldown, teto diário, item já roubado, sem decorativo)

### Presente
`enviar` → `pending` → `delivered` (entrega automática ao host) → `sold` (host vende com fração). Itens roubados não presenteáveis.

## FKs e restrições

- Sem FK declarada (padrão do módulo); integridade por aplicação (services) e validação no repositório.
- `scope_key` obrigatório em todas as tabelas novas (constituição: nenhuma tabela ignora escopo).
- Colunas `created_at`/`updated_at` em casas/itens/visitas/presentes (padrão timestamps).

## Configuração nova (fun/config.js + fun/constants.js defaults)

- `housesEnabled`, `avatarEnabled`, `visitsEnabled`, `giftsEnabled`, `robberyEnabled` (boolean, default true)
- `houseDailyCollectMax` (int, default 1), `houseMaxItems` (int, default 24)
- `houseCellGrid` (string "6x8"), `houseSecurityMaxLevel` (int, default 3)
- `houseRobberyCooldownMs` (int), `houseRobberyDailyMax` (int)
- `avatarShopRotationMs` (int)
- Reuso de `assaultCooldownMs`, `assaultBaseChance`, `assaultMinSteal`, `assaultMaxStealRatio`, `assaultFailFinePct/Min/Max`, `worldQuietHours*`, `worldTickMs`

## Relações entre entidades

House (1) — (N) Item; House (1) — (N) Visita (host); Usuário (1) — (N) Visita (visitor); Usuário (1) — (N) Presente (from/to); Token (1) → Usuário/Scope; Avatar (1) → Usuário/Scope; Item (N) — (1) Catálogo (loja); Avatar (N) — (1) Catálogo (avatar).