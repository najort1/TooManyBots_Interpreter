# API Contrato — Jogo de Casas e Avatares (fun)

**Created**: 2026-08-14 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Model**: [data-model.md](../data-model.md)

Escopo: interfaces que o jogo expõe a usuários/sistemas.

## 1. API Web — `/api/fun/houses/*`

Servidor: `fun/dashboard/server.js` (http puro, padrão bolsa; handler por path). Prefixo `/api/fun/houses/*`. O Next já faz proxy de `/api/fun/:path*` para o backend (rewrite em `fun_dashboard/next.config.ts`).

- **Auth de leitura**: token no path resolve quem é o dono (posse do link). Casa alheia visível a membros do **mesmo grupo** (vizinhos) sem listar grupos/JIDs de outros escopos; middleware do Next (`isProtectedPath`) trata `/casas/*` e `/api/fun/houses/*` como públicos (padrão bolsa/job).
- **Auth de escrita**: header `x-house-token` obrigatório nas rotas de escrita (dono); respostas nunca incluem JIDs de terceiros.
- **Formato**: JSON; erros como `{ error: string, reason?: string }` com status 400/401/403/404/409/429/503 (padrão existente).

### Endpoints

| Método | Path | Auth | Corpo (request) | Resposta 200 |
|--------|------|------|-----------------|--------------|
| GET | `/api/fun/houses/:token` | leitura pública do bairro | — | visor completo da casa (dono: `{ owns: true, house, items, avatar, cleanliness, security, coil_daily: {...} }`; visitante: `{ owns: false, house, items, avatar, host: {nickname}, mural }`) |
| POST | `/api/fun/houses/:token/collect` | dono (token) | — | `{ ok, coins, reason: 'property-collect' }` |
| PUT | `/api/fun/houses/:token/items/move` | dono (token) | `{ itemId, x, y, rotated }` | `{ ok, item }` |
| POST | `/api/fun/houses/:token/items/place` | dono (token) | `{ itemId, x, y }` | `{ ok, item, coins }` |
| POST | `/api/fun/houses/:token/items/sell` | dono (token) | `{ itemId }` | `{ ok, coins }` |
| GET | `/api/fun/houses/:token/shop` | dono (token) | — | `{ shop: [...], coins }` |
| POST | `/api/fun/houses/:token/visit` | leitura do bairro (membro) | `{ note }` | `{ ok, visit }` |
| POST | `/api/fun/houses/:token/gifts` | vista (membro) | `{ itemId?, coins?, targetJid? }` | `{ ok, gift }` |
| POST | `/api/fun/houses/:token/rob` | vista (membro) | — | `{ ok, result: 'success'\|'fail'\|'blocked', item?, fine?, wantedDelta? }` |
| GET | `/api/fun/houses/:token/visits` | dono | — | `{ visits: [...] }` |

**Validação por rota** (contrato baseado em [data-model.md](../data-model.md)): `x`/`y` dentro do grid; `itemId` ∈ catálogo; dono ≠ visitante; tetos diários (visitas, presentes, roubos); cooldown de roubo; `note` com blocklist/max length (sem mídia); itens roubados não presenteáveis/vendáveis; multa com piso/teto; `security` influencia chance. Saldo nunca negativo (ledger).

### Exemplo (coleção)

```json
POST /api/fun/houses/{token}/collect
x-house-token: {token}
→ 200 { "ok": true, "coins": 45, "reason": "house-collect" }
```

### Autenticação resumida

- Leitura: token resolve quem é o responsável; expõe apenas dados não-pessoais (avatar, decoração, nick do grupo).
- Escrita: `x-house-token` no header do client (o `funApi` já usa `credentials: 'same-origin'` + rewrite).
- Erros: 401 sem token/header inválido; 403 fora do escopo; 409 conflito (cooldown/teto); 503 `houses-indisponivel`.

## 2. Comandos no WhatsApp (grupo + DM)

Formato: `parseFunCommand`, prefixo `/`, aliases em `FUN_COMMAND_ALIASES`.

### `/casa`

**Grupo** → instrui o usuário a usar o comando no chat privado do bot (nunca envia link; respeita a regra de banimento):

```
Você precisa do seu link da casa. Chame o bot no privado e digite /casa lá para receber o link.
```

**DM** (`isGroup=false`) → usa `membershipService`/`dmGroups` para resolver grupos do usuário; se apenas um, responde diretamente o link pessoal (e resumo: saldo, tetos, notificações):

```
🏠 Sua casa (grupo X) — link: https://.../casas/{token}
Coins: 1200 | Visitas: 3/5 hoje | Roubo: liberado
```

Se múltiplos grupos → escolher via `groupScopeCommand` (padrão existente) ou enumerar os links.

**Subcomandos** (DM): `link`, `revogar`, `info`, `shop` (resumo).

### `/avatar`

**Grupo** → instrução de DM (mesmo padrão do `/casa`).
**DM** → responde resumo do avatar (slots equipados, peças desbloqueadas) e o link para editar no navegador. Subcomandos: `link`, `info`, `desbloquear` (lista).

### Contratos de resposta
- Mensagens centralizadas em `fun/messages/house.js` (DRY); formatação em `fun/formatters/house.js` (emoji, grid para o grupo).
- Respeito ao prefixo do grupo, quiet hours para automáticos (constituição).

## 3. Contrato de dados do navegador (frontend)

- **`fun_dashboard/src/lib/api.ts`**: adicionar `funApi.houses.*` (proxy `/api/fun/houses/*`); `x-house-token` nos calls de escrita; tipos em `fun_dashboard/src/lib/types.ts`.
- **`fun_dashboard/src/middleware.ts`**: `/casas/:path*` e `/api/fun/houses/:path*` tratados como públicos (bolsa/job pattern).
- **UI**: segmento `/casas/{token}` com visor da casa; botões de ação (coletar, decorar, avatar, visitar, presente, roubar) chamando os endpoints acima; `FloorGrid` + `AvatarShowcase` em `src/components/casas/`; tema claro/escuro via CSS (constituição).

## 4. Contratos entre camadas (internos)

- Services expõem factories `createHouseService`, `createAvatarService`, `createVisitService`, `createGiftService`, `createRobberyService`, `createHouseLinkService` (DI com `repository`, repositórios, `random`, `now`).
- Todos os débitos/créditos via `repository.addCoins`/`transferCoins` (ledger atômico) — invariante de saldo não-negativo.
- `houseLinkService` gerar token (scrypt hash) → `fun_house_tokens`; resolver → user/scope.
- Capas/cooldowns centralizados (config) — FR-008.
- `policeService` para multe/aumento de procurado — FR-024 (nunca kick/ban).