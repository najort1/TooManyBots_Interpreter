# Feature Specification: Bot Membro Vivo

**Feature Branch**: `001-bot-membro-vivo`

**Created**: 2026-08-02

**Status**: Draft

**Input**: User description: "deixar o bot mais dinamico sem fazer muito spam, as vezes o bot é citado como 'bot' ou marcando ele então seria bem engraçado e legal o bot responder como se fosse um membro comum do grupo, a ideia é ele aprender como o grupo fala, responder com base no que foi citado dele e ter o poder de continuar a conversa caso o usuario responda a resposta do bot de volta. isso iria criar 'vida' para o bot, ele seria como um membro a mais do grupo, sempre sendo o mais humano e parecido com os membros do grupo"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - O bot responde quando é citado no grupo (Priority: P1)

Quando um membro do grupo cita o bot — escrevendo "bot" (como palavra) ou marcando o bot (@) — o bot responde como um membro comum do grupo, com o estilo de fala do grupo e reagindo ao conteúdo da citação.

**Why this priority**: É o núcleo do valor: o bot "ganha vida" ao participar naturalmente quando chamado. Sem isso, não existe feature.

**Independent Test**: Pode ser testado isoladamente enviando uma mensagem com "bot" ou @marcação em um grupo com a feature ativa e verificando que o bot responde em tom de membro, sem afetar outros comportamentos do módulo.

**Acceptance Scenarios**:

1. **Given** um grupo com a feature ativa, **When** um membro envia "bot, o que você acha disso?", **Then** o bot responde em até 15 segundos com uma mensagem no estilo do grupo que referencia o assunto citado.
2. **Given** um grupo com a feature ativa, **When** um membro marca o bot com @, **Then** o bot responde no estilo do grupo.
3. **Given** uma mensagem contendo "bot" como parte de outra palavra ("botão", "robô", "botox"), **When** a mensagem é enviada sem menção ao bot, **Then** o bot não responde.
4. **Given** uma mensagem que é um comando reconhecido do bot, **When** a mensagem também contém a palavra "bot", **Then** o comando tem precedência e o bot não responde como persona de membro.

---

### User Story 2 - O bot mantém a conversa quando respondem a ele (Priority: P1)

Quando um membro responde à mensagem do bot (citando a resposta do bot), o bot continua a conversa de forma natural, por um número limitado de trocas, e para quando o assunto esfria.

**Why this priority**: É o que cria "vida" real — o bot não responde uma vez e some; ele participa de um bate-papo contínuo, como um membro faria.

**Independent Test**: Pode ser testado isoladamente: após o bot responder a uma menção, citar a resposta do bot e verificar se ele continua a conversa, e que após o limite de trocas ele para.

**Acceptance Scenarios**:

1. **Given** que o bot acabou de responder a uma menção, **When** um membro responde citando a mensagem do bot, **Then** o bot responde novamente, dando continuidade ao assunto.
2. **Given** uma conversa contínua, **When** o número de trocas atinge o limite configurado (entre 2 e 4 continuações), **Then** o bot para de responder, mesmo com novas citações à última mensagem.
3. **Given** uma resposta do bot antiga (fora da janela de tempo da conversa), **When** um membro a cita sem menção nova, **Then** o bot não reabre a conversa antiga.

---

### User Story 3 - O bot aprende a falar como o grupo (Priority: P2)

O bot aprende o estilo de fala do grupo a partir das mensagens recentes: vocabulário, gírias, emojis, tom e tamanho típico das mensagens. Assim, a resposta dele soa como um membro de verdade do grupo, não como um robô genérico.

**Why this priority**: É o que diferencia "responder" de "ser um membro do grupo". Depende das menções (US1) para ter valor, por isso vem em segundo plano.

**Independent Test**: Pode ser testado isoladamente: em um grupo que usa gírias e emojis característicos, verificar que as respostas do bot incorporam esse estilo após um período de amostragem.

**Acceptance Scenarios**:

