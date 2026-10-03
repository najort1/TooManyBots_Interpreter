import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createFunBountyRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function createBounty({
    scopeKey,
    issuerJid,
    targetJid,
    bountyAmount,
    reason = '',
    ttlMs = 7 * 24 * 60 * 60 * 1000,
    now = Date.now(),
  }) {
    ensureSchema();
    const id = `bounty_${randomUUID().slice(0, 8)}`;
    const s = String(scopeKey || '').trim();
    const issuer = String(issuerJid || '').trim();
    const target = String(targetJid || '').trim();
    const amount = Math.max(1, Math.floor(Number(bountyAmount) || 0));
    const expiresAt = now + ttlMs;

    const db = getDatabase();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_bounties
       (id, scope_key, issuer_jid, target_jid, bounty_amount, status, reason, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`
    ).run(id, s, issuer, target, amount, String(reason || ''), expiresAt, now);

    return getBounty(id);
  }

  function getBounty(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_bounties WHERE id = ?`)
      .get(String(id || ''));

    if (!row) return null;
    return {
      id: String(row.id || ''),
      scopeKey: String(row.scope_key || ''),
      issuerJid: String(row.issuer_jid || ''),
      targetJid: String(row.target_jid || ''),
      bountyAmount: Number(row.bounty_amount) || 0,
      status: String(row.status || 'open'),
      claimedByJid: String(row.claimed_by_jid || ''),
      reason: String(row.reason || ''),
      expiresAt: Number(row.expires_at) || 0,
      createdAt: Number(row.created_at) || 0,
      resolvedAt: Number(row.resolved_at) || 0,
    };
  }

  function getActiveBountiesForTarget(scopeKey, targetJid, now = Date.now()) {
    ensureSchema();
    const s = String(scopeKey || '').trim();
    const target = String(targetJid || '').trim();
    return getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_bounties
         WHERE scope_key = ? AND target_jid = ? AND status = 'open' AND expires_at > ?
         ORDER BY bounty_amount DESC`
      )
      .all(s, target, now)
      .map((row) => ({
        id: String(row.id || ''),
        scopeKey: String(row.scope_key || ''),
        issuerJid: String(row.issuer_jid || ''),
        targetJid: String(row.target_jid || ''),
        bountyAmount: Number(row.bounty_amount) || 0,
        status: String(row.status || 'open'),
        claimedByJid: String(row.claimed_by_jid || ''),
        reason: String(row.reason || ''),
        expiresAt: Number(row.expires_at) || 0,
        createdAt: Number(row.created_at) || 0,
        resolvedAt: Number(row.resolved_at) || 0,
      }));
  }

  function listActiveBounties(scopeKey, limit = 10, now = Date.now()) {
    ensureSchema();
    const s = String(scopeKey || '').trim();
    return getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_bounties
         WHERE scope_key = ? AND status = 'open' AND expires_at > ?
         ORDER BY bounty_amount DESC, created_at DESC
         LIMIT ?`
      )
      .all(s, now, Math.max(1, limit))
      .map((row) => ({
        id: String(row.id || ''),
        scopeKey: String(row.scope_key || ''),
        issuerJid: String(row.issuer_jid || ''),
        targetJid: String(row.target_jid || ''),
        bountyAmount: Number(row.bounty_amount) || 0,
        status: String(row.status || 'open'),
        claimedByJid: String(row.claimed_by_jid || ''),
        reason: String(row.reason || ''),
        expiresAt: Number(row.expires_at) || 0,
        createdAt: Number(row.created_at) || 0,
        resolvedAt: Number(row.resolved_at) || 0,
      }));
  }

  function claimBounty({ id, claimedByJid, now = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const res = db
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_bounties
         SET status = 'claimed', claimed_by_jid = ?, resolved_at = ?
         WHERE id = ? AND status = 'open'`
      )
      .run(String(claimedByJid || ''), now, String(id || ''));

    return res.changes > 0;
  }

  function cancelBounty({ id, now = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const res = db
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_bounties
         SET status = 'cancelled', resolved_at = ?
         WHERE id = ? AND status = 'open'`
      )
      .run(now, String(id || ''));

    return res.changes > 0;
  }

  return {
    createBounty,
    getBounty,
    getActiveBountiesForTarget,
    listActiveBounties,
    claimBounty,
    cancelBounty,
  };
}
