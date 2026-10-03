import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';

function renderBar(value, totalBlocks = 10) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const filled = Math.round((v / 100) * totalBlocks);
  return '█'.repeat(filled) + '░'.repeat(totalBlocks - filled);
}

const ARCHETYPE_ICONS = Object.freeze({
  strangers: '🌫️',
  love_hate: '🔥',
  soulmates: '💍',
  archnemesis: '⚡',
  partners_in_crime: '🕶️',
  bitter_rivals: '⚔️',
  sweethearts: '🌸',
  chaos_agents: '🃏',
  acquaintances: '☕',
});

export async function handleRelacaoCommand({
  userJid,
  scopeKey,
  bondService,
  getContactDisplayName,
  listContacts,
  reply,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  sock,
  identityMap,
}) {
  const contacts = typeof listContacts === 'function' ? listContacts() : [];
  const resolved = await resolveUserTarget({
    args,
    mentionedJids,
    quotedParticipant,
    excludeJid: userJid,
    identityMap,
    sock,
    groupJid: scopeKey,
    contacts,
  });

  const targetJid = resolved.jid;
  if (!targetJid || !isCanonicalUserJid(targetJid)) {
    await reply('Uso: `/relacao @pessoa` ou `/quimica @pessoa` para inspecionar a dinâmica entre vocês.');
    return { handled: true };
  }

  if (targetJid === userJid) {
    await reply('Você tem uma relação intensa consigo mesmo(a), mas use o comando marcando outra pessoa!');
    return { handled: true };
  }

  if (!bondService?.getBondWithDecay) {
    await reply('Sistema de vínculos indisponível no momento.');
    return { handled: true };
  }

  const bond = bondService.getBondWithDecay(scopeKey, userJid, targetJid);
  const me = nameOf(getContactDisplayName, userJid);
  const other = nameOf(getContactDisplayName, targetJid);

  if (!bond || bond.isNew || bond.interactionsCount === 0) {
    await reply(
      [
        '🔮 *Química & Relação*',
        `*${me}* × *${other}*`,
        '',
        '*Arquétipo:* Desconhecidos 🌫️',
        '_Vocês ainda não têm interações registradas neste grupo._',
        '',
        '💡 Dica: Usem `/kiss`, `/slap`, `/hug`, enviem presentes ou duelem para começar essa história!',
      ].join('\n')
    );
    return { handled: true, bond };
  }

  const archetype = bondService.classifyBond({
    affection: bond.affection,
    rivalry: bond.rivalry,
    intimacy: bond.intimacy,
    chaos: bond.chaos,
  });

  const icon = ARCHETYPE_ICONS[archetype.key] || '✨';

  const lines = [
    '🔮 *Química & Relação*',
    `*${me}* × *${other}*`,
    '',
    `*Arquétipo:* ${archetype.label} ${icon}`,
    `_${archetype.desc}_`,
    '',
    `💗 *Afeto:* [${renderBar(bond.affection)}] ${Math.round(bond.affection)}%`,
    `⚔️ *Rivalidade:* [${renderBar(bond.rivalry)}] ${Math.round(bond.rivalry)}%`,
    `🤝 *Intimidade:* [${renderBar(bond.intimacy)}] ${Math.round(bond.intimacy)}%`,
    `🎲 *Caos:* [${renderBar(bond.chaos)}] ${Math.round(bond.chaos)}%`,
    '',
    `📊 *Interações registradas:* ${bond.interactionsCount || 0}`,
  ];

  if (bond.flags?.lastInfidelity) {
    lines.push('⚠️ *Status conjugal:* Suspeita de infidelidade flagrada recentemente!');
  }

  await reply(lines.join('\n'));
  return { handled: true, bond, archetype };
}
