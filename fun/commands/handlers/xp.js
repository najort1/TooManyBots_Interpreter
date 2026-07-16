import { formatXpProfile } from '../../formatters/rankCard.js';
import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';

/**
 * /xp · /perfil [@pessoa | reply]
 * Perfil próprio ou de outro no mesmo grupo (scope).
 */
export async function handleXpCommand({
  userJid,
  scopeKey,
  rankService,
  relationshipService,
  effectsRepository,
  casinoService,
  factionService,
  jobService,
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

  // target opcional: menção, reply ou nome/número nos args
  let targetJid = userJid;
  const wantsOther =
    (Array.isArray(mentionedJids) && mentionedJids.length > 0) ||
    Boolean(String(quotedParticipant || '').trim()) ||
    (Array.isArray(args) && args.some((a) => String(a || '').trim()));

  if (wantsOther) {
    const resolved = await resolveUserTarget({
      args,
      mentionedJids,
      quotedParticipant,
      excludeJid: '', // pode ser o próprio se marcarem a si
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    if (resolved?.jid && isCanonicalUserJid(resolved.jid)) {
      targetJid = resolved.jid;
    } else {
      await reply(
        [
          'Não achei essa pessoa.',
          'Use `/perfil @pessoa`, responda a mensagem dela + `/perfil`, ou o nome/número.',
        ].join('\n')
      );
      return { handled: true, reason: 'target-unresolved' };
    }
  }

  const isSelf = targetJid === userJid;
  const listActiveEffects = effectsRepository
    ? (u, s) => effectsRepository.listActiveEffects(u, s)
    : null;

  const profile = rankService.getProfile(targetJid, scopeKey);
  const name =
    (typeof getContactDisplayName === 'function' && getContactDisplayName(targetJid)) ||
    '';
  const viewerName = isSelf
    ? ''
    : (typeof getContactDisplayName === 'function' && getContactDisplayName(userJid)) ||
      '';

  let partnerName = '';
  if (relationshipService) {
    const marriage = relationshipService.getMarriage(targetJid, scopeKey);
    if (marriage?.partnerJid) {
      partnerName =
        (typeof getContactDisplayName === 'function' &&
          getContactDisplayName(marriage.partnerJid)) ||
        String(marriage.partnerJid).split('@')[0];
    }
  }

  let factionLabel = '';
  if (factionService?.getUserFaction) {
    try {
      const uf = factionService.getUserFaction(scopeKey, targetJid);
      const fac = uf?.faction || uf;
      if (fac?.name) {
        factionLabel = `${fac.emoji || '🏴‍☠️'} ${fac.name}`;
      }
    } catch {
      // ignore
    }
  }

  let casino = null;
  if (casinoService?.getUserCasinoStats) {
    try {
      const c = casinoService.getUserCasinoStats(targetJid, scopeKey);
      if (c && (c.games > 0 || c.wagered > 0 || c.won > 0 || c.lost > 0)) {
        casino = {
          profit: Number(c.profit) || 0,
          wagered: Number(c.wagered) || 0,
          won: Number(c.won) || 0,
          lost: Number(c.lost) || 0,
          games: Number(c.games) || 0,
        };
      }
    } catch {
      // ignore
    }
  }

  const stats = profile.stats || {
    xp: 0,
    level: 1,
    dailyStreak: 0,
    coins: 0,
    title: '',
    messageCount: 0,
    xpAwardedCount: 0,
  };

  let activeBuffs = [];
  if (typeof listActiveEffects === 'function') {
    activeBuffs = listActiveEffects(targetJid, scopeKey) || [];
  }

  let employment = null;
  try {
    if (jobService?.getEmployment) {
      employment = jobService.getEmployment(targetJid, scopeKey);
    }
  } catch {
    employment = null;
  }

  const text = formatXpProfile({
    displayName: name,
    userJid: targetJid,
    stats,
    rank: profile.rank,
    total: profile.total,
    coinsRank: profile.coinsRank,
    coinsTotal: profile.coinsTotal,
    messagesRank: profile.messagesRank,
    messagesTotal: profile.messagesTotal,
    partnerName,
    activeBuffs,
    isSelf,
    viewerName,
    casino,
    factionLabel,
    employment,
  });

  await reply(text);
  return { handled: true, targetJid, isSelf };
}
