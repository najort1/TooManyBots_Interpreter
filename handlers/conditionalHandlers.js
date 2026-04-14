import { sendTextMessage } from '../engine/sender.js';
import { interpolate } from '../engine/utils.js';
import { BLOCK_TYPE, INTERNAL_VAR } from '../config/constants.js';
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
  handleDataProcessor,
  handleHttpRequest,
  handleListOperations,
  handleStringFunctions,
} from './integrationHandlers.js';
import {
  handleCommandInput,
  handleMultipleChoice,
  handleRedirectToHuman,
  handleSendReaction,
} from './interactionHandlers.js';
import {
  evaluateConditionConfig,
  extractJsonPath,
  findEndIf,
  findNextBranch,
  getIfStack,
  toText,
} from './shared.js';

const INLINE_ACTION_HANDLERS = {
  [BLOCK_TYPE.INITIAL_MESSAGE]: handleInitialMessage,
  [BLOCK_TYPE.SEND_TEXT]: handleSendText,
  [BLOCK_TYPE.SEND_LIST]: handleSendList,
  [BLOCK_TYPE.REDIRECT_TO_HUMAN]: handleRedirectToHuman,
  [BLOCK_TYPE.COMMAND_INPUT]: handleCommandInput,
  [BLOCK_TYPE.MULTIPLE_CHOICE]: handleMultipleChoice,
  [BLOCK_TYPE.HTTP_REQUEST]: handleHttpRequest,
  [BLOCK_TYPE.STRING_FUNCTIONS]: handleStringFunctions,
  [BLOCK_TYPE.LIST_OPERATIONS]: handleListOperations,
  [BLOCK_TYPE.DATA_PROCESSOR]: handleDataProcessor,
  [BLOCK_TYPE.SEND_REACTION]: handleSendReaction,
  [BLOCK_TYPE.SET_VARIABLE]: handleSetVariable,
  [BLOCK_TYPE.REDIRECT]: handleRedirect,
  [BLOCK_TYPE.DELAY]: handleDelay,
  [BLOCK_TYPE.END_CONVERSATION]: handleEndConversation,
  [BLOCK_TYPE.RESTART_FLOW]: handleRestartFlow,
};

function normalizeOperator(operator) {
  const raw = toText(operator).toLowerCase();
  if (!raw) return '';
  if (raw === '==' || raw === '!=') return raw;
  if (raw === '>' || raw === '<' || raw === '>=' || raw === '<=') return raw;

  const compact = raw.replace(/[\s_-]+/g, '');
  if (compact === 'equals' || compact === 'equal' || compact === 'eq') return '==';
  if (compact === 'equalto') return '==';
  if (compact === 'notequals' || compact === 'neq') return '!=';
  if (compact === 'notequalto') return '!=';
  if (compact === 'greaterthan') return '>';
  if (compact === 'lessthan') return '<';
  if (compact === 'greaterthanorequal' || compact === 'greaterthanorequalto') return '>=';
  if (compact === 'lessthanorequal' || compact === 'lessthanorequalto') return '<=';
  if (compact === 'contains' || compact === 'contain' || compact === 'includes') return 'contains';
  if (compact === 'doesnotcontain') return 'not_contains';
  if (compact === 'notcontains' || compact === 'notinclude') return 'not_contains';
  if (compact === 'startswith') return 'starts_with';
  if (compact === 'endswith') return 'ends_with';
  if (compact === 'isempty') return 'is_empty';
  if (compact === 'isnotempty') return 'is_not_empty';
  if (compact === 'exists') return 'exists';
  if (compact === 'doesnotexist') return 'does_not_exist';
  if (compact === 'between') return 'between';
  if (compact === 'regex' || compact === 'matchesregex' || compact === 'matchregex') return 'regex';
  if (compact === 'doesnotmatchregex') return 'not_regex';
  return raw;
}

function toComparableText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function isEmptyValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function resolveConditionSourceValue(condition, session) {
  const sourceExpression = toText(condition?.source || condition?.variable);
  if (!sourceExpression) return '';

  const variables = session?.variables ?? {};
  if (Object.prototype.hasOwnProperty.call(variables, sourceExpression)) {
    return variables[sourceExpression];
  }

  const resolved = extractJsonPath(variables, sourceExpression);
  return resolved === undefined ? '' : resolved;
}

