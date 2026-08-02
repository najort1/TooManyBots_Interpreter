import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

const GRANULAR_EVENTS = [
  'journal_auto_enabled',
  'market_auto_enabled',
  'happy_hour_auto_enabled',
  'chaos_auto_enabled',
  'weekly_restock_auto_enabled',
];

function resolveGranular(value, fallback) {
  return value === undefined || value === null ? fallback : Number(value) !== 0;
}

function mapGroupRow(row) {
  if (!row) return null;
  const worldEventsEnabled =
    row.world_events_enabled === undefined || row.world_events_enabled === null
      ? true
      : Number(row.world_events_enabled) !== 0;
  const base = {
    groupJid: String(row.group_jid || ''),
    enabled: Number(row.enabled) !== 0,
    xpMin: Number(row.xp_min) || 15,
    xpMax: Number(row.xp_max) || 25,
    cooldownMs: Number(row.cooldown_ms) || 60_000,
    levelUpAnnounce: Number(row.level_up_announce) !== 0,
    dailyXp: Number(row.daily_xp) || 150,
    dailyCoins: Number(row.daily_coins) || 50,
    rankLimit: Number(row.rank_limit) || 10,
    worldEventsEnabled,
    personaEnabled:
      row.persona_enabled === undefined || row.persona_enabled === null
        ? true
        : Number(row.persona_enabled) !== 0,
    permitirNsfw: Number(row.permitir_nsfw ?? 0) !== 0,
    updatedAt: Number(row.updated_at) || 0,
  };
  for (const col of GRANULAR_EVENTS) {
    const key = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    base[key] = resolveGranular(row[col], worldEventsEnabled);
  }
  return base;
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

    // Default ligado (FR-012); só desliga se explícito false/0
    let personaEnabled = 1;
    if (input.personaEnabled === false || input.personaEnabled === 0) {
      personaEnabled = 0;
    } else if (input.personaEnabled === true || input.personaEnabled === 1) {
      personaEnabled = 1;
    } else if (existing) {
      personaEnabled = existing.personaEnabled ? 1 : 0;
    }

    let permitirNsfw = 0;
    if (input.permitirNsfw === true || input.permitirNsfw === 1) {
      permitirNsfw = 1;
    } else if (existing) {
      permitirNsfw = existing.permitirNsfw ? 1 : 0;
    }

    const granularCols = {};
    for (const col of GRANULAR_EVENTS) {
      const key = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      let val = 1;
      if (input[key] === false || input[key] === 0) {
        val = 0;
      } else if (input[key] === true || input[key] === 1) {
        val = 1;
      } else if (existing && existing[key] !== undefined) {
        val = existing[key] ? 1 : 0;
      } else {
        val = worldEventsEnabled;
      }
      granularCols[col] = val;
    }

    const updatedAt = Date.now();

    const columns = [
      'group_jid', 'enabled', 'xp_min', 'xp_max', 'cooldown_ms', 'level_up_announce',
      'daily_xp', 'daily_coins', 'rank_limit', 'world_events_enabled', 'persona_enabled',
      'permitir_nsfw',
      ...GRANULAR_EVENTS,
      'updated_at',
    ];
    const placeholders = columns.map(() => '?').join(', ');
    const setClauses = columns.map((c) => `${c} = excluded.${c}`).join(',\n        ');

    db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_settings (
        ${columns.join(', ')}
      ) VALUES (${placeholders})
      ON CONFLICT(group_jid) DO UPDATE SET
        ${setClauses}`
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
      personaEnabled,
      permitirNsfw,
      ...GRANULAR_EVENTS.map((col) => granularCols[col]),
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
        personaEnabled: true,
        permitirNsfw: false,
        journalAutoEnabled: true,
        marketAutoEnabled: true,
        happyHourAutoEnabled: true,
        chaosAutoEnabled: true,
        weeklyRestockAutoEnabled: true,
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
      personaEnabled: saved.personaEnabled !== false,
      permitirNsfw: saved.permitirNsfw === true,
      journalAutoEnabled: saved.journalAutoEnabled !== false,
      marketAutoEnabled: saved.marketAutoEnabled !== false,
      happyHourAutoEnabled: saved.happyHourAutoEnabled !== false,
      chaosAutoEnabled: saved.chaosAutoEnabled !== false,
      weeklyRestockAutoEnabled: saved.weeklyRestockAutoEnabled !== false,
      source: 'group',
    };
  }

  /** true se o grupo pode receber eventos aleatórios do mundo. */
  function isWorldEventsEnabled(groupJid, funConfig = {}) {
    const rates = resolveEffectiveRates(groupJid, funConfig);
    return rates.worldEventsEnabled !== false;
  }

  /**
   * Retorna o estado de cada evento autônomo granular para o grupo.
   * @returns {{ journalAutoEnabled, marketAutoEnabled, happyHourAutoEnabled, chaosAutoEnabled, weeklyRestockAutoEnabled }}
   */
  function getGranularWorldEvents(groupJid, funConfig = {}) {
    const rates = resolveEffectiveRates(groupJid, funConfig);
    return {
      journalAutoEnabled: rates.journalAutoEnabled !== false,
      marketAutoEnabled: rates.marketAutoEnabled !== false,
      happyHourAutoEnabled: rates.happyHourAutoEnabled !== false,
      chaosAutoEnabled: rates.chaosAutoEnabled !== false,
      weeklyRestockAutoEnabled: rates.weeklyRestockAutoEnabled !== false,
    };
  }

  /**
   * Verifica se um tipo específico de evento autônomo está habilitado no grupo.
   * @param {string} groupJid
   * @param {'journal'|'market'|'happyHour'|'chaos'|'weeklyRestock'} eventType
   * @param {object} [funConfig={}]
   * @returns {boolean}
   */
  function isGranularEventEnabled(groupJid, eventType, funConfig = {}) {
    const granular = getGranularWorldEvents(groupJid, funConfig);
    const keyMap = {
      journal: 'journalAutoEnabled',
      market: 'marketAutoEnabled',
      happyHour: 'happyHourAutoEnabled',
      chaos: 'chaosAutoEnabled',
      weeklyRestock: 'weeklyRestockAutoEnabled',
    };
    const key = keyMap[eventType];
    if (!key) return true;
    return granular[key] !== false;
  }

  return {
    getGroupSettings,
    listGroupSettings,
    upsertGroupSettings,
    deleteGroupSettings,
    resolveEffectiveRates,
    isWorldEventsEnabled,
    getGranularWorldEvents,
    isGranularEventEnabled,
  };
}
