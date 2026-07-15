import { formatDailyResult } from '../../formatters/rankCard.js';

export async function handleDailyCommand({
  userJid,
  scopeKey,
  dailyService,
  effectsRepository,
  bridgeService,
  socialHooks,
  funConfig,
  reply,
  effectiveRates,
}) {
  const now = Date.now();
  let rewardCoins = effectiveRates?.dailyCoins ?? funConfig.dailyCoins;
  let rewardXp = effectiveRates?.dailyXp ?? funConfig.dailyXp;
  let doubled = false;
  let panelinha = false;

  if (effectsRepository) {
    const boost = effectsRepository.getEffect(userJid, scopeKey, 'daily_double', now);
    if (boost && boost.charges > 0) {
      rewardCoins = Math.floor(Number(rewardCoins) || 0) * 2;
      doubled = true;
      effectsRepository.consumeCharge(userJid, scopeKey, 'daily_double', now);
    }
  }

  if (bridgeService) {
    const bridgeMult = bridgeService.getDailyXpMultiplier(scopeKey, userJid, funConfig, now);
    if (bridgeMult.debuff) {
      rewardXp = Math.max(1, Math.floor(Number(rewardXp) * bridgeMult.mult));
      panelinha = true;
    }
  }

  const result = dailyService.claimDaily({
    userJid,
    scopeKey,
    now,
    rewardXp,
    rewardCoins,
  });

  let text = formatDailyResult(result);
  if (result.claimed && doubled) {
    text += '\n⚡ *Daily turbinado* da loja aplicado!';
  }
  if (result.claimed && panelinha) {
    text += '\n💀 Debuff *Panelinha oficial*: menos XP de daily. Melhore a `/ponte`.';
  }

  if (result.claimed && typeof socialHooks?.onDaily === 'function') {
    const mission = socialHooks.onDaily({ scopeKey, userJid, now });
    if (mission?.completed) {
      text += '\n🏁 Squad: missão mista completa!';
    } else if (mission?.updated && mission.mission?.progress?.daily) {
      text += '\n🎯 Objetivo daily do squad ✅';
    } else if (mission?.updated) {
      text += '\n🎯 Daily do squad registrado.';
    }
  }

  await reply(text);
  return { handled: true, result };
}
