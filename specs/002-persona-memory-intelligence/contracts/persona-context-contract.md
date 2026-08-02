# Contract: Persona Context Pipeline

## Purpose

Definir o contrato funcional entre o pipeline de entrada, a camada de contexto da persona e a geração de resposta.

## 1. Input Contract: Conversation Event

O pipeline deve produzir um evento conversacional normalizado contendo, no mínimo:

- escopo do grupo
- autor da mensagem
- identificador da mensagem
- texto ou conteúdo relevante da interação
- participantes mencionados
- participante citado, quando houver
- indicador de reply
- momento da interação
- tipo de trigger da persona

## 2. Pre-Response Context Contract

A camada de contexto deve devolver um pacote contendo, no mínimo:

- thread ativa selecionada
- fatos confirmados relevantes
- sinais inferidos relevantes
- sinais sociais relevantes
- identidade da persona por grupo
- indicadores de risco ou bloqueio
- referência das memórias selecionadas
- razões de descarte das memórias candidatas relevantes

## 3. Retrieval Rules Contract

O resultado de recuperação deve obedecer às seguintes garantias:

- nunca incluir memória de outro grupo
- priorizar reply/thread sobre mera recência quando houver conflito
- manter separação entre fato confirmado e inferência
- excluir memórias sensíveis ou suprimidas do contexto de resposta
- respeitar limite de contexto configurado

## 4. Post-Response Contract

Após a resposta, o fluxo deve ser capaz de registrar:

- continuação ou abertura de thread
- reforço de memórias utilizadas com sucesso
- novas memórias explícitas observadas no evento atual
- ajustes de expiração, decay ou supressão quando aplicável

## 5. Failure Handling Contract

Quando o contexto completo não puder ser montado:

- o fluxo não deve quebrar a resposta da persona
- o sistema deve degradar para contexto mínimo seguro
- o fallback da persona deve continuar disponível
- falhas parciais de memória não devem contaminar outros grupos

## 6. Observability Contract

O fluxo deve expor informação observável suficiente para validar:

- quais memórias foram selecionadas
- quais foram descartadas e por quê
- qual thread foi usada
- se houve bloqueio por sensibilidade
- se houve prevenção de leak entre grupos
