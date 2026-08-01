/**
 * farewellService — lógica de domínio do /despedir e /despedida rank.
 *
 * Camada fina acima do repositório (que é quem fala SQLite). Centraliza
 * regras ( registro, ranking, total) e expõe façade simples para os handlers.
 */

export function createFarewellService({ farewellRepository, newsService = null, getContactDisplayName = null } = {}) {
  if (!farewellRepository) {
    throw new Error('[fun/farewell] farewellRepository is required');
  }

  function register({ scopeKey, userJid, now = Date.now() } = {}) {
    const row = farewellRepository.recordFarewell({ scopeKey, userJid, now });
    // Evento para o jornal 23:59 — newsFacts lê via bucket despedir.
    try {
      newsService?.log?.(scopeKey, 'despedir', { userJid, payload: {}, now });
    } catch {
      /* ignore */
    }
    return row;
  }

  function getRanking(scopeKey, limit = 10) {
    const rows = farewellRepository.listRanking(scopeKey, limit);
    const getDisplayName =
      typeof getContactDisplayName === 'function' ? getContactDisplayName : (jid) => String(jid).split('@')[0];
    return rows.map((r, i) => ({
      rank: i + 1,
      userJid: r.userJid,
      displayName: tryName(getDisplayName, r.userJid),
      count: r.count,
      lastAt: r.lastAt,
    }));
  }

  function getUserPosition(userJid, scopeKey) {
    const entry = farewellRepository.getCount(scopeKey, userJid);
    // rank = nº de usuários com count maior que o meu + 1
    if (!entry || entry.count === 0) {
      return { rank: 0, count: 0 };
    }
    const ranking = farewellRepository.listRanking(scopeKey, 50);
    const idx = ranking.findIndex((r) => r.userJid === userJid);
    return { rank: idx < 0 ? 0 : idx + 1, count: entry.count };
  }

  function totalByGroup(scopeKey) {
    return farewellRepository.totalByGroup(scopeKey);
  }

  return {
    register,
    getRanking,
    getUserPosition,
    totalByGroup,
  };
}

function tryName(fn, jid) {
  try {
    const n = fn(jid);
    return (n && String(n).trim()) || String(jid).split('@')[0];
  } catch {
    return String(jid).split('@')[0];
  }
}
