# Feature Specification: Auto-Aprimoramento de Dados Guiado por LLM

**Feature Branch**: `[003-data-self-healing]`

**Created**: 2026-08-03

**Status**: Draft

**Input**: User description: "Função de auto-aprimoramento dos dados que o bot tem, guiado por LLM, com aprendizado constante e inteligente, sempre se questionando se tudo está em ordem. Cobre todos os dados que o bot tem no banco de dados. Ex.: validar com 100% de certeza um fato da memória do grupo (quem disse, quando disse, o que disse), corrigir divergências e ser autônomo. LLM precisa acessar os dados como tool_call de um agente."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Auditoria e correção de fatos da memória do grupo (Priority: P1)

Como participante de um grupo, quero que o bot valide e corrija autonomamente os fatos que ele guardou sobre o grupo, de forma que a memória usada nas respostas seja confiável: autoria certa, texto fiel ao que foi dito e nada de "memória viajada" sendo tratada como verdade.

**Why this priority**: É o núcleo do pedido (o exemplo do Gabriel) e o maior ganho de confiança na persona. Sem isso, erros de atribuição e distorções se consolidam na lore e degradam todas as respostas futuras.

**Independent Test**: Pode ser testado de forma independente populando fatos com erros conhecidos (autor trocado, resumo distorcido, fato sem evidência), executando uma varredura e verificando: correção de autoria, reparo de resumo, flag "não verificável" sem exclusão automática e registro completo na trilha de auditoria.

**Acceptance Scenarios**:

1. **Given** que existe um fato na memória do grupo com alta confiança atribuído ao Gabriel, **When** a varredura encontra a mensagem original correspondente nos dados, **Then** o fato é marcado como verificado (confiança plena) com referência à evidência.
2. **Given** que um fato foi atribuído à pessoa errada, **When** a evidência encontrada mostra o autor real, **Then** a autoria é corrigida e a mudança é registrada na trilha de auditoria com antes/depois e motivo.
3. **Given** que o resumo gravado diverge do conteúdo real da mensagem, **When** a evidência é encontrada, **Then** o resumo é reparado de acordo com a fonte e a divergência é auditada.
4. **Given** que nenhuma evidência é encontrada para um fato, **When** a varredura não consegue verificar, **Then** o fato é marcado como "não verificável" (sem exclusão automática) e a inconclusão fica registrada.

---

### User Story 2 - Validação de memórias de conversa (Priority: P2)

Como usuário, quero que as memórias de conversa (fatos semânticos sobre pessoas, preferências e relações) tenham o nível de confiança correto: promovidas quando há evidência de repetição/confirmação, rebaixadas ou suprimidas quando contraditas ou sem suporte, para que o bot nunca afirme como verdade o que é só suspeita.

**Why this priority**: Essas memórias alimentam respostas da persona e são o segundo maior risco de alucinação/contradição após a lore. Vêm logo após a validação da memória do grupo.

**Independent Test**: Pode ser testado de forma independente criando memórias "inferred" com baixa confiança e verificando a promoção/rebaixamento conforme a varredura encontra evidência de confirmação ou contradição, além da deduplicação de memórias próximas.

**Acceptance Scenarios**:

1. **Given** uma memória classificada como "inferred" (suspeita), **When** a varredura encontra múltiplas ocorrências que corroboram, **Then** a memória é promovida para nível de confirmação maior com a confiança ajustada.
2. **Given** uma memória contradita por dados posteriores, **When** a varredura detecta a contradição, **Then** a memória é rebaixada ou suprimida, sem ser excluída sem registro.
3. **Given** duas memórias duplicadas ou quase idênticas sobre o mesmo sujeito, **When** a varredura identifica a duplicação, **Then** as memórias são consolidadas e a duplicação é registrada.

---

### User Story 3 - Verificação de integridade de dados socioeconômicos e perfis (Priority: P2)

Como administrador do bot, quero que o sistema verifique autonomamente a integridade dos demais dados (economia, mercado, perfis, identidade), corrigindo ou sinalizando inconsistências, para que o estado persistido nunca viole as regras do jogo.

**Why this priority**: "Cobrir todos os dados" inclui a saúde do ledger e do mercado — inconsistências aqui causam perda de confiança na economia e exploits. É verificável sem interação do usuário.

**Independent Test**: Pode ser testado de forma independente injetando dados inválidos (saldo negativo, preço fora do range, perfil com nickname vazio em excesso) e verificando a detecção, correção ou sinalização no relatório.

**Acceptance Scenarios**:

