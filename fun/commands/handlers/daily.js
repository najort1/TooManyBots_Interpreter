import { formatDailyResult } from '../../formatters/rankCard.js';

export async function handleDailyCommand({
  userJid,
  scopeKey,
  dailyService,
  effectsRepository,
  bridgeService,
  socialHooks,
  jobService,
  repository,
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

  // salário de profissão + reset de inatividade
  if (result.claimed && jobService?.applyDailySalary) {
    const pay = jobService.applyDailySalary({ userJid, scopeKey, now });
    if (pay?.paid > 0 && pay.job) {
      text += `\n${pay.job.emoji} *Salário ${pay.job.name}:* +*${pay.paid}*c (${pay.workers} no cargo)`;
      result.coins = pay.coins;
      result.jobSalary = pay.paid;
    }
  }

  // se daily bloqueado (already-claimed), não mexe em missed;
  // inatividade: quando last_daily está velho e user tem emprego (checado em background-ish via perfil ou start)
  if (!result.claimed && result.reason === 'already-claimed' && jobService?.processInactivity) {
    // no-op no claim bloqueado
  }

  // ao falhar claim por already, não demite; demissão por inatividade:
  // se o usuário tem emprego e last_daily_at > 48h sem claim bem-sucedido — processado quando tenta daily após janela
  if (result.claimed === false && jobService?.processInactivity && repository) {
    const stats = repository.getUserStats?.(userJid, scopeKey);
    const last = Number(stats?.lastDailyAt) || 0;
    // se passou > 48h do last daily e está tentando de novo (already or ok path handled)
    if (last > 0 && now - last > 48 * 60 * 60_000) {
      const fire = jobService.processInactivity({
        userJid,
        scopeKey,
        lastDailyAt: last,
        now,
      });
      if (fire?.fired) {
        text += `\n🪪 *Demitido por inatividade* (${fire.jobId}). 3 dailys perdidos.`;
      }
    }
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
