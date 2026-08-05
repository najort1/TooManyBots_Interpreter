# Levantamento: pontos de subutilização do LLM no módulo `fun`

> Alvo: identificar onde dá pra injetar mais contexto, dar mais liberdade ao modelo e melhorar o que já existe — **sem reescrever arquitetura**.

Classificação:
- **INJETAR CONTEXTO** — dados que já existem no código mas não chegam ao prompt.
- **LIBERAR MODELO** — restrições/parâmetros conservadores que amarram a saída.
- **CONSISTÊNCIA/BUG** — divergências com a infra existente que limitam ganhos.

HOTSPOTS por impacto (alto → baixo): `personaService` → `groupMemoryService`(persona) → `dailyChallengeService` → `flavorService` → `marketService`(journalist) → `personaSocialHintService` → `tarotService` → `profileService` → `qmpService`.

---

## 1. personaService — resposta do bot (maior impacto, ponto central)

`fun/services/personaService.js` · chamada em `generateResponse` (l.415).

### INJETAR CONTEXTO
- **Quem falou**: o `prompt` (user) é só o texto da mensagem (l.409). Não injeta nome do autor, mencionados, nem texto da mensagem citada (reply). O modelo responde "cego". — `participantJids` é computado (l.487) e usado só em `getHints`, não vira prompt.
- **`loreBlock` truncado a 320 chars** (l.386) — o `groupMemoryService` produz ~0.8–2k chars de lore; corta agressivamente. Há espaço.
- **`facts` limitado a 4** (`slice(0,4)` l.403) — fatos disponíveis são truncados.
- **`socialHints` filtrado a 6 e só conf≥60 não-negative** (l.389) — descarta dicas neutras/baixa confiança.
- **Identidade rica do perfil** (`profileService.buildIdentityBlock`: nick/bio/niver/título) **não é chamada**. Só chega `groupIdentity` (voiceStyle/lore), não a identidade dos participantes.
- **`threadContext` só 4 turnos** (l.373) sem incluir texto citado de reply.

### LIBERAR MODELO
- **`maxChars` recém reduzido p/ 200** (`PERSONA_MAX_CHARS`) e o prompt ainda diz "1 a 3 frases" + "até maxChars caracteres". Se o objetivo é member "natural", o teto de 200 chars corta respostas com desenvolvimento. Considerar relaxar p/ ~280–320 e instruir "frases completas, desenvolva".
- **Sem retry** (l.431) — único serviço sem `zenMaxRetries`; falha única → fallback estático de 9 frases. Inconsistente com flavor/market/extract (4 tentativas).
- **Sem JSON mode** — texto puro sanitizado; `{reply:"..."}` evitaria meta leakage e simplificaria `sanitizeFlavor`.

### CONSISTÊNCIA
- **`sendSamplingParams: !== false`** (l.424) vs resto `=== true` — personifica envia sampling por default, os outros não. Confirmar intenção.
- **timeoutMs 15s efetivo** (`Math.min(15s, 35s)`) menor que o task default 35s — pode abortar respostas.

---

## 2. groupMemoryService — persona (lore do grupo)

`fun/services/groupMemoryService.js` · `refreshPersona` (l.1078), chamada LLM l.1102.

### LIBERAR MODELO
- **A persona já usa a task `persona`** (não `extract`), com perfil de geração próprio. Não é necessário criar uma task `personaMemory` só para corrigir temperatura.
- **`refreshPersona` só roda se `inserted+reinforced>0 || random()<0.35`** (l.749) — persona pode ficar desatualizada em grupos pouco ativos.

### INJETAR CONTEXTO
- **Extract não injeta persona atual** no prompt — o modelo re-extrai sem saber o "clima" já consolidado.
- **Extract não recebe `group_identity`** (nicks/bios) — o LLM adivinha quem é quem só pelo `name` do batch; erros de atribuição hoje mitigados por `inferSubjectIndicesFromSummary`.

### CONSISTÊNCIA
- **`looseParseFacts` (regex salvager)** indica JSON mode não 100% confiável — mesmo com `jsonMode:true`, há fallback regex pesado (l.346). Se o proxy suporta `json_schema` strict, usar.
- **`knownFactsInPrompt=24`** + system reenviado a cada flush sem prompt caching.

