const ACTIONS = new Set(['fix_author', 'fix_text', 'merge_duplicates', 'promote_confidence', 'flag_unverifiable', 'delete', 'downgrade', 'suppress', 'integrity_fix', 'report']);
const DOMAIN_ACTIONS = {
  // memory_lore é lore do grupo: a auditoria valida veracidade/autoria/duplicidade,
  // nunca propõe exclusão (delete) — conteúdo pesado/humor BR é cultura do grupo.
  memory_lore: new Set(['fix_author', 'fix_text', 'merge_duplicates', 'flag_unverifiable', 'report']),
  conversation_memory: new Set(['promote_confidence', 'downgrade', 'suppress', 'merge_duplicates', 'delete', 'report']),
  economy: new Set(['integrity_fix', 'report', 'delete']),
  profile: new Set(['integrity_fix', 'report', 'delete']),
};
const LOW = new Set(['fix_author', 'fix_text', 'merge_duplicates', 'promote_confidence', 'flag_unverifiable', 'report']);
export function riskForAction(action) { return LOW.has(action) ? 'low' : 'high'; }
export function validateFindingsPayload(payload, { domain = 'memory_lore', factsById = new Map() } = {}) {
  if (!payload || payload.domain !== domain || !DOMAIN_ACTIONS[domain] || !Array.isArray(payload.findings)) return { ok: false, reason: 'invalid-payload' };
  const findings = [];
  for (const item of payload.findings) {
    if (!item || !ACTIONS.has(item.action) || !DOMAIN_ACTIONS[domain].has(item.action) || !Number.isInteger(item.confidence) || item.confidence < 0 || item.confidence > 100 || !item.targetId || !factsById.has(String(item.targetId))) continue;
    if ((item.action === 'fix_author' && !/^[^\s@]+@s\.whatsapp\.net$/.test(String(item.suggestedAuthorJid || ''))) || (item.action === 'fix_text' && String(item.suggestedText || '').trim().length < 6)) continue;
    if ((item.action === 'promote_confidence' || item.action === 'downgrade') && (!Number.isFinite(Number(item.suggestedConfidence)) || Number(item.suggestedConfidence) < 0 || Number(item.suggestedConfidence) > 1)) continue;
    if (item.action === 'merge_duplicates' && (!item.duplicateId || !factsById.has(String(item.duplicateId)) || String(item.duplicateId) === String(item.targetId))) continue;
    findings.push({ ...item, targetId: String(item.targetId), riskLevel: riskForAction(item.action) });
  }
  return { ok: true, findings };
}
export function validateEvidenceFinding(finding, evidence, fact, similarityThreshold = 0.5) {
  if (finding.action === 'flag_unverifiable' || finding.action === 'report' || finding.action === 'promote_confidence' || finding.action === 'merge_duplicates') return { ok: true };
  if (!evidence || evidence.scopeKey !== fact.scopeKey || evidence.similarity < similarityThreshold) return { ok: false, reason: 'evidence-mismatch' };
  if (finding.action === 'fix_author' && evidence.authorJid !== finding.suggestedAuthorJid) return { ok: false, reason: 'author-mismatch' };
  if (finding.action === 'fix_text' && evidence.similarity < similarityThreshold) return { ok: false, reason: 'text-mismatch' };
  return { ok: true };
}
