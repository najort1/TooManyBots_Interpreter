# TooManyBots Interpreter

Motor de interpretação de fluxos de conversação para bots de WhatsApp. Crie chatbots declarativos através de arquivos `.tmb` (TooManyBots) que definem fluxos de mensagens, condições, integrações HTTP e gerenciamento de estado de sessão.

---

## Índice

- [Visão Geral](#visão-geral)
- [Stack Tecnológico](#stack-tecnológico)
- [Quick Start](#quick-start)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Workflow de Desenvolvimento](#workflow-de-desenvolvimento)
- [Testes](#testes)
- [Scripts npm](#scripts-npm)
- [Configuração do IDE](#configuração-do-ide)
- [Pontos de Entrada](#pontos-de-entrada)
- [Documentação](#documentação)

---

## Visão Geral

O **TooManyBots Interpreter** resolve o problema de criar bots de WhatsApp complexos sem necessidade de programação. Ele permite:

- **Fluxos Declarativos**: Defina conversas em arquivos `.tmb` JSON
- **Múltiplos Bots**: Execute vários bots simultaneamente
- **Integrações HTTP**: Conecte-se a APIs externas
- **Handoff Humano**: Escale para atendimento humano quando necessário
- **Pesquisas (Surveys)**: Colete feedback dos usuários
- **Broadcast**: Envie mensagens em massa segmentadas
- **Dashboard Real-time**: Monitore conversas e métricas em tempo real com indicador de conexão WebSocket

### Capacidades Principais

- **Engine de Fluxos**: Processamento de blocos (mensagem, delay, input, condicional, integração, pesquisa)
- **Runtime WhatsApp**: Conexão via Baileys para múltiplas contas
- **Persistência**: SQLite para contatos, sessões, analytics e histórico
- **Dashboard React**: Interface moderna com React Router, recarga de fluxos com feedback visual e logs amigáveis

---

## Stack Tecnológico

### Backend

| Tecnologia | Versão | Propósito |
|------------|--------|-----------|
| **Node.js** | 18+ | Runtime principal |
| **better-sqlite3** | ^12.8.0 | Banco de dados SQLite síncrono |
| **baileys** | ^7.0.0 | Biblioteca WhatsApp (@whiskeysockets/baileys) |
| **pino** | ^8.19.0 | Logging estruturado |
| **pino-pretty** | ^11.0.0 | Formatação de logs |

### Frontend (Dashboard)

| Tecnologia | Versão | Propósito |
|------------|--------|-----------|
| **React** | ^19.2.4 | UI framework |
| **React Router** | ^7.9.4 | Roteamento client-side |
| **TypeScript** | ~6.0.2 | Type safety |
| **Vite** | ^8.0.4 | Build tool e dev server |
| **Tailwind CSS** | ^4.2.2 | Utility-first styling |
| **Chart.js** | ^4.5.1 | Visualização de dados |
| **Lucide React** | - | Iconografia |

### Ferramentas de Build & Test

| Ferramenta | Propósito |
|------------|-----------|
| **Jest** | Test runner |
| **ESLint** | Linting de código |
| **npm** | Gerenciamento de pacotes |

---

## Quick Start

### Pré-requisitos

- Node.js 18 ou superior
- npm (incluído com Node.js)
- Windows (para uso do `iniciar.bat`)

### Instalação

```bash
# 1. Clone o repositório
git clone <repo-url>
cd TooManyBots_Interpreter

# 2. Instale as dependências do backend
npm install

# 3. Instale as dependências do dashboard
cd tmb_dashboard
npm install
cd ..
```

### Primeira Execução (Setup Inicial)

**⚠️ Importante (Windows):** O `better-sqlite3` requer ferramentas de compilação. Se `npm install` falhar:
- Instale o **Visual Studio Build Tools** ou **Visual Studio Community** com a carga de trabalho "Desenvolvimento para desktop com C++"
- Ou use `npm install --build-from-source` se já tiver o Python e node-gyp configurado

Na primeira execução, o interpretador:
1. Inicia automaticamente o **dashboard web** em `http://127.0.0.1:8787`
2. Abre o navegador automaticamente (se possível)
3. Exibe a mensagem: *"Nenhuma configuração salva detectada. Abra a aba 'Setup Inicial' na dashboard para continuar."*

**O que fazer:**
1. Coloque seu arquivo `.tmb` na pasta `bots/` (criada automaticamente)
2. Acesse a aba **"Setup Inicial"** no dashboard
3. Selecione seu fluxo e configure a conexão WhatsApp

Ou simplesmente use o script automatizado:
```bash
iniciar.bat
```

O script `iniciar.bat` cuida de toda a configuração automaticamente no Windows.

### Execução

```bash
# Opção 1: Usando o batch no Windows
iniciar.bat

# Opção 2: Node.js diretamente
node index.js

# Opção 3: Modo desenvolvimento com watch
npm run dev
```

### Dashboard - Duas Formas de Executar

**Opção 1: Dashboard Embutido (Produção) - Recomendado**
```bash
# Inicia o interpretador + dashboard embutido na porta 8787
node index.js
# Acesse: http://127.0.0.1:8787
```
O interpretador inicia automaticamente o dashboard embutido após compilar o frontend.

**Opção 2: Dashboard em Desenvolvimento (Hot Reload)**
```bash
# Em um terminal separado, para desenvolvimento do frontend
cd tmb_dashboard
npm run dev
# Acesse: http://localhost:5173
```
Use esta opção **apenas** se estiver modificando o código do dashboard. Não execute ambos simultaneamente.

### UX Operacional do Dashboard

- A aba **Visão Geral** concentra métricas, gráficos e logs em tempo real.
- A aba **Gestão de Fluxos** permite recarregar os `.tmb` com feedback de progresso, sucesso ou falha.
- Logs e sessões priorizam nomes resolvidos de contatos/grupos; o JID continua disponível como detalhe técnico quando necessário.
- Eventos técnicos de sistema ficam ocultos por padrão nos logs, com opção para exibição diagnóstica.
- A barra superior separa o status do runtime do status **Tempo real**, que indica WebSocket conectado ou reconectando.
- Estados vazios explicam os pre-requisitos operacionais: contatos aparecem conforme o runtime conhece chats do WhatsApp, handoff depende do bloco `redirect-to-human`, e pesquisas sao enviadas por bloco `survey` ou pela aba de disparo manual.
- Telas de configuracao evitam termos internos do SQLite como rotulo principal; detalhes como WAL/SHM ficam contextualizados como armazenamento auxiliar.

---

## Estrutura do Projeto

### Código-Fonte

```
TooManyBots_Interpreter/
├── config/                        # Configurações e wizard
│   ├── index.js                   # Configuração centralizada
│   ├── constants.js               # Constantes do sistema
│   └── configWizard.js            # Assistente de configuração interativo
├── dashboard/                     # Servidor HTTP/WebSocket
│   ├── server.js                  # Servidor principal
│   ├── apiRouter.js               # Rotas da API
│   ├── httpServer.js              # Servidor HTTP
│   └── websocketManager.js        # Gerenciamento de WebSockets
├── db/                            # Camada de persistência
│   ├── analyticsRepository.js     # Métricas de conversação
│   ├── broadcastRepository.js     # Histórico de broadcasts
│   ├── contactRepository.js       # Gestão de contatos
│   ├── sessionRepository.js       # Sessões ativas
│   ├── surveyRepository.js        # Pesquisas e respostas
│   └── index.js                   # Exportações consolidadas
├── engine/                        # Motor de interpretação
│   ├── flowEngine.js              # Execução principal de blocos
│   ├── surveyEngine.js            # Lógica de pesquisas
│   ├── handoffEngine.js           # Handoff humano
│   ├── flowLoader.js              # Parser de arquivos .tmb
│   ├── broadcastService.js        # Broadcast em massa
│   └── apiMetrics.js              # Métricas de chamadas HTTP
├── handlers/                      # Processadores de blocos
│   ├── basicHandlers.js           # Blocos básicos (mensagem, delay, input)
│   ├── conditionalHandlers.js     # Blocos condicionais
│   ├── integrationHandlers.js     # Chamadas HTTP
│   ├── interactionHandlers.js     # Botões e listas
│   └── surveyHandlers.js          # Blocos de pesquisa
├── runtime/                       # Runtime e lifecycle
│   ├── container.js               # Inicialização modular
│   ├── whatsappRuntime.js         # Conexão WhatsApp
│   ├── ingestionQueue.js          # Fila de processamento
│   ├── ingestionPipeline.js       # Pipeline com policies
│   ├── dashboardBridge.js         # Bridge para dashboard
│   └── healthMetrics.js           # Métricas de saúde
├── tmb_dashboard/                 # Dashboard React moderno
│   └── src/
│       ├── components/            # Componentes UI
│       ├── hooks/                 # Hooks customizados
│       ├── lib/                   # Utilitários e API clients
│       ├── App.tsx                # App principal
│       ├── router.tsx             # Configuração de rotas
│       └── main.tsx               # Entry point
├── tests/                         # Testes automatizados
├── utils/                         # Utilitários centralizados
│   ├── normalization.js           # Normalização de dados
│   ├── async.js                   # Funções assíncronas
│   ├── errors.js                  # Serialização de erros
│   └── surveyRuntime.js           # Runtime de pesquisas
├── index.js                       # Entry point do runtime
├── flowLoader.js                  # Loader de fluxos
├── flowEngine.js                  # Engine principal
├── package.json
└── iniciar.bat                    # Script de inicialização (Windows)
```

### Arquivos Gerados pelo Sistema

Na primeira execução, o interpretador cria automaticamente:
- `bots/` - Pasta para seus fluxos `.tmb` (arquivos de bot)
- `config.user.json` - Configuração do projeto (criada via dashboard)
- `data/` - Banco de dados SQLite (`*.db`)

Estes arquivos estão no `.gitignore` e não devem ser commitados.

---

## Workflow de Desenvolvimento

### Branch Strategy

- **`main`**: Branch principal com código estável
- Todas as mudanças passam por commits diretos na `main` (fluxo simplificado)

### Conventional Commits

Seguimos a especificação [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<escopo>): <descrição>
```

**Tipos comuns:**
- `feat`: Nova funcionalidade
- `fix`: Correção de bug
- `refactor`: Refatoração sem mudança de comportamento
- `test`: Adição/modificação de testes
- `docs`: Documentação
- `build`: Mudanças em dependências ou build

**Escopos comuns:**
- `dashboard`: API e servidor do dashboard
- `db`: Camada de persistência
- `engine`: Motor de interpretação
- `handlers`: Processadores de blocos
- `runtime`: Runtime e lifecycle
- `utils`: Utilitários
- `tmb-dashboard`: Dashboard React
- `metrics`: Métricas e analytics
- `survey`: Sistema de pesquisas
- `router`: Roteamento
- `deps`: Dependências

**Exemplos:**
```bash
feat(dashboard): adicionar endpoint de métricas em tempo real
fix(engine): corrigir processamento de blocos condicionais
refactor(utils): extrair função toText para normalization.js
test(survey): adicionar testes de regras de frequência
docs: atualizar README com novas funcionalidades
```

### Code Review Standards

- Toda mudança deve preservar compatibilidade com APIs existentes
- Refatorações devem usar utilitários centralizados (`utils/`)
- Novos módulos `db/` devem seguir o padrão de repositório especializado
- Testes devem ser adicionados para funcionalidades críticas
- Verifique `AGENTS.md` para orientações de colaboração

---

## Testes

### Framework

Os testes automatizados do backend rodam pelo script `npm test`, que atualmente usa `node --test --import ./tests/test-env-setup.js tests/*.test.js`. A documentação histórica ainda referencia Jest em alguns pontos, mas o comando real do repositório é a fonte de verdade.

### Executando Testes

```bash
# Executar todos os testes
npm test

# Modo watch (útil durante desenvolvimento)
npm test -- --watch

# Com cobertura
npm test -- --coverage

# Executar teste específico
npm test -- data-processor-conditions.test.js
```

### Estrutura de Testes

Os testes estão localizados em `tests/`:

- `advanced-blocks.test.js` - Blocos avançados (condicionais, integração)
- `contact-utils.test.js` - Utilitários de contato
- `data-processor-conditions.test.js` - Condicionais de processamento
- `ingestion-queue.test.js` - Fila de ingestão
- `multi-bot.test.js` - Suporte multi-bot
- `survey-module.test.js` - Módulo de pesquisas
- `runtime-feature-*.test.js` - Testes de runtime

### Quality Gates

- **Testes devem passar** antes de merge
- **Não remover ou enfraquecer testes** sem aprovação explícita
- **Adicionar testes** para novas funcionalidades, especialmente handlers e utilitários
- **Smoke test**: `smoke-test.js` para validação rápida do sistema

### Ambiente de Teste

Adicionado ambiente de testes isolado (Abril/2026):
- Diretório temporário para dados de teste
- Variável de ambiente `TMB_TEST_DATA_DIR` configurável
- Setup automático em `tests/test-env-setup.js`

---

## Scripts npm

### Backend (raiz)

| Comando | Descrição |
|---------|-----------|
| `npm start` | Inicia o runtime do bot |
| `npm run dev` | Inicia com watch mode (`node --watch`) |
| `npm test` | Executa a suite de testes backend com `node --test` |

### Dashboard (`tmb_dashboard/`)

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Servidor de desenvolvimento Vite (hot reload) |
| `npm run build` | Build de produção |
| `npm run lint` | ESLint |
| `npm run preview` | Preview do build de produção |

### Scripts do Projeto Principal

| Comando | Descrição |
|---------|-----------|
| `npm run dashboard:dev` | Inicia dashboard em modo dev |
| `npm run dashboard:build` | Build do dashboard |
| `npm run dashboard:lint` | Lint do dashboard |

---

## Configuração do IDE

### VS Code - Extensões Recomendadas

- **ESLint** - Linting JavaScript/TypeScript
- **Prettier** - Formatação de código
- **SQLite Viewer** - Visualização de banco de dados
- **Tailwind CSS IntelliSense** - Autocomplete de classes Tailwind
- **GitLens** - Git supercharged

### Configurações do Projeto

- **ESLint**: Configurado em `eslint.config.js` (dashboard)
- **TypeScript**: `tsconfig.json` no `tmb_dashboard/`
- **Test runner backend**: `node --test` com preload `tests/test-env-setup.js`

### Dicas de Produtividade

**Debug com logs verbose:**
```bash
DEBUG=* node index.js
DEBUG=baileys node index.js
```

**Acesso direto ao SQLite:**
```bash
sqlite3 data/bot.db
```

**Backup do banco:**
```bash
cp data/bot.db data/bot.db.backup
```

---

## Pontos de Entrada

### Runtime Principal

**`index.js`** - Entry point do runtime WhatsApp multi-bot

```bash
node index.js
```

Inicializa:
- Container de dependências (`runtime/container.js`)
- Conexão WhatsApp (`runtime/whatsappRuntime.js`)
- Pipeline de ingestão (`runtime/ingestionPipeline.js`)
- Dashboard server (`dashboard/server.js`)

### Dashboard

**`tmb_dashboard/src/main.tsx`** - Entry point da aplicação React

```bash
cd tmb_dashboard
npm run dev
```

Inicializa:
- React 18 com TypeScript
- React Router 7
- Vite dev server

### Key Exports

- `connectToWhatsApp()` @ `runtime/whatsappRuntime.js` - Conexão WhatsApp
- `delay()` @ `utils/async.js` - Utilitário de timeout
- `normalizeInt()` @ `utils/normalization.js` - Normalização de inteiros
- `stringifyError()` @ `utils/errors.js` - Serialização de erros
- `broadcastDashboardEvent()` @ `runtime/dashboardBridge.js` - Eventos dashboard

---

## Documentação

A documentação completa está disponível em `.context/docs/`:

| Documento | Descrição |
|-----------|-----------|
| [`project-overview.md`](.context/docs/project-overview.md) | Visão geral do projeto, arquitetura e stack |
| [`development-workflow.md`](.context/docs/development-workflow.md) | Fluxo de trabalho, commits e code review |
| [`testing-strategy.md`](.context/docs/testing-strategy.md) | Estratégia de testes e quality gates |
| [`tooling.md`](.context/docs/tooling.md) | Ferramentas e dicas de produtividade |
| [`AGENTS.md`](AGENTS.md) | Repository map e guia de colaboração |

---

## Contribuindo

1. Familiarize-se com a estrutura em [`Project Overview`](.context/docs/project-overview.md)
2. Execute `npm test` para verificar setup
3. Explore `smoke-test.js` para entender o fluxo básico
4. Leia os handlers em `handlers/` para entender o processamento de blocos
5. Verifique o `db/index.js` para entender a camada de persistência

Consulte [`Development Workflow`](.context/docs/development-workflow.md) para mais detalhes.

---

## Resolução de Problemas

### `npm install` falha com erro de `node-gyp` ou `better-sqlite3`
**Causa:** O `better-sqlite3` precisa ser compilado.  
**Solução (Windows):** Instale o Visual Studio Build Tools:
```bash
# Opção 1: Via winget
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# Opção 2: Baixe em https://visualstudio.microsoft.com/downloads/
# Selecione "Ferramentas de Build" com a carga de trabalho "Desenvolvimento para desktop com C++"
```

### "Nenhuma configuração salva detectada"
**Normal!** Na primeira execução, isso é esperado. Acesse o dashboard em `http://127.0.0.1:8787` e use a aba **"Setup Inicial"**.

### Não consigo acessar o dashboard
Verifique:
1. O interpretador está rodando? (veja os logs no terminal)
2. Tente `http://127.0.0.1:8787` (produção) ou `http://localhost:5173` (dev)
3. Verifique se a porta não está em uso por outro programa

### Meu arquivo .tmb não aparece no dashboard
- Verifique se está na pasta `bots/` (na raiz do projeto)
- Verifique se tem a extensão `.tmb`
- Valide o JSON: use uma ferramenta como https://jsonlint.com/

### Smoke test falha
O `smoke-test.js` requer um fluxo de exemplo. Crie um arquivo `bots/flow.tmb` com o exemplo acima antes de rodar.

---

## Licença

[Adicionar informação de licença]

---

**Última atualização:** Abril de 2026
</Content>
