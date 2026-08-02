# Research — Bot Membro Vivo

Fase 0 do plano: resolução de todas as incógnitas técnicas do Technical Context, com decisões,
justificativas e alternativas consideradas. Baseado na inspeção do código do módulo fun.

## R1 — Onde encaixar o gatilho da persona no pipeline

- **Decision**: hook passivo em `fun/pipeline/onIncomingMessage.js`, na seção passiva que já existe
  (após o bloco `if (isCommand)` e após o `isCountableMessage`), junto ao voto passivo do QMP.
- **Rationale**: o pipeline já executa comandos primeiro (`routeFunCommand`) — assim comandos
  reconhecidos têm precedência (FR-002). O bloco passivo existente (QMP) mostra o padrão de guardas
  com `try/catch` que nunca quebram o fluxo. A persona entra como mais uma tentativa passiva,
  fire-and-forget, sem engolir a mensagem (XP passivo continua).
- **Alternatives considered**: (a) hook antes dos comandos — rejeitado, violaria a precedência de
  comandos; (b) módulo separado de evento Baileys — rejeitado, duplicaria o parsing que o pipeline já
  faz (scope, JID, LID, mentionedJids).

## R2 — Detecção de gatilho ("bot" + @ + reply ao bot)

- **Decision**: três condições combináveis, verificadas em ordem barata:
  1. **Texto**: regex `/\bbot\b/i` na mensagem — palavra inteira, case-insensitive. Não casa
     "botão"/"robô"/"botox" (o limite de palavra falha em seguida de letra), atendendo FR-002.
  2. **@marcação**: o JID do bot (de `sock.user.id`, sem sufixo de dispositivo `:N`, normalizado via
     `identityMap` para SID canônico `@s.whatsapp.net`) está em `mentionedJids`.
  3. **Reply ao bot**: `quotedParticipant` (autor da mensagem citada) === JID normalizado do bot —
     usado apenas para CONTINUAR uma thread ativa (FR-006), não para abrir thread nova sem menção.
- **Rationale**: `mentionedJids` e `quotedParticipant` já chegam prontos no `ctx` do pipeline; o
  padrão LID→SID via `identityMap.resolve` já é usado no módulo. A verificação é barata e testável
  como função pura.
- **Alternatives considered**: (a) lib de NLP/entidade — rejeitada, over-engineering para uma
  palavra + menção; (b) comparar raw `mentionedJids` sem normalizar LID — rejeitado, quebraria em
  grupos com WhatsApp moderno (LID).

## R3 — Aprendizado de estilo (fonte da "voz" do grupo)

- **Decision**: o `personaService` mantém sua própria janela rolante em memória por grupo
  (`{userJid, name, text, at}`, ≤100 msgs / 24h, mesmo padrão do buffer do groupMemoryService) e
  deriva um **perfil de voz** compacto (tokens frequentes sem stopwords, emojis, tamanho médio,
  amostras anonimizadas) persistido em `fun_persona_profile` (atualizado periodicamente). A
  observação é alimentada pelo mesmo ponto do pipeline que chama `groupMemoryService.observeMessage`
  (fire-and-forget).
- **Rationale**: FR-008 exige janela rolante por grupo; FR-014 proíbe reproduzir dados pessoais e
  persistir amostras além da janela; FR-015 exige que o "estilo aprendido" persista entre reinícios.
  Persistir o perfil derivado (não os textos crus) atende aos três. O buffer do groupMemoryService é
  interno (`_buffers`) e voltado a extract de fatos — reusá-lo acoplaria a persona ao ciclo de vida
  da memória; a janela própria é isolada e barata.
- **Alternatives considered**: (a) reusar `groupMemoryService` buffer — rejeitado por acoplamento e
  por não persistir texto cru; (b) persistir textos crus das amostras — rejeitado por violar FR-014;
  (c) sem persistência (só memória) — rejeitado por violar FR-015.

## R4 — Geração da resposta (cascata LLM)

