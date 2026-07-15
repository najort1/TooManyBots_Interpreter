import { formatXpProfile } from '../../formatters/rankCard.js';

export async function handleXpCommand({
  userJid,
  scopeKey,
  rankService,
  relationshipService,
  effectsRepository,
  getContactDisplayName,
  reply,
}) {
  const listActiveEffects = effectsRepository
    ? (u, s) => effectsRepository.listActiveEffects(u, s)
    : null;
  const profile = rankService.getProfile(userJid, scopeKey);
  const name =
    typeof getContactDisplayName === 'function'
      ? getContactDisplayName(userJid)
      : '';

  let partnerName = '';
  if (relationshipService) {
    const marriage = relationshipService.getMarriage(userJid, scopeKey);
    if (marriage?.partnerJid) {
      partnerName =
        (typeof getContactDisplayName === 'function' &&
          getContactDisplayName(marriage.partnerJid)) ||
        marriage.partnerJid.split('@')[0];
    }
  }

  const stats = profile.stats || {
    xp: 0,
    level: 1,
    dailyStreak: 0,
    coins: 0,
    title: '',
  };

  let activeBuffs = [];
  if (typeof listActiveEffects === 'function') {
    activeBuffs = listActiveEffects(userJid, scopeKey) || [];
  }

  const text = formatXpProfile({
    displayName: name,
    userJid,
    stats,
    rank: profile.rank,
    total: profile.total,
    partnerName,
    activeBuffs,
  });

  await reply(text);
  return { handled: true };
}
