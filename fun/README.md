# Fun Bot

Bot de **divertimento** para grupos de WhatsApp — processo **standalone**, independente do interpreter de fluxos `.tmb`.

XP, coins, daily, ranks, casamento, cassino, mercado de rua, bolsa, panelinhas, missões, tarô, fofoca, stickers e um “relógio do mundo” que anuncia eventos sozinho.

---

## O que é / o que não é

| É | Não é |
|---|--------|
| Processo separado (`npm run fun`) | Um bot de atendimento com fluxos `.tmb` |
| Config em `fun/config.user.json` | O `config.user.json` da raiz do TMB |
| Dados em `data/fun/` | O SQLite/auth dos bots de suporte |
| Comandos de jogo no grupo (e DM opcional) | Dashboard de conversas humanas do TMB |

Reusa o core do monorepo (Baileys, SQLite auth, parser, sender), mas **não carrega** fluxos nem bots de atendimento.

---

## Subir

Na raiz do repositório:

```bash
npm install

# primeira vez (ou forçar wizard de grupos)
npm run fun -- --setup

# normal
npm run fun

# com reload em mudanças
npm run fun:dev
```

1. Escaneie o **QR** no terminal (sessão WhatsApp do Fun).
2. No wizard, escolha os **grupos liberados** (whitelist).
3. No grupo: `/ajuda`.

### TUI — painel de auditoria (TTY)

Ao rodar `npm run fun` em um terminal interativo, ao fim do boot (após QR/wizard)
a tela vira um **painel full-screen** com 5 abas. Pino/Baileys foram para o `stderr`
para não corromper o painel.

| Tecla | Ação |
|-------|------|
| `Tab` | alterna entre abas |
| `↑` / `↓` | rola a lista |
| `q` | sai (restaura terminal e libera lock) |

| Aba | O que mostra |
|-----|--------------|
| Auditoria | histórico dos eventos do mundo por categoria (market, news, self-heal, chaos, etc.) |
| Saúde | conexão, filas (cmd/output), reconexão, último tick do mundo |
| Economia | últimos `economy-tick` (changed/stockChanged/scheduledApplied/reason) + total acumulado |
| LLM | contadores por tarefa×provider, taxa `invent` (zen vs template), alerta de `templateRate ≥ 40%` |
| Grupos | grupos whitelist, top comandos por escopo, top players |

> **Fallback plain**: quando o stdout **não é TTY** (redirecionamento, CI, serviço)
> o painel **não inicia** e os eventos caem como `[fun] HH:MM:SS [categoria] ok|falha
> scope? detalhe?` no stdout — mesmo formato_legacy do `runtime.js`.

#### Configuração (`fun/config.user.json`)

```json
{
  "tuiEnabled": true,        // false desliga o painel (fallback plain sempre)
  "tuiRefreshMs": 1000,      // intervalo de refresh (200–10_000)
  "tuiMaxHistory": 200       // histórico em anel (20–2000)
}
```

- `tuiEnabled: false` → só fallback plain (logs no stdout).
- `tuiRefreshMs` baixo ⇒ mais responsivo, mais CPU; baixo demais pode piscar.
- `tuiMaxHistory` alto ⇒ retém mais contexto, mais RAM.

### Dashboard

| Superfície | Como | URL default |
|------------|------|-------------|
| API embutida no bot | sobe com `npm run fun` se `dashboardEnabled` | http://127.0.0.1:8790 |
| UI Next.js | `npm run fun:dashboard` | http://127.0.0.1:3001 |

Detalhes da UI: [`fun_dashboard/README.md`](../fun_dashboard/README.md).

---

## Persona: memória e contexto

A persona preserva os gatilhos e fallback existentes, mas agora observa mensagens de grupo para manter threads por reply, fatos explícitos e uma identidade local. A recuperação é sempre isolada por `scope_key`: fatos confirmados são separados de sinais inferidos, e registros sensíveis, suprimidos ou expirados não entram no prompt. Configure `personaMemoryEnabled` e `personaMemoryMaxContextItems` em `fun/config.user.json` para desativar ou limitar essa camada.

## Auto-aprimoramento de dados

