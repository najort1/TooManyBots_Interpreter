# Implementation Plan: Jogo de Casas e Avatares do Módulo Fun

**Branch**: `004-fun-houses-game` | **Date**: 2026-08-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-fun-houses-game/spec.md`

## Summary

Expandir o módulo `fun` (bot WhatsApp) e o painel `fun_dashboard` (Next.js) com um jogo de **casas e avatares** por grupo ("bairro"): cada jogador ganha uma casa padrão que pode decorar (móveis/pets), um avatar customizável (roupas/acessórios desbloqueados por nível ou comprados com moedas), coleta diária de limpeza, e interações sociais entre membros do mesmo grupo — visitar casas (mural de recados), deixar presentes e roubar decorações de casas com segurança baixa (flagra = multa in-game + procurado, nunca kick/ban). O acesso web é por **link pessoal único entregue exclusivamente no chat privado do bot** (o bot nunca inicia conversa privada — risco de banimento). A expansão entra como extensão das camadas existentes (constants → schema → repo → service → handler → pipeline → testes → docs), sem quebrar comandos nem economia existentes.

**Abordagem técnica** (detalhada em [research.md](./research.md)): catálogo estático em `fun/shop/houses.js` + dados dos jogadores em novas tabelas SQLite em `fun/schema.js` (version bump), repositórios/stores em `fun/db/` e `fun/services/` por camada; API do jogo em `fun/dashboard/server.js` (http puro, padrão bolsa); UI em `fun_dashboard` com segmento público `/casas/*` isolado do shell admin (padrão bolsa), renderização por CSS grid + emoji (sem canvas), mobile-first Tailwind v4.

## Technical Context

**Language/Version**: Node.js (mesmo do monorepo — ESM, `"type": "module"` no fun; ver package.json da raiz)

**Primary Dependencies**:
- Backend: `better-sqlite3` (sync, transacional), `http` nativo (o `server.js` NÃO usa Express — é `http.createServer` puro), `node:crypto` para tokens
- Frontend (`fun_dashboard`, já instalado): `next@15.5.9` (App Router), `react@19.1.0`, `tailwindcss@^4`, `lucide-react`, `clsx`, `tailwind-merge` — sem libs novas para renderização; grid CSS + emoji (4 itens por linha no grid da casa)
- Sem novas dependências de runtime; nenhuma lib de render 3D/canvas

**Storage**: SQLite via `better-sqlite3`, schema `analytics.*`, arquivo em `data/fun/` (TMB_DATA_DIR). DB isolado por escopo (`scope_key` = JID do grupo). `FUN_SCHEMA_VERSION` (hoje `'30'` em `fun/constants.js:1`) será incrementada com novas tabelas e migrações idempotentes em `ensureFunSchema` (`fun/schema.js:956`)

**Testing**: `node --test` + `node:assert/strict` em `tests/fun-*.test.js`, banco temporário via `initDb()` (`db/index.js`), `_resetDefaultFunStatsRepository()` e `FUN_DISABLE_LIVE_LLM=1`; JIDs/grupos únicos por teste (timestamp), sem rede, stubs determinísticos (`random: () => 0.5`). O frontend valida via build `npm run fun:dashboard:build` + revisão manual (a constituição não exige testes do Next)

**Target Platform**: WhatsApp (Baileys, via pipeline `fun/pipeline/onIncomingMessage.js`), navegador desktop + mobile (iOS/Android WebView do WhatsApp e navegadores) — mobile-first

**Project Type**: Web app no monorepo (`fun/` backend + `fun_dashboard/` Next.js)

**Performance Goals**: Ações de jogo no navegador com feedback em < 1s (sem rede externa); página da casa carrega sem artefatos no mobile; resposta do comando no grupo em < 2s (padrão do módulo)

**Constraints**:
- Nunca iniciar conversa privada no WhatsApp (risco de banimento); link pessoal só via DM iniciado pelo usuário
- Mais de 30 rótulos de comandos; novos comandos entram por extensão no `router.js` sem tocar nos existentes
- Backend da web sem framework (http puro, padrão existente)
- Fronteira server/client do Next: dados no servidor, interatividade em Client Components; não expor JIDs de outros grupos
- Constituição do módulo fun (movimentação via ledger atômico, caps/cooldowns centralizados, builds e gates verdes)

**Scale/Scope**: Dezenas de grupos (whitelist), até ~1000 usuários por grupo; casas/avatares por jogador por grupo; escala do módulo existente

**Constraints adicionais de economia**:
- Ledger atômico via `addCoins`/`transferCoins` (`funStatsRepository`) — nunca update direto de saldo
- Caps e cooldowns em `fun/constants.js` / `fun/config.js` (padrão `assaultCooldownMs`, `betMax` etc.)
- Punição in-game com piso/teto (padrão `assaultFailFinePct/Min/Max`/`heist*FailFinePct`)
- Reusar `assaultCooldownMs`, `assaultBaseChance`, `assaultMinSteal`, `assaultMaxStealRatio`, `assaultFailFinePct/Min/Max` do roubo de propriedades existente
- Copy pública sem contradizer os números
- Conteúdo gerado por usuário (recados da visita) com blocklist/limite

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle (constituição fun) | Status | Verificação |
|---|------------------------------|--------|-------------|
| 1 | Arquitetura em camadas: constants → schema → repo → service → handler → pipeline → testes → docs | ✅ PASS | Toda feature nova segue a ordem; repositórios só persistem, services têm regras, handlers finos |
| 2 | Regras de negócio em `fun/services/` (ou `fun/economy/)`; repositórios só persistência; handlers parsing+delegação | ✅ PASS | `houseService`/`avatarService`/`robberyService` centralizam regras; novos handlers finos |
| 3 | Módulo standalone: dados em `data/fun/` via TMB_DATA_DIR isolado em `fun/start.js`, sem carregar `.tmb` | ✅ PASS | Não há fluxos `.tmb`; banco isolado |
| 4 | Persistência isolada por `scope_key` (JID do grupo); identidade canônica `@s.whatsapp.net`; nenhuma tabela ignora escopo | ✅ PASS | Toda tabela nova tem `scope_key`; identidade via JID canônico |
| 5 | Novas tabelas em `fun/schema.js` (create-if-not-exists) + incremento `FUN_SCHEMA_VERSION`; migrações idempotentes | ✅ PASS | Bump para `'31'`; migrações idempotentes |
| 6 | Movimentação de moeda via ledger transacional atômico — nunca update direto | ✅ PASS | `addCoins`/`transferCoins` via `funStatsRepository` |
| 7 | Apostas/compras/coletas/assaltos/eventos respeitam caps e cooldowns centralizados em `fun/constants.js`/`fun/config.js` | ✅ PASS | Novas chaves de config com normalizeInt + defaults |
| 8 | Motor econômico é única fonte de preços (arquétipos versionados, impacto determinístico) | ✅ PASS (não aplica a casas — preços de itens são estáticos no catálogo; consulte "Complexity Tracking") | Catálogo de casas em `fun/shop/houses.js` como constantes |
| 9 | Copy pública alinhada à direção real; penalidades in-game com piso/teto (ex.: 5% saldo, piso 10, teto 200); nunca kick/ban por meta | ✅ PASS | Multas usam piso/teto de `assault/assaultFailFine`; sem kick/ban |
| 10 | Drama público/zoeira no grupo mas nunca doxxing, fofoca de DM ou dados pessoais; NSFW com opt-out | ✅ PASS | Recados/visitas dentro do grupo; sem exposição de dados pessoais |
| 11 | Opt-out sempre possível; anúncios respeitam quiet hours; eventos autônomos obedecem `worldAutonomous`/`worldTickMs` | ✅ PASS | Rotina de limpeza/sujeira respeita quiet hours e `worldTickMs` |
| 12 | Corretora web read-only e isolada do admin; sem listar grupos, sem compra/venda na web, sem eco de JIDs | ✅ PASS | Casas usam segmento público próprio, fora do admin; sem listar grupos |
| 13 | Toda feature com conteúdo gerado por usuário tem feature-gate ou filtro (blocklist, max length, sem mídia) | ✅ PASS | Recados com filtro/limite; sem mídia |
| 14 | Testes `node --test` em `tests/fun-*.test.js`, determinísticos, banco temporário, `FUN_DISABLE_LIVE_LLM=1`, stubs | ✅ PASS | Novas suítes seguem o padrão |
| 15 | Invariantes de economia (caps, ledger, saldo não-negativo) testados; proibido remover/enfraquecer testes | ✅ PASS | Invariantes cobertos |
| 16 | LLM em cascata Zen → Ollama → template local com timeout/retry; falha nunca quebra comando | ✅ PASS | Fallbacks mantidos; LLM não é crítico em casas |
| 17 | Config: segredos nunca em `config.user.json` commitado; defaults centralizados | ✅ PASS | Novas chaves em `constants.js`/`config.js` |
| 18 | Commits Conventional Commits com escopo `fun`/`fun-*`; PRs validam `npm test`, `npm run fun:dev --setup`, e build do dashboard se UI mudar | ✅ PASS | Gates de PR |
| 19 | APIs do dashboard: `POST /api/fun/changelog` e admin só com auth; a corretora permanece pública e read-only | ✅ PASS | Segmento `/casas/*` público com auth por token do jogador (posse do link) |
| 20 | Mensagens e formatters centralizados (`fun/messages/`, `fun/formatters/`) | ✅ PASS | Novas mensagens em `fun/messages/` |
| 21 | Alterações de UI preservam isolamento `/bolsa*` (sem sidebar/admin) e tema claro/escuro com variáveis CSS | ✅ PASS | `/casas/*` próprio segmento público com tema |

**Violações detectadas**: Nenhuma obrigatória. Uma observação documentada no Complexity Tracking (catálogo de preços estático vs motor econômico — não é violação, pois itens de casa não negociam em preço).

## Project Structure

### Documentation (this feature)

```text
specs/004-fun-houses-game/
├── plan.md              # Este arquivo (/speckit-plan)
├── research.md          # Fase 0: decisões técnicas
├── data-model.md        # Fase 1: modelo de dados
├── quickstart.md        # Fase 1: guia de validação
├── contracts/           # Fase 1: contratos de API/comandos
└── tasks.md             # Fase 2 (/speckit-tasks - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
fun/
├── constants.js                 # + caps de capacidade/limpeza/seguranca de casas; FUN_SCHEMA_VERSION '31'
├── config.js                    # + chaves houses/avatar/robbery (normalizeInt/Boolean)
├── schema.js                    # + tabelas fun_house*, fun_user_avatar; migracoes idempotentes
├── shop/
│   ├── houses.js                # catalogo estatico de casas/moveis/mascotes
│   └── avatars.js               # catalogo global de slotItems (por nivel/comravel)
├── db/
│   ├── funHouseRepository.js    # CRUD casas/itens/posicao/visitas/presentes (todos por scope_key)
│   └── funAvatarRepository.js   # estado do avatar + equipamentos (por scope_key)
├── services/
│   ├── houseService.js          # regras de provision, colocar/mover/vender, limpeza/renda por tick, coletar
│   ├── avatarService.js         # regras de equipar/desbloquear/compra de roupa
│   ├── visitService.js          # visitar, mural, recado (filtro), teto diario
│   ├── giftService.js           # dar presente, entregar, vender presente
│   ├── robberyService.js        # roubo: chance, seguranca, multa, procurado
│   └── houseLinkService.js      # token: gerar/revogar/resolver
├── commands/handlers/
│   ├── house.js                 # /casa (grupo instrui DM; DM lista grupos e manda link)
│   └── avatar.js                # /avatar [link|desbloquear|info] (DM)
├── dashboard/
│   └── server.js                # + rotas /api/fun/houses/* (ver contracts/api-web.md)
├── messages/
│   └── house.js                 # mensagens centralizadas (DRY)
└── formatters/
    └── house.js                 # formata emoji/grid para o grupo

fun_dashboard/
├── src/middleware.ts            # + /casas/* como caminho público (sem auth admin)
├── src/app/
│   ├── casas/
│   │   ├── layout.tsx           # tema público, sem AppShell (padrão bolsa)
│   │   └── [token]/
│   │       ├── page.tsx         # visor da casa (decorar/mudar avatar da owning; visitar dos demais)
│   │       ├── decorar/page.tsx # editor da própria casa
│   │       └── avatar/page.tsx  # editor do próprio avatar
├── src/components/casas/        # FloorGrid, HouseCard, MoveableItem, AvatarShowcase, VisitMural, GiftPanel, RobberyPanel
├── src/lib/
│   ├── api.ts                   # + funApi.houses.* (proxy para /api/fun/houses/*)
│   └── types.ts                 # + tipos Houses/Avatar/Visit/Gift/Robbery
```

**Structure Decision**: Backend do jogo em `fun/` nas mesmas camadas existentes, sem criar novo projeto — mesmo padrão da mecânica `property` (`fun/shop/properties.js` → `fun/services/propertyService.js` → `fun/db/funPropertyRepository.js`). Frontend no `fun_dashboard` existente, com segmento público novo `/casas/*` replicando o isolamento de `/bolsa` (layout próprio, sem sidebar admin, sem listar grupos). Não há processo novo nem projeto novo; a web é um segmento do dashboard Next.js existente. Representante da porta pública via rewrite `/api/fun/:path*` já existente (`fun_dashboard/next.config.ts`).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Catálogo de casas estático (constantes) em vez de motor econômico | Preços fixos de itens de loja — não são ativos negociáveis como ações da bolsa; não há tick de preço | Não se aplica: motor econômico é para ativos; casas têm preço fixo de loja (simplicidade, DRY) |
| 3 serviços novos (visit/gift/robbery) separados do `propertyService` | Casas introduzem mecânica social nova (visita/presente/roubo de decoração) distinta de "propriedade que gera renda" | Fundir com propertyService misturaria responsabilidades distintas, violando SRP |
| Auth por token do jogador nas rotas web públicas de escrita | O padrão do repo é http puro + função `requireAdmin` (admin); precisamos de auth por token (posse do link) para ações de jogador | Express/framework adicionaria dependência; criar mini-framework geral seria over-engineering (YAGNI) |