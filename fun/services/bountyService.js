export function createBountyService({
  bountyRepository,
  statsRepository,
  relationshipRepository = null,
  factionRepository = null,
} = {}) {
  if (!bountyRepository) throw new Error('[fun/bountyService] bountyRepository obrigatório');
  if (!statsRepository) throw new Error('[fun/bountyService] statsRepository obrigatório');

  function createBounty({
    scopeKey,
    issuerJid,
    targetJid,
    amount,
    reason = '',
    ttlMs = 7 * 24 * 60 * 60 * 1000,
    now = Date.now(),
  }) {
    const s = String(scopeKey || '').trim();
    const issuer = String(issuerJid || '').trim();
    const target = String(targetJid || '').trim();
    const rawAmount = Math.floor(Number(amount) || 0);

    if (!s || !issuer || !target) return { ok: false, reason: 'invalid-parameters' };
    if (issuer === target) return { ok: false, reason: 'self-target' };
    if (rawAmount < 10) return { ok: false, reason: 'minimum-amount', min: 10 };

    // Anti-conluio: cônjuge
    if (relationshipRepository) {
      const marriage = relationshipRepository.getMarriage?.(issuer, s);
      if (marriage && marriage.partnerJid === target) {
        return { ok: false, reason: 'spouse-target' };
      }
    }

    // Anti-conluio: mesma facção
    if (factionRepository) {
      const facIssuer = factionRepository.getUserFaction?.(s, issuer);
      const facTarget = factionRepository.getUserFaction?.(s, target);
      if (facIssuer?.faction?.id && facTarget?.faction?.id && facIssuer.faction.id === facTarget.faction.id) {
        return { ok: false, reason: 'same-faction' };
      }
    }

    // Valida saldo
    const stats = statsRepository.getUserStats(issuer, s);
    const balance = Math.max(0, Number(stats?.coins) || 0);
    if (balance < rawAmount) {
      return { ok: false, reason: 'insufficient-balance', required: rawAmount, current: balance };
    }

    // Taxa do submundo de 20% (sink econômico deflacionário permanente)
    const netReward = Math.max(1, Math.floor(rawAmount * 0.8));

    // Debita o contratante integralmente
    statsRepository.addCoins({
      userJid: issuer,
      scopeKey: s,
      amount: -rawAmount,
      reason: 'bounty-collateral',
    });

    const bounty = bountyRepository.createBounty({
      scopeKey: s,
      issuerJid: issuer,
      targetJid: target,
      bountyAmount: netReward,
      reason,
      ttlMs,
      now,
    });

    return {
      ok: true,
      bounty,
      totalCharged: rawAmount,
      underworldFee: rawAmount - netReward,
    };
  }

  function claimOnAssault({
    scopeKey,
    hunterJid,
    targetJid,
    stolenCoins = 0,
    now = Date.now(),
  }) {
    const s = String(scopeKey || '').trim();
    const hunter = String(hunterJid || '').trim();
    const target = String(targetJid || '').trim();

    if (!s || !hunter || !target || hunter === target) {
      return { claimed: false, reason: 'invalid-participants' };
    }

    if (Number(stolenCoins) <= 0) {
      return { claimed: false, reason: 'zero-stolen-coins' };
    }

    const activeBounties = bountyRepository.getActiveBountiesForTarget(s, target, now);
    if (!activeBounties.length) {
      return { claimed: false, reason: 'no-active-bounty' };
    }

    // Filtra contratos válidos para o caçador (não pode ser quem colocou o contrato, nem cônjuge, nem mesma facção)
    const validBounties = activeBounties.filter((b) => {
      if (b.issuerJid === hunter) return false;
      if (relationshipRepository) {
        const m = relationshipRepository.getMarriage?.(hunter, s);
        if (m && m.partnerJid === target) return false;
      }
      if (factionRepository) {
        const facHunter = factionRepository.getUserFaction?.(s, hunter);
        const facTarget = factionRepository.getUserFaction?.(s, target);
        if (facHunter?.faction?.id && facTarget?.faction?.id && facHunter.faction.id === facTarget.faction.id) {
          return false;
        }
      }
      return true;
    });

    if (!validBounties.length) {
      return { claimed: false, reason: 'no-eligible-bounty' };
    }

    // Regra de Proporcionalidade: Recompensa limitada ao dobro do roubo real
    // O saldo restante do contrato continua aberto na cabeça do procurado!
    const stolen = Math.max(1, Math.floor(Number(stolenCoins) || 0));
    const proportionalCap = Math.max(20, Math.floor(stolen * 2.0));

    let claimedRecord = null;
    for (const b of validBounties) {
      const payout = Math.min(b.bountyAmount, proportionalCap);
      if (typeof bountyRepository.reduceBountyAmount === 'function') {
        const reduction = bountyRepository.reduceBountyAmount({
          id: b.id,
          amountPaid: payout,
          claimedByJid: hunter,
          now,
        });
        if (reduction) {
          claimedRecord = {
            bountyId: b.id,
            rewardAmount: reduction.paid,
            remainingBounty: reduction.remaining,
            fullyClaimed: reduction.fullyClaimed,
            targetJid: target,
            issuerJid: b.issuerJid,
          };
          break;
        }
      } else {
        const claimed = bountyRepository.claimBounty({ id: b.id, claimedByJid: hunter, now });
        if (claimed) {
          claimedRecord = {
            bountyId: b.id,
            rewardAmount: b.bountyAmount,
            remainingBounty: 0,
            fullyClaimed: true,
            targetJid: target,
            issuerJid: b.issuerJid,
          };
          break;
        }
      }
    }

    if (!claimedRecord) {
      return { claimed: false, reason: 'claim-failed' };
    }

    // Paga a recompensa ao caçador
    statsRepository.addCoins({
      userJid: hunter,
      scopeKey: s,
      amount: claimedRecord.rewardAmount,
      reason: 'bounty-reward',
    });

    return {
      claimed: true,
      ...claimedRecord,
    };
  }

  function cancelBounty({ scopeKey, bountyId, userJid, now = Date.now() }) {
    const b = bountyRepository.getBounty(bountyId);
    if (!b || b.scopeKey !== scopeKey) return { ok: false, reason: 'not-found' };
    if (b.issuerJid !== userJid) return { ok: false, reason: 'not-owner' };
    if (b.status !== 'open') return { ok: false, reason: 'not-open' };

    const cancelled = bountyRepository.cancelBounty({ id: bountyId, now });
    if (!cancelled) return { ok: false, reason: 'cancel-failed' };

    // Devolve apenas a quantia líquida (taxa de 20% retida pelo submundo)
    statsRepository.addCoins({
      userJid,
      scopeKey,
      amount: b.bountyAmount,
      reason: 'bounty-refund',
    });

    return { ok: true, refunded: b.bountyAmount };
  }

  function listActiveBounties(scopeKey, limit = 10, now = Date.now()) {
    return bountyRepository.listActiveBounties(scopeKey, limit, now);
  }

  return {
    createBounty,
    claimOnAssault,
    cancelBounty,
    listActiveBounties,
  };
}
