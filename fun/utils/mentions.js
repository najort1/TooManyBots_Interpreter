import { isUserJid, isLidJid } from '../../runtime/contactUtils.js';
import {
  extractNameQueryFromArgs,
  resolveUserTarget,
  isCanonicalUserJid,
} from './identity.js';

/**
 * Extrai JIDs mencionados (PN e LID) da mensagem Baileys.
 */
export function extractMentionedJids(msgOrParsed = {}) {
  const result = [];
  const seen = new Set();

  const push = (raw) => {
    const jid = String(raw || '').trim();
    if (!jid || seen.has(jid)) return;
    // aceita user pn, lid, e números longos (lid disfarçado)
    if (isUserJid(jid) || isLidJid(jid)) {
      seen.add(jid);
      result.push(jid);
      return;
    }
  };

  const fromArray = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) push(item);
  };

  fromArray(msgOrParsed.mentionedJids);

  const msg = msgOrParsed.rawMessage || msgOrParsed;
  const content = msg?.message || {};
  const layers = [
    content,
    content.extendedTextMessage,
    content.imageMessage,
    content.ephemeralMessage?.message,
    content.ephemeralMessage?.message?.extendedTextMessage,
  ];

  for (const layer of layers) {
    if (!layer) continue;
    const ctx = layer.contextInfo || layer.ContextInfo;
    if (ctx) {
      fromArray(ctx.mentionedJid || ctx.mentioned_jid);
    }
  }

  return result;
}

/**
 * Resolve síncrono simples (testes / fallback). Prefira resolveUserTarget async.
 */
export function resolveTargetJid({
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  excludeJid = '',
} = {}) {
  const exclude = String(excludeJid || '').trim();

  for (const m of mentionedJids) {
    const jid = String(m || '').trim();
    if (jid && jid !== exclude && isCanonicalUserJid(jid)) return jid;
  }

  const quoted = String(quotedParticipant || '').trim();
  if (quoted && quoted !== exclude && isCanonicalUserJid(quoted)) return quoted;

  for (const arg of args) {
    const token = String(arg || '').trim().replace(/^@/, '');
    if (!token) continue;
    if (token.includes('@')) {
      if (isCanonicalUserJid(token) && token !== exclude) return token;
      continue;
    }
    if (/^\d{8,15}$/.test(token)) {
      const jid = `${token}@s.whatsapp.net`;
      if (isCanonicalUserJid(jid) && jid !== exclude) return jid;
    }
  }

  return '';
}

export function resolveTwoTargets({
  args = [],
  mentionedJids = [],
  excludeJid = '',
} = {}) {
  const exclude = String(excludeJid || '').trim();
  const found = [];

  for (const m of mentionedJids) {
    const jid = String(m || '').trim();
    if (jid && jid !== exclude && isCanonicalUserJid(jid) && !found.includes(jid)) {
      found.push(jid);
    }
    if (found.length >= 2) break;
  }

  for (const arg of args) {
    if (found.length >= 2) break;
    const token = String(arg || '').trim().replace(/^@/, '');
    if (!token) continue;
    let jid = '';
    if (isCanonicalUserJid(token)) jid = token;
    else if (/^\d{8,15}$/.test(token)) {
      const candidate = `${token}@s.whatsapp.net`;
      if (isCanonicalUserJid(candidate)) jid = candidate;
    }
    if (jid && jid !== exclude && !found.includes(jid)) found.push(jid);
  }

  return { a: found[0] || '', b: found[1] || '' };
}

export function parseAmountFromArgs(args = []) {
  for (const arg of args) {
    const token = String(arg || '').trim().replace(/[^\d.-]/g, '');
    // amount curto — evita interpretar telefone/LID como valor
    if (!token || token.length > 9) continue;
    const n = Number(token);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}

export {
  extractNameQueryFromArgs,
  resolveUserTarget,
  isCanonicalUserJid,
};
