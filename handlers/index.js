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
import { parseCommandInput } from '../engine/commandParser.js';
import { addConversationEvent } from '../db/index.js';
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

function stringifyError(error) {
  if (!error) return '';
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function logHandlerErrorEvent({ block, session, jid, flow, userMessage = '', error, stage = '' }) {
  const command = toText(session?.variables?.[INTERNAL_VAR.LAST_COMMAND] ?? '');
  const safeUserMessage = toText(userMessage);
  const safeError = stringifyError(error);

  addConversationEvent({
    occurredAt: Date.now(),
    eventType: 'flow-error',
    direction: 'system',
    jid: toText(jid) || 'unknown',
    flowPath: toText(flow?.flowPath),
    messageText: safeUserMessage || safeError || 'Flow error',
    metadata: {
      stage,
      command,
      blockId: toText(block?.id),
      blockType: toText(block?.type),
      blockName: toText(block?.name),
      userMessage: safeUserMessage,
      error: safeError,
    },
  });
}

function toText(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return String(value).toLowerCase() === 'true';
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return safeParseJSON(trimmed, value);
  }
  return value;
}

function getHumanHandoffState(session) {
  const raw = session?.variables?.[INTERNAL_VAR.HUMAN_HANDOFF];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;

  const parsed = parseMaybeJson(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }

  return {};
}

function escapePathSegment(segment) {
  return segment.replace(/\[(\d+)\]/g, '.$1');
}

function extractJsonPath(source, jsonPath) {
  const path = toText(jsonPath);
  if (!path) return source;

  const obj = typeof source === 'string' ? parseMaybeJson(source) : source;
  if (obj == null) return undefined;

  const tokens = path
    .split('.')
    .map(part => escapePathSegment(part))
    .join('.')
    .split('.')
    .map(token => token.trim())
    .filter(Boolean);

  let current = obj;
  for (const token of tokens) {
    if (current == null) return undefined;
    current = current[token];
  }
  return current;
}

function evaluateExpression(expression, scope, fallback = null) {
  const expr = toText(expression);
  if (!expr) return fallback;
  try {
    const names = Object.keys(scope);
    const values = Object.values(scope);
    const fn = new Function(...names, `"use strict"; return (${expr});`);
    return fn(...values);
  } catch {
    return fallback;
  }
}

function normalizeHttpHeaders(headers, variables) {
  if (!Array.isArray(headers)) return {};

  const output = {};
  for (const header of headers) {
    const key = toText(interpolate(header?.key, variables));
    if (!key) continue;
    const value = interpolate(header?.value, variables);
    output[key] = value;
  }
  return output;
}

function serializeRequestBody(body, bodyType, variables) {
  const interpolated = interpolate(String(body ?? ''), variables);
  const normalizedType = toText(bodyType).toLowerCase();

  if (!interpolated) return null;
  if (normalizedType === 'none') return null;
  if (normalizedType === 'text' || normalizedType === 'raw') return interpolated;

  if (normalizedType === 'json') {
    const parsed = safeParseJSON(interpolated, null);
    if (parsed !== null) return JSON.stringify(parsed);
    return JSON.stringify(interpolated);
  }

  if (normalizedType === 'form-urlencoded') {
    const parsed = safeParseJSON(interpolated, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return new URLSearchParams(parsed).toString();
    }
    return interpolated;
  }

  return interpolated;
}

function parseHttpResponseBody(responseText, contentType) {
  const normalizedType = String(contentType ?? '').toLowerCase();
  if (normalizedType.includes('application/json')) {
    return safeParseJSON(responseText, responseText);
  }

  return parseMaybeJson(responseText);
}

function normalizeMultipleChoiceOptions(cfg) {
  const rawOptions = Array.isArray(cfg.options) ? cfg.options : (Array.isArray(cfg.items) ? cfg.items : []);

  return rawOptions.map((option, index) => {
    const id = toText(option?.id || `option_${index + 1}`);
    const title = toText(option?.title || option?.label || option?.text || option?.value || id);
    const value = option?.value ?? title;
    const description = toText(option?.description);
    return { id, title, value, description };
  });
}

