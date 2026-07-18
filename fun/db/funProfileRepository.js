/**
 * Perfis sociais por grupo (nick, bio, niver, título).
 */

import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapProfile(row) {
  if (!row) {
    return {
      userJid: '',
      scopeKey: '',
      nickname: '',
      bio: '',
      birthdayMd: '',
      title: '',
      extras: '',
      rawNote: '',
      updatedAt: 0,
      empty: true,
    };
  }
  const nickname = String(row.nickname || '').trim();
  const bio = String(row.bio || '').trim();
  const birthdayMd = String(row.birthday_md || '').trim();
  const title = String(row.title || '').trim();
  // raw_note guarda "extras" (resto da fofoca do /perfil set)
  const extras = String(row.raw_note || '').trim();
  return {
    userJid: String(row.user_jid || ''),
    scopeKey: String(row.scope_key || ''),
    nickname,
    bio,
    birthdayMd,
    title,
    extras,
    rawNote: extras,
    updatedAt: Number(row.updated_at) || 0,
    empty: !nickname && !bio && !birthdayMd && !title && !extras,
  };
}

export function createFunProfileRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getProfile(userJid, scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_profiles
         WHERE user_jid = ? AND scope_key = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''));
    if (!row) {
      return mapProfile({
        user_jid: userJid,
        scope_key: scopeKey,
      });
    }
    return mapProfile(row);
  }

  function getNickname(userJid, scopeKey) {
    const p = getProfile(userJid, scopeKey);
    return p.nickname || '';
  }

  /**
   * Batch nicknames for rank/labels: Map jid → nick
   */
  function getNicknamesForScope(scopeKey, userJids = []) {
    ensureSchema();
    const scope = String(scopeKey || '');
    const jids = [...new Set((userJids || []).map(String).filter(Boolean))];
    if (!scope || !jids.length) return new Map();
    const placeholders = jids.map(() => '?').join(',');
    const rows = getDatabase()
      .prepare(
        `SELECT user_jid, nickname FROM ${ANALYTICS_SCHEMA}.fun_user_profiles
         WHERE scope_key = ? AND user_jid IN (${placeholders})
           AND TRIM(nickname) != ''`
      )
      .all(scope, ...jids);
    const map = new Map();
    for (const r of rows) {
      map.set(String(r.user_jid), String(r.nickname || '').trim());
    }
    return map;
  }

  /**
   * Upsert com merge: undefined = não mexe; string (inclui '') = seta.
   */
  function upsertProfile({
    userJid,
    scopeKey,
    nickname,
    bio,
    birthdayMd,
    title,
    extras,
    rawNote,
    now = Date.now(),
  } = {}) {
    ensureSchema();
    const u = String(userJid || '').trim();
    const s = String(scopeKey || '').trim();
    const ts = Number(now) || Date.now();
    if (!u || !s) return { ok: false, reason: 'invalid-identity' };

    const current = getProfile(u, s);
    const extrasIn =
      extras !== undefined ? extras : rawNote !== undefined ? rawNote : undefined;
    const next = {
      nickname: nickname !== undefined ? String(nickname || '').trim() : current.nickname,
      bio: bio !== undefined ? String(bio || '').trim() : current.bio,
      birthdayMd:
        birthdayMd !== undefined ? String(birthdayMd || '').trim() : current.birthdayMd,
      title: title !== undefined ? String(title || '').trim() : current.title,
      extras:
        extrasIn !== undefined
          ? String(extrasIn || '').trim().slice(0, 500)
          : current.extras || current.rawNote || '',
    };

    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_profiles
         (user_jid, scope_key, nickname, bio, birthday_md, title, raw_note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_jid, scope_key) DO UPDATE SET
           nickname = excluded.nickname,
           bio = excluded.bio,
           birthday_md = excluded.birthday_md,
           title = excluded.title,
           raw_note = excluded.raw_note,
           updated_at = excluded.updated_at`
      )
      .run(
        u,
        s,
        next.nickname.slice(0, 48),
        next.bio.slice(0, 200),
        next.birthdayMd.slice(0, 5),
        next.title.slice(0, 32),
        next.extras,
        ts
      );

    return { ok: true, profile: getProfile(u, s), previous: current };
  }

  function clearProfile(userJid, scopeKey, now = Date.now()) {
    return upsertProfile({
      userJid,
      scopeKey,
      nickname: '',
      bio: '',
      birthdayMd: '',
      title: '',
      extras: '',
      now,
    });
  }

  function deleteProfile(userJid, scopeKey) {
    ensureSchema();
    const r = getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_user_profiles
         WHERE user_jid = ? AND scope_key = ?`
      )
      .run(String(userJid || ''), String(scopeKey || ''));
    return r.changes || 0;
  }

  function listBirthdaysOn(scopeKey, birthdayMd) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_profiles
         WHERE scope_key = ? AND birthday_md = ? AND TRIM(birthday_md) != ''`
      )
      .all(String(scopeKey || ''), String(birthdayMd || ''));
    return rows.map(mapProfile);
  }

  function wasBirthdayAnnounced(scopeKey, userJid, year) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT 1 AS ok FROM ${ANALYTICS_SCHEMA}.fun_birthday_announced
         WHERE scope_key = ? AND user_jid = ? AND year = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''), Number(year) || 0);
    return Boolean(row);
  }

  function markBirthdayAnnounced(scopeKey, userJid, year, now = Date.now()) {
    ensureSchema();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_birthday_announced
         (scope_key, user_jid, year, announced_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_key, user_jid, year) DO UPDATE SET
           announced_at = excluded.announced_at`
      )
      .run(
        String(scopeKey || ''),
        String(userJid || ''),
        Number(year) || 0,
        Number(now) || Date.now()
      );
  }

  return {
    getProfile,
    getNickname,
    getNicknamesForScope,
    upsertProfile,
    clearProfile,
    deleteProfile,
    listBirthdaysOn,
    wasBirthdayAnnounced,
    markBirthdayAnnounced,
  };
}