O auto-aprimoramento audita periodicamente dados do grupo. A LLM apenas propõe achados estruturados; ela não recebe escrita no banco. A camada determinística valida schema, escopo e evidência antes de aplicar qualquer correção.

- **Evidência**: mensagens elegíveis são normalizadas, recebem hash e ficam em retenção configurável. Não persiste mídia, comandos ou conteúdo sensível.
- **Autonomia com guardrails**: correções comprovadas de baixo risco (autoria, texto, deduplicação) podem ser aplicadas; exclusões, economia, perfis sensíveis e supressões viram pendência de revisão administrativa.
- **Segurança operacional**: cada ação, rejeição ou simulação fica em auditoria; a varredura respeita `scope_key`, quiet hours, orçamento e falhas de LLM sem bloquear o bot.
- **Admin**: no dashboard, a seção **Auto-aprimoramento** permite habilitar/desabilitar, executar varredura manual, usar dry-run, consultar histórico e decidir pendências de alto risco.

Configuração recomendada em `fun/config.user.json`:

```json
{
  "selfHealEnabled": true,
  "selfHealDryRun": true,
  "selfHealIntervalMs": 600000,
  "selfHealEvidenceRetentionDays": 60,
  "selfHealMaxItemsPerRun": 50,
  "selfHealMaxCallsPerRun": 10
}
```

Comece com `selfHealDryRun: true`. Nesse modo o relatório e a trilha de auditoria são gravados, mas fatos, memórias, economia e perfis não sofrem alterações. Após revisar os achados, desative o dry-run para permitir somente ações de baixo risco comprovadas. A cobertura é incremental: lore do grupo, memórias de conversa, e verificações de economia/perfis.

## Configuração

| Arquivo | Função |
|---------|--------|
| `fun/config.user.json` | Config local (não commitar segredos) |
| `fun/config.user.example.json` | Modelo |
| `fun/config.public.json` | Overrides públicos (ex.: URL base de jobs) |
| `fun/config.js` | Merge + defaults (`DEFAULT_FUN_CONFIG` em `constants.js`) |

Campos úteis (exemplo):

```json
{
  "prefix": "/",
  "requireGroupWhitelist": true,
  "groupWhitelistJids": ["120363...@g.us"],
  "allowDm": true,
  "dataDir": "./data/fun",
  "dashboardEnabled": true,
  "dashboardPort": 8790,
  "worldAutonomous": true,
  "marketEnabled": true,
  "economyEnabled": true,
  "zenEnabled": true,
  "ollamaEnabled": true
}
```

### LLM (opcional)

Cascata de sabor / eventos / zoeira:

1. **Zen** (`zenBaseUrl`, default `http://127.0.0.1:3000`)
2. **Templates** locais se o Zen estiver indisponível ou se chamadas reais estiverem desabilitadas

O fallback Ollama está descontinuado no runtime. Testes setam `FUN_DISABLE_LIVE_LLM=1` para não bater rede.

### Dados e isolamento

- Default: `data/fun/` (via `TMB_DATA_DIR` definido em `start.js` **antes** de carregar o DB).
- Auth Baileys e SQLite do Fun ficam aí — não misturam com o interpreter principal.
- Economia, inventário e ranks são por **`scope_key`** (JID do grupo).

---

## Comandos (resumo)

Ajuda no zap: `/ajuda` · `/ajuda economia` · `/ajuda mundo` · `/ajuda cassino` · …

