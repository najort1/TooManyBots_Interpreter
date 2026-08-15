function dayStart(now) { const date = new Date(Number(now) || Date.now()); return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()); }
function sanitizeNote(value) { return String(value || '').replace(/[\r\n]+/g, ' ').replace(/https?:\/\//gi, '').trim().slice(0, 160); }

export function createVisitService({ houseRepository } = {}) {
  if (!houseRepository) throw new Error('[fun/visit] houseRepository obrigatório');
  function visit({ scopeKey, ownerJid, visitorJid, note = '', funConfig = {}, now = Date.now() }) {
    if (funConfig.visitsEnabled === false) return { ok: false, reason: 'disabled' };
    if (!scopeKey || !ownerJid || !visitorJid || String(ownerJid) === String(visitorJid)) return { ok: false, reason: 'invalid-visit' };
    const max = Math.max(1, Number(funConfig.houseVisitDailyMax) || 5);
    const count = houseRepository.countVisitsSince(scopeKey, visitorJid, dayStart(now));
    if (count >= max) return { ok: false, reason: 'daily-cap', max, count };
    const visit = houseRepository.addVisit({ scopeKey, ownerJid, visitorJid, note: sanitizeNote(note), now });
    return { ok: true, visit };
  }
  function mural({ scopeKey, ownerJid, limit = 30 }) { return { ok: true, visits: houseRepository.listVisits(scopeKey, ownerJid, limit) }; }
  return { visit, mural };
}
