/**
 * config/constants.js
 *
 * Enumerações centralizadas para evitar magic strings espalhadas pelo código.
 * Todas as constantes semânticas do projeto devem ser definidas aqui.
 */

// ─── Status da Sessão ─────────────────────────────────────────────────────────
export const SESSION_STATUS = {
  ACTIVE: 'active',
  ENDED: 'ended',
};

// ─── Tipos de Espera (waitingFor) ─────────────────────────────────────────────
export const WAIT_TYPE = {
  KEYWORD: 'keyword',
  LIST: 'list',
  MULTIPLE_CHOICE: 'multiple-choice',
  HUMAN: 'human',
  SATISFACTION_SURVEY: 'satisfaction-survey',
};

// ─── Tipos de Bloco Suportados ────────────────────────────────────────────────
export const BLOCK_TYPE = {
  INITIAL_MESSAGE: 'initial-message',
  SEND_TEXT: 'send-text',
  SEND_LIST: 'send-list',
  REDIRECT_TO_HUMAN: 'redirect-to-human',
  CONDITION: 'condition',
  IF_CONDITION: 'if-condition',
  ELSE_IF: 'else-if',
  ELSE: 'else',
  END_IF: 'end-if',
  SET_VARIABLE: 'set-variable',
  REDIRECT: 'redirect',
  DELAY: 'delay',
  END_CONVERSATION: 'end-conversation',
  RESTART_FLOW: 'restart-flow',
  COMMAND_INPUT: 'command-input',
  HTTP_REQUEST: 'http-request',
  KEYCHECK: 'keycheck',
  STRING_FUNCTIONS: 'string-functions',
  LIST_OPERATIONS: 'list-operations',
  DATA_PROCESSOR: 'data-processor',
  MULTIPLE_CHOICE: 'multiple-choice',
  SEND_REACTION: 'send-reaction',
  SURVEY: 'survey',
};

// ─── Tipos de Condição ────────────────────────────────────────────────────────
export const CONDITION_TYPE = {
  VARIABLE: 'variable',
  KEYWORD: 'keyword',
};

// ─── Operadores de Condição ───────────────────────────────────────────────────
export const OPERATOR = {
  EQUALS: '==',
  NOT_EQUALS: '!=',
  GREATER: '>',
  LESS: '<',
  GREATER_EQUAL: '>=',
  LESS_EQUAL: '<=',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'not_contains',
  BETWEEN: 'between',
  STARTS_WITH: 'starts_with',
  ENDS_WITH: 'ends_with',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
};

// ─── Operadores Lógicos ───────────────────────────────────────────────────────
export const LOGICAL_OPERATOR = {
  AND: 'AND',
  OR: 'OR',
};

// ─── Variáveis Internas do Engine ─────────────────────────────────────────────
export const INTERNAL_VAR = {
  SESSION_ID: '__sessionId',
  KEYWORDS: '__keywords',
  NEXT_BLOCK_ON_KEYWORD: '__nextBlockOnKeyword',
  CAPTURE_VARIABLE: '__captureVariable',
  LAST_MESSAGE: '__lastMessage',
  LAST_INCOMING_MESSAGE_KEY: '__lastIncomingMessageKey',
  LAST_INCOMING_MESSAGE_ID: '__lastIncomingMessageId',
  LAST_INCOMING_LIST_ID: '__lastIncomingListId',
  LIST_ITEMS: '__listItems',
  NEXT_BLOCK_ON_LIST: '__nextBlockOnList',
  LAST_LIST_SELECTION: '__lastListSelection',
  LAST_LIST_SELECTION_ID: '__lastListSelectionId',
  NEXT_BLOCK_ON_MULTIPLE_CHOICE: '__nextBlockOnMultipleChoice',
  MULTIPLE_CHOICE_OPTIONS: '__multipleChoiceOptions',
  MULTIPLE_CHOICE_ALLOW_MULTIPLE: '__multipleChoiceAllowMultiple',
  MULTIPLE_CHOICE_MIN: '__multipleChoiceMinSelections',
  MULTIPLE_CHOICE_MAX: '__multipleChoiceMaxSelections',
  MULTIPLE_CHOICE_CAPTURE_VAR: '__multipleChoiceCaptureVar',
  MULTIPLE_CHOICE_INVALID_MESSAGE: '__multipleChoiceInvalidMessage',
  LAST_MULTIPLE_CHOICE_SELECTION: '__lastMultipleChoiceSelection',
  LAST_MULTIPLE_CHOICE_SELECTION_IDS: '__lastMultipleChoiceSelectionIds',
  LAST_COMMAND: '__lastCommand',
  LAST_COMMAND_ARGS: '__lastCommandArgs',
  IF_STACK: '__ifStack',
  SESSION_STARTED_AT: '__sessionStartedAt',
  SESSION_LAST_ACTIVITY_AT: '__sessionLastActivityAt',
  SESSION_MESSAGE_COUNT: '__sessionMessageCount',
  SESSION_USER_KEY: '__sessionUserKey',
  SESSION_ENDED_AT: '__sessionEndedAt',
  SESSION_END_REASON: '__sessionEndReason',
  HUMAN_HANDOFF: '__humanHandoff',
  SATISFACTION_SURVEY_STATE: '__satisfactionSurveyState',
};

// ─── Limites do Engine ────────────────────────────────────────────────────────
export const ENGINE_LIMITS = {
  MAX_STEPS: 100,
  PROCESSED_IDS_MAX: 2000,
  PROCESSED_IDS_TTL_MS: 10 * 60 * 1000, // 10 minutos
};

// --- Limites de Broadcast ---
export const BROADCAST_LIMITS = {
  CONTACT_LIST_MAX: 5000,
  CONTACT_SEARCH_MAX: 200,
  SELECTED_RECIPIENTS_MAX: 1000,
  MESSAGE_TEXT_MAX: 4096,
  IMAGE_MAX_BYTES: 8 * 1024 * 1024,
  SEND_DELAY_MS: 250,
  ACTIVE_SESSION_CACHE_MAX: 4000,
  ACTIVE_SESSION_CACHE_TTL_MS: 20 * 1000,
  // Intervalo de poll enquanto a campanha estiver pausada (ms). Mantem o
  // processo responsivo para resume/cancel sem consumir CPU.
  PAUSE_POLL_MS: 250,
  // Penalidade de atraso aplicada quando o atendimento conversacional esta
  // sob pressao (fila de ingestao ou taxa de entrada elevada). Garante que
  // mensagens de clientes ativos tenham prioridade sobre broadcast.
  BACKPRESSURE_DELAY_MS: 500,
  // Tamanho maximo do buffer de resultados antes de persistir em lote no
  // SQLite. Reduz o numero de fsyncs em campanhas grandes.
  PERSIST_BATCH_SIZE: 25,
  // Intervalo maximo (ms) entre persistencias em lote. Garante checkpoint
  // mesmo quando o throughput e baixo, limitando janela de possivel perda
  // em caso de crash.
  PERSIST_FLUSH_MS: 1500,
  // Intervalo minimo (ms) entre emissoes de progresso nao-criticas. Eventos
  // criticos (start, failure, pause/resume/cancel, complete) nao sao
  // throttled.
  PROGRESS_THROTTLE_MS: 400,
};
