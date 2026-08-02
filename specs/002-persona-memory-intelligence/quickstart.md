# Quickstart: Persona Memory Intelligence

## Objetivo

Validar ponta a ponta que a persona do módulo `fun/` consegue:
- responder usando a thread correta
- lembrar fatos úteis sem inventar
- manter identidade por grupo
- evitar vazamento de memória entre grupos

## Pré-requisitos

- Repositório com dependências instaladas
- Banco de testes isolado
- Execução sem dependência de rede externa para a suíte automatizada
- Feature spec disponível em `specs/002-persona-memory-intelligence/spec.md`

## Artefatos de referência

- Especificação: `specs/002-persona-memory-intelligence/spec.md`
- Modelo de dados: `specs/002-persona-memory-intelligence/data-model.md`
- Contrato funcional: `specs/002-persona-memory-intelligence/contracts/persona-context-contract.md`

## Cenário 1: Continuidade por reply

1. Preparar um grupo de teste isolado com duas conversas paralelas.
2. Inserir uma thread em que o bot já respondeu anteriormente.
3. Acionar o bot por meio de uma reply nessa thread.
4. Verificar que a resposta continua o assunto correto e não puxa contexto da outra conversa.

**Resultado esperado**:
- thread correta selecionada
- contexto de outra conversa não aparece
- resposta permanece coerente com a cadeia citada

## Cenário 2: Memória explícita vs inferida

1. Registrar uma preferência explícita de um participante em contexto de grupo.
2. Registrar um sinal ambíguo sobre outro traço, sem confirmação clara.
3. Acionar o bot em conversa futura sobre o mesmo tema.
4. Verificar o pacote de contexto e a resposta.

**Resultado esperado**:
- fato explícito pode ser reutilizado como memória confirmada
- inferência fraca não aparece como verdade categórica

## Cenário 3: Identidade por grupo

1. Preparar dois grupos com tons sociais diferentes.
2. Alimentar lore e interações distintas em cada grupo.
3. Acionar o bot em ambos os grupos com prompts equivalentes.
4. Comparar o contexto selecionado e a resposta resultante.

**Resultado esperado**:
- estilo do bot permanece coerente dentro de cada grupo
- fatos e tom não vazam entre grupos

## Cenário 4: Anti-leak entre grupos

1. Registrar memória relevante sobre o mesmo usuário em um grupo A.
2. Não registrar essa memória no grupo B.
3. Acionar o bot no grupo B com tema relacionado.
4. Inspecionar o contexto recuperado.

**Resultado esperado**:
- nenhuma memória do grupo A entra no contexto do grupo B
- a resposta do grupo B não menciona fatos aprendidos apenas no grupo A

## Cenário 5: Decay e supressão

1. Inserir memórias antigas, contraditas e sensíveis em um grupo de teste.
2. Executar o fluxo de atualização e recuperação.
3. Acionar a persona com tema potencialmente relacionado.

**Resultado esperado**:
- memórias antigas perdem prioridade
- memórias sensíveis não entram no contexto de resposta
- memórias contraditas podem ser rebaixadas ou suprimidas

## Validação recomendada

Executar uma combinação de:
- testes unitários dos serviços de thread, retrieval, ingestão e contexto
- testes de integração com banco isolado
- cenários de comportamento da persona focados em reply, confiança e anti-leak

## Critério de aprovação

A feature está pronta para implementação quando houver cobertura planejada para:
- continuidade por reply
- memória explícita/corroborada/inferida
- identidade por grupo
- bloqueio de contexto sensível
- prevenção total de leak entre grupos
