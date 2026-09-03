const SENSITIVE_PATTERNS = [
  /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b/,
  /\b\d{10,13}\b.*\b(zap|whats|telefone|celular|pix)\b/i,
  /\b(zap|whats|telefone|celular|pix)\b.*\b\d{10,13}\b/i,
  /(senha|password|token|api[_-]?key)\s*[:=]/i,
];

export function looksSensitiveJournalText(text) {
  const body = String(text || '');
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(body));
}

export function isJournalMessageEligible({
  scopeKey,
  text,
  messageType = 'text',
  source = 'human',
  prefix = '/',
} = {}) {
  if (!String(scopeKey || '').endsWith('@g.us')) {
    return { eligible: false, reason: 'not-group' };
  }

  const body = String(text || '').trim();
  if (!body) {
    return {
      eligible: false,
      reason: messageType && messageType !== 'text' ? 'media-empty' : 'empty',
    };
  }
  if (String(source || 'human') === 'human' && body.startsWith(String(prefix || '/'))) {
    return { eligible: false, reason: 'command' };
  }
  if (looksSensitiveJournalText(body)) {
    return { eligible: false, reason: 'sensitive' };
  }

  return { eligible: true, text: body };
}
