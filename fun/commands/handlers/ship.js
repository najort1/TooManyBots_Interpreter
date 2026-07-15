import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';

export async function handleShipCommand({
  userJid,
  scopeKey,
  relationshipService,
  getContactDisplayName,
  listContacts,
  reply,
  args,
  mentionedJids,
  sock,
  identityMap,
}) {
  const contacts = typeof listContacts === 'function' ? listContacts() : [];
  const mentions = Array.isArray(mentionedJids) ? [...mentionedJids] : [];

  // resolve 1º e 2º alvo
  let a = '';
  let b = '';

  if (mentions.length >= 2) {
    const r1 = await resolveUserTarget({
      mentionedJids: [mentions[0]],
      args: [],
      excludeJid: '',
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    const r2 = await resolveUserTarget({
      mentionedJids: [mentions[1]],
      args: [],
      excludeJid: r1.jid,
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    a = r1.jid;
    b = r2.jid;
  } else if (mentions.length === 1) {
    const r = await resolveUserTarget({
      mentionedJids: mentions,
      args,
      excludeJid: userJid,
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    a = userJid;
    b = r.jid;
  } else {
    // tenta nome(s) nos args
    const r = await resolveUserTarget({
      args,
      mentionedJids: [],
      excludeJid: userJid,
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    if (r.jid) {
      a = userJid;
      b = r.jid;
    }
  }

  if (!isCanonicalUserJid(a) || !isCanonicalUserJid(b)) {
    await reply('Uso: `/ship @pessoa1 @pessoa2` ou `/ship @pessoa` (com você).');
    return { handled: true };
  }

  const result = relationshipService.ship(a, b);
  if (!result.ok) {
    await reply('Não deu pra calcular o ship.');
    return { handled: true };
  }

  const name = (jid) =>
    (typeof getContactDisplayName === 'function' && getContactDisplayName(jid)) ||
    jid.split('@')[0];

  const barLen = 10;
  const filled = Math.round((result.percent / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  await reply(
    [
      '💘 *Ship*',
      `*${name(a)}* × *${name(b)}*`,
      `${bar} *${result.percent}%*`,
      result.label,
    ].join('\n')
  );
  return { handled: true, result };
}
