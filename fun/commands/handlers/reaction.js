import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';
import {
  createReactionMediaService,
  getReactionKind,
  normalizeReactionAction,
} from '../../services/reactionMediaService.js';

const ACTION_LABELS = Object.freeze({
  kiss: 'beijou',
  hug: 'abracou',
  pat: 'fez carinho em',
  slap: 'deu um tapa em',
  cuddle: 'ficou de chamego com',
  bite: 'mordeu',
  lick: 'lambeu',
  poke: 'cutucou',
  handhold: 'segurou a mao de',
  highfive: 'bateu aqui com',
  wave: 'acenou para',
  nom: 'deu um nom em',
});

const MEME_LABELS = Object.freeze({
  happy: 'feliz',
  cry: 'chorando',
  laugh: 'rindo',
  bruh: 'bruh',
  sus: 'sus',
});

function parseCommandHead(text, prefix) {
  const p = String(prefix || '/');
  const raw = String(text || '').trim();
  if (!raw.startsWith(p)) return '';
  return String(raw.slice(p.length).trim().split(/\s+/)[0] || '');
}

function reactionCaption({ action, kind, userJid, targetJid, getContactDisplayName, provider }) {
  const actor = nameOf(getContactDisplayName, userJid);
  const source = provider ? `_fonte: ${provider}_` : '';

  if (kind === 'meme') {
    const label = MEME_LABELS[action] || action;
    return [`*${actor}* mandou um *${label}*.`, source].filter(Boolean).join('\n');
  }

  const verb = ACTION_LABELS[action] || action;
  if (targetJid && isCanonicalUserJid(targetJid)) {
    return [`*${actor}* ${verb} *${nameOf(getContactDisplayName, targetJid)}*.`, source]
      .filter(Boolean)
      .join('\n');
  }
  return [`*${actor}* usou *${action}*.`, source].filter(Boolean).join('\n');
}

export async function handleReactionCommand({
  text,
  userJid,
  scopeKey,
  funConfig,
  getContactDisplayName,
  listContacts,
  reply,
  replyImageUrl,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  sock,
  identityMap,
  reactionMediaService,
}) {
  const action = normalizeReactionAction(parseCommandHead(text, funConfig?.prefix || '/'));
  const kind = getReactionKind(action);
  if (!action || !kind) {
    await reply('Reacao desconhecida.');
    return { handled: true, reason: 'unknown-reaction' };
  }

  const contacts = typeof listContacts === 'function' ? listContacts() : [];
  const resolved =
    kind === 'anime'
      ? await resolveUserTarget({
          args,
          mentionedJids,
          quotedParticipant,
          excludeJid: '',
          identityMap,
          sock,
          groupJid: scopeKey,
          contacts,
        })
      : null;
  const targetJid = resolved?.jid || '';

  const mediaService =
    reactionMediaService ||
    createReactionMediaService({
      getConfig: () => funConfig || {},
    });

  const media = await mediaService.getReaction(action, { funConfig });
  if (!media?.ok || !media.url) {
    await reply('Nao achei midia agora. Tenta de novo em instantes.');
    return { handled: true, result: media || null };
  }

  const caption = reactionCaption({
    action,
    kind,
    userJid,
    targetJid,
    getContactDisplayName,
    provider: media.provider,
  });

  if (typeof replyImageUrl === 'function') {
    await replyImageUrl(media.url, caption, media.mimeType || '');
  } else {
    await reply(`${caption}\n${media.url}`);
  }

  return { handled: true, result: media };
}
