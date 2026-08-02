# Data Model: Persona Memory Intelligence

## 1. Conversation Event

Representa uma interação normalizada recebida pelo pipeline antes da geração da resposta.

### Campos principais
- `scopeKey`
- `chatJid`
- `messageId`
- `authorJid`
- `text`
- `messageType`
- `mentionedJids`
- `quotedParticipant`
- `quotedMessageId`
- `isGroup`
- `isReply`
- `triggerType`
- `occurredAt`

### Regras
- Sempre pertence a um único `scopeKey`
- Nunca pode ser processado sem `authorJid` válido
- `isReply` depende da presença de referência de citação resolvida

## 2. Thread Context

Representa a conversa ativa usada para continuidade e priorização contextual.

### Campos principais
- `threadKey`
- `scopeKey`
- `anchorMessageId`
- `replyToMessageId`
- `participants[]`
- `topicSummary`
- `openQuestions[]`
- `lastUserJid`
- `turnCount`
- `lastMessageAt`
- `expiresAt`

### Relacionamentos
- Pertence a um `scopeKey`
- Pode ser referenciado por várias memórias conversacionais

### Regras
- Reply direta deve ter prioridade para resolver `threadKey`
- Thread expirada não deve dominar contexto novo
- Turnos devem ser limitados para evitar crescimento infinito

## 3. Conversation Memory

Unidade principal de memória recuperável para a persona.

### Campos principais
- `id`
- `scopeKey`
- `memoryType` (`thread`, `episodic`, `semantic`, `social`)
- `subjectUserJid`
- `targetUserJid`
- `threadKey`
- `relatedMessageId`
- `factText`
- `factKey`
- `confidence`
- `confirmationLevel` (`explicit`, `corroborated`, `inferred`)
- `sensitivityLevel` (`safe`, `private`, `sensitive`)
- `sourceType`
- `keywords[]`
- `entities[]`
- `firstSeenAt`
- `lastSeenAt`
- `expiresAt`
- `usageCount`
- `suppressed`

### Relacionamentos
- Pertence a um único `scopeKey`
- Pode referenciar um `threadKey`
- Pode estar centrada em um ou dois usuários

### Regras
- Nunca pode ser recuperada fora do `scopeKey`
- Memórias `suppressed` não participam do ranking
- `confirmationLevel=inferred` não pode ser tratada como fato forte sem promoção posterior
- Memórias com `sensitivityLevel` alto devem ser filtradas para uso na persona

## 4. Group Persona Identity

Representa o perfil persistente de estilo da persona por grupo.

### Campos principais
- `scopeKey`
- `voiceStyle[]`
- `allowedTones[]`
- `forbiddenTones[]`
- `signatureTraits[]`
- `groupLoreSummary`
- `updatedAt`

### Regras
- Existe uma identidade por grupo
- Não deve conter fatos pessoais individuais como fonte principal
- Deve influenciar estilo, não sobrescrever fatos do contexto atual

## 5. Memory Retrieval Result

Pacote final entregue para a tentativa de resposta.

### Campos principais
- `scopeKey`
- `threadContext`
- `confirmedFacts[]`
- `inferredSignals[]`
- `socialSignals[]`
- `groupIdentity`
- `discardReasons[]`
- `selectedMemoryIds[]`
- `riskFlags[]`

### Regras
- Deve respeitar limite máximo de itens e orçamento de contexto
- Deve distinguir claramente fatos confirmados de sinais inferidos
- Deve registrar por que memórias relevantes foram descartadas

## 6. State Transitions

### Conversation Memory
- `new` → `explicit`
- `new` → `inferred`
- `inferred` → `corroborated`
- `explicit` → `corroborated`
- `explicit|corroborated|inferred` → `suppressed`
- `explicit|corroborated|inferred` → `expired`

### Thread Context
- `opened` → `active`
- `active` → `extended`
- `active|extended` → `expired`
- `expired` → `replaced`

## 7. Validation Rules

- Todo identificador de usuário deve ser canônico dentro do escopo do grupo
- Todo registro persistido deve ter `scopeKey`
- Memórias contraditórias devem poder coexistir temporariamente até resolução por relevância ou supressão
- Itens sensíveis devem ser marcados ainda na ingestão
- Resultado de recuperação nunca deve misturar memórias de grupos diferentes