| Tema | Exemplos |
|------|----------|
| **Básico** | `/xp` `/perfil` `/rank` `/rankcoins` `/topmsg` `/daily` `/saldo` `/pay 50 @user` |
| **Economia** | `/loja` `/mercado` `/armas` `/adquirir gasolina` `/inventario` `/bazar` `/assaltar` |
| **Mundo & auto** | `/ajuda mundo` — relógio, quiet hours, notícias de mercado, negócios, jornal 23:59, conquistas |
| **Negócios** | `/negocio` `/negocio comprar barraca` `/coletar` `/negocio consertar barraca` |
| **Bolsa** | `/bolsa` `/carteira` `/bolsa comprar bombatech 3` `/bolsa vender pato 1` · web read-only `/bolsa/<id-grupo>` |
| **Conquistas** | `/conquistas` |
| **Social** | `/marry @user` `/aceitar` `/recusar` `/divorce` `/ship @a @b` |
| **Emprego** | `/emprego` `/emprego bombeiro` `/demitir sim` `/trabalhar` |
| **Jogos** | `/cf 20 cara` `/sorte` `/aposta @user 20 cara` `/roletarussa` `/puxar` |
| **Cassino** | `/roleta` `/slot` `/crash` `/bj` `/bingo` `/torneio` `/rankcassino` |
| **Zoeira** | `/tarot` `/cancelar` `/fofoca` `/oraculo` `/illuminati` `/roast` `/lore` |
| **Persona** | Cite `bot` ou marque o bot com `@` para ele responder como um membro do grupo. Respeita quiet hours, cooldown e toggle por grupo no dashboard. |
| **Panelinhas** | `/panelinha` `/ponte` `/missao` `/squad` `/evento` |
| **Mídia** | `/fig` (legenda na mídia ou reply) |
| **Privado** | `/grupo` (escopo do DM, se `allowDm`) |

Lista viva e completa: `fun/formatters/helpGuide.js` + `fun/constants.js` (aliases).

---

## Economia de 4 camadas

Mercado de rua + bolsa usam o pacote `fun/economy/`:

| Camada | Papel | Onde |
|--------|--------|------|
| **C1** Motor | tick de preço, supply/demand, clamp | `engine.js` |
| **C2** Jornalista | narrativa alinhada aos números reais | `eventPipeline.js` |
| **C3** Arquétipos | choques versionados (sem % inventado pela IA) | `archetypes.js` |
| **C4** Regulador | overheat, frequência, decepção com follow-up | `regulator.js`, `deception.js` |

Fluxo típico de evento:

1. IA (ou template) sugere **arquétipo + história** (não manda `impactPct`).
2. Catálogo resolve impacto; overheat pode forçar correção de queda.
3. Preços aplicam tick + caps (±12% por evento, floors/ceils por empresa).
4. **Copy pública** é alinhada à direção real do ticker (manchete e `%` não se contradizem).
5. Relógio do mundo (`worldAutonomous`) anuncia no grupo sem mensagem humana.

Empresas (bolsa / personalidade): BurgerZap, Uno Motors, BombaTech, Peixaria do João, Satélite BR, PatoCoin — ver `economy/companies.js`.

### Corretora web (somente leitura · isolada do admin)

Cada grupo tem a sua bolsa. O **bot manda o link já com o id do grupo** — não há seletor de grupos na web (privacidade).

| URL | Auth | O que faz |
|-----|------|-----------|
| `/bolsa/<id-grupo>` | **Público** | Só corretora: cotações, ATH, gráfico, datas, notícias |
| `/bolsa` | Público | “Use o link do zap” — **sem listar grupos** |

- **Fora** do dashboard admin (sem sidebar / groups / settings).
- APIs GET only: `/api/fun/bolsa`, `/history`, `/events` — sem compra/venda, sem eco de JID no JSON.
- Ordens **somente no WhatsApp**.
- Histórico: `fun_stock_price_history` (schema v18).
- Link no `/bolsa` do zap: `config.public.json` → `publicBaseUrl`.

Itens de rua: `shop/collectibles.js` (gasolina, armas, veículos, etc.).

---

## Mapa do código

```
fun/
  start.js              # entry: isola TMB_DATA_DIR → runtime
  runtime.js            # Baileys + reconnect + dashboard API
  index.js              # createFunModule (services + world tick)
  wizard.js             # setup de whitelist de grupos
  config.js             # load/merge config
  constants.js          # comandos, defaults, action types
  schema.js             # DDL fun_* no SQLite
  pipeline/             # onIncomingMessage
  commands/             # router + handlers por domínio
  services/             # regras de jogo (xp, market, casino…)
  economy/              # motor econômico 4 camadas
  db/                   # repositórios fun_*
  llm/                  # Zen → Ollama → template
  shop/                 # catálogo loja + collectibles
  jobs/                 # cargos CLT + tokens de teste
  formatters/           # help, cards de rank (PNG)
  utils/                # labels, stickers, quiet hours, membership
  dashboard/server.js   # API HTTP local do bot
  docs/                 # roadmap P1/P2
  scripts/              # reset mercado, limpeza de jobs de teste
```

