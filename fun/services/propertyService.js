/**
 * Negócios — compra, tick de buffer, coletar, conserto, roubo no assalto.
 */

import {
  getProperty,
  listProperties,
  securityLabel,
} from '../shop/properties.js';

export function createPropertyService({
  repository,
  propertyRepository,
  random = Math.random,
} = {}) {
  function enabled(funConfig = {}) {
    return funConfig.propertiesEnabled !== false;
  }

  function tickMs(funConfig = {}) {
    return Math.max(
      60_000,
      Math.floor(Number(funConfig.propertyTickMs) || Number(funConfig.economyTickMs) || 15 * 60_000)
    );
  }

  function maxOwned(funConfig = {}) {
    return Math.max(1, Math.floor(Number(funConfig.propertyMaxOwned) || 2));
  }

  function minHealth(funConfig = {}) {
    return Math.max(0, Number(funConfig.propertyMinHealthToEarn) || 15);
  }

  function effectiveIncome(def, health, funConfig = {}) {
    const h = Number(health) || 0;
    if (h < minHealth(funConfig)) return 0;
    return Math.max(0, Math.floor(def.incomePerTick * (h / 100)));
  }

  function repairCost(def, health) {
    const missing = Math.max(0, 100 - (Number(health) || 0));
    if (missing <= 0) return 0;
    return Math.max(15, Math.floor(def.cost * 0.04 * (missing / 100)));
  }

  function listCatalog() {
    return listProperties();
  }

  function listOwned(scopeKey, userJid) {
    return propertyRepository.listByUser(scopeKey, userJid).map((row) => {
      const def = getProperty(row.propertyType);
      return { ...row, def };
    });
  }

  function buy({ userJid, scopeKey, propertyId, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const def = getProperty(propertyId);
    if (!def) return { ok: false, reason: 'unknown' };

    const existing = propertyRepository.getByUserType(scopeKey, userJid, def.id);
    if (existing) return { ok: false, reason: 'already-owned', def };

    const count = propertyRepository.countByUser(scopeKey, userJid);
    if (count >= maxOwned(funConfig)) {
      return { ok: false, reason: 'max-owned', max: maxOwned(funConfig), count };
    }

    const stats =
      repository.getUserStats(userJid, scopeKey) ||
      repository.ensureUserRow(userJid, scopeKey, now);
    const coins = Number(stats.coins) || 0;
    if (coins < def.cost) {
      return { ok: false, reason: 'no-coins', need: def.cost, coins };
    }

    repository.addCoins({
      userJid,
      scopeKey,
      amount: -def.cost,
      now,
      reason: `property-buy:${def.id}`,
    });

    const row = propertyRepository.insert({
      scopeKey,
      userJid,
      propertyType: def.id,
      health: 100,
      bufferCoins: 0,
      lastTickAt: now,
      now,
    });

    return {
      ok: true,
      property: row,
      def,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  /**
   * Acumula buffer para todas as props do scope (chamado no economy tick).
   * @returns {{ ticked: number, totalAdded: number }}
   */
  function tickScope(scopeKey, funConfig = {}, now = Date.now()) {
    if (!enabled(funConfig)) return { ticked: 0, totalAdded: 0 };
    const interval = tickMs(funConfig);
    const rows = propertyRepository.listByScope(scopeKey);
    let ticked = 0;
    let totalAdded = 0;
    for (const row of rows) {
      const def = getProperty(row.propertyType);
      if (!def) continue;
      const last = Number(row.lastTickAt) || 0;
      if (last > 0 && now - last < interval) continue;

      // quantos ticks cabem desde last (cap 4 pra não farmar offline infinito)
      const elapsed = last > 0 ? now - last : interval;
      const ticks = Math.min(4, Math.max(1, Math.floor(elapsed / interval)));
      const income = effectiveIncome(def, row.health, funConfig) * ticks;
      if (income <= 0) {
        propertyRepository.setBuffer(row.id, row.bufferCoins, now);
        ticked += 1;
        continue;
      }
      const next = Math.min(def.bufferCap, row.bufferCoins + income);
      const added = next - row.bufferCoins;
      propertyRepository.setBuffer(row.id, next, now);
      ticked += 1;
      totalAdded += added;
    }
    return { ticked, totalAdded };
  }

  function collect({ userJid, scopeKey, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const { total, details } = propertyRepository.collectAllBuffers(scopeKey, userJid);
    if (total <= 0) return { ok: false, reason: 'empty', total: 0 };

    repository.addCoins({
      userJid,
      scopeKey,
      amount: total,
      now,
      reason: 'property-collect',
    });

    return {
      ok: true,
      total,
      details,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function repair({ userJid, scopeKey, propertyId, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const def = getProperty(propertyId);
    if (!def) return { ok: false, reason: 'unknown' };
    const row = propertyRepository.getByUserType(scopeKey, userJid, def.id);
    if (!row) return { ok: false, reason: 'not-owned' };
    if (row.health >= 99.5) return { ok: false, reason: 'full-health', property: row, def };

    const cost = repairCost(def, row.health);
    const stats =
      repository.getUserStats(userJid, scopeKey) ||
      repository.ensureUserRow(userJid, scopeKey, now);
    if ((Number(stats.coins) || 0) < cost) {
      return { ok: false, reason: 'no-coins', need: cost, coins: stats.coins };
    }

    repository.addCoins({
      userJid,
      scopeKey,
      amount: -cost,
      now,
      reason: `property-repair:${def.id}`,
    });
    const updated = propertyRepository.setHealth(row.id, 100);
    return {
      ok: true,
      cost,
      property: updated,
      def,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  /**
   * No assalto PvP: rouba do buffer com maior steal potencial.
   * @returns {{ stolen: number, property: object|null, def: object|null, damage: number, source: 'buffer'|'none' }}
   */
  function robBuffer({ targetJid, scopeKey, maxWant = null, now = Date.now() }) {
    void now;
    const owned = propertyRepository.listByUser(scopeKey, targetJid);
    if (!owned.length) {
      return { stolen: 0, property: null, def: null, damage: 0, source: 'none' };
    }

    // escolhe prop com maior buffer * stealRatio
    let best = null;
    for (const row of owned) {
      if (row.bufferCoins <= 0) continue;
      const def = getProperty(row.propertyType);
      if (!def) continue;
      const pot = Math.floor(row.bufferCoins * def.stealRatio);
      if (!best || pot > best.pot) best = { row, def, pot };
    }
    if (!best || best.pot <= 0) {
      return { stolen: 0, property: null, def: null, damage: 0, source: 'none' };
    }

    const wantCap =
      maxWant != null ? Math.max(0, Math.floor(Number(maxWant) || 0)) : best.pot;
    const want = Math.min(best.pot, wantCap, best.row.bufferCoins);
    // variação 70–100% do want
    const steal = Math.max(
      1,
      Math.floor(want * (0.7 + random() * 0.3))
    );
    const taken = propertyRepository.takeFromBuffer(best.row.id, steal);
    const dmg =
      best.def.damageMin +
      Math.floor(random() * Math.max(1, best.def.damageMax - best.def.damageMin + 1));
    const damaged = propertyRepository.applyDamage(best.row.id, dmg);

    return {
      stolen: taken.taken || 0,
      property: damaged || best.row,
      def: best.def,
      damage: dmg,
      source: 'buffer',
    };
  }

  function totalBuffer(scopeKey, userJid) {
    return propertyRepository
      .listByUser(scopeKey, userJid)
      .reduce((s, r) => s + (r.bufferCoins || 0), 0);
  }

  function formatList(scopeKey, userJid, funConfig = {}) {
    const owned = listOwned(scopeKey, userJid);
    const catalog = listCatalog();
    const lines = ['🏪 *Negócios*', ''];

    if (owned.length) {
      lines.push('*Seus*');
      for (const o of owned) {
        const def = o.def;
        if (!def) continue;
        const earn = effectiveIncome(def, o.health, funConfig);
        lines.push(
          `${def.emoji} *${def.name}* · vida ${Math.round(o.health)}% · caixa *${o.bufferCoins}*c (cap ${def.bufferCap}) · +${earn}/tick`
        );
      }
      lines.push('');
    } else {
      lines.push('_Você ainda não tem negócio._', '');
    }

    lines.push('*Catálogo* · `/negocio comprar <id>`');
    for (const def of catalog) {
      const has = owned.some((o) => o.propertyType === def.id);
      lines.push(
        `${def.emoji} \`${def.id}\` *${def.name}* · *${def.cost}*c · +${def.incomePerTick}/tick · sec. ${securityLabel(def.security)}${has ? ' · _seu_' : ''}`
      );
    }
    lines.push(
      '',
      `_Máx ${maxOwned(funConfig)} negócios · \`/coletar\` saca o caixa · \`/negocio consertar <id>\`_`
    );
    return lines.join('\n');
  }

  return {
    enabled,
    listCatalog,
    listOwned,
    buy,
    tickScope,
    collect,
    repair,
    robBuffer,
    totalBuffer,
    formatList,
    effectiveIncome,
    repairCost,
    getProperty,
  };
}
