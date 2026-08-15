# Feature Specification: Jogo de Casas e Avatares do Módulo Fun (Houses & Avatars)

**Feature Branch**: `004-fun-houses-game`

**Created**: 2026-08-14

**Status**: Draft

**Input**: Nova feature do bot de divertimento (`fun`): os usuários passam a ter casas servidas pelo `fun_dashboard` e avatares customizáveis, expandindo o sistema de moedas existente e o frontend. Mundo por grupo; interações sociais (visitar, presentear, roubar) entre membros do mesmo grupo; autenticação web por link pessoal entregue no chat privado do bot.

## Clarifications

### Session 2026-08-14

- Q: O que acontece com um item roubado depois que o ladrão o pega? → A: Opção B (variante) — o item passa a ser do ladrão com **posse plena**: ele pode vender e presentear como qualquer item, sem marca de bloqueio; sem devolução ao dono original, que pode comprar um item igual na loja.
- Q: Qual postura de segurança o link pessoal deve ter contra brute-force/escaneamento de tokens? → A: Opção A — token aleatório e unguessable (24 bytes) com hash scrypt + salt no banco; sem lockout por IP nem expiração extra (além da revogação manual).
- Q: Como impedir automação/abuso das ações de jogo na web além dos tetos diários? → A: Opção B — tetos diários por jogador (FR-008/016/019/025) **+** rate limit por IP do middleware existente (padrão bolsa/job); sem throttle adicional por ação.

## User Scenarios & Testing

### User Story 1 - Casa própria: comprar, decorar e coletar (Priority: P1)

Todo jogador do grupo ganha automaticamente uma casa padrão completa com um conjunto inicial de itens. O jogador pode ver e comandar sua casa (colocar, mover, remover, vender itens), comprar novos móveis e atividade diária de limpeza com moedas, e coletar uma recompensa diária da casa bem cuidada. A casa é visível no navegador via link pessoal, com visual mobile-first.

**Why this priority**: É a base de todo o jogo: o loop de economia (moedas → itens → casa melhor) e o engajamento diário dependem da casa existir e ser gerenciável; os demais stories constroem sobre ela.

**Independent Test**: O jogador aciona o comando no grupo, recebe instrução de privado, obtém o link, e no navegador consegue renderizar a casa padrão, comprar um móvel com moedas e vê-lo na casa, e coletar a recompensa diária. QI do sistema (Qualidade Interna) é dado pelas invariantes de economia verificadas por testes automatizados.

**Acceptance Scenarios**:

1. **Given** um jogador com saldo suficiente, **When** ele compra um item no navegador, **Then** o saldo de moedas do grupo é debitado, o item aparece na casa e o ledger registra a transação.
2. **Given** um jogador que não tem moedas suficientes para um item, **When** ele tenta comprar, **Then** o item não é comprado e uma mensagem de erro amigável é exibida.
3. **Given** um jogador com casa padrão recém-criada, **When** ele abre o link pessoal da casa, **Then** a casa é renderizada com os itens iniciais e com a recompensa diária disponível para coleta.
4. **Given** um jogador que realizou a atividade diária de limpeza depois do reset diário, **When** ele tenta fazê-la de novo no mesmo dia, **Then** o sistema informa o cooldown restante e não concede recompensa.

---

### User Story 2 - Avatar customizável (Priority: P1)

Cada jogador tem um avatar (boneco virtual) com corpo base e slots de personalização (cabelo/rosto, roupas, acessórios). Ao ganhar XP/nível, o jogador desbloqueia novas opções gratuitas de personalização; opções premium são compradas com moedas na loja de roupas. O avatar é visível no navegador na casa do jogador e nas casas dos outros jogadores.

**Why this priority**: É o segundo pilar de identidade e colecionismo; junto com a casa, dá motivo para visitar e para gastar moedas (sink econômico).

**Independent Test**: O jogador abre o link pessoal, seleciona um item de roupa desbloqueado/comprado, salva e vê o avatar atualizado na própria casa e na casa de outro jogador.

**Acceptance Scenarios**:

1. **Given** um jogador com um item de avatar desbloqueado (por nível ou compra), **When** ele equipa o item no navegador, **Then** o avatar renderizado passa a exibir o item equipado.
2. **Given** um item de avatar premium, **When** o jogador tenta equipá-lo sem tê-lo comprado nem desbloqueado, **Then** o sistema bloqueia a seleção e oferece a compra.
3. **Given** outro jogador visitando a casa, **When** a casa é carregada, **Then** o avatar do dono é renderizado com os itens equipados.

