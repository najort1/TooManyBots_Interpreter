import { getDb } from '../../db/context.js';
import { ensureFunSchema } from '../schema.js';
const S = 'analytics';
const map = row => row && ({ ...row, id: Number(row.id), targetId: String(row.target_id), before: row.before_json ? JSON.parse(row.before_json) : null, after: row.after_json ? JSON.parse(row.after_json) : null });
export function createFunSelfHealRepository({ getDatabase = getDb } = {}) {
  const ensure = () => ensureFunSchema(getDatabase());
  function insertAudit(entry) {
    ensure(); const now = Number(entry.createdAt) || Date.now();
    const result = getDatabase().prepare(`INSERT INTO ${S}.fun_self_heal_audit (run_id,scope_key,domain,target_table,target_id,action,risk_level,status,before_json,after_json,reason,evidence_ref,llm_confidence,mode,created_at,decided_at,decided_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(entry.runId, entry.scopeKey, entry.domain, entry.targetTable, String(entry.targetId), entry.action, entry.riskLevel, entry.status, entry.before ? JSON.stringify(entry.before) : null, entry.after ? JSON.stringify(entry.after) : null, entry.reason || '', entry.evidenceRef || null, entry.llmConfidence ?? null, entry.mode, now, entry.decidedAt || null, entry.decidedBy || null);
    return map(getDatabase().prepare(`SELECT * FROM ${S}.fun_self_heal_audit WHERE id=?`).get(result.lastInsertRowid));
  }
  function listAudit({ runId, scopeKey, status, domain, action } = {}) { ensure(); let sql=`SELECT * FROM ${S}.fun_self_heal_audit WHERE 1=1`; const p=[]; for (const [column,value] of [['run_id',runId],['scope_key',scopeKey],['status',status],['domain',domain],['action',action]]) if (value) { sql+=` AND ${column}=?`; p.push(String(value)); } return getDatabase().prepare(`${sql} ORDER BY id DESC`).all(...p).map(map); }
  function listRuns({ domain, scopeKey, from, to } = {}) {
    ensure(); let sql = `SELECT run_id AS runId, scope_key AS scopeKey, domain, mode, MIN(created_at) AS startedAt, MAX(COALESCE(decided_at, created_at)) AS finishedAt, COUNT(*) AS itemsAudited, SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) AS applied, SUM(CASE WHEN status='pending_review' THEN 1 ELSE 0 END) AS pendingReview, SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected, SUM(CASE WHEN status='simulated' THEN 1 ELSE 0 END) AS simulated, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errors, 0 AS llmCalls, CASE WHEN SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) > 0 THEN 'error' ELSE 'done' END AS status FROM ${S}.fun_self_heal_audit WHERE 1=1`; const p = [];
    for (const [column, value] of [['domain', domain], ['scope_key', scopeKey]]) if (value) { sql += ` AND ${column}=?`; p.push(String(value)); }
    if (Number.isFinite(Number(from)) && Number(from) > 0) { sql += ' AND created_at>=?'; p.push(Number(from)); }
    if (Number.isFinite(Number(to)) && Number(to) > 0) { sql += ' AND created_at<=?'; p.push(Number(to)); }
    return getDatabase().prepare(`${sql} GROUP BY run_id, scope_key, domain, mode ORDER BY startedAt DESC`).all(...p);
  }
  function reviewFinding(id, { decision, adminJid, now = Date.now() } = {}) { ensure(); const status=decision === 'apply' ? 'applied' : decision === 'reject' ? 'rejected' : null; if (!status) return { ok:false, reason:'invalid-decision' }; const r=getDatabase().prepare(`UPDATE ${S}.fun_self_heal_audit SET status=?,decided_at=?,decided_by=? WHERE id=? AND status='pending_review'`).run(status, Number(now), `admin:${adminJid || ''}`, Number(id)); return r.changes ? { ok:true, finding:listAudit({}).find(x=>x.id===Number(id)) } : { ok:false, reason:'already-decided' }; }
  function getSummary() { ensure(); return getDatabase().prepare(`SELECT domain, status, COUNT(*) AS count FROM ${S}.fun_self_heal_audit GROUP BY domain, status`).all(); }
  return { insertAudit, listRuns, listAudit, reviewFinding, getSummary };
}
