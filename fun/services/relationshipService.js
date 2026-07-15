/**
 * Marry com proposta (aceitar/recusar) + ship.
 */

import { ACTION_TYPE, PROPOSAL_TTL_MS } from '../constants.js';

function hashPair(a, b) {
  const x = [String(a || ''), String(b || '')].sort().join('|');
  let h = 2166136261;
  for (let i = 0; i < x.length; i += 1) {
    h ^= x.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRelationshipService({
  relationshipRepository,
  actionRepository,
} = {}) {
  if (!relationshipRepository) {
    throw new Error('[fun/relationshipService] relationshipRepository required');
  }
  if (!actionRepository) {
    throw new Error('[fun/relationshipService] actionRepository required');
  }

  function getMarriage(userJid, scopeKey) {
    return relationshipRepository.getMarriage(userJid, scopeKey);
  }

  function proposeMarry({ userJid, partnerJid, scopeKey, now = Date.now() }) {
    const a = String(userJid || '').trim();
    const b = String(partnerJid || '').trim();
    const s = String(scopeKey || '').trim();
    if (!a || !b || !s) return { ok: false, reason: 'invalid-identity' };
    if (a === b) return { ok: false, reason: 'self-marry' };

    const aM = relationshipRepository.getMarriage(a, s);
    if (aM) return { ok: false, reason: 'already-married', partnerJid: aM.partnerJid };
    const bM = relationshipRepository.getMarriage(b, s);
    if (bM) return { ok: false, reason: 'partner-married', partnerJid: bM.partnerJid };

    // se B já pediu A, casa direto? melhor forçar aceitar — só cria proposta A→B
    const reverse = actionRepository.getLatestIncoming({
      scopeKey: s,
      toJid: a,
      actionType: ACTION_TYPE.MARRY,
      now,
    });
    if (reverse && reverse.fromJid === b) {
      // pedido mútuo: aceita automaticamente
      actionRepository.deleteAction(reverse.id);
      const married = relationshipRepository.marry({ userJid: a, partnerJid: b, scopeKey: s, now });
      if (married.ok) {
        actionRepository.clearMarryInvolving?.({ scopeKey: s, userJid: a });
        actionRepository.clearMarryInvolving?.({ scopeKey: s, userJid: b });
      }
      return { ok: true, reason: 'mutual', married: true, result: married };
    }

    const action = actionRepository.createAction({
      scopeKey: s,
      actionType: ACTION_TYPE.MARRY,
      fromJid: a,
      toJid: b,
      payload: {},
      ttlMs: PROPOSAL_TTL_MS,
      now,
    });

    return {
      ok: true,
      reason: 'proposed',
      married: false,
      action,
      expiresInMs: PROPOSAL_TTL_MS,
    };
  }

  function acceptMarry({ userJid, scopeKey, now = Date.now() }) {
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const pending = actionRepository.getLatestIncoming({
      scopeKey: s,
      toJid: u,
      actionType: ACTION_TYPE.MARRY,
      now,
    });
    if (!pending) return { ok: false, reason: 'no-proposal' };

    // revalida antes de casar (alvo/propositor pode ter casado entre o pedido e o /aceitar)
    const uM = relationshipRepository.getMarriage(u, s);
    if (uM) {
      actionRepository.deleteAction(pending.id);
      return { ok: false, reason: 'already-married', partnerJid: uM.partnerJid };
    }
    const fromM = relationshipRepository.getMarriage(pending.fromJid, s);
    if (fromM) {
      actionRepository.deleteAction(pending.id);
      return { ok: false, reason: 'partner-married', partnerJid: fromM.partnerJid };
    }

    const result = relationshipRepository.marry({
      userJid: pending.fromJid,
      partnerJid: u,
      scopeKey: s,
      now,
    });
    actionRepository.deleteAction(pending.id);
    if (!result.ok) return result;
    // limpa propostas residual (outros pretendentes envolvendo os recém-casados)
    actionRepository.clearMarryInvolving?.({ scopeKey: s, userJid: u });
    actionRepository.clearMarryInvolving?.({ scopeKey: s, userJid: pending.fromJid });
    return {
      ok: true,
      reason: 'ok',
      fromJid: pending.fromJid,
      toJid: u,
      marriedAt: result.marriedAt,
    };
  }

  function declineMarry({ userJid, scopeKey, now = Date.now() }) {
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const pending = actionRepository.getLatestIncoming({
      scopeKey: s,
      toJid: u,
      actionType: ACTION_TYPE.MARRY,
      now,
    });
    if (!pending) return { ok: false, reason: 'no-proposal' };
    actionRepository.deleteAction(pending.id);
    return {
      ok: true,
      reason: 'declined',
      fromJid: pending.fromJid,
      toJid: u,
    };
  }

  function divorce({ userJid, scopeKey }) {
    return relationshipRepository.divorce({ userJid, scopeKey });
  }

  function ship(userA, userB) {
    const a = String(userA || '').trim();
    const b = String(userB || '').trim();
    if (!a || !b) return { ok: false, reason: 'invalid-identity', percent: 0 };
    if (a === b) return { ok: false, reason: 'self-ship', percent: 0 };

    const h = hashPair(a, b);
    const percent = h % 101;
    let label = 'Meh';
    if (percent >= 90) label = 'Destino';
    else if (percent >= 75) label = 'Química forte';
    else if (percent >= 50) label = 'Tem potencial';
    else if (percent >= 25) label = 'Amizade talvez';
    else label = 'Só colega';

    return { ok: true, percent, label, userA: a, userB: b };
  }

  /** @deprecated use proposeMarry */
  function marry(input) {
    return proposeMarry(input);
  }

  return {
    getMarriage,
    proposeMarry,
    acceptMarry,
    declineMarry,
    marry,
    divorce,
    ship,
  };
}
