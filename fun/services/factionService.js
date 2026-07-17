/**
 * Panelinhas oficiais + cofre (API interna: faction*).
 */

export function createFactionService({
  factionRepository,
  repository,
  bridgeService = null,
} = {}) {
  if (!factionRepository) throw new Error('[fun/factionService] factionRepository required');
  if (!repository) throw new Error('[fun/factionService] repository required');

  function create({ scopeKey, userJid, name, funConfig = {}, now = Date.now() }) {
    const cost = Math.max(0, Math.floor(Number(funConfig.factionCreateCost) || 50));
    const maxMembers = Math.max(2, Math.floor(Number(funConfig.factionMaxMembers) || 8));

    if (factionRepository.getMember?.(scopeKey, userJid)) {
      return { ok: false, reason: 'already-in-faction' };
    }

    const bal =
      repository.getUserStats(userJid, scopeKey)?.coins
      ?? repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (cost > 0 && bal < cost) {
      return { ok: false, reason: 'insufficient-funds', coins: bal, cost };
    }

    // debita antes de criar; se create falhar (nome tomado), reembolsa
    if (cost > 0) {
      repository.addCoins({
        userJid,
        scopeKey,
        amount: -cost,
        now,
        reason: 'faction-create',
      });
    }

    const created = factionRepository.createFaction({
      scopeKey,
      name,
      leaderJid: userJid,
      now,
    });
    if (!created.ok) {
      if (cost > 0) {
        repository.addCoins({
          userJid,
          scopeKey,
          amount: cost,
          now,
          reason: 'faction-create-refund',
        });
      }
      return created;
    }

    return {
      ok: true,
      faction: created.faction,
      cost,
      maxMembers,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function join({ scopeKey, userJid, name, funConfig = {} }) {
    const fac = factionRepository.getByName(scopeKey, name);
    if (!fac) return { ok: false, reason: 'not-found' };
    const maxMembers = Math.max(2, Math.floor(Number(funConfig.factionMaxMembers) || 8));
    return factionRepository.joinFaction({
      scopeKey,
      userJid,
      factionId: fac.id,
      maxMembers,
    });
  }

  function leave({ scopeKey, userJid, funConfig = {}, now = Date.now() }) {
    const cost = Math.max(0, Math.floor(Number(funConfig.factionLeaveCost) || 25));
    if (cost > 0) {
      const bal = repository.getUserStats(userJid, scopeKey)?.coins || 0;
      if (bal < cost) {
        return { ok: false, reason: 'insufficient-funds', coins: bal, cost };
      }
    }
    const left = factionRepository.leaveFaction({ scopeKey, userJid });
    if (!left.ok) return left;
    if (cost > 0) {
      repository.addCoins({
        userJid,
        scopeKey,
        amount: -cost,
        now,
        reason: 'faction-leave',
      });
    }
    return {
      ...left,
      cost,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function donate({ scopeKey, userJid, amount, now = Date.now() }) {
    const value = Math.floor(Number(amount) || 0);
    if (value <= 0) return { ok: false, reason: 'invalid-amount' };
    const bal = repository.getUserStats(userJid, scopeKey)?.coins
      ?? repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < value) {
      return { ok: false, reason: 'insufficient-funds', coins: bal };
    }

    const member = factionRepository.getMember(scopeKey, userJid);
    if (!member) return { ok: false, reason: 'not-in-faction' };

    repository.addCoins({
      userJid,
      scopeKey,
      amount: -value,
      now,
      reason: 'faction-donate',
    });
    const donated = factionRepository.donateToVault({
      scopeKey,
      userJid,
      amount: value,
      now,
    });
    return {
      ...donated,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function info({ scopeKey, name = null, userJid = null, funConfig = {} }) {
    let faction = null;
    if (name) {
      faction = factionRepository.getByName(scopeKey, name);
    } else if (userJid) {
      faction = factionRepository.getUserFaction(scopeKey, userJid)?.faction || null;
    }
    if (!faction) return { ok: false, reason: 'not-found' };

    const members = factionRepository.listMembers(faction.id);
    const maxMembers = Math.max(2, Math.floor(Number(funConfig.factionMaxMembers) || 8));
    const bridge = bridgeService?.getFactionBridge?.(scopeKey, faction.id, funConfig) || null;

    return {
      ok: true,
      faction,
      members,
      memberCount: members.length,
      maxMembers,
      bridge,
    };
  }

  function rank({ scopeKey, funConfig = {} }) {
    const list = factionRepository.listByScope(scopeKey);
    const maxMembers = Math.max(2, Math.floor(Number(funConfig.factionMaxMembers) || 8));
    const rows = list.map(f => {
      const bridge = bridgeService?.getFactionBridge?.(scopeKey, f.id, funConfig) || null;
      const memberCount = factionRepository.countMembers(f.id);
      // score: vault * (0.5 + 0.5 * ponte) — panelinha pura sobe menos
      const ponte = bridge?.score ?? 0.5;
      const score = Math.floor(f.vaultCoins * (0.5 + 0.5 * Math.min(1, Math.max(0, ponte))));
      return {
        faction: f,
        memberCount,
        maxMembers,
        bridge,
        score,
      };
    });
    rows.sort((a, b) => b.score - a.score || b.faction.vaultCoins - a.faction.vaultCoins);
    return { ok: true, rows };
  }

  function getUserFaction(scopeKey, userJid) {
    return factionRepository.getUserFaction(scopeKey, userJid);
  }

  return {
    create,
    join,
    leave,
    donate,
    info,
    rank,
    getUserFaction,
    listByScope: (scopeKey) => factionRepository.listByScope(scopeKey),
  };
}
