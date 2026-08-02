# Feature Specification: Persona Memory Intelligence

**Feature Branch**: `[002-persona-memory-intelligence]`

**Created**: 2026-08-02

**Status**: Draft

**Input**: User description: "Expandir a persona do módulo fun para ficar o mais inteligente possível, com memória forte, continuidade de conversa, contexto por reply, distinção entre fatos confirmados e inferidos, identidade consistente por grupo e evolução arquitetural ampla da camada de memória e contexto."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Responder com contexto certo (Priority: P1)

Como participante do grupo, quero que o bot responda usando o contexto da conversa correta e lembrando fatos relevantes sobre o assunto atual, para que a resposta pareça natural e conectada ao que está acontecendo no chat.

**Why this priority**: Sem continuidade contextual, a persona parece aleatória, rasa ou perdida. Esse é o núcleo da percepção de inteligência.

**Independent Test**: Pode ser testado de forma independente simulando menções diretas e replies a mensagens anteriores, verificando se o bot usa o assunto, os participantes e as referências corretas sem confundir threads diferentes.

**Acceptance Scenarios**:

1. **Given** que há uma conversa ativa sobre um tema específico no grupo, **When** um participante menciona o bot para entrar no assunto, **Then** a resposta deve refletir o tema atual e os participantes relevantes da conversa.
2. **Given** que um participante responde uma mensagem anterior do bot ou de outro membro, **When** o bot é acionado nessa resposta, **Then** a resposta deve continuar a thread citada em vez de puxar contexto de outra conversa recente do grupo.
3. **Given** que existem duas conversas paralelas no mesmo grupo, **When** o bot é acionado em uma delas, **Then** ele deve responder com base apenas no contexto da conversa-alvo.

---

### User Story 2 - Lembrar fatos úteis sem inventar (Priority: P1)

Como participante do grupo, quero que o bot lembre gostos, apelidos, bordões e fatos sociais relevantes já vistos no grupo, sem afirmar como verdade coisas que ele apenas suspeita, para que a memória pareça confiável em vez de invasiva ou viajada.

**Why this priority**: Memória sem confiança controlada gera respostas impressionantes por um momento, mas rapidamente destrói a credibilidade da persona quando ela alucina ou exagera.

**Independent Test**: Pode ser testado isoladamente alimentando o sistema com fatos explícitos, fatos repetidos e sinais ambíguos, depois verificando quais informações podem ou não aparecer afirmativamente nas respostas.

**Acceptance Scenarios**:

1. **Given** que um participante declara explicitamente uma preferência no grupo, **When** o bot usa essa informação em uma conversa futura relacionada, **Then** a resposta deve tratar essa preferência como fato lembrado válido.
2. **Given** que o sistema apenas inferiu um traço com baixa evidência, **When** o bot responde sobre esse tema, **Then** ele não deve apresentar essa inferência como um fato confirmado.
3. **Given** que uma memória antiga perdeu relevância ou foi contradita por interações posteriores, **When** o bot é acionado, **Then** essa memória não deve dominar a resposta nem ser tratada como verdade atual.

---

### User Story 3 - Manter uma identidade consistente por grupo (Priority: P2)

Como participante de grupos diferentes, quero que o bot tenha um jeito consistente de falar em cada grupo, respeitando o clima local, as piadas internas e os limites daquele contexto, para que ele pareça um membro conhecido do grupo e não uma IA genérica mudando de personalidade a cada mensagem.

**Why this priority**: Depois da continuidade e da memória confiável, a identidade consistente é o que transforma a persona em presença social recorrente em vez de simples resposta contextual.

**Independent Test**: Pode ser testado de forma independente comparando respostas do bot em grupos com climas distintos, verificando se o tom permanece estável por grupo e se lore local influencia o estilo sem quebrar limites de segurança.

**Acceptance Scenarios**:

1. **Given** que um grupo possui piadas internas e estilo de conversa recorrente, **When** o bot responde nesse grupo ao longo do tempo, **Then** ele deve manter um tom compatível com esse histórico local.
2. **Given** que dois grupos têm estilos sociais bem diferentes, **When** o bot interage em ambos, **Then** a identidade percebida deve se ajustar por grupo sem perder coerência interna.
3. **Given** que existe conteúdo sensível, privado ou potencialmente invasivo no histórico, **When** o bot responde, **Then** ele deve evitar usar esse material como forma de “personalização”.

---

### Edge Cases

