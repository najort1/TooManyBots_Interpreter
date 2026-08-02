# Research: Persona Memory Intelligence

## Decision 1: Introduzir uma camada explícita de contexto da persona

- **Decision**: Criar uma camada de orquestração de contexto separada da geração de resposta, responsável por montar o pacote de contexto antes da chamada da persona.
- **Rationale**: A persona atual já possui trigger, cooldown, fallback e geração, mas a memória útil ainda está espalhada entre thread simples, lore do grupo e perfil social. Separar a montagem de contexto reduz acoplamento, melhora testabilidade e evita inflar o serviço de resposta com ranking, decay e regras de confiança.
- **Alternatives considered**:
  - Expandir diretamente o serviço atual de persona: rejeitado porque concentraria regras demais em um único ponto e aumentaria risco de regressão.
  - Usar apenas prompt maior com mais histórico: rejeitado porque não resolve seleção, confiança, escopo e anti-leak de memória.

## Decision 2: Tratar memória por categorias distintas

- **Decision**: Modelar memória em quatro categorias operacionais: contexto de thread, memória episódica, memória semântica e memória social.
- **Rationale**: Cada tipo de memória tem finalidade, duração e risco diferentes. Contexto de thread precisa ser prioritário e curto; memória semântica tende a ser mais estável; memória social exige mais cautela; memória episódica envelhece mais rápido.
- **Alternatives considered**:
  - Uma tabela única sem tipagem forte: rejeitado porque dificultaria ranking, decay e política de uso.
  - Armazenar tudo apenas como lore agregada: rejeitado porque não sustenta continuidade fina nem confiança por fato.

## Decision 3: Diferenciar fatos explícitos, corroborados e inferidos

- **Decision**: Toda memória recuperável para resposta deve carregar um nível de evidência: explícito, corroborado ou inferido.
- **Rationale**: A principal barreira para “inteligência” útil é impedir que o bot trate suspeita como verdade. O nível de evidência permite definir políticas diferentes de recuperação e uso na resposta.
- **Alternatives considered**:
  - Usar apenas score numérico genérico: rejeitado porque não deixa claro o motivo social da confiança.
  - Não persistir inferências: rejeitado porque sinais fracos ainda podem ser úteis para ranking e continuidade, desde que não sejam afirmados como fatos.

## Decision 4: Resolver thread com prioridade absoluta para reply

- **Decision**: Quando a mensagem atual for reply, a thread citada será a âncora primária do contexto. Sem reply, o sistema usará recência, participantes e tema para anexação de thread.
- **Rationale**: O maior problema de naturalidade em chats de grupo é responder a conversa errada. Reply é o sinal mais confiável para continuidade e precisa ter precedência sobre janelas temporais genéricas.
- **Alternatives considered**:
  - Usar apenas janela temporal recente: rejeitado porque mistura conversas paralelas.
  - Usar apenas autor: rejeitado porque o mesmo autor pode participar de vários assuntos em sequência.

## Decision 5: Persistir identidade da persona por grupo

- **Decision**: Manter uma identidade estável da persona por grupo, separada das memórias sobre usuários e eventos.
- **Rationale**: O bot precisa parecer consistente em cada grupo sem misturar tom local com fatos pessoais. Separar identidade do grupo e memória sobre pessoas reduz contaminação entre estilo e conteúdo.
- **Alternatives considered**:
  - Reconstruir estilo dinamicamente apenas da lore recente: rejeitado porque gera oscilação de personalidade.
  - Manter uma única identidade global: rejeitado porque os grupos têm climas sociais diferentes.

## Decision 6: Aplicar decay e supressão como parte do fluxo normal

- **Decision**: Memórias devem envelhecer, perder prioridade e poder ser suprimidas quando ficarem contraditas, sensíveis ou irrelevantes.
- **Rationale**: “Memória perfeita” literal causaria acúmulo de lixo e respostas invasivas. O sistema deve lembrar com precisão, não lembrar tudo para sempre.
- **Alternatives considered**:
  - Nunca expirar memórias: rejeitado por risco de stale context e creepiness.
  - Apagar agressivamente: rejeitado porque reduziria demais continuidade e identidade social.

## Decision 7: Reutilizar a base atual do módulo fun em vez de substituí-la

- **Decision**: Construir a nova arquitetura em cima dos componentes já existentes de perfil, lore e persona, adicionando novos serviços e repositórios no padrão do módulo.
- **Rationale**: O módulo já segue factories, DI, `scope_key`, better-sqlite3 e testes determinísticos. A evolução deve respeitar essas convenções para reduzir custo de integração e risco operacional.
- **Alternatives considered**:
  - Reescrever toda a camada de persona do zero: rejeitado por alto risco e baixo reaproveitamento.
  - Criar um subsistema externo de memória fora do módulo `fun/`: rejeitado por quebrar o isolamento arquitetural do módulo.

## Decision 8: Observabilidade focada em seleção de contexto, não no texto gerado

- **Decision**: As métricas e diagnósticos principais devem incidir sobre memória ingerida, memórias descartadas, ranking, thread usada, bloqueios de sensibilidade e anti-leak por grupo.
- **Rationale**: O texto final do modelo pode variar, mas o processo de escolha de contexto precisa ser estável e auditável. Isso torna a inteligência observável e testável.
- **Alternatives considered**:
  - Medir apenas a resposta textual final: rejeitado porque é frágil e difícil de tornar determinístico.
  - Não medir o pipeline de memória: rejeitado porque dificulta identificar regressões e vazamentos entre grupos.
