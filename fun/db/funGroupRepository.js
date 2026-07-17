import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapGroupRow(row) {
  if (!row) return null;
  return {
    groupJid: String(row.group_jid || ''),
    enabled: Number(row.enabled) !== 0,
    xpMin: Number(row.xp_min) || 15,
    xpMax: Number(row.xp_max) || 25,
    cooldownMs: Number(row.cooldown_ms) || 60_000,
    levelUpAnnounce: Number(row.level_up_announce) !== 0,
    dailyXp: Number(row.daily_xp) || 150,
    dailyCoins: Number(row.daily_coins) || 50,
    rankLimit: Number(row.rank_limit) || 10,
    /** Eventos aleatórios do mundo (mercado auto + trégua). Happy hour continua. Default: ligado. */
    worldEventsEnabled:
      row.world_events_enabled === undefined || row.world_events_enabled === null
        ? true
        : Number(row.world_events_enabled) !== 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function createFunGroupRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getGroupSettings(groupJid) {
    ensureSchema();
    const db = getDatabase();
    const row = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_settings WHERE group_jid = ?`
      )
      .get(String(groupJid || ''));
    return mapGroupRow(row);
  }

  function listGroupSettings() {
    ensureSchema();
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_settings ORDER BY group_jid ASC`
      )
      .all();
    return rows.map(mapGroupRow);
  }

  function upsertGroupSettings(input = {}) {
    ensureSchema();
    const db = getDatabase();
    const groupJid = String(input.groupJid || '').trim();
    if (!groupJid.endsWith('@g.us')) {
      throw new Error('groupJid invalido');
    }

    const existing = getGroupSettings(groupJid);

    let xpMin = Math.max(1, Math.floor(Number(input.xpMin) || existing?.xpMin || 15));
    let xpMax = Math.max(1, Math.floor(Number(input.xpMax) || existing?.xpMax || 25));
    if (xpMax < xpMin) {
      const t = xpMin;
      xpMin = xpMax;
      xpMax = t;
    }

    const enabled =
      input.enabled === false || input.enabled === 0
        ? 0
        : input.enabled === true || input.enabled === 1
          ? 1
          : existing
            ? existing.enabled
              ? 1
              : 0
            : 1;

    const cooldownMs = Math.max(
      0,
      Math.floor(Number(input.cooldownMs ?? existing?.cooldownMs ?? 60_000) || 0)
    );
    const levelUpAnnounce =
      input.levelUpAnnounce === false || input.levelUpAnnounce === 0
        ? 0
        : input.levelUpAnnounce === true || input.levelUpAnnounce === 1
          ? 1
          : existing
            ? existing.levelUpAnnounce
              ? 1
              : 0
            : 1;
    const dailyXp = Math.max(
      0,
      Math.floor(Number(input.dailyXp ?? existing?.dailyXp ?? 150) || 0)
    );
    const dailyCoins = Math.max(
      0,
      Math.floor(Number(input.dailyCoins ?? existing?.dailyCoins ?? 50) || 0)
    );
    const rankLimit = Math.min(
      50,
      Math.max(1, Math.floor(Number(input.rankLimit ?? existing?.rankLimit ?? 10) || 10))
    );

    // Default ligado; só desliga se explícito false/0
    let worldEventsEnabled = 1;
    if (input.worldEventsEnabled === false || input.worldEventsEnabled === 0) {
      worldEventsEnabled = 0;
    } else if (input.worldEventsEnabled === true || input.worldEventsEnabled === 1) {
      worldEventsEnabled = 1;
    } else if (existing) {
      worldEventsEnabled = existing.worldEventsEnabled ? 1 : 0;
    }

    const updatedAt = Date.now();

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_settings (
        group_jid, enabled, xp_min, xp_max, cooldown_ms, level_up_announce,
        daily_xp, daily_coins, rank_limit, world_events_enabled, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(group_jid) DO UPDATE SET
        enabled = excluded.enabled,
        xp_min = excluded.xp_min,
        xp_max = excluded.xp_max,
        cooldown_ms = excluded.cooldown_ms,
        level_up_announce = excluded.level_up_announce,
        daily_xp = excluded.daily_xp,
        daily_coins = excluded.daily_coins,
        rank_limit = excluded.rank_limit,
        world_events_enabled = excluded.world_events_enabled,
        updated_at = excluded.updated_at`
    ).run(
      groupJid,
      enabled,
      xpMin,
      xpMax,
      cooldownMs,
      levelUpAnnounce,
      dailyXp,
      dailyCoins,
      rankLimit,
      worldEventsEnabled,
      updatedAt
    );

    return getGroupSettings(groupJid);
  }

  function deleteGroupSettings(groupJid) {
    ensureSchema();
    const db = getDatabase();
    db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_settings WHERE group_jid = ?`
    ).run(String(groupJid || ''));
  }

  /**
   * Resolve taxas efetivas: override por grupo, senão defaults da config global.
   */
  function resolveEffectiveRates(groupJid, funConfig = {}) {
    const saved = getGroupSettings(groupJid);
    if (!saved) {
      return {
        enabled: true,
        xpMin: funConfig.xpMin ?? 15,
        xpMax: funConfig.xpMax ?? 25,
        cooldownMs: funConfig.cooldownMs ?? 60_000,
        levelUpAnnounce: funConfig.announceLevelUp !== false,
        dailyXp: funConfig.dailyXp ?? 150,
        dailyCoins: funConfig.dailyCoins ?? 50,
        rankLimit: funConfig.rankLimit ?? 10,
        worldEventsEnabled: true,
        source: 'global',
      };
    }
    return {
      enabled: saved.enabled,
      xpMin: saved.xpMin,
      xpMax: saved.xpMax,
      cooldownMs: saved.cooldownMs,
      levelUpAnnounce: saved.levelUpAnnounce,
      dailyXp: saved.dailyXp,
      dailyCoins: saved.dailyCoins,
      rankLimit: saved.rankLimit,
      worldEventsEnabled: saved.worldEventsEnabled !== false,
      source: 'group',
    };
  }

  /** true se o grupo pode receber eventos aleatórios do mundo. */
  function isWorldEventsEnabled(groupJid, funConfig = {}) {
    const rates = resolveEffectiveRates(groupJid, funConfig);
    return rates.worldEventsEnabled !== false;
  }

  return {
    getGroupSettings,
    listGroupSettings,
    upsertGroupSettings,
    deleteGroupSettings,
    resolveEffectiveRates,
    isWorldEventsEnabled,
  };
}