function getMultipleChoiceMode(cfg, optionsLength) {
  const selectionMode = toText(cfg.selectionMode || cfg.selectionType || cfg.responseType).toLowerCase();
  const allowMultiple =
    cfg.allowMultiple === true ||
    cfg.multiple === true ||
    selectionMode === 'multiple' ||
    toNumber(cfg.maxSelections, 0) > 1;

  const minSelections = Math.max(1, toNumber(cfg.minSelections, 1));
  const defaultMax = allowMultiple ? optionsLength : 1;
  const maxSelections = Math.max(1, toNumber(cfg.maxSelections, defaultMax));

  return { allowMultiple, minSelections, maxSelections };
}

function getIncomingMessageText(session, runtime) {
  if (runtime?.incoming?.text !== undefined) return String(runtime.incoming.text ?? '');
  return String(session.variables[INTERNAL_VAR.LAST_MESSAGE] ?? '');
}

function shouldSendCommandInvalidMessage(message, cfg, parseResult) {
  if (parseResult?.partial) return true;

  const normalizedMessage = toText(message);
  if (!normalizedMessage) return false;

  const normalizedCommand = toText(cfg.command).replace(/^\//, '').toLowerCase();
  if (normalizedCommand) {
    const extracted = normalizedMessage.replace(/^\//, '').toLowerCase();
    if (extracted.startsWith(normalizedCommand)) return true;
  }

  return false;
}

async function executeWithRetry(executor, maxRetries, retryDelay) {
  let attempts = 0;
  let lastError = null;

  while (attempts <= maxRetries) {
    try {
      return await executor();
    } catch (error) {
      lastError = error;
      if (attempts >= maxRetries) break;
      if (retryDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
    attempts++;
  }

  throw lastError;
}

function applyDataTransform(sourceValue, cfg, sessionVariables) {
  const transformType = toText(cfg.transformType || cfg.operation).toLowerCase();
  const inputValue = parseMaybeJson(sourceValue);

  switch (transformType) {
    case 'json_parse': {
      if (typeof sourceValue === 'string') return safeParseJSON(sourceValue, sourceValue);
      return inputValue;
    }
    case 'json_stringify':
      return JSON.stringify(inputValue);
    case 'extract_field':
      return extractJsonPath(inputValue, cfg.jsonPath);
    case 'array_map': {
      if (!Array.isArray(inputValue)) throw new Error('Fonte nao e um array para array_map.');
      const expression = toText(cfg.mapExpression) || 'item';
      return inputValue.map((item, index, array) => {
        const scope = { item, index, array, vars: sessionVariables };
        if (expression.includes('{{') && expression.includes('}}')) {
          return interpolate(expression, scope);
        }
        return evaluateExpression(expression, scope, item);
      });
    }
    case 'array_filter': {
      if (!Array.isArray(inputValue)) throw new Error('Fonte nao e um array para array_filter.');
      const expression = toText(cfg.filterCondition) || 'Boolean(item)';
      return inputValue.filter((item, index, array) =>
        Boolean(evaluateExpression(expression, { item, index, array, vars: sessionVariables }, false))
      );
    }
    case 'array_reduce': {
      if (!Array.isArray(inputValue)) throw new Error('Fonte nao e um array para array_reduce.');
      const expression = toText(cfg.mapExpression) || 'acc';
      const hasInitial = cfg.initialValue !== undefined && cfg.initialValue !== null && cfg.initialValue !== '';
      const initialValue = hasInitial ? parseMaybeJson(cfg.initialValue) : undefined;

      if (hasInitial) {
        return inputValue.reduce(
          (acc, item, index, array) =>
            evaluateExpression(
              expression,
              { acc, curr: item, prev: acc, item, index, array, vars: sessionVariables },
              acc
            ),
          initialValue
        );
      }

      if (inputValue.length === 0) return inputValue;
      return inputValue.slice(1).reduce(
        (acc, item, index) =>
          evaluateExpression(
            expression,
            { acc, curr: item, prev: acc, item, index: index + 1, array: inputValue, vars: sessionVariables },
            acc
          ),
        inputValue[0]
      );
    }
    case 'array_sort': {
      if (!Array.isArray(inputValue)) throw new Error('Fonte nao e um array para array_sort.');
      const sorted = [...inputValue];
      const expression = toText(cfg.mapExpression);
      if (!expression) {
        return sorted.sort((a, b) => String(a).localeCompare(String(b)));
      }
      return sorted.sort((a, b) => {
        const av = evaluateExpression(expression, { item: a, a, b, vars: sessionVariables }, a);
        const bv = evaluateExpression(expression, { item: b, a: b, b: a, vars: sessionVariables }, b);
        if (av === bv) return 0;
        return String(av).localeCompare(String(bv));
      });
    }
    case 'text_uppercase':
      return String(inputValue ?? '').toUpperCase();
    case 'text_lowercase':
      return String(inputValue ?? '').toLowerCase();
    case 'text_trim':
      return String(inputValue ?? '').trim();
    case 'text_split': {
      const delimiter = toText(cfg.delimiter || cfg.separator || cfg.jsonPath || ',');
      return String(inputValue ?? '').split(delimiter);
    }
    case 'custom_code':
    case 'custom':
    case 'custom_transform': {
      const customCode = toText(cfg.customCode);
      if (!customCode) return inputValue;
      const names = ['input', 'vars'];
      const values = [inputValue, sessionVariables];
      const body = customCode.includes('return') ? customCode : `return (${customCode});`;
      const fn = new Function(...names, `"use strict"; ${body}`);
      return fn(...values);
    }
    default:
      return inputValue;
  }
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
  const items = Array.isArray(cfg.items) ? cfg.items : [];

  await sendListMessage(sock, jid, {
    text,
    items: items.map(item => ({
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
        [INTERNAL_VAR.LIST_ITEMS]: JSON.stringify(items),
        [INTERNAL_VAR.NEXT_BLOCK_ON_LIST]: String(session.blockIndex + 1),
      },
    },
    done: false,
  };
}

async function handleCommandInput({ block, session, sock, jid, runtime }) {
  const cfg = block.config ?? {};
  const incomingMessage = getIncomingMessageText(session, runtime);
  const parseResult = parseCommandInput(incomingMessage, cfg);

  if (!parseResult.matched) {
    const invalidMessage = interpolate(toText(cfg.invalidMessage), session.variables);
    if (invalidMessage && shouldSendCommandInvalidMessage(incomingMessage, cfg, parseResult)) {
      await sendTextMessage(sock, jid, invalidMessage);
    }
    return {
      nextBlockIndex: null,
      sessionPatch: { waitingFor: null },
      done: false,
    };
  }

  const commandName = toText(cfg.command || cfg.pattern);
  return {
    nextBlockIndex: session.blockIndex + 1,
    sessionPatch: {
      variables: {
        ...session.variables,
        ...parseResult.variableValues,
        [INTERNAL_VAR.LAST_COMMAND]: commandName,
        [INTERNAL_VAR.LAST_COMMAND_ARGS]: parseResult.commandArgs,
      },
    },
    done: false,
  };
}

async function handleMultipleChoice({ block, session, sock, jid }) {
  const cfg = block.config ?? {};
  const options = normalizeMultipleChoiceOptions(cfg);
  if (options.length === 0) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const { allowMultiple, minSelections, maxSelections } = getMultipleChoiceMode(cfg, options.length);
  const promptText = interpolate(
    toText(cfg.text || cfg.question || cfg.prompt || 'Escolha uma opcao:'),
    session.variables
  );

  const renderedOptions = options
    .map((option, index) => {
      if (!option.description) return `${index + 1}. ${option.title}`;
      return `${index + 1}. ${option.title}\n   _${option.description}_`;
    })
    .join('\n');

  const hint = allowMultiple
    ? `Responda com ${minSelections === maxSelections ? `${minSelections}` : `${minSelections} a ${maxSelections}`} opcao(oes), separadas por virgula.`
    : 'Responda com o numero ou nome da opcao.';

  const messageText = [promptText, '', renderedOptions, '', hint].filter(Boolean).join('\n');
  await sendTextMessage(sock, jid, messageText);

  const captureVariable = toText(cfg.captureVariable || cfg.outputVariable || cfg.variableName || 'multiple_choice_selection');
  const invalidMessage = toText(cfg.invalidMessage || cfg.validationMessage || 'Opcao invalida. Tente novamente.');

  return {
    nextBlockIndex: null,
    sessionPatch: {
      waitingFor: WAIT_TYPE.MULTIPLE_CHOICE,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.MULTIPLE_CHOICE_OPTIONS]: JSON.stringify(options),
        [INTERNAL_VAR.MULTIPLE_CHOICE_ALLOW_MULTIPLE]: String(allowMultiple),
        [INTERNAL_VAR.MULTIPLE_CHOICE_MIN]: String(minSelections),
        [INTERNAL_VAR.MULTIPLE_CHOICE_MAX]: String(maxSelections),
        [INTERNAL_VAR.MULTIPLE_CHOICE_CAPTURE_VAR]: captureVariable,
        [INTERNAL_VAR.MULTIPLE_CHOICE_INVALID_MESSAGE]: invalidMessage,
        [INTERNAL_VAR.NEXT_BLOCK_ON_MULTIPLE_CHOICE]: String(session.blockIndex + 1),
      },
    },
    done: false,
  };
}

async function handleHttpRequest({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const method = toText(cfg.method || 'GET').toUpperCase();
  const url = interpolate(toText(cfg.url), session.variables);

  if (!url) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const timeout = Math.max(1000, toNumber(cfg.timeout, 30000));
  const retryEnabled = cfg.retryOnFailure === true;
  const maxRetries = retryEnabled ? Math.max(0, toNumber(cfg.maxRetries, 0)) : 0;
  const retryDelay = Math.max(0, toNumber(cfg.retryDelay, 1000));
  const onError = toText(cfg.onError || 'continue').toLowerCase();

  const headers = normalizeHttpHeaders(cfg.headers, session.variables);
  const serializedBody = serializeRequestBody(cfg.body, cfg.bodyType, session.variables);

  if (serializedBody && !headers['Content-Type']) {
    const bodyType = toText(cfg.bodyType).toLowerCase();
    if (bodyType === 'json') headers['Content-Type'] = 'application/json';
    if (bodyType === 'form-urlencoded') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const requestFn = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeout);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : serializedBody,
        signal: controller.signal,
      });

      const responseText = await response.text();
      const contentType = response.headers.get('content-type');
      const responseData = parseHttpResponseBody(responseText, contentType);

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.data = responseData;
        throw error;
      }

      return { response, responseData };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const { response, responseData } = await executeWithRetry(requestFn, maxRetries, retryDelay);

    const variables = { ...session.variables };
    if (cfg.saveResponse !== false) {
      const responseVariable = toText(cfg.responseVariable || 'http_response');
      variables[responseVariable] = responseData;
    }
    if (cfg.saveStatusCode) {
      const statusVar = toText(cfg.statusCodeVariable || 'http_status');
      variables[statusVar] = response.status;
    }

    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: { variables },
      done: false,
    };
  } catch (error) {
    const hasCustomErrorMessage = Object.prototype.hasOwnProperty.call(cfg, 'errorMessage');
    const errorTemplate = hasCustomErrorMessage ? cfg.errorMessage : 'Erro ao fazer requisicao HTTP.';
    const errorMessage = interpolate(toText(errorTemplate), session.variables);
    logHandlerErrorEvent({
      block,
      session,
      jid,
      flow,
      userMessage: errorMessage,
      error,
      stage: 'http-request',
    });

    if (errorMessage) {
      await sendTextMessage(sock, jid, errorMessage);
    }

    const variables = { ...session.variables };
    if (cfg.saveResponse !== false) {
      const responseVariable = toText(cfg.responseVariable || 'http_response');
      variables[responseVariable] = error?.data ?? null;
    }
    if (cfg.saveStatusCode) {
      const statusVar = toText(cfg.statusCodeVariable || 'http_status');
      variables[statusVar] = Number.isFinite(Number(error?.status)) ? Number(error.status) : 0;
    }

    if (onError === 'stop' || onError === 'end' || onError === 'halt') {
      return {
        nextBlockIndex: null,
        sessionPatch: { status: SESSION_STATUS.ENDED, variables },
        done: true,
      };
    }

    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: { variables },
      done: false,
    };
  }
}

