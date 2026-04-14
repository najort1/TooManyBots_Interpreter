import crypto from 'node:crypto';
import { sendTextMessage } from '../engine/sender.js';
import { interpolate, safeParseJSON } from '../engine/utils.js';
import { SESSION_STATUS } from '../config/constants.js';
import {
  applyDataTransform,
  evaluateExpression,
  executeWithRetry,
  logHandlerErrorEvent,
  normalizeHttpHeaders,
  parseHttpResponseBody,
  parseMaybeJson,
  serializeRequestBody,
  toBool,
  toNumber,
  toText,
} from './shared.js';

const DEFAULT_STRING_OPERATION = 'Constant';
const DEFAULT_LIST_ACTION = 'Create';

const HTML_ENTITY_ENCODE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_ENTITY_DECODE_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function shouldStopOnError(value) {
  const normalized = toText(value).toLowerCase();
  return normalized === 'stop' || normalized === 'end' || normalized === 'halt';
}

function normalizeHashAlgorithm(value) {
  const normalized = toText(value).toLowerCase();
  const map = {
    md4: 'md4',
    md5: 'md5',
    sha1: 'sha1',
    sha256: 'sha256',
    sha384: 'sha384',
    sha512: 'sha512',
  };
  return map[normalized] || normalized;
}

function ensureHashAlgorithmSupported(algorithm) {
  const supported = new Set(crypto.getHashes().map(item => String(item).toLowerCase()));
  if (!supported.has(algorithm.toLowerCase())) {
    throw new Error(`Algoritmo de hash nao suportado: ${algorithm}`);
  }
}

function interpolateValue(value, variables) {
  return interpolate(String(value ?? ''), variables);
}

function normalizeStringInput(cfg, variables) {
  const sourceVariable = toText(cfg.sourceVariable);
  if (sourceVariable && Object.prototype.hasOwnProperty.call(variables, sourceVariable)) {
    return variables[sourceVariable];
  }
  return interpolateValue(cfg.inputValue, variables);
}

function toDatePart(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function parseDateWithFormat(input, format) {
  const text = String(input ?? '').trim();
  const dateFormat = String(format ?? '').trim();
  if (!text) throw new Error('Data de entrada vazia.');

  if (!dateFormat) {
    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) throw new Error(`Data invalida: ${text}`);
    return new Date(parsed);
  }

  const tokenPatterns = [
    ['YYYY', '(?<YYYY>\\d{4})'],
    ['MM', '(?<MM>\\d{1,2})'],
    ['DD', '(?<DD>\\d{1,2})'],
    ['HH', '(?<HH>\\d{1,2})'],
    ['mm', '(?<mm>\\d{1,2})'],
    ['ss', '(?<ss>\\d{1,2})'],
  ];

  let pattern = dateFormat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [token, expression] of tokenPatterns) {
    pattern = pattern.replace(token, expression);
  }

  const match = new RegExp(`^${pattern}$`).exec(text);
  if (!match?.groups) {
    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) throw new Error(`Data invalida para formato ${dateFormat}: ${text}`);
    return new Date(parsed);
  }

  const year = toDatePart(match.groups.YYYY, 1970);
  const month = Math.max(1, Math.min(12, toDatePart(match.groups.MM, 1)));
  const day = Math.max(1, Math.min(31, toDatePart(match.groups.DD, 1)));
  const hour = Math.max(0, Math.min(23, toDatePart(match.groups.HH, 0)));
  const minute = Math.max(0, Math.min(59, toDatePart(match.groups.mm, 0)));
  const second = Math.max(0, Math.min(59, toDatePart(match.groups.ss, 0)));

  return new Date(year, month - 1, day, hour, minute, second);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateWithFormat(date, format) {
  const dateFormat = String(format ?? '').trim();
  if (!dateFormat) return date.toISOString();

  return dateFormat
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad2(date.getMonth() + 1))
    .replace(/DD/g, pad2(date.getDate()))
    .replace(/HH/g, pad2(date.getHours()))
    .replace(/mm/g, pad2(date.getMinutes()))
    .replace(/ss/g, pad2(date.getSeconds()));
}

