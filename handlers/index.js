/**
 * handlers/index.js
 *
 * Cada manipulador recebe:
 *   { block, session, sock, jid, flow }
 *
 * Retorna um HandlerResult:
 *   {
 *     nextBlockIndex: number | null,  // null = manter atual (aguardando usuário)
 *     sessionPatch: object,           // atualização parcial da sessão
 *     done: boolean,                  // true = fim da conversa
 *   }
 */

import { sendTextMessage, sendListMessage } from '../engine/sender.js';
import { interpolate, safeParseJSON } from '../engine/utils.js';
import {
  BLOCK_TYPE,
  SESSION_STATUS,
  WAIT_TYPE,
  CONDITION_TYPE,
  LOGICAL_OPERATOR,
  INTERNAL_VAR,
} from '../config/constants.js';

// ─── Auxiliar ─────────────────────────────────────────────────────────────────

function evaluateConditionConfig(cfg, session) {
  let primaryConditionMet = evaluateSingleCondition(cfg, session);
  let finalConditionMet = primaryConditionMet;

  if (cfg.hasMultipleConditions && Array.isArray(cfg.additionalConditions) && cfg.additionalConditions.length > 0) {
    const additionalResults = cfg.additionalConditions.map(cond => evaluateSingleCondition(cond, session));
    if (cfg.logicalOperator === LOGICAL_OPERATOR.OR) {
      finalConditionMet = primaryConditionMet || additionalResults.some(r => r);
    } else {
      finalConditionMet = primaryConditionMet && additionalResults.every(r => r);
    }
  }
  return finalConditionMet;
}

/**
 * Busca o próximo branch no mapa pré-calculado (O(1)).
 * Fallback para busca linear apenas se o mapa não contiver o índice.
 */
function findNextBranch(flow, currentIndex) {
  if (flow.branchMap && flow.branchMap.has(currentIndex)) {
    return flow.branchMap.get(currentIndex);
  }
  // Fallback linear (não deve ocorrer com fluxo bem-formado)
  let depth = 0;
  for (let i = currentIndex + 1; i < flow.blocks.length; i++) {
    const type = flow.blocks[i].type;
    if (type === BLOCK_TYPE.IF_CONDITION) {
      depth++;
    } else if (type === BLOCK_TYPE.END_IF) {
      if (depth === 0) return i;
      depth--;
    } else if (type === BLOCK_TYPE.ELSE_IF || type === BLOCK_TYPE.ELSE) {
      if (depth === 0) return i;
    }
  }
  return currentIndex + 1;
}

/**
 * Busca o end-if no mapa pré-calculado (O(1)).
 * Fallback para busca linear apenas se o mapa não contiver o índice.
 */
