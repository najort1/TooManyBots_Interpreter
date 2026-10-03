import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createFunBondRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function normalizePair(u1, u2) {
    const a = String(u1 || '').trim();
    const b = String(u2 || '').trim();
    if (!a || !b) return { userA: a, userB: b };
    return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
  }

  function getBond(scopeKey, u1, u2) {
    ensureSchema();
    const { userA, userB } = normalizePair(u1, u2);
    const s = String(scopeKey || '').trim();
    if (!s || !userA || !userB) return null;

    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_social_bonds
         WHERE scope_key = ? AND user_a = ? AND user_b = ?`
      )
      .get(s, userA, userB);

    if (!row) {
      return {
        scopeKey: s,
        userA,
        userB,
        affection: 0,
        rivalry: 0,
        intimacy: 0,
        chaos: 0,
        archetype: 'strangers',
        lastAction: '',
        lastActorJid: '',
        dailyPointsAcc: 0,
        lastInteractionAt: 0,
        lastDecayAt: 0,
        interactionsCount: 0,
        flags: {},
        updatedAt: 0,
        isNew: true,
      };
    }

    let flags = {};
    try {
      flags = JSON.parse(row.flags_json || '{}');
    } catch {
      flags = {};
    }

    return {
      scopeKey: String(row.scope_key || ''),
      userA: String(row.user_a || ''),
      userB: String(row.user_b || ''),
      affection: Number(row.affection) || 0,
      rivalry: Number(row.rivalry) || 0,
      intimacy: Number(row.intimacy) || 0,
      chaos: Number(row.chaos) || 0,
      archetype: String(row.archetype || 'strangers'),
      lastAction: String(row.last_action || ''),
      lastActorJid: String(row.last_actor_jid || ''),
      dailyPointsAcc: Number(row.daily_points_acc) || 0,
      lastInteractionAt: Number(row.last_interaction_at) || 0,
      lastDecayAt: Number(row.last_decay_at) || 0,
      interactionsCount: Number(row.interactions_count) || 0,
      flags,
      updatedAt: Number(row.updated_at) || 0,
      isNew: false,
    };
  }

  function saveBond(bond) {
    ensureSchema();
    const { userA, userB } = normalizePair(bond.userA, bond.userB);
    const s = String(bond.scopeKey || '').trim();
    const now = Number(bond.updatedAt) || Date.now();
    const flagsJson = JSON.stringify(bond.flags || {});

    const db = getDatabase();
    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_social_bonds
       (scope_key, user_a, user_b, affection, rivalry, intimacy, chaos, archetype,
        last_action, last_actor_jid, daily_points_acc, last_interaction_at,
        last_decay_at, interactions_count, flags_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_key, user_a, user_b) DO UPDATE SET
         affection = excluded.affection,
         rivalry = excluded.rivalry,
         intimacy = excluded.intimacy,
         chaos = excluded.chaos,
         archetype = excluded.archetype,
         last_action = excluded.last_action,
         last_actor_jid = excluded.last_actor_jid,
         daily_points_acc = excluded.daily_points_acc,
         last_interaction_at = excluded.last_interaction_at,
         last_decay_at = excluded.last_decay_at,
         interactions_count = excluded.interactions_count,
         flags_json = excluded.flags_json,
         updated_at = excluded.updated_at`
    ).run(
      s,
      userA,
      userB,
      Number(bond.affection) || 0,
      Number(bond.rivalry) || 0,
      Number(bond.intimacy) || 0,
      Number(bond.chaos) || 0,
      String(bond.archetype || 'strangers'),
      String(bond.lastAction || ''),
      String(bond.lastActorJid || ''),
      Number(bond.dailyPointsAcc) || 0,
      Number(bond.lastInteractionAt) || 0,
      Number(bond.lastDecayAt) || 0,
      Number(bond.interactionsCount) || 0,
      flagsJson,
      now
    );

    return getBond(s, userA, userB);
  }

  function upsertBondRaw(raw) {
    return saveBond({
      scopeKey: raw.scopeKey,
      userA: raw.userA,
      userB: raw.userB,
      affection: raw.affection,
      rivalry: raw.rivalry,
      intimacy: raw.intimacy,
      chaos: raw.chaos,
      archetype: raw.archetype || 'strangers',
      lastAction: raw.lastAction || '',
      lastActorJid: raw.lastActorJid || '',
      dailyPointsAcc: raw.dailyPointsAcc || 0,
      lastInteractionAt: raw.lastInteractionAt || 0,
      lastDecayAt: raw.lastDecayAt || 0,
      interactionsCount: raw.interactionsCount || 0,
      flags: raw.flags || {},
      updatedAt: raw.updatedAt || Date.now(),
    });
  }

  function listBondsForUser(scopeKey, userJid, limit = 20) {
    ensureSchema();
    const s = String(scopeKey || '').trim();
    const u = String(userJid || '').trim();
    if (!s || !u) return [];

    const db = getDatabase();
    return db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_social_bonds
         WHERE scope_key = ? AND (user_a = ? OR user_b = ?)
         ORDER BY (affection + rivalry + intimacy + chaos) DESC
         LIMIT ?`
      )
      .all(s, u, u, Math.max(1, limit))
      .map((row) => ({
        scopeKey: String(row.scope_key || ''),
        userA: String(row.user_a || ''),
        userB: String(row.user_b || ''),
        affection: Number(row.affection) || 0,
        rivalry: Number(row.rivalry) || 0,
        intimacy: Number(row.intimacy) || 0,
        chaos: Number(row.chaos) || 0,
        archetype: String(row.archetype || 'strangers'),
        interactionsCount: Number(row.interactions_count) || 0,
        lastInteractionAt: Number(row.last_interaction_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
      }));
  }

  function listTopBonds(scopeKey, limit = 10) {
    ensureSchema();
    const s = String(scopeKey || '').trim();
    if (!s) return [];

    const db = getDatabase();
    return db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_social_bonds
         WHERE scope_key = ? AND interactions_count > 0
         ORDER BY (affection + rivalry + intimacy + chaos) DESC
         LIMIT ?`
      )
      .all(s, Math.max(1, limit))
      .map((row) => ({
        scopeKey: String(row.scope_key || ''),
        userA: String(row.user_a || ''),
        userB: String(row.user_b || ''),
        affection: Number(row.affection) || 0,
        rivalry: Number(row.rivalry) || 0,
        intimacy: Number(row.intimacy) || 0,
        chaos: Number(row.chaos) || 0,
        archetype: String(row.archetype || 'strangers'),
        interactionsCount: Number(row.interactions_count) || 0,
        lastInteractionAt: Number(row.last_interaction_at) || 0,
        updatedAt: Number(row.updated_at) || 0,
      }));
  }

  return {
    normalizePair,
    getBond,
    saveBond,
    upsertBondRaw,
    listBondsForUser,
    listTopBonds,
  };
}