- O que acontece quando o bot é acionado em uma reply cuja thread original já expirou ou perdeu contexto útil?
- Como o sistema lida com memórias contraditórias sobre a mesma pessoa ou o mesmo fato?
- Como o bot deve agir quando há pouca memória útil para responder, mas ainda assim precisa parecer natural?
- O que acontece quando a conversa atual menciona várias pessoas ao mesmo tempo e há sinais conflitantes sobre quem é o alvo principal?
- Como o sistema evita recuperar fatos sensíveis, invasivos ou fora do contexto só porque são parecidos lexicalmente com a mensagem atual?
- Como o sistema se comporta quando o mesmo usuário participa de grupos com tons sociais muito diferentes?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain separate memory categories for active conversation context, episodic group events, stable user facts, and social group dynamics.
- **FR-002**: The system MUST resolve which conversation thread is active when the bot is triggered, giving priority to direct replies over generic recency.
- **FR-003**: The system MUST retrieve a ranked set of relevant context before generating a persona response.
- **FR-004**: The system MUST rank candidate memories using at least the current participants, reply target, recent conversation flow, and topic relevance.
- **FR-005**: The system MUST distinguish between explicitly stated facts, repeated/corroborated facts, and inferred signals.
- **FR-006**: The system MUST allow explicitly stated facts to be reused in future relevant responses as confirmed memory.
- **FR-007**: The system MUST prevent low-confidence inferred signals from being presented as confirmed facts.
- **FR-008**: The system MUST support continuity of conversation when the bot is triggered by replying to a prior message in the same thread.
- **FR-009**: The system MUST preserve a group-specific persona identity that influences style and tone consistently over time.
- **FR-010**: The system MUST keep group-specific identity separate from user-specific memories so that tone and personal facts are not mixed incorrectly.
- **FR-011**: The system MUST update memory after interactions by reinforcing useful memories, extending active thread context, and downgrading stale or contradicted memories.
- **FR-012**: The system MUST support memory expiration or decay so that outdated memories lose priority over time.
- **FR-013**: The system MUST suppress or avoid using memories flagged as sensitive, private, or socially inappropriate for persona responses.
- **FR-014**: The system MUST continue to provide a safe fallback response path when there is not enough reliable memory or context to support a richer answer.
- **FR-015**: The system MUST preserve the current trigger behavior for direct mentions, @mentions, and valid passive persona activation patterns already supported by the bot.
- **FR-016**: The system MUST support observation of group interactions even when the bot is not actively replying, so future responses can benefit from accumulated context.
- **FR-017**: The system MUST prevent context from one group from influencing responses in another group.
- **FR-018**: The system MUST provide an observable way to evaluate memory quality, context selection quality, and response continuity over time.

### Key Entities *(include if feature involves data)*

- **Conversation Event**: A normalized representation of an incoming interaction, including author, group scope, text, reply target, mentions, timing, and trigger context.
- **Thread Context**: The active conversational slice used to determine what topic is being continued, who is involved, and what recent turns matter for the next response.
- **Conversation Memory**: A stored memory item associated with a group scope, categorized by memory type and carrying confidence, relevance signals, and lifecycle metadata.
- **Memory Evidence Level**: A classification indicating whether a remembered fact is explicit, corroborated, or inferred.
- **Group Persona Identity**: The persistent style profile that defines how the bot tends to speak inside a specific group.
- **Memory Retrieval Result**: The ranked context package selected for a specific response attempt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In validation scenarios with direct replies, at least 90% of triggered persona responses continue the correct conversation thread.
- **SC-002**: In validation scenarios with explicit user preferences and social facts, at least 85% of relevant responses reuse correct remembered information without introducing unrelated memory.
- **SC-003**: In validation scenarios with ambiguous or weakly inferred traits, 95% of responses avoid presenting low-confidence inferences as confirmed facts.
- **SC-004**: In multi-group validation scenarios, 100% of retrieved memories used in a response originate from the same group as the triggering conversation.
- **SC-005**: In production observation, the rate of user-visible contradictions or “viajou/nada a ver” style corrections related to persona memory decreases compared to the current baseline after rollout.
- **SC-006**: In validation scenarios with parallel conversations in the same group, at least 85% of responses use the intended topic context instead of leaking adjacent thread context.

## Assumptions

- The existing persona trigger model remains in scope and this feature expands intelligence, memory quality, and continuity rather than redefining how users summon the bot.
- Existing group scoping and canonical user identity rules remain valid and all new memory behavior must stay isolated by group scope.
- Existing profile, lore, and persona capabilities may be reused as source material, but this feature introduces a more formal memory and context layer above them.
- The first release of this expansion targets group interactions only; direct-message conversational memory is out of scope unless already supported by existing behavior.
- The feature should prefer conservative memory use over aggressive personalization whenever confidence is low or sensitivity is uncertain.
- Existing fallback behavior must remain available so that lack of memory quality does not block a response entirely.
