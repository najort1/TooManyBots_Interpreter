import { formatDailyResult } from '../../formatters/rankCard.js';

export async function handleDailyCommand({
  userJid,
  scopeKey,
  dailyService,
  effectsRepository,
  funConfig,
  reply,
  effectiveRates,
}) {
  const now = Date.now();
  let rewardCoins = effectiveRates?.dailyCoins ?? funConfig.dailyCoins;
  let doubled = false;

  if (effectsRepository) {
    const boost = effectsRepository.getEffect(userJid, scopeKey, 'daily_double', now);
    if (boost && boost.charges > 0) {
      rewardCoins = Math.floor(Number(rewardCoins) || 0) * 2;
      doubled = true;
      effectsRepository.consumeCharge(userJid, scopeKey, 'daily_double', now);
    }
  }

  const result = dailyService.claimDaily({
    userJid,
    scopeKey,
    now,
    rewardXp: effectiveRates?.dailyXp ?? funConfig.dailyXp,
    rewardCoins,
  });

  let text = formatDailyResult(result);
  if (result.claimed && doubled) {
    text += '\n⚡ *Daily turbinado* da loja aplicado!';
  }
  await reply(text);
  return { handled: true, result };
}