function evaluateKeycheckCondition(condition, session) {
  const operator = normalizeOperator(condition?.operator);
  const sourceValueRaw = resolveConditionSourceValue(condition, session);
  const variables = session?.variables ?? {};
  const compareValueRaw = interpolate(String(condition?.value ?? ''), variables);
  const compareValueMaxRaw = interpolate(String(condition?.valueMax ?? condition?.maxValue ?? ''), variables);

  const sourceText = toComparableText(sourceValueRaw).toLowerCase();
  const compareText = toComparableText(compareValueRaw).toLowerCase();
  const compareMaxText = toComparableText(compareValueMaxRaw).toLowerCase();

  const sourceNum = Number(sourceText);
  const compareNum = Number(compareText);
  const compareMaxNum = Number(compareMaxText);
  const sourceNumValid = Number.isFinite(sourceNum);
  const compareNumValid = Number.isFinite(compareNum);
  const compareMaxNumValid = Number.isFinite(compareMaxNum);

  switch (operator) {
    case '==':
      if (sourceNumValid && compareNumValid && sourceText !== '' && compareText !== '') {
        return sourceNum === compareNum;
      }
      return sourceText === compareText;
    case '!=':
      if (sourceNumValid && compareNumValid && sourceText !== '' && compareText !== '') {
        return sourceNum !== compareNum;
      }
      return sourceText !== compareText;
    case '>':
      return sourceNumValid && compareNumValid && sourceNum > compareNum;
    case '<':
      return sourceNumValid && compareNumValid && sourceNum < compareNum;
    case '>=':
      return sourceNumValid && compareNumValid && sourceNum >= compareNum;
    case '<=':
      return sourceNumValid && compareNumValid && sourceNum <= compareNum;
    case 'contains':
      return sourceText.includes(compareText);
    case 'not_contains':
      return !sourceText.includes(compareText);
    case 'starts_with':
      return sourceText.startsWith(compareText);
    case 'ends_with':
      return sourceText.endsWith(compareText);
    case 'is_empty':
      return isEmptyValue(sourceValueRaw);
    case 'is_not_empty':
      return !isEmptyValue(sourceValueRaw);
    case 'exists':
      return !isEmptyValue(sourceValueRaw);
    case 'does_not_exist':
      return isEmptyValue(sourceValueRaw);
    case 'between':
      return sourceNumValid && compareNumValid && compareMaxNumValid &&
        sourceNum >= compareNum && sourceNum <= compareMaxNum;
    case 'regex':
    case 'not_regex': {
      try {
        const flags = toText(condition?.regexFlags || condition?.flags);
        const regex = new RegExp(String(compareValueRaw), flags);
        const matched = regex.test(toComparableText(sourceValueRaw));
        return operator === 'not_regex' ? !matched : matched;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

function evaluateKeycheckConditional(conditional, session) {
  const conditions = Array.isArray(conditional?.conditions) ? conditional.conditions : [];
  if (conditions.length === 0) return false;

  const mode = toText(conditional?.mode || conditional?.logicalOperator || 'OR').toUpperCase();
  if (mode === 'AND') {
    return conditions.every(condition => evaluateKeycheckCondition(condition, session));
  }

  return conditions.some(condition => evaluateKeycheckCondition(condition, session));
}

function mergeSessionPatch(basePatch, nextPatch = {}) {
  const merged = { ...basePatch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'variables')) {
    merged.variables = nextPatch.variables;
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'waitingFor')) {
    merged.waitingFor = nextPatch.waitingFor;
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'status')) {
    merged.status = nextPatch.status;
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'botType')) {
    merged.botType = nextPatch.botType;
  }
  return merged;
}

function applySessionPatch(session, patch = {}) {
  const next = { ...session };
  if (Object.prototype.hasOwnProperty.call(patch, 'variables')) {
    next.variables = patch.variables ?? {};
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'waitingFor')) {
    next.waitingFor = patch.waitingFor;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    next.status = patch.status;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'botType')) {
    next.botType = patch.botType;
  }
  return next;
}

function resolveRedirectIndex(flow, targetBlockId) {
  const targetId = toText(targetBlockId);
  if (!targetId) return null;
  const index = flow?.indexMap?.get(targetId);
  return Number.isInteger(index) ? index : null;
}

async function executeThenActions({ actions, session, sock, jid, flow, runtime }) {
  const list = Array.isArray(actions) ? actions : [];
  const defaultNextIndex = session.blockIndex + 1;
  let combinedPatch = {};
  let workingSession = session;

  for (let i = 0; i < list.length; i++) {
    const action = list[i];
    const type = toText(action?.type).toLowerCase();
    const handler = INLINE_ACTION_HANDLERS[type];

    if (!handler) {
      console.warn(`[keycheck] Tipo de thenAction nao suportado "${type}" - ignorando.`);
      continue;
    }

    const actionBlock = {
      id: toText(action?.id || `keycheck-action-${i + 1}`),
      type,
      name: toText(action?.name || `Keycheck Action ${i + 1}`),
      config: action?.config ?? {},
    };

    const result = await handler({ block: actionBlock, session: workingSession, sock, jid, flow, runtime });
    const patch = result?.sessionPatch ?? {};
    combinedPatch = mergeSessionPatch(combinedPatch, patch);
    workingSession = applySessionPatch(workingSession, patch);

    if (result?.done) {
      return { sessionPatch: combinedPatch, done: true, pause: false, forcedNextBlockIndex: null };
    }

    if (result?.nextBlockIndex === null) {
      return { sessionPatch: combinedPatch, done: false, pause: true, forcedNextBlockIndex: null };
    }

    if (Number.isInteger(result?.nextBlockIndex) && result.nextBlockIndex !== defaultNextIndex) {
      return {
        sessionPatch: combinedPatch,
        done: false,
        pause: false,
        forcedNextBlockIndex: result.nextBlockIndex,
      };
    }
  }

  return { sessionPatch: combinedPatch, done: false, pause: false, forcedNextBlockIndex: null };
}

