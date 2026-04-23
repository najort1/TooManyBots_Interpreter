const ACTION_TOKEN_PATTERNS = [
  /^sai(?:r|u|ndo)?$/,
  /^par(?:ar|e|ando)?$/,
  /^encerr(?:ar|a|e|ando)?$/,
  /^finaliz(?:ar|a|e|ando)?$/,
  /^termin(?:ar|a|e|ando)?$/,
  /^fech(?:ar|a|e|ando)?$/,
];

const FILLER_TOKENS = new Set([
  'a',
  'agora',
  'ai',
  'as',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'essa',
  'esse',
  'esta',
  'este',
  'favor',
  'gostaria',
  'isso',
  'isto',
  'ja',
  'me',
  'o',
  'os',
  'para',
  'pode',
  'poderia',
  'por',
  'pra',
  'quero',
  'um',
  'uma',
  'vou',
]);

const CONTEXT_TOKENS = new Set([
  'atendimento',
  'bot',
  'chat',
  'conversa',
  'conversas',
  'sessao',
  'sessoes',
]);

export function normalizeSessionTerminationText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isActionToken(token) {
  return ACTION_TOKEN_PATTERNS.some(pattern => pattern.test(token));
}

export function isSessionTerminationMessage(value) {
  const normalized = normalizeSessionTerminationText(value);
  if (!normalized) return false;

  const tokens = normalized.split(' ');
  let hasActionToken = false;

  for (const token of tokens) {
    if (!token) continue;
    if (isActionToken(token)) {
      hasActionToken = true;
      continue;
    }
    if (FILLER_TOKENS.has(token)) continue;
    if (CONTEXT_TOKENS.has(token)) continue;
    return false;
  }

  return hasActionToken;
}