---

### User Story 3 - Visitar casas de outros jogadores (Priority: P2)

Um jogador pode visitar a casa de qualquer outro membro do mesmo grupo (via busca/listagem no navegador). A visita é pública e registrada: o dono vê um mural de visitas (visitante, data, recado deixado). Visitar não tem custo, mas tem um teto de visitas por dia.

**Why this priority**: Cria o loop social do bairro — descoberta, presença e motivo para a casa dos outros ser interessante — sem depender de roubo (P2 tardio) nem de presentes (P3). A frequência de cada mesa se usa apenas para a listagem de quem visitar.

**Independent Test**: Um jogador abre o portal da casa, encontra a casa de um colega de grupo, entra nela, deixa um recado e o dono vê a visita registrada no mural.

**Acceptance Scenarios**:

1. **Given** dois membros do mesmo grupo, **When** o visitante carrega a casa do anfitrião, **Then** a casa é renderizada com móveis, pets e avatar do dono, sem controles de edição.
2. **Given** um visitante que quer deixar um recado, **When** ele envia o recado, **Then** o recado aparece no mural de visitas do anfitrião.
3. **Given** um jogador que já atingiu o teto diário de visitas, **When** ele tenta visitar outra casa, **Then** o sistema bloqueia com aviso.
4. **Given** um visitante, **When** ele acessa uma casa de outro grupo ou um link de casa inválido, **Then** o acesso é negado com mensagem de erro.

---

### User Story 4 - Presentear itens a outros jogadores (Priority: P3)

Um visitante pode deixar um presente para o anfitrião: itens da loja de presentes (itens de avatar, decoração, moedas já existentes, embrulhos/colecionáveis) comprados no momento do presente ou vindos do inventário do visitante. O presente é entregue automaticamente e notificado; o anfitrião pode vender presentes não desejados. Presentear tem teto por dia e não pode ser usado para repassar itens roubados.

**Why this priority**: Reforça a generosidade social e é um sink de moedas/colecionáveis, mas depende das casas e da identidade visual existirem (P1/P2).

**Independent Test**: Um visitante compra um presente na loja de presentes, escolhe o anfitrião, e o anfitrião vê o novo item na casa/avatar e recebe notificação.

**Acceptance Scenarios**:

1. **Given** um visitante com moedas suficientes, **When** ele compra e envia um presente a um anfitrião, **Then** o anfitrião recebe o item, o ledger registra a transação e o visitante respeita o teto diário.
2. **Given** um anfitrião que recebeu um presente não desejado, **When** ele o vende, **Then** uma parte do valor é creditada em moedas e o item sai do inventário.
3. **Given** um item marcado como roubado, **When** um jogador tenta presenteá-lo, **Then** o sistema bloqueia a ação.

---

### User Story 5 - Robar e segurança (Priority: P2)

A casa tem um nível de segurança (tranca/cerca/alarme, upgrades por moedas). Loucos ("mad") de segurança mais alta são mais protegidos; loucos de segurança baixa perdem itens decorativos para assaltantes. Um assalto tem chance de sucesso determinística; sucesso transfere o item roubado ao ladrão com **posse plena** (pode vender/presentear como qualquer item, sem marca restritiva; sem devolução ao dono original — Clarificação 2026-08-14), fracasso aplica multa in-game e aumenta o nível de procurado do ladrão (polícia existente do módulo), sem kick/ban. Robo tem teto por dia e cooldown, não afeta moedas nem pets.

**Why this priority**: É a mecânica mais arriscada e sensível da economia, por isso exige os maiores controles anti-exploit (caps, cooldowns, multas), e por isso entra junto com o P2 de casas: precisa da infraestrutura (itens, segurança, infraestrutura de policiamento) já pronta.

**Independent Test**: com segurança baixa e cooldown liberado, o ladrão tenta assaltar; com segurança alta ou cooldown ativo, o assalto é bloqueado com mensagem; em falha, o ladrão é multado e o nível de procurado aumenta.

**Acceptance Scenarios**:

