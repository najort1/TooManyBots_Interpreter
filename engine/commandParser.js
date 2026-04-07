function toText(value) {
  return String(value ?? '').trim();
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpaces(text) {
  return toText(text).replace(/\s+/g, ' ');
}

function tokenizeArgs(raw) {
  const tokens = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

function buildPatternMatcher(pattern) {
  const normalizedPattern = normalizeSpaces(pattern);
  if (!normalizedPattern) return null;

  const tokenRegex = /\{([^}]+)\}/g;
  const tokenOrder = [];
  let source = '';
  let lastIndex = 0;
  let tokenMatch;

  while ((tokenMatch = tokenRegex.exec(normalizedPattern)) !== null) {
    const staticPart = normalizedPattern.slice(lastIndex, tokenMatch.index);
    source += escapeRegex(staticPart).replace(/\s+/g, '\\s+');
    source += '(.+?)';
    tokenOrder.push(toText(tokenMatch[1]));
    lastIndex = tokenMatch.index + tokenMatch[0].length;
  }

  const tail = normalizedPattern.slice(lastIndex);
  source += escapeRegex(tail).replace(/\s+/g, '\\s+');

  return {
    regex: new RegExp(`^${source}$`, 'i'),
    tokenOrder,
  };
}

function validateArg(value, argDef = {}) {
  const normalizedValue = toText(value);
  const required = argDef.required !== false;

  if (!normalizedValue) {
    return required ? { valid: false, reason: 'required' } : { valid: true };
  }

  const validation = toText(argDef.validation).toLowerCase();
  const regexPattern = toText(argDef.regexPattern);

  if (regexPattern) {
    try {
      const pattern = new RegExp(regexPattern);
      if (!pattern.test(normalizedValue)) {
        return { valid: false, reason: 'regex' };
      }
    } catch {
      return { valid: false, reason: 'invalid-regex' };
    }
  }

  if (!validation || validation === 'text') return { valid: true };

  switch (validation) {
    case 'number':
    case 'numeric':
      return Number.isFinite(Number(normalizedValue)) ? { valid: true } : { valid: false, reason: 'number' };
    case 'integer':
    case 'int':
      return /^-?\d+$/.test(normalizedValue) ? { valid: true } : { valid: false, reason: 'integer' };
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue) ? { valid: true } : { valid: false, reason: 'email' };
    case 'phone':
      return /^[+\d][\d\s().-]{5,}$/.test(normalizedValue) ? { valid: true } : { valid: false, reason: 'phone' };
    case 'boolean':
      return /^(true|false|1|0|sim|nao|yes|no)$/i.test(normalizedValue)
        ? { valid: true }
        : { valid: false, reason: 'boolean' };
    default:
      return { valid: true };
  }
}

function extractByPattern(message, pattern) {
  const matcher = buildPatternMatcher(pattern);
  if (!matcher) return null;

  const normalizedMessage = normalizeSpaces(message);
  const match = normalizedMessage.match(matcher.regex);
  if (!match) return null;

  const extracted = {};
  matcher.tokenOrder.forEach((token, index) => {
    extracted[token] = toText(match[index + 1]);
  });
  return extracted;
}

function extractByCommand(message, command, argsDefs = []) {
  const normalizedMessage = toText(message);
  const normalizedCommand = toText(command).replace(/^\//, '').toLowerCase();
  if (!normalizedMessage || !normalizedCommand) return null;

  const parsed = normalizedMessage.match(/^\/?(\S+)(?:\s+(.*))?$/);
  if (!parsed) return null;

  const incomingCommand = toText(parsed[1]).replace(/^\//, '').toLowerCase();
  if (incomingCommand !== normalizedCommand) return null;

  const rawArgText = toText(parsed[2]);
  const values = rawArgText ? tokenizeArgs(rawArgText) : [];
  const extracted = {};

  argsDefs.forEach((argDef, index) => {
    const tokenName = toText(argDef.token || argDef.name || `arg${index + 1}`);
    extracted[tokenName] = toText(values[index] ?? '');
  });

  return extracted;
}

function mapExtractedToVariables(extracted, argsDefs = []) {
  const variableValues = {};
  const commandArgs = {};

  argsDefs.forEach((argDef, index) => {
    const tokenName = toText(argDef.token || argDef.name || `arg${index + 1}`);
    const variableName = toText(argDef.variableName || tokenName);
    const value = toText(extracted[tokenName]);
    commandArgs[tokenName] = value;
    if (variableName) variableValues[variableName] = value;
  });

  return { variableValues, commandArgs };
}

/**
 * Parse de entrada de comando para bloco "command-input".
 * Retorna se houve match, partial match (comando reconhecido mas inválido) e valores extraídos.
 */
export function parseCommandInput(rawMessage, config = {}) {
  const message = toText(rawMessage);
  const argsDefs = Array.isArray(config.args) ? config.args : [];

  if (!message) {
    return { matched: false, partial: false, commandMatched: false, extracted: {}, variableValues: {}, commandArgs: {}, errors: [] };
  }

  let extracted = null;
  let commandMatched = false;

  if (toText(config.pattern)) {
    extracted = extractByPattern(message, config.pattern);
    commandMatched = Boolean(extracted);
  }

  if (!extracted && toText(config.command)) {
    extracted = extractByCommand(message, config.command, argsDefs);
    commandMatched = Boolean(extracted);
  }

  if (!extracted) {
    return { matched: false, partial: false, commandMatched: false, extracted: {}, variableValues: {}, commandArgs: {}, errors: [] };
  }

  const errors = [];
  for (let i = 0; i < argsDefs.length; i++) {
    const argDef = argsDefs[i];
    const tokenName = toText(argDef.token || argDef.name || `arg${i + 1}`);
    const value = extracted[tokenName];
    const validation = validateArg(value, argDef);
    if (!validation.valid) {
      errors.push({ token: tokenName, reason: validation.reason });
    }
  }

  const { variableValues, commandArgs } = mapExtractedToVariables(extracted, argsDefs);
  const matched = errors.length === 0;

  return {
    matched,
    partial: commandMatched && !matched,
    commandMatched,
    extracted,
    variableValues,
    commandArgs,
    errors,
  };
}