export async function handleCondition({ block, session, flow, sock, jid }) {
  const cfg = block.config;

  console.log('[handleCondition] Evaluating condition:', {
    conditionType: cfg.conditionType,
    variable: cfg.variable,
    variableValue: session.variables[cfg.variable],
    operator: cfg.operator,
    compareValue: cfg.value,
    trueBlockId: cfg.trueBlockId,
    falseBlockId: cfg.falseBlockId,
  });

  const finalConditionMet = evaluateConditionConfig(cfg, session);

  if (finalConditionMet && cfg.trueMessage) {
    const text = interpolate(cfg.trueMessage, session.variables);
    await sendTextMessage(sock, jid, text);
  } else if (!finalConditionMet && cfg.falseMessage) {
    const text = interpolate(cfg.falseMessage, session.variables);
    await sendTextMessage(sock, jid, text);
  } else if (!finalConditionMet && cfg.fallbackMessage) {
    const text = interpolate(cfg.fallbackMessage, session.variables);
    await sendTextMessage(sock, jid, text);
  }

  const targetId = finalConditionMet ? cfg.trueBlockId : cfg.falseBlockId;

  console.log('[handleCondition] Result:', {
    finalConditionMet,
    targetId,
    willJump: Boolean(targetId),
  });

  if (targetId) {
    const idx = flow.indexMap.get(targetId);
    if (idx !== undefined) {
      console.log(`[handleCondition] Jumping to block index ${idx}`);
      return { nextBlockIndex: idx, sessionPatch: {}, done: false };
    }
  }

  console.log(`[handleCondition] No target defined, advancing sequentially to ${session.blockIndex + 1}`);
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

export async function handleIfCondition({ block, session, flow }) {
  const cfg = block.config;
  const finalConditionMet = evaluateConditionConfig(cfg, session);

  const stack = getIfStack(session);
  stack.push({ matched: finalConditionMet });

  const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };

  if (finalConditionMet) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
  }

  return { nextBlockIndex: findNextBranch(flow, session.blockIndex), sessionPatch: patch, done: false };
}

export async function handleElseIf({ block, session, flow }) {
  const stack = getIfStack(session);
  if (stack.length === 0) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const top = stack[stack.length - 1];

  if (top.matched) {
    return { nextBlockIndex: findEndIf(flow, session.blockIndex), sessionPatch: {}, done: false };
  }

  const cfg = block.config;
  const finalConditionMet = evaluateConditionConfig(cfg, session);

  if (finalConditionMet) {
    top.matched = true;
    const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
  }

  return { nextBlockIndex: findNextBranch(flow, session.blockIndex), sessionPatch: {}, done: false };
}

export async function handleElse({ session, flow }) {
  const stack = getIfStack(session);
  if (stack.length === 0) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const top = stack[stack.length - 1];

  if (top.matched) {
    return { nextBlockIndex: findEndIf(flow, session.blockIndex), sessionPatch: {}, done: false };
  }

  top.matched = true;
  const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
}

export async function handleEndIf({ session }) {
  const stack = getIfStack(session);
  if (stack.length > 0) {
    stack.pop();
  }
  const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
}

export async function handleKeycheck({ block, session, flow, sock, jid, runtime }) {
  const cfg = block?.config ?? {};
  const conditionals = Array.isArray(cfg.conditionals) ? cfg.conditionals : [];
  const matchedConditional = conditionals.find(conditional => evaluateKeycheckConditional(conditional, session));

  if (!matchedConditional) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const actionExecution = await executeThenActions({
    actions: matchedConditional.thenActions,
    session,
    sock,
    jid,
    flow,
    runtime,
  });

  if (actionExecution.done) {
    return { nextBlockIndex: null, sessionPatch: actionExecution.sessionPatch, done: true };
  }

  if (actionExecution.pause) {
    return { nextBlockIndex: null, sessionPatch: actionExecution.sessionPatch, done: false };
  }

  if (actionExecution.forcedNextBlockIndex !== null) {
    return {
      nextBlockIndex: actionExecution.forcedNextBlockIndex,
      sessionPatch: actionExecution.sessionPatch,
      done: false,
    };
  }

  const redirectIndex = resolveRedirectIndex(flow, matchedConditional.redirectBlockId);
  if (redirectIndex !== null) {
    return { nextBlockIndex: redirectIndex, sessionPatch: actionExecution.sessionPatch, done: false };
  }

  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: actionExecution.sessionPatch, done: false };
}
