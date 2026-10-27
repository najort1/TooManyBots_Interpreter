# TooManyBots Fun

Bot de entretenimento para grupos de WhatsApp. XP, coins, loja, bolsa, cassino, panelinhas, casas, avatares, empregos e uma persona viva com IA local.

O projeto roda como um processo Node.js separado (`npm run fun`), conversa por Baileys e guarda tudo em um SQLite próprio, dentro de `data/fun/`. Ele não carrega os fluxos `.tmb` do interpretador TMB: as duas coisas convivem no mesmo repositório, mas o Fun é um bot de jogo, não um bot de atendimento.

---

## Índice

- [Visão geral](#visão-geral)
- [O que dá para fazer](#o-que-dá-para-fazer)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Primeiro boot](#primeiro-boot)
- [Executando](#executando)
- [Comandos](#comandos)
- [Configuração](#configuração)
- [Como o runtime funciona](#como-o-runtime-funciona)
- [Economia em 4 camadas](#economia-em-4-camadas)
- [Persona, memória e IA](#persona-memória-e-ia)
- [Dashboard e observabilidade](#dashboard-e-observabilidade)
- [Dados e isolamento](#dados-e-isolamento)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Testes](#testes)
- [Scripts](#scripts)
- [Troubleshooting](#troubleshooting)
- [Documentação](#documentação)

---

## Visão geral

O Fun Bot é um servidor de mundo aberto para grupos de WhatsApp. Cada grupo autorizado vira um pequeno universo com economia, cassino, panelinhas e um relógio que continua funcionando mesmo quando ninguém manda mensagem.

| | Fun Bot |
|---|---|
| Processo | standalone, `npm run fun` |
| Configuração | `fun/config.user.json` |
| Dados e sessão | `data/fun/` (SQLite + auth Baileys) |
| Entrada | comandos com prefixo (padrão `/`) no grupo ou no privado |
| Saída | mensagens de texto, figurinhas, imagens, áudios e o painel do mundo |
| IA | opcional. Sem provedor configurado, o bot responde com templates locais |

Ele reaproveita o core do monorepo (parser de mensagem, sender, conexão Baileys, filas e camada de SQLite), mas mantém ciclo de vida, banco e regras de negócio próprios.

### O que dá para fazer

- **Perfil e progressão**: XP, níveis, títulos, coins, ranking do grupo, conquistas, daily com bônus de sequência e desafios diários de conhecimento.
- **Economia**: loja oficial, inventário, bazar entre membros, mercado de rua com negócios, bolsa com seis empresas e corretora web de leitura.
- **Cassino e jogos**: roleta europeia com regra La Partage, 21, caça-níqueis, crash, bingo, torneio de oito jogadores, cara ou coroa, aposta P2P, roleta russa e jogos multiplayer web (Quiz Royale, Grid CTF, King of the Hill).
- **Vida social**: panelinhas (facções), índice de ponte, missões mistas, tribunal do povo, contratos de caça, casamento e divórcio, química 4D, `/ship`, perfis e despedidas.
- **Empregos**: cargos CLT, freela, expediente, simulador tático de bombeiro e desafio de firewall.
- **Mundo virtual**: casas 2D e 3D, avatares customizáveis, carros tunados, visitas, presentes e roubos.
- **Mídia**: figurinhas, geração de imagem por IA, reações e áudio de voz.
- **Persona viva**: o bot responde como um membro do grupo, com humor, memória do grupo, lore aprendida, autonomia limitada e voz sintetizada.
- **Relógio do mundo**: mercado, eventos, happy hour, jornal das 23:59, lembretes e auditoria de dados rodando sozinhos.

---

## Requisitos

- Node.js 18 ou superior (20 LTS recomendado). O `npm run fun:doctor` checa isso e outros pontos do ambiente.
- npm.
- Uma conta de WhatsApp para parear o bot (o pareamento é feito por QR code no terminal).
- Opcional: um endpoint de IA (veja [Configuração](#configuração)) e chaves de API para voz, imagem, figurinhas animadas e som.
- Opcional: `ffmpeg` no PATH, para áudio Opus e figurinha animada.

---

## Instalação

```bash
# 1. Clone o repositório
git clone https://github.com/najort1/TooManyBots_Interpreter.git
cd TooManyBots_Interpreter

# 2. Dependências do bot
npm install

# 3. Dependências do dashboard web
npm --prefix fun_dashboard install

# 4. Variáveis de ambiente (opcional, mas recomendado)
cp .env.example .env
```

No Windows, copie o `.env` com `copy .env.example .env`.

O `better-sqlite3` é nativo. Se o `npm install` reclamar de `node-gyp` no Windows, instale o Visual Studio Build Tools com a carga de trabalho "Desenvolvimento para desktop com C++".

### Atalho no Windows

Na raiz existem dois `.bat` que cuidam do trabalho chato:

- `setup.bat`: confere Node e npm, instala as dependências, recompila o `better-sqlite3` se precisar e abre o assistente de configuração.
- `iniciar_fun.bat`: faz a mesma checagem e abre um menu com iniciar o bot (QR), iniciar bot e dashboard 3D juntos, refazer a configuração, rodar o doctor ou sair.

---

## Primeiro boot

```bash
npm run fun -- --setup
```

O que acontece:

1. O banco é criado em `data/fun/` e o schema do jogo (`fun_*`, versão 37) é aplicado.
2. O terminal mostra um QR code. Escaneie com o WhatsApp da conta do bot.
3. O wizard lista os grupos do WhatsApp e pergunta quais entram na whitelist.
4. Depois do pareamento, o relógio do mundo começa a rodar e o painel TUI assume a tela.

No grupo, comece por:

```
/ajuda
```

Para refazer a whitelist depois: `npm run fun -- --setup`.

---

## Executando

```bash
npm run fun        # processo normal
npm run fun:dev    # com reload em mudanças (node --watch)
```

### Superfícies

| Interface | Porta | Como sobe |
|---|---|---|
| Bot + API HTTP interna | 8790 | junto com `npm run fun` |
| Dashboard web (Next.js) | 3001 | `npm run fun:dashboard` |
| Painel TUI no terminal | sem porta | automático em terminal interativo |

```bash
# terminal 1: bot e API
npm run fun

# terminal 2: dashboard web
npm run fun:dashboard
```

O dashboard consome a API do bot em `http://127.0.0.1:8790/api/fun/*`, através de um rewrite do Next (`/api/fun/*` vira `${FUN_API_URL}/api/fun/*`). Se o bot estiver desligado, a UI sobe mas não tem o que mostrar.

### Painel do terminal (TUI)

Em um terminal interativo, o bot vira um painel full screen com cinco abas: Auditoria, Saúde, Economia, LLM e Grupos. `Tab` alterna, setas rolam e `q` sai. Os logs do Pino e do Baileys vão para `stderr` para não corromper o desenho.

Sem TTY (serviço, CI, pipe), o painel não sobe e os eventos saem em texto simples no stdout, no formato `[fun] HH:MM:SS [categoria] ok|falha scope? detalhe?`.

---

## Comandos

O prefixo padrão é `/` e sai de `fun/config.user.json` (`prefix`). A lista completa vive em `fun/commands/catalog.js` e `fun/constants.js`, e o próprio bot responde com `/ajuda`, `/ajuda economia`, `/ajuda mundo`, `/ajuda cassino` e companhia.

| Tema | Exemplos |
|---|---|
| Perfil | `/xp`, `/perfil`, `/rank`, `/rankcoins`, `/rankmessages`, `/conquistas`, `/cadastrar` |
| Economia | `/daily`, `/saldo`, `/pay @user 100`, `/loja`, `/comprar item_id`, `/inventario`, `/bazar`, `/vender item_id 500` |
| Mercado e bolsa | `/galeria`, `/propriedades`, `/coletar`, `/bolsa`, `/carteira`, `/bolsa comprar bombatech 3`, `/bolsa vender bombatech 1` |
| Emprego | `/emprego`, `/trabalhar`, `/demissao` |
| Jogos | `/cf 20 cara`, `/sorte`, `/aposta @user 50`, `/roletarussa`, `/puxar`, `/desafio`, `/dica` |
| Cassino | `/roleta vermelho 100`, `/slot 50`, `/crash 100`, `/cashout`, `/bj 100`, `/hit`, `/stand`, `/bingo`, `/torneio`, `/rankcassino` |
| Social | `/marry @user`, `/aceitar`, `/recusar`, `/divorce`, `/ship @a @b`, `/relacao @user`, `/despedir @user` |
| Panelinhas | `/panelinha criar Nome`, `/ponte`, `/missao`, `/squad`, `/evento`, `/tribunal @user motivo`, `/bounty @user 200` |
| Casas e avatares | `/casa`, `/avatar`, `/meucarro`, `/carro` |
| Zoeira e mídia | `/tarot`, `/fofoca`, `/oraculo`, `/roast`, `/illuminati`, `/lore`, `/fig`, `/gerar` |

Regras gerais:

- Comandos sociais, panelinhas e apostas entre duas pessoas só funcionam em grupo.
- O bot responde no privado, mas nunca inicia uma conversa privada por conta própria a partir de um comando de grupo.
- Todo comando tem cooldown próprio, definido no catálogo.
- Cada grupo tem o seu próprio saldo, inventário, ranking e economia (o `scope_key` é o JID do grupo).

---

## Configuração

### Arquivos

| Arquivo | Para que serve |
|---|---|
| `fun/config.user.json` | configuração local do bot (whitelist, prefixo, IA, toggles). Já está no `.gitignore` |
| `fun/config.user.example.json` | modelo com todos os campos e os valores padrão |
| `fun/config.public.json` | poucos valores públicos, como a `publicBaseUrl` usada nos links da corretora |
| `fun/config.js` + `fun/constants.js` | merge da configuração e defaults (`DEFAULT_FUN_CONFIG`) |
| `.env` | chaves de provedores de IA e de mídia |

### Campos que você provavelmente vai mexer

```json
{
  "prefix": "/",
  "requireGroupWhitelist": true,
  "groupWhitelistJids": ["120363...@g.us"],
  "allowDm": true,
  "dataDir": "./data/fun",
  "dashboardEnabled": true,
  "dashboardHost": "127.0.0.1",
  "dashboardPort": 8790,
  "worldAutonomous": true,
  "zenEnabled": false,
  "zenBaseUrl": "http://localhost:20128/v1",
  "zenModel": "bot-zap"
}
```

### IA

O registro de provedores (`fun/llm/providers.js`) conhece OpenRouter, DeepSeek, OpenAI, Ollama, LM Studio, o Zen Proxy e qualquer endpoint compatível com OpenAI. O Zen Proxy local é o caminho padrão do projeto, porque mantém tudo na máquina.

A cascata é sempre a mesma:

1. chama o endpoint configurado;
2. se ele estiver fora do ar ou desativado, o bot entra em **modo econômico** e responde com templates locais, sem latência e sem custo.

Cada tarefa tem seus próprios parâmetros de amostragem (`fun/llm/zenTaskParams.js`): a persona fala com temperatura alta, a extração de memórias é fria e curta, a auditoria de dados é conservadora.

Variáveis de ambiente úteis:

| Variável | Para que serve |
|---|---|
| `FUN_DISABLE_LIVE_LLM=1` | desliga chamadas externas e força o modo econômico (usado nos testes) |
| `ZEN_API_KEY` | chave do Zen Proxy |
| `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY` | provedores externos |
| `GEMINI_API_KEY` | voz da persona e geração de imagem |
| `YOUTUBE_API_KEY`, `TENOR_API_KEY` | som e reação animada |
| `METERED_API_KEY`, `METERED_DOMAIN` | servidor STUN/TURN para as salas de jogo |
| `TMB_DATA_DIR` | diretório de dados do bot (padrão `data/fun`) |
| `FUN_API_URL` | URL da API do bot usada pelo dashboard (padrão `http://127.0.0.1:8790`) |
| `FUN_DASHBOARD_API_KEY` | chave de acesso ao dashboard administrativo |
| `FUN_DASHBOARD_RATE_MAX` | requisições por IP na janela de rate limit do dashboard (padrão 60) |
| `FUN_DASHBOARD_HOUSE_SESSION_RATE_MAX` | requisições por sessão de casa em tempo real (padrão 20) |
| `DEBUG_ENV=1` | mostra o que foi lido do `.env` no boot |

As chaves do dashboard ficam em `fun_dashboard/.env.local` (modelo em `fun_dashboard/.env.example`), e o `.env` da raiz vale para o bot. O assistente de configuração (`npm run setup`) grava nos dois lugares ao mesmo tempo: `fun/config.user.json` e o `.env` da raiz.

---

## Como o runtime funciona

### Boot

`fun/start.js` fixa `TMB_DATA_DIR` em `data/fun/` **antes** de qualquer import do banco, cria o diretório, garante as pastas de assets e chama `startFunBot()` em `fun/runtime.js`. A partir daí:

1. lock de instância (`fun-runtime.lock`) para não subir dois bots com a mesma sessão;
2. banco aberto e schema do jogo aplicado;
3. API do dashboard no ar (antes do WhatsApp, para o dashboard abrir sem QR);
4. teste de conectividade do endpoint de IA, com queda automática para o modo econômico;
5. conexão Baileys e QR code;
6. wizard de grupos, se a whitelist estiver vazia;
7. relógio do mundo ligado;
8. TUI assumindo o terminal, se houver TTY.

### Filas

O runtime separa o que é rápido do que é pesado para não travar o grupo:

| Fila | Concorrência | Uso |
|---|---|---|
| `fast` | 8 | leituras de estado (`/xp`, `/saldo`, `/perfil`, `/ajuda`) |
| `state` | 4 | transações de banco (`/pay`, `/aposta`, `/comprar`, `/roleta`) |
| `heavy` | 8 | chamadas de IA ou serviço externo (`/tarot`, `/roast`, `/fig`) |

Na saída, a `OutputQueue` limita a 8 envios simultâneos, segura 250 ms entre mensagens no mesmo JID e agrupa mensagens de baixa prioridade em até 1 s, o que evita rajada no grupo.

### Relógio do mundo

A cada 45 segundos (configurável em `worldTickMs`) o bot checa o estado do mundo: preço das ações, eventos de mercado, happy hour, lembretes, varreduras de memória, varredura de dados, follow-ups da persona e o journal das 23:59. Entre 01:00 e 06:00 (America/Sao_Paulo) os anúncios autônomos ficam desligados, com exceção do journal. Para desligar o relógio inteiro: `"worldAutonomous": false`.

### Identidade (LID e PN)

O mesmo participante aparece no WhatsApp como número (`@s.whatsapp.net`) ou como identificador privado (`@lid`). O runtime aprende o par LID/PN pela chave da mensagem e migra os dados do usuário de forma idempotente, para o saldo, o ranking e o inventário não se partirem em dois.

---

## Economia em 4 camadas

O mercado de rua e a bolsa usam o pacote `fun/economy/`, com quatro camadas que não se misturam:

| Camada | Papel | Arquivo |
|---|---|---|
| C1, motor | tick de preço, oferta e demanda, limites de variação | `engine.js` |
| C2, jornalista | narrativa alinhada aos números reais | `eventPipeline.js` |
| C3, arquétipos | choques versionados, sem porcentagem inventada | `archetypes.js` |
| C4, regulador | superaquecimento, frequência e decepção com follow-up | `regulator.js`, `deception.js` |

O fluxo de um evento é sempre o mesmo: a IA (ou o template) sugere um arquétipo e uma história, o catálogo resolve o impacto, os preços aplicam o tick com teto de 12% por evento, e a manchete pública sai alinhada com a direção real do ticker. As empresas da bolsa estão em `fun/economy/companies.js`: BurgerZap, Uno Motors, BombaTech, Peixaria do João, Satélite BR e PatoCoin.

A corretora web (`/bolsa/<id-do-grupo>` no dashboard) é pública e somente de leitura: cotações, gráfico, recordes e notícias. Compra e venda acontecem no WhatsApp, e o site nunca lista os grupos.

---

## Persona, memória e IA

A persona segue a ideia de "bot membro vivo": ela não abre conversa com "posso ajudar?", fala em primeira pessoa, calibra o humor pelo tom do grupo e alterna entre one-liners e respostas longas conforme o assunto pede.

- **Gatilhos**: menção direta, citação em reply, palavra-chave do apelido e oportunidades espontâneas (com política de autonomia e cooldown por grupo).
- **Ferramentas**: a persona consulta lore e status do grupo, abre a roleta russa, dá dica do desafio, faz tiragem de tarô, mede química entre duas pessoas, manda figurinha, reage e sintetiza áudio de voz (`fun/services/personaToolProtocol.js`).
- **Anti-alucinação**: se o texto afirmar que mandou um áudio ou uma figurinha sem a ferramenta correspondente ter sido chamada, a resposta é rejeitada e reprocessada.
- **Memória**: tudo é recuperado por `scope_key`. Fatos confirmados ficam separados de sinais inferidos, e registros sensíveis, suprimidos ou expirados não entram no prompt.
- **Auto-aprimoramento**: a LLM só propõe achados estruturados. A camada determinística valida schema, escopo e evidência antes de aplicar qualquer correção, com dry-run por padrão. Exclusões, economia, perfis sensíveis e supressões viram pendência para aprovação no dashboard.

---

## Dashboard e observabilidade

### TUI

Cinco abas no terminal: Auditoria (eventos do mundo por categoria), Saúde (conexão, filas, reconexão, último tick), Economia (últimos ticks do motor C1), LLM (contadores por tarefa e provedor, alerta quando a taxa de template passa de 40%) e Grupos (whitelist, comandos mais usados, jogadores mais ativos).

### API do bot

`fun/dashboard/server.js` sobe em `127.0.0.1:8790` e expõe o estado do jogo, a configuração e os controles em `/api/fun/*`. Ela responde mesmo com o WhatsApp desconectado, o que facilita diagnosticar um bot que saiu do ar.

### Dashboard web

Next.js 15 (App Router), React 19, Tailwind 4, Phaser e Three.js em `fun_dashboard/`. Rotas:

| Rota | O que mostra |
|---|---|
| `/overview` | métricas do grupo, ranking e abertura de sala multiplayer |
| `/ranking` | leaderboard por XP, coins e mensagens |
| `/economia` | gestão da economia e inflação: saúde monetária, Gini, distribuição de riqueza e intervenção do regulador |
| `/casino` | métricas do cassino e facções do grupo |
| `/desafios` | lança desafio diário na whitelist |
| `/groups` | grupos, permissões, comandos desativados e toggles por grupo |
| `/llm` | analytics da IA (por período e grupo) e configuração por feature |
| `/modelos` | modelo global e modelo por função (chat, memória, jogos, sistema) |
| `/selfheal` | auditoria de dados, varredura manual e aprovação de achados |
| `/changelog` | editor de changelog e disparo para grupos selecionados |
| `/logs` | logs ao vivo com filtros, busca e download |
| `/settings` | configuração geral, guard de saída e preferências |
| `/job/play` | minigames de emprego (bombeiro e estagiário) |
| `/casas`, `/casas/[token]`, `/casas/[token]/avatar` | casas 3D e editor de avatar |
| `/casas/preview` | preview do mundo 3D, com dados simulados |
| `/carros/[token]` | oficina de customização de carro em 3D |
| `/jogos/[roomId]` | salas multiplayer (SSE) |
| `/bolsa`, `/bolsa/[scope]` | corretora pública, somente leitura |

A corretora (`/bolsa`) é a única tela de dados que existe sem o menu administrativo: ela não tem sidebar, não tem seletor de grupo e não lista os grupos.

O acesso às telas de operação exige `FUN_DASHBOARD_API_KEY`, por cookie `fun_dash_key`, header `x-api-key` ou header Bearer. O padrão é fail-secure: só ficam abertas a corretora e as páginas de casa, carro, sala de jogo e os mini-games de emprego, acessadas por link pessoal com token. Todas as rotas têm rate limit por IP (60 por minuto, 20 por sessão de casa em tempo real). Sem a chave configurada, o Next aceita o fallback local `fun-dashboard-dev-key` e a API do bot libera qualquer chamada, o que é tranquilo em `127.0.0.1` mas vale saber antes de expor a porta.

---

## Dados e isolamento

- Tudo do Fun vive em `data/fun/`: `runtime.db` (credenciais Baileys e estado do runtime) e `analytics.db` (schema `analytics` com as tabelas `fun_*`, em modo WAL).
- O core compartilhado do TMB (parser, sender, `db/context.js`) é reutilizado, mas o `TMB_DATA_DIR` do Fun aponta para o diretório isolado, então nada se mistura com o bot de atendimento.
- Economia, inventário, ranking, panelinhas e memórias são por `scope_key`, o JID do grupo.
- Apagar `data/fun/` é o jeito de começar do zero e forçar um novo pareamento por QR.

Tabelas principais: `fun_user_stats`, `fun_coin_ledger`, `fun_factions`, `fun_social_edges`, `fun_stock_quotes`, `fun_stock_holdings`, `fun_casino_stats`, `fun_roulette_history`, `fun_group_memories`, `fun_evidence_log`, `fun_persona_identities`, `fun_houses`, `fun_avatar_state_v2`, `fun_group_events` e `fun_journal_messages`.

---

## Estrutura do repositório

```
TooManyBots_Interpreter/
├── fun/                       # Fun Bot (foco do projeto)
│   ├── start.js               # entry: isola o data dir e sobe o runtime
│   ├── runtime.js             # Baileys, reconexão, filas, relógio do mundo, TUI
│   ├── index.js               # createFunModule: monta serviços e repositórios
│   ├── config.js              # merge de configuração
│   ├── constants.js           # defaults, catálogo de comandos, versão do schema
│   ├── schema.js              # DDL das tabelas fun_*
│   ├── wizard.js              # setup da whitelist de grupos
│   ├── pipeline/              # onIncomingMessage
│   ├── commands/              # catálogo, router e handlers por domínio
│   ├── services/              # regras de jogo (xp, mercado, cassino, persona...)
│   ├── economy/               # motor econômico em 4 camadas
│   ├── casino/                # roleta, dealer, histórico, ranking
│   ├── games/                 # salas multiplayer e SSE
│   ├── events/                # extração e agregação de eventos do grupo
│   ├── llm/                   # provedores, governança e métricas de IA
│   ├── db/                    # repositórios fun_*
│   ├── shop/                  # catálogo de loja, casas, avatares, cartas
│   ├── jobs/                  # cargos CLT e tokens de teste
│   ├── firefighters/          # simulador tático de bombeiro
│   ├── tui/                   # painel de auditoria no terminal
│   ├── dashboard/             # API HTTP interna do bot
│   ├── messages/, formatters/, utils/, scripts/, assets/
│   └── docs/                  # roadmap P1/P2 e notas de subutilização de IA
├── fun_dashboard/             # dashboard web Next.js do Fun
├── engine/, runtime/, db/, utils/, handlers/   # core TMB compartilhado
├── dashboard/, tmb_dashboard/, bots/, config/   # interpretador TMB (fora do foco)
├── tests/                     # suíte node:test (a maioria é fun-*.test.js)
├── docs/obsidian/             # documentação de arquitetura por subsistema
├── specs/                     # especificações por feature (persona, self-heal, casas)
├── data/fun/                  # dados e sessão do bot (gerado, ignorado pelo git)
└── package.json
```

---

## Testes

```bash
npm test
```

O script usa `node --test` com o preload `tests/test-env-setup.js`, que cria um diretório de dados temporário e isola as variáveis de ambiente. São 164 arquivos de teste, 147 deles do módulo Fun (`fun-*.test.js`), cobrindo economia, mercado, bolsa, cassino, panelinhas, persona, memória, self-healing, casas, avatares, TUI, filas e comandos.

```bash
# um arquivo específico
node --test --import ./tests/test-env-setup.js tests/fun-economy.test.js
```

Os testes não batem em rede: `FUN_DISABLE_LIVE_LLM=1` mantém tudo no modo econômico. O dashboard não tem suíte de navegador (Playwright e axe estão nas devDependencies, mas sem testes e2e); a cobertura dele vem de testes node que importam os módulos de `fun_dashboard/src`.

---

## Scripts

| Comando | O que faz |
|---|---|
| `npm run fun` | sobe o bot |
| `npm run fun:dev` | sobe o bot com watch |
| `npm run fun -- --setup` | refaz o wizard de grupos |
| `npm run setup` | abre o assistente de configuração (também em `npm run fun:setup`) |
| `npm run fun:doctor` | diagnostica ambiente, dependências e configuração |
| `npm run fun:test-game` | cria contas, panelinhas e sala de teste para os jogos multiplayer |
| `npm run fun:dashboard` | dashboard web em desenvolvimento (porta 3001) |
| `npm run fun:dashboard:build` | build de produção do dashboard |
| `npm run fun:dashboard:start` | dashboard web em modo start |
| `npm test` | suíte de testes |

`npm start`, `npm run dev` e `npm run dashboard:*` pertencem ao interpretador TMB e ao dashboard antigo em `tmb_dashboard/`. Eles continuam no repositório, mas não fazem parte do Fun.

Scripts auxiliares dentro de `fun/scripts/`:

```bash
node fun/scripts/reset-market-prices.mjs      # zera os preços do mercado
node fun/scripts/gen-job-test-links.mjs        # gera links de teste de emprego
node fun/scripts/cleanup-job-test-data.mjs     # limpa os dados de teste
node fun/scripts/live-market-coherence.mjs     # sonda de coerência do mercado
```

---

## Troubleshooting

| Sintoma | O que olhar |
|---|---|
| Bot não responde no grupo | o JID está em `groupWhitelistJids`? `requireGroupWhitelist` está ligado? |
| QR aparece toda vez | `data/fun/` foi apagado ou outro processo está usando a mesma sessão |
| Mercado parado | `worldAutonomous`, `marketEnabled` e as quiet hours |
| Textos de IA genéricos ou ausentes | o endpoint de IA está no ar? sem ele o bot usa templates |
| Dashboard abre vazio | o bot está rodando na 8790? `FUN_API_URL` aponta para a porta certa? |
| `npm install` falha com `node-gyp` | faltam as ferramentas de build do C++ no Windows |
| Sessão do WhatsApp caiu | o runtime reconecta sozinho; se o logout for definitivo, apague `data/fun/` e pareie de novo |

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [`fun/README.md`](fun/README.md) | manual do módulo Fun, mais detalhado e sempre atualizado |
| [`docs/obsidian/`](docs/obsidian/) | arquitetura por subsistema, do runtime à persona |
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | constituição do módulo: escopo, ordem das camadas e quality gates |
| [`fun/docs/FUN-P1-P2-ROADMAP.md`](fun/docs/FUN-P1-P2-ROADMAP.md) | roadmap do que vem depois |
| [`fun/docs/LLM-SUBUTILIZACAO.md`](fun/docs/LLM-SUBUTILIZACAO.md) | levantamento de onde a IA está sendo subutilizada |
| [`fun_dashboard/README.md`](fun_dashboard/README.md) | detalhes do dashboard web |
| [`specs/`](specs/) | especificações de bot membro vivo, memória, self-healing e casas |

### Princípios de produto

1. Punição só dentro do jogo (coins, título, ranking). Nunca kick nem ban por zoeira.
2. Drama público e de brincadeira, sem doxxing.
3. Teto de aposta, cooldown e limite de impacto de mercado.
4. Tudo separado por grupo (`scope_key`).
5. Opt-out de panelinha sempre possível.