async function handleDataProcessor({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const sourceVariable = toText(cfg.sourceVariable);
  const targetVariable = toText(cfg.outputVariable || sourceVariable || 'data_processor_output');
  const onError = toText(cfg.onError || 'continue').toLowerCase();

  const sourceValue = sourceVariable ? session.variables[sourceVariable] : undefined;

  try {
    const transformedValue = applyDataTransform(sourceValue, cfg, session.variables);
    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: {
        variables: {
          ...session.variables,
          [targetVariable]: transformedValue,
        },
      },
      done: false,
    };
  } catch (error) {
    const hasCustomErrorMessage = Object.prototype.hasOwnProperty.call(cfg, 'errorMessage');
    const errorTemplate = hasCustomErrorMessage ? cfg.errorMessage : 'Erro ao processar dados.';
    const errorMessage = interpolate(toText(errorTemplate), session.variables);
    logHandlerErrorEvent({
      block,
      session,
      jid,
      flow,
      userMessage: errorMessage,
      error,
      stage: 'data-processor',
    });

    if (errorMessage) {
      await sendTextMessage(sock, jid, errorMessage);
    }

    if (onError === 'stop' || onError === 'end' || onError === 'halt') {
      return {
        nextBlockIndex: null,
        sessionPatch: { status: SESSION_STATUS.ENDED },
        done: true,
      };
    }

    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: {},
      done: false,
    };
  }
}

