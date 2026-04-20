import { interpolate, safeParseJSON } from '../engine/utils.js';
import { emitConversationEvent } from '../engine/conversationEvents.js';
import {
  BLOCK_TYPE,
  CONDITION_TYPE,
  INTERNAL_VAR,
  LOGICAL_OPERATOR,
} from '../config/constants.js';

export function evaluateConditionConfig(cfg, session) {
  const primaryConditionMet = evaluateSingleCondition(cfg, session);
  let finalConditionMet = primaryConditionMet;

  if (cfg.hasMultipleConditions && Array.isArray(cfg.additionalConditions) && cfg.additionalConditions.length > 0) {
    const additionalResults = cfg.additionalConditions.map(cond => evaluateSingleCondition(cond, session));
    if (cfg.logicalOperator === LOGICAL_OPERATOR.OR) {
      finalConditionMet = primaryConditionMet || additionalResults.some(result => result);
    } else {
      finalConditionMet = primaryConditionMet && additionalResults.every(result => result);
    }
  }

  return finalConditionMet;
}

export function findNextBranch(flow, currentIndex) {
  if (flow.branchMap && flow.branchMap.has(currentIndex)) {
    return flow.branchMap.get(currentIndex);
  }

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

export function findEndIf(flow, currentIndex) {
  if (flow.endIfMap && flow.endIfMap.has(currentIndex)) {
    return flow.endIfMap.get(currentIndex);
  }

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

export function getIfStack(session) {
  return safeParseJSON(session.variables[INTERNAL_VAR.IF_STACK], []);
}

export function stringifyError(error) {
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

export function logHandlerErrorEvent({ block, session, jid, flow, userMessage = '', error, stage = '' }) {
  const command = toText(session?.variables?.[INTERNAL_VAR.LAST_COMMAND] ?? '');
  const safeUserMessage = toText(userMessage);
  const safeError = stringifyError(error);

  emitConversationEvent({
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

export function toText(value) {
  return String(value ?? '').trim();
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return String(value).toLowerCase() === 'true';
}

export function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return safeParseJSON(trimmed, value);
  }
  return value;
}

export function getHumanHandoffState(session) {
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

function normalizeLookupToken(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, '');
}

function resolveObjectFieldByToken(obj, token) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, token)) {
    return obj[token];
  }

  const normalizedToken = normalizeLookupToken(token);
  if (!normalizedToken) return undefined;

  for (const key of Object.keys(obj)) {
    if (normalizeLookupToken(key) === normalizedToken) {
      return obj[key];
    }
  }

  return undefined;
}

export function extractJsonPath(source, jsonPath) {
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
    if (Array.isArray(current)) {
      current = current[token];
      continue;
    }

    const resolved = resolveObjectFieldByToken(current, token);
    current = resolved;
  }
  return current;
}