function findEndIf(flow, currentIndex) {
  if (flow.endIfMap && flow.endIfMap.has(currentIndex)) {
    return flow.endIfMap.get(currentIndex);
  }
  // Fallback linear
  let depth = 0;
  for (let i = currentIndex + 1; i < flow.blocks.length; i++) {
    const type = flow.blocks[i].type;
    if (type === BLOCK_TYPE.IF_CONDITION) {
      depth++;
    } else if (type === BLOCK_TYPE.END_IF) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return currentIndex + 1;
}

function getIfStack(session) {
  return safeParseJSON(session.variables[INTERNAL_VAR.IF_STACK], []);
}


// ─── Manipuladores ────────────────────────────────────────────────────────────────

async function handleInitialMessage({ block, session, sock, jid }) {
  const text = interpolate(block.config.text, session.variables);
  await sendTextMessage(sock, jid, text);
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

async function handleSendText({ block, session, sock, jid }) {
  const text = interpolate(block.config.text, session.variables);
  await sendTextMessage(sock, jid, text);

  if (block.config.waitForResponse || block.config.captureResponse) {
    // Pausar — armazenar palavras-chave para que o manipulador de mensagens possa verificá-las
    return {
      nextBlockIndex: null, // não avançar ainda
      sessionPatch: {
        waitingFor: WAIT_TYPE.KEYWORD,
        variables: {
          ...session.variables,
          [INTERNAL_VAR.KEYWORDS]: JSON.stringify(block.config.keywords ?? []),
          [INTERNAL_VAR.CAPTURE_VARIABLE]: block.config.captureVariable || '',
          [INTERNAL_VAR.NEXT_BLOCK_ON_KEYWORD]: String(session.blockIndex + 1),
        },
      },
      done: false,
    };
  }

  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

async function handleSendList({ block, session, sock, jid }) {
  const cfg = block.config;
  const text = interpolate(cfg.text, session.variables);

  await sendListMessage(sock, jid, {
    text,
    items: cfg.items.map(item => ({
      id: item.id,
      title: interpolate(item.title, session.variables),
      description: interpolate(item.description, session.variables),
    })),
  });

  // Pausar e aguardar seleção da lista
  return {
    nextBlockIndex: null,
    sessionPatch: {
      waitingFor: WAIT_TYPE.LIST,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.LIST_ITEMS]: JSON.stringify(cfg.items),
        [INTERNAL_VAR.NEXT_BLOCK_ON_LIST]: String(session.blockIndex + 1),
      },
    },
    done: false,
  };
}

async function handleCondition({ block, session, flow, sock, jid }) {
  const cfg = block.config;

  console.log(`🔍 [handleCondition] Evaluating condition:`, {
    conditionType: cfg.conditionType,
    variable: cfg.variable,
    variableValue: session.variables[cfg.variable],
    operator: cfg.operator,
    compareValue: cfg.value,
    trueBlockId: cfg.trueBlockId,
    falseBlockId: cfg.falseBlockId,
  });

  // Avaliar condição usando auxiliar genérico
  let finalConditionMet = evaluateConditionConfig(cfg, session);

  // Enviar mensagem apropriada se configurado
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

  // Determinar próximo bloco
  const targetId = finalConditionMet ? cfg.trueBlockId : cfg.falseBlockId;

  console.log(`🔍 [handleCondition] Result:`, {
    finalConditionMet,
    targetId,
    willJump: !!targetId,
  });

  if (targetId) {
    const idx = flow.indexMap.get(targetId);
    if (idx !== undefined) {
      console.log(`🔍 [handleCondition] Jumping to block index ${idx}`);
      return { nextBlockIndex: idx, sessionPatch: {}, done: false };
    }
  }

  // Nenhum alvo definido — avançar sequencialmente
  console.log(`🔍 [handleCondition] No target defined, advancing sequentially to ${session.blockIndex + 1}`);
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

/**
 * Avalia uma única condição baseada em seu tipo e operador
 */
function evaluateSingleCondition(conditionConfig, session) {
  const type = conditionConfig.conditionType || CONDITION_TYPE.VARIABLE;

  if (type === CONDITION_TYPE.VARIABLE) {
    const varRaw = String(session.variables[conditionConfig.variable] ?? '').trim();
    const compRaw = String(conditionConfig.value ?? '').trim();
    const compMaxRaw = String(conditionConfig.valueMax ?? '').trim();

    const varValue = varRaw.toLowerCase();
    const compareValue = compRaw.toLowerCase();
    const compareValueMax = compMaxRaw.toLowerCase();

    switch (conditionConfig.operator) {
      case '==': return varValue === compareValue;
      case '!=': return varValue !== compareValue;
      case '>': return Number(varValue) > Number(compareValue);
      case '<': return Number(varValue) < Number(compareValue);
      case '>=': return Number(varValue) >= Number(compareValue);
      case '<=': return Number(varValue) <= Number(compareValue);
      case 'contains': return varValue.includes(compareValue);
      case 'between':
        return Number(varValue) >= Number(compareValue) && Number(varValue) <= Number(compareValueMax);
      case 'not_contains': return !varValue.includes(compareValue);
      case 'starts_with': return varValue.startsWith(compareValue);
      case 'ends_with': return varValue.endsWith(compareValue);
      case 'is_empty': return varRaw === '';
      case 'is_not_empty': return varRaw !== '';
      default: return false;
    }
  } else if (type === CONDITION_TYPE.KEYWORD) {
    const lastMsg = String(session.variables[INTERNAL_VAR.LAST_MESSAGE] ?? '').toLowerCase().trim();

    // Suportar tanto palavra-chave única quanto array de palavras-chave
    const keywordsToCheck = conditionConfig.keywords && conditionConfig.keywords.length > 0
      ? conditionConfig.keywords
      : [conditionConfig.keyword];

    return keywordsToCheck.some(kw => {
      if (!kw) return false;
      const keywords = String(kw)
        .split(',')
        .map(k => k.trim().toLowerCase());
      return keywords.some(k => lastMsg === k || lastMsg.includes(k));
    });
  }

  return false;
}

// ─── Novos Blocos de Condicionamento ─────────────────────────────────────────────────

async function handleIfCondition({ block, session, flow }) {
  const cfg = block.config;
  let finalConditionMet = evaluateConditionConfig(cfg, session);

  const stack = getIfStack(session);
  stack.push({ matched: finalConditionMet });

  const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };

  if (finalConditionMet) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
  } else {
    return { nextBlockIndex: findNextBranch(flow, session.blockIndex), sessionPatch: patch, done: false };
  }
}