1. **Given** um saldo ou movimentação que viole um invariante conhecido (ex.: saldo negativo, cap estourado), **When** a varredura de integridade roda, **Then** a anomalia é detectada, classificada e corrigida (ou sinalizada) com registro na trilha.
2. **Given** dados derivados incoerentes (ex.: narrativa do jornal contrária ao ticker), **When** a varredura compara as fontes, **Then** a divergência é reportada para revisão sem alterar a fonte de verdade do motor econômico.
3. **Given** perfis ou registros órfãos/duplicados, **When** a varredura identifica, **Then** o sistema limpa ou sinaliza conforme a política definida para o domínio.

---

### User Story 4 - Observabilidade e controle administrativo (Priority: P3)

Como administrador do bot, quero ver o que o auto-aprimoramento fez, o que não conseguiu verificar, quanto custou, e poder ligar/desligar ou rodar em modo de simulação, para confiar no sistema autônomo sem perder o controle.

**Why this priority**: Autonomia sem observabilidade é risco. Antes de ampliar a cobertura, o administrador precisa de confiança no comportamento do sistema.

**Independent Test**: Pode ser testado de forma independente executando uma varredura em modo de simulação (dry-run) e conferindo o relatório: nenhuma alteração real aplicada e todas as propostas listadas.

**Acceptance Scenarios**:

1. **Given** o modo de simulação ativado, **When** uma varredura completa roda, **Then** nenhum dado é alterado e todas as correções propostas aparecem no relatório.
2. **Given** um problema crítico detectado (ex.: dados sensíveis no prompt ou falha de LLM), **When** a varredura termina, **Then** o processo nunca fica travado e a falha fica registrada com a causa.
3. **Given** o painel administrativo, **When** o admin consulta o histórico de varreduras, **Then** ele vê por varredura: domínio, itens auditados, correções aplicadas/rejeitadas, custo e status.

---

### Edge Cases

- O que acontece quando a LLM está indisponível ou devolve JSON inválido durante uma varredura? (nunca corromper dados nem travar o processo)
- Como o sistema trata fatos contraditórios com evidências de pesos diferentes? (evidência mais recente/mais específica vence, demais são rebaixadas e registradas)
- Como evitar que a própria LLM de auditoria alucine correções? (validação determinística obrigatória antes de qualquer escrita)
- Como o sistema lida com dados sensíveis que não devem entrar no prompt de auditoria?
- Como controlar custo/latência quando a base de dados cresce? (orçamento por varredura/domínio)
- O que impede a varredura de colidir com ações de jogo em andamento (escritas concorrentes)?
- Como o log de evidências lida com privacidade e retenção (janela configurável, sem mídia, sem conteúdo sensível persistido)?
- O que acontece se uma evidência nova chega depois de um fato ter sido marcado "não verificável"? (reavaliação)
- Como o sistema trata domínios ainda não cobertos pela varredura? (fora de escopo explícito, sem escrita)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST execute varreduras autônomas de dados em agenda configurável, sem exigir interação do usuário.
- **FR-002**: System MUST, na primeira versão, cobrir pelo menos o domínio de memória/lore do grupo (validação de autoria, fidelidade do texto e verificabilidade).
- **FR-003**: System MUST dar à LLM acesso de leitura aos dados relevantes de cada domínio por meio de uma interface controlada de ferramentas/capabilities, nunca acesso cru irrestrito.
- **FR-004**: System MUST receber da LLM apenas achados estruturados que passem por validação de schema estrita (tipo, limites, domínio de valores) antes de qualquer efeito.
- **FR-005**: System MUST aplicar toda correção por meio de uma camada determinística de validação; a LLM NUNCA escreve no banco diretamente.
- **FR-006**: System MUST registrar na trilha de auditoria toda correção aplicada, com antes/depois, motivo, evidência usada e decisão.
- **FR-007**: System MUST manter vínculo de evidência entre fatos e suas fontes (mensagem original, evento, snapshot) quando disponível.
- **FR-008**: System MUST respeitar isolamento por grupo (scope_key), flags de sensibilidade, quiet hours e limites de custo/quantidade por varredura.
- **FR-009**: System MUST garantir que falha de LLM, timeout ou saída inválida nunca modifique dados nem trave o processo (skip com registro).
- **FR-010**: Admin MUST poder habilitar/desabilitar o sistema e executar em modo de simulação (dry-run) sem efeitos reais.
- **FR-011**: System MUST detectar duplicatas e quase-duplicatas de memórias/fatos e consolidá-las com registro.
- **FR-012**: System MUST detectar erros de atribuição de autoria em fatos e corrigi-los quando a evidência comprovar.
- **FR-013**: System MUST tratar memórias contraditórias de forma explícita (promoção, rebaixamento ou supressão registrada), nunca apagando sem rastro.
- **FR-014**: System MUST evitar expor dados sensíveis (dados pessoais, segredos, conteúdo NSFW) nos prompts de auditoria além do estritamente necessário ao domínio.
- **FR-015**: System MUST cobrir os demais domínios de dados de forma incremental e explícita, nunca de forma implícita e não documentada.
- **FR-016**: System MUST aplicar autonomamente correções de baixo risco (autoria comprovada por evidência, deduplicação, reparo de texto com evidência) após validação determinística, e encaminhar correções de alto risco (exclusões, alterações em dados econômicos, conteúdo sensível) para revisão do administrador.
- **FR-017**: System MUST persistir evidência de mensagens observadas (autor, texto normalizado, timestamp, hash) com janela de retenção configurável, e vincular fatos/memórias a essa evidência quando disponível.

