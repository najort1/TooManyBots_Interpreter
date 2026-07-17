/**
 * Rótulo de usuário no chat: @menção (WhatsApp) ou nome de exibição.
 * Default: marcar (mentionUsers !== false).
 *
 * formatUser do request-scope registra JIDs para o sendMessage({ mentions }).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** @type {AsyncLocalStorage<{ formatUser?: (jid: string) => string, mentionUsers?: boolean }>} */
export const userLabelContext = new AsyncLocalStorage();

/**
 * Parte local do JID (número / lid) para o texto `@xxx`.
 */
export function jidLocalPart(jid) {
  const raw = String(jid || '').trim();
  if (!raw) return '';
  const at = raw.indexOf('@');
  return at > 0 ? raw.slice(0, at) : raw.replace(/^@/, '');
}

/**
 * JID canônico para o array mentions do Baileys.
 */
export function normalizeMentionJid(jid) {
  const raw = String(jid || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw;
  if (/^\d{8,20}$/.test(raw)) return `${raw}@s.whatsapp.net`;
  return raw;
}

/**
 * Nome legível (sem menção).
 */
export function displayNameOnly(getContactDisplayName, jid) {
  const j = String(jid || '').trim();
  if (!j) return 'alguém';
  const name =
    typeof getContactDisplayName === 'function' ? getContactDisplayName(j) : '';
  const n = String(name || '').trim();
  if (n) return n;
  const local = jidLocalPart(j);
  return local || 'alguém';
}

/**
 * @param {string} jid
 * @param {object} [opts]
 * @param {(jid: string) => string} [opts.getContactDisplayName]
 * @param {boolean} [opts.mention] — força menção on/off
 * @param {(jid: string) => void} [opts.track] — registra jid para mentions[]
 */
export function formatUserLabel(jid, opts = {}) {
  const j = String(jid || '').trim();
  if (!j) return 'alguém';

  const store = userLabelContext.getStore();
  const mention =
    opts.mention !== undefined
      ? Boolean(opts.mention)
      : store?.mentionUsers !== undefined
        ? store.mentionUsers !== false
        : true;

  if (mention) {
    const full = normalizeMentionJid(j);
    const local = jidLocalPart(full || j);
    if (typeof opts.track === 'function' && full) opts.track(full);
    else if (store?.trackMention && full) store.trackMention(full);
    return local ? `@${local}` : 'alguém';
  }

  return displayNameOnly(opts.getContactDisplayName || store?.getContactDisplayName, j);
}

/**
 * Compatível com os nameOf(getContactDisplayName, jid) espalhados nos handlers.
 * Se houver formatUser no ALS (pipeline), usa ele.
 */
export function nameOf(getContactDisplayName, jid) {
  const store = userLabelContext.getStore();
  if (typeof store?.formatUser === 'function') {
    return store.formatUser(jid);
  }
  if (typeof getContactDisplayName === 'function' || jid) {
    return formatUserLabel(jid, {
      getContactDisplayName,
      mention: store?.mentionUsers !== false,
      track: store?.trackMention,
    });
  }
  return 'alguém';
}

/**
 * Formatter de um request (grupo/comando): label + lista de mentions.
 */
export function createUserFormatter({
  getContactDisplayName = null,
  mentionUsers = true,
} = {}) {
  const pending = new Set();
  const mention = mentionUsers !== false;

  function trackMention(jid) {
    const full = normalizeMentionJid(jid);
    if (full) pending.add(full);
  }

  function formatUser(jid) {
    return formatUserLabel(jid, {
      getContactDisplayName,
      mention,
      track: trackMention,
    });
  }

  function takeMentions() {
    const arr = [...pending];
    pending.clear();
    return arr;
  }

  function peekMentions() {
    return [...pending];
  }

  return {
    formatUser,
    takeMentions,
    peekMentions,
    trackMention,
    mentionUsers: mention,
    getContactDisplayName,
  };
}

/**
 * Roda fn com ALS de labels (para handlers/formatters).
 */
export function runWithUserLabels(formatter, fn) {
  return userLabelContext.run(
    {
      formatUser: formatter.formatUser,
      trackMention: formatter.trackMention,
      mentionUsers: formatter.mentionUsers,
      getContactDisplayName: formatter.getContactDisplayName,
    },
    fn
  );
}

/**
 * Garante que o texto responde a um usuário (ator do comando).
 * Em grupo com mentionUsers: prefixa @numero se ainda não estiver no texto.
 * Assim todo reply indica a quem o bot está falando, mesmo se o handler não citou ninguém.
 *
 * @param {string} text
 * @param {string} actorJid
 * @param {object} [opts]
 * @param {boolean} [opts.mentionUsers=true]
 * @param {(jid: string) => void} [opts.track]
 * @param {boolean} [opts.force=false] — se true, marca mesmo no DM
 * @param {boolean} [opts.isGroup=true]
 * @returns {string}
 */
export function ensureActorMention(text, actorJid, opts = {}) {
  const body = String(text || '').trim();
  if (!body) return body;

  const mentionOn = opts.mentionUsers !== false;
  if (!mentionOn) return body;

  const isGroup = opts.isGroup !== false;
  if (!isGroup && !opts.force) return body;

  const jid = normalizeMentionJid(actorJid);
  const local = jidLocalPart(jid);
  if (!local) return body;

  const tag = `@${local}`;
  // já cita este ator em qualquer lugar do texto
  if (body.includes(tag)) {
    if (typeof opts.track === 'function') opts.track(jid);
    return body;
  }

  if (typeof opts.track === 'function') opts.track(jid);
  return `${tag}\n${body}`;
}