1. **Given** uma casa alvo com segurança baixa, **When** o ladrão executa o assalto com cooldown liberado, **Then** o assalto tem chance determinística de sucesso; em sucesso o item é transferido com marca de roubado, em falha o ladrão é multado (piso/teto) e o procurado aumenta.
2. **Given** uma casa alvo com segurança no nível máximo, **When** o ladrão tenta assaltar, **Then** o assalto bloqueado com aviso (não tenta).
3. **Given** um objeto marcado como roubado, **When** o ladrão tenta vendê-lo ou presenteá-lo, **Then** o objeto pode ser vendido/presenteado normalmente (posse plena do ladrão — Clarificação 2026-08-14).
4. **Given** um ladrão pego, **When** a penalidade é aplicada, **Then** ela é apenas in-game (multa, procurado) — nunca kick/ban.

---

### Edge Cases

- Duas transações concorrentes (compra e coleta ao mesmo tempo) não corrompem saldo nem estoque — ledger e saldo não-negativo garantidos.
- Jogador novo (sem casa) acessa link: casa padrão é provisionada automaticamente com resposta rápida.
- Jogador vende o último item (casa fica vazia mas válida; provisão padrão retorna na próxima abertura se a casa estiver vazia? — decisão de produto na resposta A de segurança: preso).
- Visita a casa de jogador que saiu do grupo ou foi banido: casa fica inacessível/arquivada; link pessoal revogado.
- Roubo de item já roubado: bloqueado (item não pode ser alvo de novo roubo).
- Item roubado que passa a ser do ladrão: sem marca restritiva — o ladrão pode vender/presentear normalmente; não há devolução ao dono original (Clarificação 2026-08-14).
- Jogador sem moedas tenta comprar cofre/alarme: mensagem amigável (física de saldo).
- Link pessoal vazado: o dono pode revogar e gerar novo link a qualquer momento.
- Erro de rede/LLM em qualquer comando: o comando cai em fallback ou mensagem amigável, nunca trava o bot.
- Bateria de comandos: mudanças de configuração não quebram saldo/estoque de jogadores existentes.

## Requirements

### Functional Requirements

**Casas e inventário**

- **FR-001**: O sistema DEVE provisionar automaticamente uma casa padrão (com conjunto inicial de itens) para todo jogador que acessar o jogo, sem custo.
- **FR-002**: O jogador DEVE poder listar, posicionar e mover itens decorativos na sua casa no navegador.
- **FR-003**: O jogador DEVE poder remover e vender itens da casa, com devolução parcial em moedas.
- **FR-004**: A casa DEVE ter um estado de limpeza; itens da casa e o estado de limpeza DEVEM depender do tempo (sujeira/desgaste progride com o tempo e influencia a recompensa diária).
- **FR-005**: O sistema DEVE aplicar uma atividade diária de limpeza por jogador por dia, com cooldown de reset diário, concedendo recompensa em moedas se a casa estiver bem cuidada.
- **FR-006**: O sistema DEVE manter o inventário de itens (decorativos, roupas, acessórios, presentes) por jogador e por grupo.

**Economia e moedas**

- **FR-007**: Todas as compras, vendas, presentes, roubos e recompensas DEVEM movimentar moedas via ledger transacional atômico, com saldo não-negativo.
- **FR-008**: Toda compra/venda DEVE respeitar caps e cooldowns centralizados em configuração (teto diário de compras, de visitas, de presentes, de roubos; valores de multa com piso e teto). *Anti-abuso: tetos diários por jogador + rate limit por IP do middleware existente; sem throttle extra por ação (Clarificação 2026-08-14).*
- **FR-009**: Vender um item DEVE creditar uma fração do valor de compra, documentada e determinística.
- **FR-010**: A loja de itens (móveis, pets, roupa, acessórios, segurança) DEVE ser consultável no navegador com preços de moedas do grupo, e as compras DEVEM debitar o saldo do jogador.

**Avatar**

- **FR-011**: Cada jogador DEVE ter um avatar composto por corpo base e slots de personalização (cabelo/rosto, roupas, acessórios).
- **FR-012**: O jogador DEVE poder equipar/remover itens de avatar nos slots, com validação de posse/desbloqueio.
- **FR-013**: Subir de nível (XP existente) DEVE desbloquear opções gratuitas de personalização.
- **FR-014**: Itens premium de avatar DEVEM ser compráveis com moedas na loja.
- **FR-015**: O avatar do dono DEVE ser renderizado na casa do dono e nas casas visitadas.

**Visitas**

- **FR-016**: O jogador DEVE poder visitar as casas de outros membros do mesmo grupo pelo navegador, com teto diário de visitas.
- **FR-017**: O sistema DEVE registrar visitas (visitante, data, recado opcional) e exibi-las em um mural de visitas para o anfitrião.
- **FR-018**: O acesso a casas de outros grupos ou links inválidos DEVE ser negado.