1. **Given** um grupo com mensagens recentes usando vocabulário, gírias e emojis próprios, **When** o bot responde a uma menção, **Then** a resposta incorpora o estilo observado (tom, emojis e tamanho similares aos do grupo).
2. **Given** um grupo novo ou sem mensagens recentes suficientes, **When** o bot responde a uma menção, **Then** o bot usa um estilo padrão do módulo, sem erro.
3. **Given** o grupo muda o tom de fala, **When** passa o tempo (janela de amostragem recente), **Then** as respostas do bot se ajustam ao novo tom.
4. **Given** dois grupos com estilos diferentes, **When** o bot responde em cada um, **Then** cada resposta usa o estilo do próprio grupo, sem misturar.

---

### User Story 4 - Guardas anti-spam e controle por grupo (Priority: P2)

O bot respeita limites para não virar spam: cooldown entre respostas, silêncio nos horários de quietude e possibilidade de desligar a feature por grupo no dashboard administrativo.

**Why this priority**: Sem os guardas, o bot "vivo" viraria um incômodo. O controle por grupo dá segurança aos administradores.

**Independent Test**: Pode ser testado isoladamente enviando múltiplas menções seguidas e verificando o cooldown; e desligando a feature no dashboard e verificando que o bot para de responder.

**Acceptance Scenarios**:

1. **Given** que o bot acabou de responder a uma menção, **When** outra menção ocorre dentro do período de cooldown (ex.: 60 segundos), **Then** o bot não responde até o cooldown terminar.
2. **Given** horário de quietude do grupo, **When** há uma menção ao bot, **Then** o bot não responde (ou adia) até o fim do período de quietude.
3. **Given** a feature desligada para um grupo no dashboard, **When** qualquer membro menciona o bot, **Then** o bot não responde em nenhuma circunstância.
4. **Given** a feature ligada por padrão em grupos liberados, **When** um administrador a desliga no dashboard, **Then** a mudança surte efeito em até 1 minuto e permanece após reinício do módulo.

---

### Edge Cases

- Múltiplos membros mencionam o bot ao mesmo tempo no grupo → o bot responde uma única vez (regra de cooldown), sem flood.
- Mensagem do próprio bot menciona "bot" → o bot nunca responde às próprias mensagens (evita loop infinito).
- Sem modelo de linguagem disponível no momento → o bot ainda responde usando um fallback local, respeitando os mesmos guardas anti-spam.
- Grupo sem mensagens recentes (janela de amostragem vazia) → resposta usa estilo padrão do módulo, sem falha.
- A mensagem citada pelo bot contém conteúdo pessoal ou sensível → as amostras de estilo nunca são reproduzidas literalmente e são descartadas ao sair da janela.
- Vários usuários participam da mesma conversa contínua → a conversa pertence ao grupo; qualquer membro pode dar continuidade até o limite de trocas.
- O bot é mencionado em mensagens de sistema ou de botões/interações → apenas mensagens de texto normais de membros disparam a persona.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE detectar menção ao bot quando uma mensagem de grupo contém a palavra "bot" como palavra inteira (case-insensitive) ou marca o bot via @.
- **FR-002**: O sistema NÃO DEVE disparar quando "bot" aparece como substring de outra palavra (ex.: "botão", "robô", "botox") nem quando a mensagem é um comando reconhecido do bot.
- **FR-003**: O sistema NÃO DEVE responder a mensagens do próprio bot (anti self-loop).
- **FR-004**: O sistema DEVE gerar uma resposta em até 15 segundos, em tom de membro comum do grupo, reagindo ao conteúdo da citação.
- **FR-005**: O sistema DEVE usar o estilo de fala aprendido do grupo (vocabulário, gírias, emojis, tamanho típico) ao gerar respostas de persona.
- **FR-006**: Quando um membro responde citando a mensagem do bot, o sistema DEVE continuar a conversa, até um limite de continuações por conversa (entre 2 e 4).
- **FR-007**: O sistema DEVE expirar conversas por inatividade (tempo máximo sem resposta); citações a mensagens expiradas NÃO continuam a conversa.
- **FR-008**: O sistema DEVE aprender o estilo a partir de uma janela rolante de mensagens recentes do grupo (ex.: últimas 24 horas ou ~100 mensagens), sem cruzar grupos.
- **FR-009**: O sistema DEVE isolar estilo e conversas por grupo — cada grupo tem seu próprio perfil e estado.
- **FR-010**: O sistema DEVE respeitar um cooldown entre respostas da persona no mesmo grupo (ex.: 60 segundos), mesmo com múltiplas menções.
- **FR-011**: O sistema DEVE permanecer silencioso (ou adiar respostas) durante o horário de quietude do grupo.
- **FR-012**: O sistema DEVE permitir ligar/desligar a feature por grupo no dashboard administrativo, com a feature ligada por padrão nos grupos liberados.
- **FR-013**: Sem modelo de linguagem disponível, o sistema DEVE responder via fallback local, respeitando os mesmos guardas anti-spam.
- **FR-014**: O sistema NÃO DEVE reproduzir dados pessoais identificáveis das amostras de estilo nem persistir amostras além da janela.
- **FR-015**: O sistema DEVE persistir o estado (estilo aprendido e conversas ativas) entre reinícios do módulo.