async function handleSendReaction({ block, session, sock, jid, runtime }) {
  const cfg = block.config ?? {};
  const emoji = interpolate(toText(cfg.emoji || cfg.reaction || cfg.text), session.variables);
  if (!emoji) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const targetKey = runtime?.incoming?.messageKey || session.variables[INTERNAL_VAR.LAST_INCOMING_MESSAGE_KEY];
  if (!targetKey || !targetKey.id) {
    console.warn('[send-reaction] Nenhuma message key disponivel para enviar reacao.');
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  await sock.sendMessage(jid, {
    react: {
      text: emoji,
      key: targetKey,
    },
  });

  const removeDelay = Math.max(
    0,
    toNumber(cfg.removeAfterDelay ?? cfg.removeDelay ?? cfg.removeAfterMs ?? cfg.delayMs, 0)
  );
  const shouldRemove = cfg.removeAfter === true || cfg.removeReaction === true || removeDelay > 0;

  if (shouldRemove && removeDelay > 0) {
    setTimeout(() => {
      sock.sendMessage(jid, {
        react: {
          text: '',
          key: targetKey,
        },
      }).catch(() => {});
    }, removeDelay);
  }

  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
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

async function handleRedirectToHuman({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const nowTs = Date.now();
  const previous = getHumanHandoffState(session);
  const alreadyActive = previous.active === true;

  const queue = toText(interpolate(String(cfg.queue ?? previous.queue ?? 'default'), session.variables)) || 'default';
  const reason = toText(interpolate(String(cfg.reason ?? previous.reason ?? ''), session.variables));
  const targetOnClaim = toText(cfg.onClaimBlockId);
  const targetOnFinish = toText(cfg.onFinishBlockId);
  const targetOnTimeout = toText(cfg.onTimeoutBlockId);
  const timeoutMinutes = Math.max(0, toNumber(cfg.timeoutMinutes, 0));

  const messageTemplate = toText(cfg.message);
  const shouldSendMessage = Boolean(messageTemplate) && !(alreadyActive && previous.messageSent === true);
  if (shouldSendMessage) {
    const text = interpolate(messageTemplate, session.variables);
    if (text) {
      await sendTextMessage(sock, jid, text);
    }
  }

  const handoff = {
    active: true,
    requestedAt: Number(previous.requestedAt) > 0 ? Number(previous.requestedAt) : nowTs,
    updatedAt: nowTs,
    queue,
    reason,
    messageSent: previous.messageSent === true || shouldSendMessage,
    captureUntilClaimed: cfg.captureUntilClaimed !== false,
    onClaimBlockId: targetOnClaim || undefined,
    onFinishBlockId: targetOnFinish || undefined,
    onTimeoutBlockId: targetOnTimeout || undefined,
    timeoutMinutes,
  };

  if (!alreadyActive) {
    addConversationEvent({
      occurredAt: nowTs,
      eventType: 'human-handoff-requested',
      direction: 'system',
      jid,
      flowPath: flow?.flowPath ?? '',
      messageText: reason || 'Sessao transferida para atendimento humano',
      metadata: {
        blockId: toText(block?.id),
        blockType: toText(block?.type),
        queue,
        reason,
        timeoutMinutes,
        onClaimBlockId: targetOnClaim || null,
        onFinishBlockId: targetOnFinish || null,
        onTimeoutBlockId: targetOnTimeout || null,
      },
    });
  }

  return {
    nextBlockIndex: null,
    sessionPatch: {
      waitingFor: WAIT_TYPE.HUMAN,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.HUMAN_HANDOFF]: handoff,
      },
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
  [BLOCK_TYPE.REDIRECT_TO_HUMAN]: handleRedirectToHuman,
  [BLOCK_TYPE.COMMAND_INPUT]: handleCommandInput,
  [BLOCK_TYPE.MULTIPLE_CHOICE]: handleMultipleChoice,
  [BLOCK_TYPE.HTTP_REQUEST]: handleHttpRequest,
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
