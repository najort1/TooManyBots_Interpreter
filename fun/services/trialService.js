export const DEFAULT_TRIAL_BAIL = 150;

export function createTrialService({
  trialRepository,
  statsRepository,
  effectsRepository = null,
  relationshipRepository = null,
  factionRepository = null,
} = {}) {
  if (!trialRepository) throw new Error('[fun/trialService] trialRepository obrigatório');
  if (!statsRepository) throw new Error('[fun/trialService] statsRepository obrigatório');

  function openTrial({
    scopeKey,
    accuserJid,
    defendantJid,
    charge = '',
    durationMs = 90_000,
    bailAmount = DEFAULT_TRIAL_BAIL,
    now = Date.now(),
  }) {
    const s = String(scopeKey || '').trim();
    const accuser = String(accuserJid || '').trim();
    const defendant = String(defendantJid || '').trim();
    const bail = Math.max(50, Math.floor(Number(bailAmount) || DEFAULT_TRIAL_BAIL));

    if (!s || !accuser || !defendant) return { ok: false, reason: 'invalid-participants' };
    if (accuser === defendant) return { ok: false, reason: 'self-accusation' };

    // Verifica se já tem tribunal em andamento
    const existing = trialRepository.getActiveTrial(s, now);
    if (existing) {
      return { ok: false, reason: 'trial-in-progress', activeTrial: existing };
    }

    // Verifica imunidade judicial
    if (effectsRepository?.getEffect?.(defendant, s, 'tribunal_immunity', now)) {
      return { ok: false, reason: 'defendant-immune' };
    }

    // Valida caução do acusador
    const stats = statsRepository.getUserStats(accuser, s);
    const bal = Math.max(0, Number(stats?.coins) || 0);
    if (bal < bail) {
      return { ok: false, reason: 'insufficient-bail', required: bail, current: bal };
    }

    // Debita a caução do acusador
    statsRepository.addCoins({
      userJid: accuser,
      scopeKey: s,
      amount: -bail,
      reason: 'trial-bail-deposit',
    });

    const trial = trialRepository.createTrial({
      scopeKey: s,
      accuserJid: accuser,
      defendantJid: defendant,
      infractionType: 'social_complaint',
      evidenceSummary: charge,
      bailAmount: bail,
      durationMs,
      now,
    });

    return {
      ok: true,
      trial,
      bailCharged: bail,
    };
  }

  function vote({ trialId, voterJid, vote: rawVote, now = Date.now() }) {
    const trial = trialRepository.getTrial(trialId);
    if (!trial || trial.status !== 'voting') {
      return { ok: false, reason: 'not-active' };
    }

    if (now > trial.endsAt) {
      return { ok: false, reason: 'voting-ended' };
    }

    const voter = String(voterJid || '').trim();
    if (voter === trial.defendantJid) {
      return { ok: false, reason: 'defendant-cannot-vote' };
    }

    // Ponderação do voto para evitar tirania de panelinha
    let weight = 1.0;
    if (relationshipRepository) {
      const marriage = relationshipRepository.getMarriage?.(trial.accuserJid, trial.scopeKey);
      if (marriage && marriage.partnerJid === voter) {
        weight = 0.3; // cônjuge do acusador tem peso reduzido
      }
    }

    if (factionRepository) {
      const facAccuser = factionRepository.getUserFaction?.(trial.scopeKey, trial.accuserJid);
      const facVoter = factionRepository.getUserFaction?.(trial.scopeKey, voter);
      if (facAccuser?.faction?.id && facVoter?.faction?.id && facAccuser.faction.id === facVoter.faction.id) {
        weight = 0.3; // mesma panelinha do acusador tem peso reduzido
      }
    }

    const isGuilty = rawVote === 'guilty' || rawVote === 'culpado';
    return trialRepository.castVote({
      trialId,
      voterJid: voter,
      vote: isGuilty ? 'guilty' : 'innocent',
      voteWeight: weight,
      now,
    });
  }

  function resolveTrial(trialId, now = Date.now()) {
    const trial = trialRepository.getTrial(trialId);
    if (!trial) return { ok: false, reason: 'not-found' };
    if (trial.status !== 'voting') {
      return { ok: true, trial, alreadyResolved: true };
    }

    const votes = trialRepository.getVotes(trialId);
    let guiltyWeighted = 0;
    let innocentWeighted = 0;

    for (const v of votes) {
      if (v.vote === 'guilty') guiltyWeighted += v.voteWeight;
      else innocentWeighted += v.voteWeight;
    }

    const s = trial.scopeKey;
    const accuser = trial.accuserJid;
    const defendant = trial.defendantJid;

    // Se o réu adquiriu imunidade judicial no ínterim da votação, encerra como arquivado
    if (effectsRepository?.getEffect?.(defendant, s, 'tribunal_immunity', now)) {
      const updated = trialRepository.resolveTrial({
        trialId,
        status: 'dismissed',
        penaltyCoins: 0,
        now,
      });

      try {
        statsRepository.addCoins({
          userJid: accuser,
          scopeKey: s,
          amount: trial.bailAmount,
          reason: 'trial-dismissed-bail-refund',
        });
      } catch (err) {
        console.error('[fun/trialService] Erro ao devolver caução de processo arquivado:', err);
      }

      return {
        ok: true,
        status: 'dismissed',
        reason: 'defendant-immune',
        trial: updated,
      };
    }

    if (guiltyWeighted > innocentWeighted && guiltyWeighted > 0) {
      // 1. CONDENAÇÃO: Multa do réu e devolução de caução com recompensa ao acusador
      const defStats = statsRepository.getUserStats(defendant, s);
      const defBal = Math.max(0, Number(defStats?.coins) || 0);
      const penalty = Math.max(30, Math.min(300, Math.floor(defBal * 0.10) || 30));

      const updated = trialRepository.resolveTrial({
        trialId,
        status: 'convicted',
        penaltyCoins: penalty,
        now,
      });

      try {
        // Debita réu
        statsRepository.addCoins({
          userJid: defendant,
          scopeKey: s,
          amount: -penalty,
          reason: 'trial-conviction-fine',
        });

        // Devolve caução + multa ao acusador
        statsRepository.addCoins({
          userJid: accuser,
          scopeKey: s,
          amount: trial.bailAmount + penalty,
          reason: 'trial-victory-refund',
        });

        // Aplica efeitos no réu: condenado_publico (24h) e tribunal_immunity (48h)
        if (effectsRepository) {
          effectsRepository.setTimedEffect?.({
            userJid: defendant,
            scopeKey: s,
            effectKey: 'condenado_publico',
            durationMs: 24 * 60 * 60 * 1000,
            payload: { trialId },
            now,
          });
          effectsRepository.setTimedEffect?.({
            userJid: defendant,
            scopeKey: s,
            effectKey: 'tribunal_immunity',
            durationMs: 48 * 60 * 60 * 1000,
            payload: { trialId },
            now,
          });
        }
      } catch (err) {
        console.error('[fun/trialService] Erro ao aplicar efeitos colaterais de condenação:', err);
      }

      return {
        ok: true,
        status: 'convicted',
        penaltyCoins: penalty,
        accuserPayout: trial.bailAmount + penalty,
        trial: updated,
      };
    } else {
      // 2. ABSOLVIÇÃO / LITIGÂNCIA DE MÁ-FÉ: Caução transferida integralmente ao réu
      const updated = trialRepository.resolveTrial({
        trialId,
        status: 'acquitted',
        penaltyCoins: 0,
        now,
      });

      try {
        statsRepository.addCoins({
          userJid: defendant,
          scopeKey: s,
          amount: trial.bailAmount,
          reason: 'trial-damages-compensation',
        });
      } catch (err) {
        console.error('[fun/trialService] Erro ao transferir caução na absolvição:', err);
      }

      return {
        ok: true,
        status: 'acquitted',
        compensationToDefendant: trial.bailAmount,
        trial: updated,
      };
    }
  }

  function getActiveTrial(scopeKey, now = Date.now()) {
    return trialRepository.getActiveTrial(scopeKey, now);
  }

  return {
    openTrial,
    vote,
    resolveTrial,
    getActiveTrial,
  };
}