- **Decision**: o `personaService` gera via cascata **Zen → template estático** reutilizando o
  cliente existente `openaiChatComplete` + `resolveZenTaskParams` (padrão de timeouts do flavor) e os
  sanitizers exportados do `flavorService` (`sanitizeFlavor`, `looksLikeScoreboardEcho`,
  `looksLikeMetaReasoning`). Prompt de sistema próprio ("membro comum do grupo", pt-BR, 1–3 frases,
  variar tom, sem doxxing, sem coins/XP/placar), com estilo injetado do perfil + contexto da menção
  (mensagem citada/thread) + amostras anonimizadas da janela. Fallback: linhas estáticas locais.
  `FUN_DISABLE_LIVE_LLM=1` + mock injetado nos testes.
- **Rationale**: respeita a cascata da constituição (Zen → template) sem modificar o `flavorService`
  (OCP) — os sanitizers já são exportados e blindam eco de placar e meta-reasoning (G2).
- **Alternatives considered**: (a) adicionar scenario `persona_*` ao flavorService — rejeitado, mexe
  em código estável compartilhado para um caso com prompt muito diferente; (b) LLM direto sem
  sanitizers — rejeitado, arriscaria eco de placar/erros (G2).

## R5 — Guardas: cooldown, quiet hours, threads e anti-self-loop

- **Decision**: cooldown por grupo em `Map<string, number>` (scopeKey → lastReplyAt, default 60s),
  quiet hours via `isWorldQuietHours(funConfig, now)` (1h–6h), thread persistida em
  `fun_persona_thread` (turn_count, max_turns, last_activity_at, contexto recente) com TTL 30min, e
  anti-self-loop: a persona nunca observa/responde mensagens cujo autor seja o próprio bot
  (comparação de JID normalizado).
- **Rationale**: guardas baratos antes de qualquer chamada LLM; thread persistida atende FR-015;
  anti-self-loop atende FR-003/SC-005.
- **Alternatives considered**: (a) cooldown persistido em DB — rejeitado, latência desnecessária
  para janela de 60s; (b) thread só em memória — rejeitado, viola FR-015.

## R6 — Controle por grupo (dashboard)

- **Decision**: nova coluna `persona_enabled` em `fun_group_settings` seguindo o padrão
  "default ligado, só desliga se explícito false/0" (idêntico a `world_events_enabled` no
  `funGroupRepository.upsertGroupSettings`). O endpoint `PUT /api/fun/groups/:jid/settings` do
  `fun/dashboard/server.js` passa o campo; a UI `fun_dashboard/src/app/groups/page.tsx` ganha um
  toggle. Leitura efetiva no runtime: `personaEnabled = groupSettings.personaEnabled !== 0 &&
  funConfig.personaEnabled !== false`.
- **Rationale**: reutiliza o mecanismo existente de settings por grupo e o contrato do dashboard;
  default ON atende FR-012 (decisão do usuário: controle só no dashboard).
- **Alternatives considered**: (a) comando no grupo — rejeitado (decisão do usuário: somente
  dashboard); (b) flag global apenas — rejeitado, FR-012 exige por grupo.

## R7 — Configuração

- **Decision**: constantes em `fun/constants.js` e defaults configuráveis em `fun/config.js`:
  `personaCooldownMs=60000`, `personaMaxTurns=3`, `personaThreadTtlMs=1800000`,
  `personaWindowSize=100`, `personaWindowMs=86400000`, `personaTimeoutMs=28000`,
  `personaMaxChars=400`. Centralização exigida pela constituição (DRY).
- **Rationale**: valores do spec (assumptions) viram defaults; sem valores mágicos espalhados.

## R8 — Testes determinísticos

- **Decision**: `tests/fun-persona-service.test.js` (gatilhos, guardas, threads, geração com LLM
  mock, fallback) e `tests/fun-persona-settings.test.js` (upsert do toggle, leitura efetiva, contrato
  do dashboard), com `FUN_DISABLE_LIVE_LLM=1`, banco SQLite temporário e funções puras exportadas.
- **Rationale**: FR do spec e constituição (G4) exigem testes node --test determinísticos e sem rede
  para LLM.