async function handleElseIf({ block, session, flow }) {
  const stack = getIfStack(session);
  if (stack.length === 0) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const top = stack[stack.length - 1];

  if (top.matched) {
    return { nextBlockIndex: findEndIf(flow, session.blockIndex), sessionPatch: {}, done: false };
  }

  const cfg = block.config;
  let finalConditionMet = evaluateConditionConfig(cfg, session);

  if (finalConditionMet) {
    top.matched = true;
    const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
  } else {
    return { nextBlockIndex: findNextBranch(flow, session.blockIndex), sessionPatch: {}, done: false };
  }
}

async function handleElse({ block, session, flow }) {
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

async function handleEndIf({ block, session }) {
  const stack = getIfStack(session);
  if (stack.length > 0) {
    stack.pop();
  }
  const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
}

async function handleSetVariable({ block, session }) {
  const { variableName, variableValue } = block.config;
  const interpolatedValue = interpolate(String(variableValue ?? ''), session.variables);

  return {
    nextBlockIndex: session.blockIndex + 1,
    sessionPatch: {
      variables: { ...session.variables, [variableName]: interpolatedValue },
    },
    done: false,
  };
}

async function handleRedirect({ block, session, flow }) {
  const targetId = block.config.targetBlockId;
  if (!targetId) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const idx = flow.indexMap.get(targetId);
  if (idx === undefined) {
    console.warn(`[Redirect] Bloco alvo "${targetId}" não encontrado. Avançando sequencialmente.`);
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const patch = {};
  if (idx <= session.blockIndex) {
    patch.variables = { ...session.variables, [INTERNAL_VAR.IF_STACK]: '[]' };
  }

  return { nextBlockIndex: idx, sessionPatch: patch, done: false };
}

async function handleDelay({ block, session }) {
  const ms = block.config.duration ?? 1000;
  await new Promise(resolve => setTimeout(resolve, ms));
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

async function handleEndConversation({ block, session, sock, jid, flow }) {
  const shouldSendClosingMessage = flow?.runtimeConfig?.endBehavior?.sendClosingMessage !== false;
  if (shouldSendClosingMessage && block.config.message) {
    const text = interpolate(block.config.message, session.variables);
    await sendTextMessage(sock, jid, text);
  }
  return { nextBlockIndex: null, sessionPatch: { status: SESSION_STATUS.ENDED }, done: true };
}

async function handleRestartFlow({ session }) {
  return {
    nextBlockIndex: 0,
    sessionPatch: {
      variables: {},
      waitingFor: null,
      status: SESSION_STATUS.ACTIVE,
    },
    done: false,
  };
}

// ─── Registro ────────────────────────────────────────────────────────────────

export const HANDLERS = {
  [BLOCK_TYPE.INITIAL_MESSAGE]: handleInitialMessage,
  [BLOCK_TYPE.SEND_TEXT]: handleSendText,
  [BLOCK_TYPE.SEND_LIST]: handleSendList,
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
