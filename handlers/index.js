import { BLOCK_TYPE } from '../config/constants.js';
import {
  handleDelay,
  handleEndConversation,
  handleInitialMessage,
  handleRedirect,
  handleRestartFlow,
  handleSendList,
  handleSendText,
  handleSetVariable,
} from './basicHandlers.js';
import {
  handleCondition,
  handleElse,
  handleElseIf,
  handleEndIf,
  handleIfCondition,
  handleKeycheck,
} from './conditionalHandlers.js';
import {
  handleDataProcessor,
  handleHttpRequest,
} from './integrationHandlers.js';
import {
  handleCommandInput,
  handleMultipleChoice,
  handleRedirectToHuman,
  handleSendReaction,
} from './interactionHandlers.js';

export const HANDLERS = {
  [BLOCK_TYPE.INITIAL_MESSAGE]: handleInitialMessage,
  [BLOCK_TYPE.SEND_TEXT]: handleSendText,
  [BLOCK_TYPE.SEND_LIST]: handleSendList,
  [BLOCK_TYPE.REDIRECT_TO_HUMAN]: handleRedirectToHuman,
  [BLOCK_TYPE.COMMAND_INPUT]: handleCommandInput,
  [BLOCK_TYPE.MULTIPLE_CHOICE]: handleMultipleChoice,
  [BLOCK_TYPE.HTTP_REQUEST]: handleHttpRequest,
  [BLOCK_TYPE.KEYCHECK]: handleKeycheck,
  [BLOCK_TYPE.DATA_PROCESSOR]: handleDataProcessor,
  [BLOCK_TYPE.SEND_REACTION]: handleSendReaction,
  [BLOCK_TYPE.CONDITION]: handleCondition,
  [BLOCK_TYPE.IF_CONDITION]: handleIfCondition,
  [BLOCK_TYPE.ELSE_IF]: handleElseIf,
  [BLOCK_TYPE.ELSE]: handleElse,
  [BLOCK_TYPE.END_IF]: handleEndIf,
  [BLOCK_TYPE.SET_VARIABLE]: handleSetVariable,
  [BLOCK_TYPE.REDIRECT]: handleRedirect,
  [BLOCK_TYPE.DELAY]: handleDelay,
  [BLOCK_TYPE.END_CONVERSATION]: handleEndConversation,
  [BLOCK_TYPE.RESTART_FLOW]: handleRestartFlow,
};