**Presentes**

- **FR-019**: O visitante DEVE poder deixar um presente (item de avatar, decoração, moedas já existentes, colecionáveis) ao anfitrião, com teto diário.
- **FR-020**: O anfitrião DEVE receber e notificar a entrega do presente, e DEVE poder vendê-lo (fração do valor).
- **FR-021**: Item roubado passa a pertencer ao ladrão com **posse plena**: pode ser vendido/presenteado normalmente; não há devolução ao dono original (que pode comprar um item igual na loja). *(Atualizado pela Clarificação 2026-08-14.)*

**Segurança e roubo**

- **FR-022**: A casa DEVE ter um nível de segurança (upgrades por moedas) que define o risco de perda.
- **FR-023**: O sistema DEVE permitir o roubo apenas de itens decorativos, e apenas quando a segurança do alvo for abaixo do limite definido.
- **FR-024**: O roubo DEVE ter resultado determinístico: sucesso (item transferido ao ladrão com posse plena — pode vender/presentear —, sem devolução ao dono original) ou falha (multa in-game com piso/teto e aumento de procurado na polícia existente).
- **FR-025**: O roubo DEVE respeitar teto diário e cooldown por ladrão; itens já roubados NÃO podem ser alvo de novo roubo.
- **FR-026**: Penalidades de jogo DEVEM ser exclusivamente in-game (moedas, procurado) — nunca kick/ban.

**Acesso web e privacidade**

- **FR-027**: O jogador DEVE acessar sua casa/avatar por um link pessoal único de navegador, posse do link = dono. O token é aleatório (24 bytes), unguessable, com hash (scrypt + salt) no banco — sem lockout por IP nem expiração extra (Clarificação 2026-08-14).
- **FR-028**: O link pessoal DEVE ser entregue exclusivamente no chat privado do bot, somente após o usuário iniciar conversa privada com o bot (jamais enviado pelo bot em grupo — o bot NUNCA inicia conversa privada).
- **FR-029**: O sistema DEVE identificar o usuário web pelo dono do link (número de WhatsApp registrado no grupo), sem expor dados pessoais de terceiros.
- **FR-030**: O dono DEVE poder revogar/regenerar seu link pessoal.
- **FR-031**: O sistema DEVE respeitar quiet hours definidas para anúncios/notificações automáticas, e o conteúdo gerado por usuários DEVE ter filtros de segurança (blocklist, max length, sem mídia). *Segurança do token: aleatório e unguessable (24 bytes, hash scrypt + salt); sem lockout/expiração (Clarificação 2026-08-14).*
- **FR-032**: APIs de escrita (comprar, mover, vender, etc.) DEVEM exigir autenticação do link; leitura de casas de terceiros limita-se a dados de avatar e decoração, **sem expor** dados pessoais (JIDs, números, coordenadas).

**In-game (WhatsApp) e DM**

- **FR-033**: O comando do jogo no grupo DEVE instruir o usuário a enviar um comando no chat privado do bot para receber o link pessoal da casa e outras informações importantes (teto diário, novas notificações) — via infraestrutura de DM existente do módulo.
- **FR-034**: Comandos essenciais (conferir saldo, coletar recompensa, consultar estado de segurança, revogar link) DEVEM funcionar tanto no grupo quanto no DM.
- **FR-035**: A expansão NÃO pode quebrar comandos, economia ou pipeline existentes do bot: toda funcionalidade nova entra por extensão, sem mudar contratos existentes.

### Key Entities

- **[Casa]**: Ambiente por jogador por grupo; estado da casa (itens posicionados com coordenadas/rotação, limpeza, saúde, segurança, cofre/moedas).
- **[Item de casa]**: Móveis/decorativos com custo, categoria, paperdoll/placeholder visual, durabilidade; estado de posição na casa.
- **[Pet]**: Item especial da casa com interação de alimentação/atenção; não roubável.
- **[Item de avatar]**: Peças de slots (cabelo/rosto, roupas, acessórios) com desbloqueio por nível e/ou compra.
- **[Avatar]**: Composição dos itens equipados por jogador.
- **[Inventário]**: Itens do jogador não posicionados/equipados (incluindo presentes recebidos).
- **[Visita]**: Registro de visita (visitante, casa, data, recado).
- **[Presente]**: Item/moeda/colecionável entregue a outro jogador (origem, destinatário, item).
- **[Segurança]**: Nível/upgrades de segurança da casa; define risco de roubo.
- **[Roubo/Assalto]**: Log de tentativas com resultado (sucesso/falha, item, multa, mudança de procurado).
- **[Link pessoal / Token]**: Token de acesso web único por jogador (por grupo), revogável; vincula ao JID canônico do WhatsApp.
- **[Ledger]**: Entradas transacionais contábeis de todas as movimentações (compras, vendas, recompensas, multas, presentes) — imutável e por escopo (grupo).

