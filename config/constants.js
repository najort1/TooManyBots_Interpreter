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
  DATA_PROCESSOR: 'data-processor',
  MULTIPLE_CHOICE: 'multiple-choice',
  SEND_REACTION: 'send-reaction',
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
  SESSION_ENDED_AT: '__sessionEndedAt',
  SESSION_END_REASON: '__sessionEndReason',
  HUMAN_HANDOFF: '__humanHandoff',
};

// ─── Limites do Engine ────────────────────────────────────────────────────────
export const ENGINE_LIMITS = {
  MAX_STEPS: 100,
  PROCESSED_IDS_MAX: 2000,
  PROCESSED_IDS_TTL_MS: 10 * 60 * 1000, // 10 minutos
};