---

## 3. dailyChallengeService — guess_game / riddle / hints

`fun/services/dailyChallengeService.js` · `tryLlmJson` (l.192), `llmText` (l.228).

### CONSISTÊNCIA / BUG
- **Parâmetros hard-coded** (l.206-210 temp 0.9/maxTokens 400; l.252-256 temp 0.8/180) — **ignora `resolveZenTaskParams`**. Inconsistente com o resto do codebase; não respeita overrides de config. Criar task `dailyGuess`/`dailyHint` em `zenTaskParams.js`.
- **`tryLlmJson` sem retry verdadeiro** — só há 2ª chamada se o jogo repete nos recentes (l.552); falha de parse/timeout → fallback local direto.

### INJETAR CONTEXTO
- **Guess game não injeta gêneros/plataformas já saídos** — só nomes de jogos no anti-eco; pode sair 3 RPG seguidos com jogos diferentes.
- **Guess game/riddle não injetam perfil/lore do grupo** — o desafio é global; poderia personalizar ("inclua jogos que a galera já mencionou no chat" via memoryService).
- **Riddle não injeta dificuldade preferida** — sem feedback de acertos/erros para calibrar.
- **Hint pokémon não recebe tipo/habitat/geração/cor** — só o nome; o modelo alucina metadados que já existem na PokeAPI (buscada em `fetchPokemonName`).
- **Pokémon não usa LLM** — só sorteio de sprite + silhueta. Dicas poderiam ser geradas via LLM com metadados.

### LIBERAR MODELO
- **`maxTokens 400` no JSON de guess** pode truncar aliases/hints longos.
- **Hint `maxTokens 180`** pode truncar 2 frases.

---

## 4. flavorService — flavor / caos / assalto / jornal (maior volume de chamadas)

`fun/llm/flavorService.js` · Zen em l.1324, Ollama em l.1377.

### CONSISTÊNCIA / DEAD CODE
- **`ollamaOn` hardcoded false** (l.1047-1050) — caminho Ollama **morto**; `generateOllama`/`deps.generate` recebidos mas nunca chamados. Redundância.
- **`sendSamplingParams=false` default** (constants l.642) anula temperature/max_tokens no proxy. Chaos temp 1.0 / assault 0.95 **não chegam ao modelo** se o proxy já tem knobs fixos. E `zenBaseUrl` default é `localhost:20128/v1` (constants l.627), divergente do `:3300` do cliente — confirmar qual endpoint está em uso.

### INJETAR CONTEXTO
- O helper de lore já limita a seleção a ~6–8 fatos relevantes (~0.8–2k chars); esse sweet spot evita despejar memória demais no prompt. Não aumentar o limite indiscriminadamente.
- **Assalto não injeta detalhes do inventário** (qual veículo, arma específica além do nome, lockpick, munição) — contexto rico em `marketService` não chega ao prompt.
- **group_times**: `events` truncado em 800 chars e o system diz "use APENAS os eventos listados"; **lore/memória do grupo NÃO são injetadas no jornal** (l.1182-1191). O jornal fica sem histórico próprio.
- **Roast (`roast_personal`)**: system diz "use APENAS os `facts=`", mas só injeta facts crus — **sem lore/perfil do alvo**, embora existam em `groupMemoryService`/`profileService`.

### LIBERAR MODELO
- **Sem JSON mode p/ flavor/caos** — texto parseado por ~80 regras em `looksLikeMetaReasoning`. `{line:"..."}` + JSON mode reduziria drift.
- **Sem prompt caching** — a cada chamada reenvia system+lore completo (alto custo p/ `group_times` diário).

---

## 5. marketService — invent + journalist (reescrita desativada)

`fun/services/marketService.js` · invent l.538, journalist l.660.

### LIBERAR MODELO (ganho barato)
- **`marketJournalistEnabled` default OFF** (l.655) — a camada "jornalista" (reescrever fofoca com facts reais direction+%) está **implementada mas desativada**. Ponto óbvio de "usar mais LLM" sem impacto em jogo (só copy).

### INJETAR CONTEXTO
- **Invent não injeta lore/perfil do grupo** — fofoca de mercado genérica; poderia referenciar personas/fatos do grupo ("BombaTech explodiu depois que o [Nome] comprou tudo").