## Success Criteria

### Measurable Outcomes

- **SC-001**: Um novo jogador consegue provisionar o jogo e completar o checkout de rota (comando → DM → link → navegador → ver casa padrão → ver avatar) em menos de 5 minutos.
- **SC-002**: Pelo menos 2 minutos de sessão interativa por usuário por acesso no navegador até os primeiros 90 dias (métrica de engajamento são registradas e reportadas sem expor identidade).
- **SC-003**: O sistema fica disponível 99,5% dos acessos web (falhas de acesso não excedem 2 falhas para cada 100 acessos por período diário — metas de estabilidade, não de capacidade).
- **SC-004**: 90% dos comandos de jogo no grupo e no DM completam sem falha nem perda de moedas em testes automatizados das principais jornadas (compra, coleta, presente, roubo).
- **SC-005**: Zero casos de fraude/exploit confirmados (saldo inflado, roubo de moedas) em 90 dias de produção. *(Removido "revenda de itens roubados" — posse plena do ladrão permite revenda; Clarificação 2026-08-14.)*
- **SC-006**: A nova funcionalidade aumenta o número de jogadores ativos (participantes do módulo de divertimento que interagem pelo menos uma vez por dia) em pelo menos 10% em 90 dias, sem queda no uso do WhatsApp.
- **SC-007**: Casas são peças vivas do bairro: pelo menos 30% das casas provisionadas recebem ao menos uma visita ou presente por período de 30 dias.

## Assumptions

- **Anti-abuso**: tetos diários por jogador + rate limit por IP existente no middleware (padrão bolsa/job); sem throttle extra por ação (Clarificação 2026-08-14).
- **Escopo por grupo**: cada grupo é um "bairro" — a casa, itens, visitas e interações de um jogador valem dentro do escopo/`scope_key` do grupo (decisão do usuário, resposta A).
- **Autenticação web**: link pessoal com token por jogador/grupo; quem possui o link é o dono; o link é entregue no DM do bot (comando no privado iniciado pelo usuário) — o bot NUNCA inicia conversa privada nem envia link em grupo (decisão do usuário; risco de banimento do WhatsApp).
- **Roubo**: apenas itens decorativos são roubáveis; moedas e pets são imunes (decisão do usuário, resposta C); item roubado passa a ser do ladrão com **posse plena** (vende/presenteia normalmente; sem devolução — Clarificação 2026-08-14); penalidades in-game (multa com piso/teto + procurado), nunca kick/ban (constituição do módulo fun).
- **Segurança como progressão**: a segurança é um atributo melhorável da casa (upgrades por moedas) — mesma família da saúde/limpeza; não projetar como minijogo separado nesta versão.
- **Acesso de leitura a casas alheias**: aberto para membros do mesmo grupo (a "vizinhança" é pública dentro do bairro); a identidade do visitante é visível ao anfitrião (tudo dentro do escopo social do grupo). Dados pessoais fora do escopo (JIDs de outros grupos, etc.) nunca são expostos.
- **Rede/LLM**: se a geração de imagens ou LLM estiver indisponível, o jogo usa placeholders/fallback e continua funcionando (cascata Zen → Ollama → template já existente); falhas nunca quebram comandos.
- **Custo/performance**: bibliotecas à escolha da implementação; o dashboard pode crescer (novas rotas/telas), mantendo o build do dashboard e o npm test verdes.
- **Reaproveitamento**: comandos de DM existentes (via router, `isGroup=false`, `groups`/`dmGroups`) são reaproveitados para entrega do link e comandos essenciais; não criar canal paralelo de mensageria.
- **Catálogo inicial**: móveis, pets, roupas e acessórios iniciais são determinados na implementação (catálogo persistente em `shop/`), com progressão por nível existente.
- **Moedas compartilhadas**: o saldo do jogador no grupo é o saldo existente (`fun_user_stats.coins`) — não há nova moeda.
- **Multi-dispositivo**: o link pessoal pode ser aberto em vários aparelhos (não há vínculo de dispositivo).