export function evaluateExpression(expression, scope, fallback = null) {
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

export function normalizeHttpHeaders(headers, variables) {
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

export function serializeRequestBody(body, bodyType, variables) {
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

export function parseHttpResponseBody(responseText, contentType) {
  const normalizedType = String(contentType ?? '').toLowerCase();
  if (normalizedType.includes('application/json')) {
    return safeParseJSON(responseText, responseText);
  }

  return parseMaybeJson(responseText);
}

export function normalizeMultipleChoiceOptions(cfg) {
  const rawOptions = Array.isArray(cfg.options) ? cfg.options : (Array.isArray(cfg.items) ? cfg.items : []);

  return rawOptions.map((option, index) => {
    const id = toText(option?.id || `option_${index + 1}`);
    const title = toText(option?.title || option?.label || option?.text || option?.value || id);
    const value = option?.value ?? title;
    const description = toText(option?.description);
    return { id, title, value, description };
  });
}

export function getMultipleChoiceMode(cfg, optionsLength) {
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

export function getIncomingMessageText(session, runtime) {
  if (runtime?.incoming?.text !== undefined) return String(runtime.incoming.text ?? '');
  return String(session.variables[INTERNAL_VAR.LAST_MESSAGE] ?? '');
}

export function shouldSendCommandInvalidMessage(message, cfg, parseResult) {
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

export async function executeWithRetry(executor, maxRetries, retryDelay) {
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

export function applyDataTransform(sourceValue, cfg, sessionVariables) {
  const transformType = toText(cfg.transformType || cfg.operation).toLowerCase();
  const inputValue = parseMaybeJson(sourceValue);

  switch (transformType) {
    case 'json_parse': {
      if (typeof sourceValue === 'string') return safeParseJSON(sourceValue, sourceValue);
      return inputValue;
    }
    case 'json_stringify':
      return JSON.stringify(inputValue);
    case 'extract_field': {
      const resolvedPath = interpolate(toText(cfg.jsonPath), sessionVariables);
      return extractJsonPath(inputValue, resolvedPath);
    }
    case 'array_map': {
      if (!Array.isArray(inputValue)) throw new Error('Fonte nao e um array para array_map.');
      const expression = toText(cfg.mapExpression);
      const jsonPathTemplate = toText(cfg.jsonPath);

      if (!expression && jsonPathTemplate) {
        return inputValue.map((item, index, array) => {
          const scope = { item, index, array, vars: sessionVariables, ...sessionVariables };
          const resolvedPath = interpolate(jsonPathTemplate, scope);
          return extractJsonPath(item, resolvedPath);
        });
      }

      const expressionToUse = expression || 'item';
      return inputValue.map((item, index, array) => {
        const scope = { item, index, array, vars: sessionVariables };
        if (expressionToUse.includes('{{') && expressionToUse.includes('}}')) {
          return interpolate(expressionToUse, scope);
        }
        return evaluateExpression(expressionToUse, scope, item);
      });
    }
    case 'array_join': {
      if (!Array.isArray(inputValue)) throw new Error('Fonte nao e um array para array_join.');
      const expression = toText(cfg.mapExpression);
      const jsonPathTemplate = toText(cfg.jsonPath);
      const separator = cfg.joinSeparator ?? cfg.separator ?? '\n';
      const includeNumbers = cfg.includeNumbers === true || toBool(cfg.includeNumbers);

      let items;
      if (!expression && jsonPathTemplate) {
        items = inputValue.map((item, index, array) => {
          const scope = { item, index, array, vars: sessionVariables, ...sessionVariables };
          const resolvedPath = interpolate(jsonPathTemplate, scope);
          return extractJsonPath(item, resolvedPath);
        });
      } else if (expression) {
        items = inputValue.map((item, index, array) => {
          const scope = { item, index, array, vars: sessionVariables };
          if (expression.includes('{{') && expression.includes('}}')) {
            return interpolate(expression, scope);
          }
          return evaluateExpression(expression, scope, item);
        });
      } else {
        items = inputValue;
      }

      const renderedItems = items.map(item => {
        if (item == null) return '';
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          return String(item);
        }
        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      });

      if (includeNumbers) {
        return renderedItems.map((item, index) => `${index + 1}. ${item}`).join(separator);
      }
      return renderedItems.join(separator);
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

export function evaluateSingleCondition(conditionConfig, session) {
  const type = conditionConfig.conditionType || CONDITION_TYPE.VARIABLE;

  if (type === CONDITION_TYPE.VARIABLE) {
    const varOriginal = session.variables[conditionConfig.variable];
    const varRaw = String(varOriginal ?? '').trim();
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
      case 'is_null': return varOriginal == null || varValue === 'null';
      case 'is_not_null': return !(varOriginal == null || varValue === 'null');
      case 'is_number': return varRaw !== '' && Number.isFinite(Number(varRaw));
      case 'is_integer': return /^-?\d+$/.test(varRaw);
      default: return false;
    }
  } else if (type === CONDITION_TYPE.KEYWORD) {
    const lastMsg = String(session.variables[INTERNAL_VAR.LAST_MESSAGE] ?? '').toLowerCase().trim();
    const keywordsToCheck = conditionConfig.keywords && conditionConfig.keywords.length > 0
      ? conditionConfig.keywords
      : [conditionConfig.keyword];

    return keywordsToCheck.some(keyword => {
      if (!keyword) return false;
      const keywords = String(keyword)
        .split(',')
        .map(item => item.trim().toLowerCase());
      return keywords.some(item => lastMsg === item || lastMsg.includes(item));
    });
  }

  return false;
}