### CONSISTÊNCIA
- Invent skeleton (archetype/category/companyId) é fixo pelo código; LLM só preenche title/body. Tools/function calling deixaria o modelo propor dentro de enum controlado.

---

## 6. personaSocialHintService — pistas sociais

`fun/services/personaSocialHintService.js` · chamada l.104.

### CONSISTÊNCIA
- **Sem retry** — falha/vazio perde o batch (não 4x como extract).
- **Sem anti-eco** — pode re-inferir a mesma pista (QMP/flavor têm).
- **Sem contexto de thread/tempo** — batch `[i] Nome: texto` sem marcadores de GAP nem timestamps; pode conectar msgs de assuntos diferentes.
- **Sem `group_identity`** — erros de atribuição possíveis.
- **Sem salvage** — se JSON falha, `parseHints` retorna `[]` (extract tem `looseParseFacts`).

### INJETAR CONTEXTO / LIBERAR
- `batchSize=50` / `minMessages=8` — janela pequena; pistas de longo prazo escapam.

---

## 7. tarotService — leitura de tarô

`fun/services/tarotService.js` · l.168.

### INJETAR CONTEXTO
- **Não injeta perfil do consulente** — só pergunta + cartas; sem nick/bio/histórico do user. Leitura genérica.
- **Não injeta lore do grupo** — poderia referenciar personas/fatos.

### LIBERAR / CONSISTÊNCIA
- **`maxChars 3000` mas `tarotMaxTokens=1000`** — pode truncar antes do limite de chars; inconsistência.
- **Sem JSON mode** — `{reading:"..."}` evitaria sanitização regex.
- Precisa checar cooldown 45s e cache entre usuários do mesmo grupo.

---

## 8. profileService — extração de perfil

`fun/services/profileService.js` · l.643.

### INJETAR CONTEXTO
- **Não injeta perfil atual** — pode re-extrair campos já definidos e sobrescrever.
- **Texto truncado a 800 chars** (l.635).

### REDUNDÂNCIA
- `parseProfileManual` (regex) já faz boa parte — LLM quase redundante p/ campos estruturados; valor real está em `extras`/`bio` criativos (que `deriveExtras` também calcula). Considerar LLM só p/ `extras`/`bio`.

---

## 9. qmpService — "Quem é Mais Provável?"

`fun/services/qmpService.js` · l.480.

### CONSISTÊNCIA
- **Parâmetros hard-coded** (temp 0.95, maxTokens 320, timeoutMs 18s) — **não usa `resolveZenTaskParams`**. Igual ao dailyChallenge: ignora a governança de tasks. O endpoint/modelo global já é resolvido pela camada Zen central; um `qmpZenModel` explícito pode continuar como override por task.
- Confirma injeção de elenco/pasta de perguntas (relatório truncou aqui).

---

## Cross-cutting (transversais, alto retorno)

1. **Endpoint/modelo Zen** — serviços não devem ter fallbacks próprios: todos devem resolver `zenBaseUrl`/`zenModel` pela função central, com `localhost:20128/v1` + `bot-zap` como defaults.
2. **`sendSamplingParams` inconsistente** — `false` default anula criatividade no flavor/chaos/assault mesmo com temp alta. Decisão atual: ignorar esse tema, pois os backends não usam esses parâmetros efetivamente.
3. **JSON mode parcial** — texto+parsing regex é mais frágil, mas a decisão atual restringe JSON mode às rotas `assault` e `group_times`.
4. **`resolveZenTaskParams` ignorado** em `dailyChallengeService` e `qmpService` (hard-coded) — quebra a governança de tasks.
5. **Prompt caching** e remoção do caminho morto de Ollama permanecem fora de escopo por decisão do projeto.
6. **Quem-falou ausente** — persona/qmp/tarot não injetam identidade do autor/consulente; contexto social rico fica de fora.

## Status das decisões

- Prompt caching: fora de escopo.
- Ollama morto: fora de escopo.
- Sampling params: ignorar por enquanto.
- JSON mode: somente `assault` e `group_times`.
- Market journalist: default ON na fase própria.
- Endpoint Zen padrão: `http://localhost:20128/v1` + `bot-zap`.