function unixUnitToMs(value, unit) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Unix time invalido: ${value}`);
  return String(unit).toLowerCase() === 'milliseconds' ? parsed : parsed * 1000;
}

function msToUnixUnit(ms, unit) {
  if (String(unit).toLowerCase() === 'milliseconds') return Math.round(ms);
  return Math.floor(ms / 1000);
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function htmlEntityEncode(input) {
  return String(input ?? '').replace(/[&<>"']/g, char => HTML_ENTITY_ENCODE_MAP[char] || char);
}

function htmlEntityDecode(input) {
  const text = String(input ?? '');
  const decodedNamed = text.replace(/&(amp|lt|gt|quot|#39);/g, match => HTML_ENTITY_DECODE_MAP[match] || match);
  return decodedNamed
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function decodeEscapedString(input) {
  return String(input ?? '')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\f/g, '\f')
    .replace(/\\v/g, '\v')
    .replace(/\\\\/g, '\\');
}

function randomFromCharset(charset) {
  if (!charset || charset.length === 0) return '';
  const index = Math.floor(Math.random() * charset.length);
  return charset[index];
}

function generateRandomString(mask) {
  const normalizedMask = String(mask ?? '').trim();
  const maskToUse = normalizedMask || '?a?a?a?a?a?a?a?a';
  const charsets = {
    a: 'abcdefghijklmnopqrstuvwxyz',
    A: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    0: '0123456789',
    x: '0123456789abcdef',
    X: '0123456789ABCDEF',
    s: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    '*': 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-={}[]:;,.?',
  };

  let result = '';
  for (let i = 0; i < maskToUse.length; i++) {
    const char = maskToUse[i];
    if (char === '?' && i + 1 < maskToUse.length) {
      const token = maskToUse[i + 1];
      if (charsets[token]) {
        result += randomFromCharset(charsets[token]);
        i++;
        continue;
      }
    }
    result += char;
  }
  return result;
}

function countOccurrences(haystack, needle, caseSensitive) {
  const searchFor = String(needle ?? '');
  if (!searchFor) return 0;
  const source = String(haystack ?? '');
  const normalizedSource = caseSensitive ? source : source.toLowerCase();
  const normalizedNeedle = caseSensitive ? searchFor : searchFor.toLowerCase();

  let count = 0;
  let index = 0;
  while (index <= normalizedSource.length) {
    const foundAt = normalizedSource.indexOf(normalizedNeedle, index);
    if (foundAt === -1) break;
    count++;
    index = foundAt + normalizedNeedle.length;
  }
  return count;
}

function normalizeListInput(rawValue, separator = ',') {
  if (Array.isArray(rawValue)) return [...rawValue];

  const parsed = parseMaybeJson(rawValue);
  if (Array.isArray(parsed)) return [...parsed];
  if (parsed && typeof parsed === 'object') return Object.values(parsed);

  const text = String(rawValue ?? '').trim();
  if (!text) return [];

  const delimiter = String(separator ?? ',');
  if (!delimiter) return [text];
  return text.split(delimiter).map(item => item.trim()).filter(item => item !== '');
}

function resolveListFromVariable(variableName, variables, separator = ',') {
  const name = toText(variableName);
  if (!name) return [];
  const value = variables[name];
  return normalizeListInput(value, separator);
}

function normalizeRemoveConditionOperator(operator) {
  const normalized = toText(operator).toLowerCase().replace(/[\s_-]+/g, '');
  const map = {
    equalto: 'equalto',
    notequalto: 'notequalto',
    contains: 'contains',
    startswith: 'startswith',
    endswith: 'endswith',
    regexmatch: 'regexmatch',
  };
  return map[normalized] || normalized;
}

function shouldRemoveByCondition(itemValue, cfg, variables) {
  const condition = normalizeRemoveConditionOperator(cfg.removeCondition);
  const removeCaseSensitive = cfg.removeCaseSensitive === true || toBool(cfg.removeCaseSensitive);
  const valueToCompare = interpolateValue(cfg.removeConditionValue, variables);

  const itemTextRaw = String(itemValue ?? '');
  const itemText = removeCaseSensitive ? itemTextRaw : itemTextRaw.toLowerCase();
  const compareTextRaw = String(valueToCompare ?? '');
  const compareText = removeCaseSensitive ? compareTextRaw : compareTextRaw.toLowerCase();

  switch (condition) {
    case 'equalto':
      return itemText === compareText;
    case 'notequalto':
      return itemText !== compareText;
    case 'contains':
      return itemText.includes(compareText);
    case 'startswith':
      return itemText.startsWith(compareText);
    case 'endswith':
      return itemText.endsWith(compareText);
    case 'regexmatch': {
      const flags = toText(cfg.removeConditionRegexFlags || (removeCaseSensitive ? '' : 'i'));
      const regex = new RegExp(compareTextRaw, flags);
      return regex.test(itemTextRaw);
    }
    default:
      return false;
  }
}

function normalizeStringOperation(value) {
  return toText(value || DEFAULT_STRING_OPERATION);
}

function normalizeListAction(value) {
  return toText(value || DEFAULT_LIST_ACTION);
}

function toUniqueKey(value) {
  if (value == null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

async function executeStringOperation(cfg, variables) {
  const operation = normalizeStringOperation(cfg.operation).toLowerCase();
  const inputRaw = normalizeStringInput(cfg, variables);
  const inputText = String(inputRaw ?? '');

  switch (operation) {
    case 'constant':
      return inputRaw;
    case 'base64encode':
      return Buffer.from(inputText, 'utf-8').toString('base64');
    case 'base64decode':
      return Buffer.from(inputText, 'base64').toString('utf-8');
    case 'hash': {
      const algorithm = normalizeHashAlgorithm(cfg.hashAlgorithm || 'sha256');
      ensureHashAlgorithmSupported(algorithm);
      return crypto.createHash(algorithm).update(inputText).digest('hex');
    }
    case 'hmac': {
      const algorithm = normalizeHashAlgorithm(cfg.hashAlgorithm || 'sha256');
      ensureHashAlgorithmSupported(algorithm);
      const hmacKey = interpolateValue(cfg.hmacKey, variables);
      return crypto.createHmac(algorithm, hmacKey).update(inputText).digest('hex');
    }
    case 'translate': {
      const dictionaryRaw = interpolateValue(cfg.translationDictionary, variables);
      const dictionary = safeParseJSON(dictionaryRaw, {});
      if (!dictionary || typeof dictionary !== 'object' || Array.isArray(dictionary)) {
        throw new Error('translationDictionary deve ser um objeto JSON valido.');
      }

      if (Object.prototype.hasOwnProperty.call(dictionary, inputText)) {
        return dictionary[inputText];
      }

      let translated = inputText;
      for (const [from, to] of Object.entries(dictionary)) {
        translated = translated.split(String(from)).join(String(to));
      }
      return translated;
    }
    case 'datetounixtime': {
      const format = interpolateValue(cfg.dateFormat, variables);
      const unit = toText(cfg.unixOutputUnit || 'seconds').toLowerCase();
      const date = parseDateWithFormat(inputText, format);
      return msToUnixUnit(date.getTime(), unit);
    }
    case 'unixtimetodate': {
      const format = interpolateValue(cfg.dateFormat, variables);
      const inputUnit = toText(cfg.unixInputUnit || 'seconds').toLowerCase();
      const ms = unixUnitToMs(inputText, inputUnit);
      const date = new Date(ms);
      if (Number.isNaN(date.getTime())) throw new Error('Unix time invalido.');
      return formatDateWithFormat(date, format);
    }
    case 'currentunixtime': {
      const unit = toText(cfg.unixOutputUnit || 'seconds').toLowerCase();
      return msToUnixUnit(Date.now(), unit);
    }
    case 'unixtimetoiso8601': {
      const inputUnit = toText(cfg.unixInputUnit || 'seconds').toLowerCase();
      const ms = unixUnitToMs(inputText, inputUnit);
      const date = new Date(ms);
      if (Number.isNaN(date.getTime())) throw new Error('Unix time invalido.');
      return date.toISOString();
    }
    case 'length': {
      const parsed = parseMaybeJson(inputRaw);
      if (Array.isArray(parsed) || typeof parsed === 'string') return parsed.length;
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length;
      return String(parsed ?? '').length;
    }
    case 'tolowercase':
      return inputText.toLowerCase();
    case 'touppercase':
      return inputText.toUpperCase();
    case 'replace': {
      const searchValue = interpolateValue(cfg.replaceSearch, variables);
      const replacement = interpolateValue(cfg.replaceValue, variables);
      const useRegex = cfg.replaceUseRegex === true || toBool(cfg.replaceUseRegex);
      if (useRegex) {
        const flags = toText(cfg.replaceFlags || 'g');
        const regex = new RegExp(searchValue, flags);
        return inputText.replace(regex, replacement);
      }
      return inputText.split(searchValue).join(replacement);
    }
    case 'regexmatch': {
      const regexPattern = interpolateValue(cfg.regexPattern, variables);
      if (!regexPattern) return '';
      const flags = toText(cfg.regexFlags);
      const regex = new RegExp(regexPattern, flags);
      const match = inputText.match(regex);
      return match ? (match[0] ?? '') : '';
    }
    case 'urlencode':
      return encodeURIComponent(inputText);
    case 'urldecode':
      return decodeURIComponent(inputText);
    case 'unescape':
      return decodeEscapedString(inputText);
    case 'htmlentityencode':
      return htmlEntityEncode(inputText);
    case 'htmlentitydecode':
      return htmlEntityDecode(inputText);
    case 'randomnum': {
      const min = toNumber(interpolateValue(cfg.randomMin, variables), 0);
      const max = toNumber(interpolateValue(cfg.randomMax, variables), 100);
      const minValue = Math.min(min, max);
      const maxValue = Math.max(min, max);
      return Math.floor(Math.random() * (maxValue - minValue + 1)) + minValue;
    }
    case 'randomstring':
      return generateRandomString(interpolateValue(cfg.randomMask, variables));
    case 'ceil':
      return Math.ceil(Number(inputText));
    case 'floor':
      return Math.floor(Number(inputText));
    case 'round':
      return Math.round(Number(inputText));
    case 'compute': {
      const expression = interpolateValue(cfg.computeExpression, variables);
      if (!expression) throw new Error('computeExpression vazio.');
      const result = evaluateExpression(expression, {
        input: parseMaybeJson(inputRaw),
        value: parseMaybeJson(inputRaw),
        vars: variables,
      }, null);
      if (result === null) throw new Error(`Falha ao avaliar expressao: ${expression}`);
      return result;
    }
    case 'countoccurrences': {
      const needle = interpolateValue(cfg.countNeedle, variables);
      const caseSensitive = cfg.countCaseSensitive === true || toBool(cfg.countCaseSensitive);
      return countOccurrences(inputText, needle, caseSensitive);
    }
    case 'delay': {
      const delayMs = Math.max(0, toNumber(interpolateValue(cfg.delayMs, variables), 0));
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      return inputRaw;
    }
    case 'charat': {
      const index = Math.floor(toNumber(interpolateValue(cfg.charIndex, variables), 0));
      return inputText.charAt(Math.max(0, index));
    }
    case 'substring': {
      const start = Math.max(0, Math.floor(toNumber(interpolateValue(cfg.substringStart, variables), 0)));
      const length = Math.floor(toNumber(interpolateValue(cfg.substringLength, variables), -1));
      if (length < 0) return inputText.substring(start);
      return inputText.substring(start, start + length);
    }
    case 'reversestring':
      return inputText.split('').reverse().join('');
    case 'trim':
      return inputText.trim();
    default:
      throw new Error(`Operacao de string-functions nao suportada: ${cfg.operation}`);
  }
}

function resolveCreateListInput(cfg, variables) {
  if (Array.isArray(cfg.items)) {
    return cfg.items.map(item => parseMaybeJson(interpolateValue(item, variables)));
  }

  const sourceVariable = toText(cfg.sourceVariable);
  if (sourceVariable && Object.prototype.hasOwnProperty.call(variables, sourceVariable)) {
    return variables[sourceVariable];
  }

  const rawValue = cfg.inputValue ?? cfg.values ?? cfg.value ?? '';
  return interpolateValue(rawValue, variables);
}

function executeListAction(cfg, variables) {
  const action = normalizeListAction(cfg.action).toLowerCase();
  const listSeparator = toText(cfg.listSeparator || ',');
  const sourceList = resolveListFromVariable(cfg.sourceVariable, variables, listSeparator);
  const secondList = resolveListFromVariable(cfg.secondSourceVariable, variables, listSeparator);

  switch (action) {
    case 'create':
      return normalizeListInput(resolveCreateListInput(cfg, variables), listSeparator);
    case 'length':
      return sourceList.length;
    case 'join':
      return sourceList.map(item => String(item ?? '')).join(interpolateValue(cfg.joinSeparator ?? ',', variables));
    case 'sort': {
      const order = toText(cfg.sortOrder || 'asc').toLowerCase();
      const mode = toText(cfg.sortMode || 'alphabetic').toLowerCase();
      const sorted = [...sourceList];
      sorted.sort((a, b) => {
        if (mode === 'numeric') return Number(a) - Number(b);
        return String(a ?? '').localeCompare(String(b ?? ''));
      });
      if (order === 'desc') sorted.reverse();
      return sorted;
    }
    case 'concat':
      return [...sourceList, ...secondList];
    case 'zip': {
      const joiner = interpolateValue(cfg.zipJoiner ?? ':', variables);
      const max = Math.min(sourceList.length, secondList.length);
      return Array.from({ length: max }, (_, index) =>
        `${String(sourceList[index] ?? '')}${joiner}${String(secondList[index] ?? '')}`
      );
    }
    case 'map': {
      if (secondList.length === 0) return [...sourceList];
      const mapped = {};
      const max = Math.min(sourceList.length, secondList.length);
      for (let i = 0; i < max; i++) {
        mapped[String(sourceList[i] ?? i)] = secondList[i];
      }
      return mapped;
    }
    case 'add': {
      const valueToAdd = parseMaybeJson(interpolateValue(cfg.addValue, variables));
      const index = Math.floor(toNumber(interpolateValue(cfg.addIndex, variables), -1));
      const next = [...sourceList];
      if (index < 0 || index >= next.length) {
        next.push(valueToAdd);
      } else {
        next.splice(index, 0, valueToAdd);
      }
      return next;
    }
    case 'remove': {
      const index = Math.floor(toNumber(interpolateValue(cfg.removeIndex, variables), -1));
      if (index < 0 || index >= sourceList.length) return [...sourceList];
      const next = [...sourceList];
      next.splice(index, 1);
      return next;
    }
    case 'removevalues':
      return sourceList.filter(item => !shouldRemoveByCondition(item, cfg, variables));
    case 'removeduplicates': {
      const seen = new Set();
      const output = [];
      for (const item of sourceList) {
        const key = toUniqueKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(item);
      }
      return output;
    }
    case 'random': {
      if (sourceList.length === 0) return null;
      const index = Math.floor(Math.random() * sourceList.length);
      return sourceList[index];
    }
    case 'shuffle': {
      const output = [...sourceList];
      for (let i = output.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [output[i], output[j]] = [output[j], output[i]];
      }
      return output;
    }
    default:
      throw new Error(`Acao de list-operations nao suportada: ${cfg.action}`);
  }
}

async function handleProcessingError({
  block,
  session,
  sock,
  jid,
  flow,
  cfg,
  error,
  stage,
  fallbackMessage,
}) {
  const hasCustomErrorMessage = Object.prototype.hasOwnProperty.call(cfg, 'errorMessage');
  const errorTemplate = hasCustomErrorMessage ? cfg.errorMessage : fallbackMessage;
  const errorMessage = interpolate(toText(errorTemplate), session.variables);

  logHandlerErrorEvent({
    block,
    session,
    jid,
    flow,
    userMessage: errorMessage,
    error,
    stage,
  });

  if (errorMessage) {
    await sendTextMessage(sock, jid, errorMessage);
  }

  if (shouldStopOnError(cfg.onError)) {
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

export async function handleHttpRequest({ block, session, sock, jid, flow }) {
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

export async function handleDataProcessor({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const sourceVariable = toText(cfg.sourceVariable);
  const targetVariable = toText(cfg.outputVariable || sourceVariable || 'data_processor_output');
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
    return handleProcessingError({
      block,
      session,
      sock,
      jid,
      flow,
      cfg,
      error,
      stage: 'data-processor',
      fallbackMessage: 'Erro ao processar dados.',
    });
  }
}

export async function handleStringFunctions({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const targetVariable = toText(cfg.outputVariable || 'string_functions_output');

  try {
    const result = await executeStringOperation(cfg, session.variables ?? {});
    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: {
        variables: {
          ...session.variables,
          [targetVariable]: result,
        },
      },
      done: false,
    };
  } catch (error) {
    return handleProcessingError({
      block,
      session,
      sock,
      jid,
      flow,
      cfg,
      error,
      stage: 'string-functions',
      fallbackMessage: 'Erro ao executar operacao de string.',
    });
  }
}

export async function handleListOperations({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const sourceVariable = toText(cfg.sourceVariable);
  const targetVariable = toText(cfg.outputVariable || sourceVariable || 'list_operations_output');

  try {
    const result = executeListAction(cfg, session.variables ?? {});
    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: {
        variables: {
          ...session.variables,
          [targetVariable]: result,
        },
      },
      done: false,
    };
  } catch (error) {
    return handleProcessingError({
      block,
      session,
      sock,
      jid,
      flow,
      cfg,
      error,
      stage: 'list-operations',
      fallbackMessage: 'Erro ao executar operacao de lista.',
    });
  }
}