### Key Entities

- **Menção (Mention)**: Evento de grupo em que o bot é citado por texto ("bot") ou por @marcação. Contém a mensagem, o autor, o grupo e o momento.
- **Conversa de persona (Persona Thread)**: Conversa contínua do bot com o grupo. Guarda grupo, participantes, número de trocas usadas, limite de continuações, último momento de atividade e expiração.
- **Janela de amostras (Style Window)**: Conjunto rolante de mensagens recentes do grupo usadas para derivar o estilo de fala. Isolada por grupo.
- **Perfil de voz do grupo (Group Voice Profile)**: Estilo derivado da janela de amostras — tom, vocabulário, emojis e tamanho típico das mensagens.
- **Preferência por grupo (Group Preference)**: Configuração de ativação/desativação da feature em cada grupo.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Em grupos com a feature ativa, pelo menos 90% das menções diretas válidas ("bot" como palavra ou @marcação) geram resposta do bot em até 15 segundos, fora de cooldown e quietude.
- **SC-002**: A taxa de falso disparo é inferior a 5% em mensagens que contêm "bot" apenas como substring ("botão", "robô", "botox").
- **SC-003**: Em pelo menos 80% das citações à mensagem do bot dentro do tempo de expiração, o bot continua a conversa, respeitando o limite de trocas.
- **SC-004**: O bot nunca responde mais de uma vez por período de cooldown no mesmo grupo e nunca responde durante a quietude.
- **SC-005**: O bot nunca responde às próprias mensagens (zero self-loop).
- **SC-006**: Após um período de uso em um grupo, pelo menos 50% das respostas do bot incorporam vocabulário, gírias ou emojis típicos do grupo (avaliado por amostragem em revisão).
- **SC-007**: Desligar a feature no dashboard interrompe todas as respostas da persona em até 1 minuto, e o estado persiste entre reinícios.

## Assumptions

- Escopo da v1: apenas conversas em grupo (fora de DM).
- O bot participa somente por menção ou resposta a ele — sem participação autônoma.
- "bot" é tratado como palavra inteira, case-insensitive; @marcação mira a conta do bot.
- Padrões iniciais (configuráveis): cooldown de 60 segundos, até 3 continuações por conversa, expiração de conversa em 30 minutos, janela de amostras das últimas 100 mensagens ou 24 horas, quietude reutilizando a faixa existente do módulo (1h–6h).
- Aprendizado da v1 é apenas de estilo de mensagens — não usa a memória de fatos do grupo.
- Controle administrativo apenas pelo dashboard (sem comando no grupo).
- A feature reutiliza a infraestrutura existente do módulo (mensagens, cascata de modelos de linguagem com fallback, quietude, dashboard).
- Comandos reconhecidos do bot têm precedência sobre a persona de membro.
- Fora de escopo da v1: participação autônoma, respostas baseadas em fatos do grupo, apelidos personalizados, suporte a DM, mudanças de UI além do controle de ativação, personalidade individual por usuário.
