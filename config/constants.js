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
};

// ─── Tipos de Bloco Suportados ────────────────────────────────────────────────
export const BLOCK_TYPE = {
  INITIAL_MESSAGE: 'initial-message',
  SEND_TEXT: 'send-text',
  SEND_LIST: 'send-list',
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
  KEYWORDS: '__keywords',
  NEXT_BLOCK_ON_KEYWORD: '__nextBlockOnKeyword',
  CAPTURE_VARIABLE: '__captureVariable',
  LAST_MESSAGE: '__lastMessage',
  LIST_ITEMS: '__listItems',
  NEXT_BLOCK_ON_LIST: '__nextBlockOnList',
  LAST_LIST_SELECTION: '__lastListSelection',
  LAST_LIST_SELECTION_ID: '__lastListSelectionId',
  IF_STACK: '__ifStack',
  SESSION_STARTED_AT: '__sessionStartedAt',
  SESSION_LAST_ACTIVITY_AT: '__sessionLastActivityAt',
  SESSION_MESSAGE_COUNT: '__sessionMessageCount',
  SESSION_ENDED_AT: '__sessionEndedAt',
  SESSION_END_REASON: '__sessionEndReason',
};

// ─── Limites do Engine ────────────────────────────────────────────────────────
export const ENGINE_LIMITS = {
  MAX_STEPS: 100,
  PROCESSED_IDS_MAX: 2000,
  PROCESSED_IDS_TTL_MS: 10 * 60 * 1000, // 10 minutos
};
