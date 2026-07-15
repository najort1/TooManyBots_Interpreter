import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

export function normalizeFactionNameKey(name = '') {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function mapFaction(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    scopeKey: String(row.scope_key || ''),
    name: String(row.name || ''),
    nameKey: String(row.name_key || ''),
    emoji: String(row.emoji || '🏴‍☠️'),
    leaderJid: String(row.leader_jid || ''),
    vaultCoins: Number(row.vault_coins) || 0,
    motto: String(row.motto || ''),
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function createFunFactionRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getById(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_factions WHERE id = ?`)
      .get(String(id || ''));
    return mapFaction(row);
  }

  function getByName(scopeKey, name) {
    ensureSchema();
    const key = normalizeFactionNameKey(name);
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_factions
         WHERE scope_key = ? AND name_key = ?`
      )
      .get(String(scopeKey || ''), key);
    return mapFaction(row);
  }

  function listByScope(scopeKey) {
    ensureSchema();
    return getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_factions
         WHERE scope_key = ?
         ORDER BY vault_coins DESC, created_at ASC`
      )
      .all(String(scopeKey || ''))
      .map(mapFaction);
  }

  function getMember(scopeKey, userJid) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_faction_members
         WHERE scope_key = ? AND user_jid = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''));
    if (!row) return null;
    return {
      scopeKey: String(row.scope_key || ''),
      userJid: String(row.user_jid || ''),
      factionId: String(row.faction_id || ''),
      role: String(row.role || 'member'),
      joinedAt: Number(row.joined_at) || 0,
    };
  }

  function listMembers(factionId) {
    ensureSchema();
    return getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_faction_members
         WHERE faction_id = ?
         ORDER BY joined_at ASC`
      )
      .all(String(factionId || ''))
      .map(row => ({
        scopeKey: String(row.scope_key || ''),
        userJid: String(row.user_jid || ''),
        factionId: String(row.faction_id || ''),
        role: String(row.role || 'member'),
        joinedAt: Number(row.joined_at) || 0,
      }));
  }

  function countMembers(factionId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS c FROM ${ANALYTICS_SCHEMA}.fun_faction_members
         WHERE faction_id = ?`
      )
      .get(String(factionId || ''));
    return Number(row?.c) || 0;
  }

  function createFaction({
    scopeKey,
    name,
    leaderJid,
    emoji = '🏴‍☠️',
    motto = '',
    now = Date.now(),
  }) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '').trim();
    const display = String(name || '').trim().slice(0, 32);
    const key = normalizeFactionNameKey(display);
    const leader = String(leaderJid || '').trim();
    const ts = Number(now) || Date.now();
    if (!s || !display || !key || !leader) return { ok: false, reason: 'invalid' };

    if (getByName(s, display)) return { ok: false, reason: 'name-taken' };
    if (getMember(s, leader)) return { ok: false, reason: 'already-in-faction' };

    const id = randomUUID();
    const run = db.transaction(() => {
      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_factions
         (id, scope_key, name, name_key, emoji, leader_jid, vault_coins, motto, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(id, s, display, key, String(emoji || '🏴‍☠️').slice(0, 8), leader, String(motto || '').slice(0, 80), ts, ts);

      db.prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_faction_members
         (scope_key, user_jid, faction_id, role, joined_at)
         VALUES (?, ?, ?, 'leader', ?)`
      ).run(s, leader, id, ts);
    });
    run();
    return { ok: true, faction: getById(id) };
  }

  function joinFaction({ scopeKey, userJid, factionId, maxMembers = 8, now = Date.now() }) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '').trim();
    const u = String(userJid || '').trim();
    const f = String(factionId || '').trim();
    if (!s || !u || !f) return { ok: false, reason: 'invalid' };
    if (getMember(s, u)) return { ok: false, reason: 'already-in-faction' };
    const fac = getById(f);
    if (!fac || fac.scopeKey !== s) return { ok: false, reason: 'not-found' };
    if (countMembers(f) >= maxMembers) return { ok: false, reason: 'full' };

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_faction_members
       (scope_key, user_jid, faction_id, role, joined_at)
       VALUES (?, ?, ?, 'member', ?)`
    ).run(s, u, f, Number(now) || Date.now());
    return { ok: true, faction: fac };
  }

  function leaveFaction({ scopeKey, userJid }) {
    ensureSchema();
    const db = getDatabase();
    const s = String(scopeKey || '').trim();
    const u = String(userJid || '').trim();
    const member = getMember(s, u);
    if (!member) return { ok: false, reason: 'not-in-faction' };
    const fac = getById(member.factionId);
    if (!fac) return { ok: false, reason: 'not-found' };

    const run = db.transaction(() => {
      db.prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_faction_members
         WHERE scope_key = ? AND user_jid = ?`
      ).run(s, u);

      const remaining = countMembers(member.factionId);
      if (remaining === 0) {
        db.prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_factions WHERE id = ?`).run(member.factionId);
        return { dissolved: true, wasLeader: member.role === 'leader' };
      }

      if (member.role === 'leader') {
        const next = listMembers(member.factionId)[0];
        if (next) {
          db.prepare(
            `UPDATE ${ANALYTICS_SCHEMA}.fun_faction_members SET role = 'leader'
             WHERE scope_key = ? AND user_jid = ?`
          ).run(s, next.userJid);
          db.prepare(
            `UPDATE ${ANALYTICS_SCHEMA}.fun_factions SET leader_jid = ?, updated_at = ?
             WHERE id = ?`
          ).run(next.userJid, Date.now(), member.factionId);
        }
      }
      return { dissolved: false, wasLeader: member.role === 'leader' };
    });

    const meta = run();
    return { ok: true, faction: fac, ...meta };
  }

  function donateToVault({ scopeKey, userJid, amount, now = Date.now() }) {
    ensureSchema();
    const member = getMember(scopeKey, userJid);
    if (!member) return { ok: false, reason: 'not-in-faction' };
    const value = Math.floor(Number(amount) || 0);
    if (value <= 0) return { ok: false, reason: 'invalid-amount' };

    const db = getDatabase();
    db.prepare(
      `UPDATE ${ANALYTICS_SCHEMA}.fun_factions
       SET vault_coins = vault_coins + ?, updated_at = ?
       WHERE id = ?`
    ).run(value, Number(now) || Date.now(), member.factionId);

    return { ok: true, faction: getById(member.factionId), amount: value };
  }

  function getUserFaction(scopeKey, userJid) {
    const member = getMember(scopeKey, userJid);
    if (!member) return null;
    const faction = getById(member.factionId);
    if (!faction) return null;
    return { member, faction };
  }

  return {
    getById,
    getByName,
    listByScope,
    getMember,
    listMembers,
    countMembers,
    createFaction,
    joinFaction,
    leaveFaction,
    donateToVault,
    getUserFaction,
    normalizeFactionNameKey,
  };
}
