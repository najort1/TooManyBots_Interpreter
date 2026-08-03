# Research: Auto-Aprimoramento de Dados Guiado por LLM

**Branch**: `003-data-self-healing` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)

**Input**: Todos os `NEEDS CLARIFICATION` da spec resolvidos na fase de especificação (Q1=C, Q2=A, Q3=A). Esta pesquisa resolve as decisões técnicas de implementação.

## D1. Interface de acesso da LLM aos dados (Q2 = tool-calling interno)

- **Decision**: Registry interno de capabilities de leitura (tool-calling) com schema JSON, invocado via cascata Zen em `jsonMode`. Sem servidor MCP externo.
- **Rationale**: A LLM roda dentro do processo do bot; chamadas locais síncronas via `openaiClient` já existem. Um servidor MCP adicionaria transporte/network/lifecycle sem benefício. O padrão `resolveZenTaskParams` + `jsonMode` já é usado por outras tarefas do módulo (ex.: extração de fatos).
- **Alternatives considered**: Servidor MCP próprio (descartado: overhead local); contexto embutido no prompt (descartado: escala mal e mistura leitura/geração).

## D2. Persistência de evidência (Q1 = histórico bruto normalizado)

- **Decision**: Nova tabela `fun_evidence_log` com mensagens observadas normalizadas (texto truncado em ~400 chars, sem mídia, sem conteúdo sensível), autor, `scope_key`, timestamp e hash. Captura no `groupMemoryService.observeMessage` via dependência injetada `evidenceRepository` — reusa filtros existentes (comandos, sensibilidade, tamanho mínimo).
- **Rationale**: `observeMessage` é o único ponto onde toda mensagem de grupo elegível já passa com filtros prontos (DRY). Normalização e hash permitem busca determinística por evidência (match por autor + similaridade de texto).
- **Alternatives considered**: Validar apenas contra `fun_daily_events`/snapshots (evidência fraca para fatos antigos); log completo de mensagens brutas (custo/privacidade maiores — rejeitado: janela + truncamento + sem mídia atendem).
- **Retenção**: janela configurável `selfHealEvidenceRetentionDays` (default 60); GC na varredura e no startup.

## D3. Autonomia com guardrails (Q3 = autônomo com revisão de alto risco)

- **Decision**: Classificador de risco determinístico por ação:
  - **Baixo risco (aplica sozinho)**: correção de autoria quando a evidência tem o mesmo autor (JID idêntico) e similaridade de texto acima de limiar; consolidação de duplicatas; reparo de texto/resumo com evidência direta.
  - **Alto risco (requer revisão do admin)**: exclusão de qualquer registro, alteração em dados econômicos (ledger/mercado), conteúdo sensível, rebaixamento/supressão de memória, qualquer ação sem evidência exata.
- **Rationale**: FR-016 exige autonomia para baixo risco e revisão para alto risco; classificação determinística (não pela LLM) mantém a decisão auditável e previsível.
- **Alternatives considered**: 100% autônomo (risco em domínios sensíveis); apenas propostas (perde o valor do aprendizado constante).

## D4. Agendamento da varredura (autonomia em background)

- **Decision**: Hook no `tickWorldEvents` (world clock existente, default ~45s por tick) com throttle por intervalo configurável `selfHealIntervalMs` (default 10min). Varredura roda por domínio e por scope, respeitando quiet hours. Além do gatilho manual via dashboard (`POST /api/fun/selfheal/run`).
- **Rationale**: Não introduz timer paralelo (concorrência com fila de mensagens); o world tick já é o mecanismo autônomo do módulo.
- **Alternatives considered**: Timer dedicado (`setInterval` próprio) — descartado por concorrência com o runtime.

## D5. Contrato de saída da LLM (findings) e validação

- **Decision**: Tarefa `selfheal` em `zenTaskParams.js` com saída JSON estrita: `{ domain, findings: [...] }`, cada finding com `{ targetId, action, confidence, evidenceRef?, reason }`. Validação de schema rígida (`validateFindingsPayload`) antes de qualquer efeito; ação desconhecida/fora do domínio → finding rejeitado e registrado.
- **Rationale**: FR-004/FR-005 — validação determinística antes de aplicar; saída inválida nunca vaza para escrita.
- **Alternatives considered**: Prompt livre com parsing "fuzzy" — rejeitado (hallucination e parse instável).

## D6. Orçamento de custo/latência

- **Decision**: `selfHealMaxItemsPerRun` (default 50) e `selfHealMaxCallsPerRun` (default 10) por domínio/varredura; evidência é buscada em lote por scope antes da LLM (uma chamada de tool com contexto compactado). Varredura aborta com registro se orçamento excede.
- **Rationale**: SC-006 — custo/latência respeitam orçamento configurado; lote reduz chamadas.
- **Alternatives considered**: Chamada LLM por item — descartada (custo alto).

## D7. Testes determinísticos

- **Decision**: `tests/fun-self-healing.test.js` no padrão existente: `initDb()` + DB temporário, `FUN_DISABLE_LIVE_LLM=1`, LLM stubada via injeção (`zenTask` fake que devolve fixtures de findings), JIDs/scope únicos. Cenários: captura de evidência, busca por evidência, validação de schema, classificador de risco (baixo/alto), dry-run sem escrita, aplicação de autoria, auditoria completa, falha de LLM (JSON inválido) sem corromper dados, quiet hours.
- **Rationale**: Constituição exige testes determinísticos sem rede; injeção de LLM fake cobre o pipeline inteiro.
- **Alternatives considered**: Testes com LLM real — rejeitados (não determinístico).

## D8. Quiet hours e sensibilidade

- **Decision**: Reuso de `worldQuietHours` para não iniciar/continuar varredura; campo `sensitive` respeitado na seleção de itens para o prompt (FR-014); evidência nunca contém mídia e é truncada.
- **Rationale**: Constituição (quiet hours) + FR-008/FR-014.