### Key Entities *(include if feature involves data)*

- **Achado de Auditoria (Finding)**: Proposta estruturada gerada pela LLM descrevendo problema detectado, ação sugerida, evidência e confiança. Nunca aplicada sem validação.
- **Trilha de Auditoria (Audit Trail)**: Registro imutável de cada ação: domínio, item-alvo, estado antes/depois, motivo, evidência, decisão (aplicada/rejeitada/simulada), autor da decisão (sistema/admin).
- **Registro de Evidência (Evidence Record)**: Log persistido e normalizado de mensagens observadas (autor, texto normalizado, timestamp, hash), com janela de retenção configurável, usado como fonte verificável para validar fatos e memórias.
- **Fato de Memória (Lore do Grupo)**: Fatos engraçados/úteis do grupo com autoria, score e hits — alvo da User Story 1.
- **Memória de Conversa**: Fatos semânticos sobre pessoas com confiança, nível de confirmação e sensibilidade — alvo da User Story 2.
- **Dado Socioeconômico e Perfil**: Ledger, mercado, ações, holdings, perfis e identidade — alvo da User Story 3.
- **Relatório de Varredura (Sweep Report)**: Resumo por execução: domínios auditados, itens verificados, correções, inconclusões, custo e status — alvo da User Story 4.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em cenários de validação, pelo menos 90% dos fatos de memória auditados com alta confiança terminam com evidência localizada ou flag "não verificável" registrado (nenhum passa em silêncio).
- **SC-002**: 100% das correções aplicadas possuem registro na trilha de auditoria com antes/depois e motivo.
- **SC-003**: Em cenários de validação, pelo menos 95% das correções de autoria correspondem ao autor real apontado pela evidência.
- **SC-004**: Zero regressões nos testes existentes de memória e nos invariantes de economia após a introdução do sistema.
- **SC-005**: Uma falha de LLM (timeout, JSON inválido, indisponibilidade) em uma varredura nunca deixa dados modificados nem o processo travado; a varredura conclui com registro.
- **SC-006**: O custo/latência de cada varredura respeita o orçamento configurado por domínio (quantidade de chamadas e volume de dados).
- **SC-007**: Em modo de simulação, nenhum dado é alterado e todas as propostas aparecem no relatório.

## Assumptions

- A cascata de LLM existente (Zen → fallback local, com timeout/retry) será reutilizada; falha de LLM cai em fallback e nunca quebra a varredura.
- O sistema opera em segundo plano (agendado), sem exigir comando novo do usuário no v1; um gatilho manual de varredura pode ser adicionado.
- O isolamento por `scope_key` e a identidade canônica de usuário continuam valendo para toda leitura/escrita.
- Para viabilizar a verificação de evidências, o sistema passa a persistir um registro normalizado de mensagens observadas (autor, texto normalizado, timestamp e hash) com janela de retenção configurável (30–90 dias); fatos anteriores ao início da captura ficam "não verificáveis" até reaparecerem como evidência.
- O acesso da LLM aos dados será por uma interface interna de tool-calling (registry de capabilities de leitura com schema JSON), e não por um servidor MCP externo, pois a LLM roda dentro do processo do bot.
- O grau de autonomia de escrita é **autônomo com guardrails**: correções de baixo risco (autoria comprovada por evidência, deduplicação, reparo de texto com evidência) são aplicadas sozinhas após validação determinística; correções de alto risco (ex.: exclusões, alterações em dados econômicos, conteúdo sensível) exigem revisão do administrador.
- O painel administrativo existente (`fun_dashboard`) será usado para observabilidade e controle.
- Quiet hours e caps de custo existentes serão respeitados pelas varreduras autônomas.
- A cobertura de todos os domínios de dados é meta de longo prazo (fases); cada domínio entra com escopo, validadores e orçamento próprios.