UI administrativa: `fun_dashboard/` (Next.js, consome a API do bot).

---

## Relógio do mundo

Com `worldAutonomous: true` (default):

- Tick periódico: mercado, happy hour, eventos de escopo.
- **Quiet hours** ~1h–6h (sem spam na madrugada) — `utils/worldQuietHours.js`.
- Eventos de mercado **autônomos** não dependem de alguém mandar mensagem.

Desligar: `"worldAutonomous": false` no `config.user.json`.

---

## Testes

Na raiz:

```bash
# suite geral (inclui fun-*)
npm run test

# só economia / mercado / cassino (exemplos)
node --test --import ./tests/test-env-setup.js tests/fun-economy.test.js
node --test --import ./tests/test-env-setup.js tests/fun-market.test.js
node --test --import ./tests/test-env-setup.js tests/fun-casino.test.js
```

Arquivos relevantes: `tests/fun-*.test.js`.

---

## Scripts utilitários

```bash
# resetar preços do mercado (cuidado: estado do jogo)
node fun/scripts/reset-market-prices.mjs

# links / limpeza de dados de teste de emprego
node fun/scripts/gen-job-test-links.mjs
node fun/scripts/cleanup-job-test-data.mjs
```

---

## Princípios de produto

1. Punição **só in-game** (coins, título, rank) — nunca kick/ban por meta.
2. Drama **público e de zoeira** no grupo, não doxxing.
3. Caps de stake, cooldown e impacto de mercado.
4. Escopo por grupo (`scope_key`); identidade canônica `@s.whatsapp.net` (LID resolvido).
5. Opt-out de panelinha sempre possível.

Roadmap P1/P2 (alianças, guerra, tribunal…): [`docs/FUN-P1-P2-ROADMAP.md`](./docs/FUN-P1-P2-ROADMAP.md).

---

## Troubleshooting rápido

| Sintoma | Checagem |
|---------|----------|
| Bot não responde no grupo | JID na `groupWhitelistJids`? `requireGroupWhitelist`? |
| QR de novo toda hora | `data/fun` apagado ou outro processo no mesmo auth? |
| Mercado sem notícia | `marketEnabled` / `worldAutonomous` / quiet hours |
| Textos de IA genéricos | Zen/Ollama no ar? senão cai em template |
| Dashboard 3001 sem dados | Bot na 8790? `FUN_API_URL` apontando certo? |

---

## Licença / monorepo

Parte do repositório **TooManyBots_Interpreter**. Ver `CONTRIBUTING.md` e `Agents.md` na raiz para mapa geral e convenções de PR.


## Casas e avatares

`/casa` cria a casa padrão no escopo do grupo e, no DM, entrega um link pessoal para `/casas/{token}`. `/avatar` abre o editor do avatar no mesmo link. Em grupos, ambos os comandos apenas instruem a chamar o bot no privado.

- A casa começa com sofá e planta, permite comprar, mover e vender decoração, limpar e coletar a recompensa diária.
- Itens de avatar são liberados por nível ou comprados com coins; as compras e vendas sempre passam pelo ledger existente.
- Visitas, presentes e roubos são isolados por `scope_key`. Item roubado recebe posse plena e pode ser vendido ou presenteado pelo novo dono.
- Os links usam token aleatório de 24 bytes com hash `scrypt` e salt no banco. O token é enviado somente em DM; nunca entra em respostas da API.

Configurações novas em `fun/config.user.json`: `housesEnabled`, `avatarEnabled`, `visitsEnabled`, `giftsEnabled`, `robberyEnabled`, `houseDailyCollectMax`, `houseMaxItems`, `houseSecurityMaxLevel`, `houseRobberyCooldownMs` e `houseRobberyDailyMax`.

Tabelas: `fun_houses`, `fun_house_items`, `fun_house_visits`, `fun_house_gifts`, `fun_house_tokens`, `fun_avatar_state` e `fun_house_robberies`.
