import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf, displayNameOnly } from '../../utils/userLabel.js';

async function flavorItalic(flavorService, scenario, vars) {
  if (!flavorService?.italicLine) return null;
  try {
    return await flavorService.italicLine(scenario, vars);
  } catch {
    return null;
  }
}

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
  socialHooks,
  funConfig,
  flavorService,
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

  const name = (jid) => nameOf(getContactDisplayName, jid);
  // LLM prefere nome legível sem @
  const plain = (jid) => displayNameOnly(getContactDisplayName, jid);

  const barLen = 10;
  const filled = Math.round((result.percent / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  let extra = null;
  if (typeof socialHooks?.onSocialPair === 'function') {
    const hook = socialHooks.onSocialPair({
      scopeKey,
      fromJid: a,
      toJid: b,
      kind: 'ship',
      funConfig,
    });
    if (hook?.eventBonus) {
      extra = `⚡ Evento cross-panelinha: +${hook.eventBonus.bonusCoins} coins pra ambos`;
    }
    if (hook?.mission?.completed) {
      extra = (extra ? `${extra}\n` : '') + '🏁 Objetivo de missão mista completo!';
    } else if (hook?.mission?.updated && hook.mission.mission) {
      // silent partial ok
    }
  }

  const fl = await flavorItalic(flavorService, 'ship', {
    a: plain(a),
    b: plain(b),
    percent: result.percent,
    label: result.label,
  });

  await reply(
    [
      '💘 *Ship*',
      `*${name(a)}* × *${name(b)}*`,
      `${bar} *${result.percent}%*`,
      result.label,
      extra,
      fl,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}
