import { getDb } from '../../db/context.js';
import {
  CAR_CATALOG,
  CAR_CATALOG_REVISION,
  calculateCarCustomizationQuote,
  validateCarCustomization,
} from '../../shared/car/domain.js';
import { hashCarOperation } from '../db/funCarRepository.js';
import { renderCarPng, buildCarSvg } from './carRenderer.js';

const ANALYTICS_SCHEMA = 'analytics';

export function createCarService({
  repository,
  carRepository,
  marketRepository = null,
  getDatabase = getDb,
  sharp = null,
} = {}) {
  if (!carRepository) throw new Error('[fun/car] carRepository obrigatório');

  function db() {
    return getDatabase();
  }

  function stats(scopeKey, userJid, now = Date.now()) {
    if (repository?.getUserStats) {
      return repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
    }
    const row = db()
      .prepare(
        `SELECT coins, level FROM ${ANALYTICS_SCHEMA}.fun_user_stats
         WHERE user_jid = ? AND scope_key = ?`
      )
      .get(String(userJid || ''), String(scopeKey || ''));
    return {
      coins: Number(row?.coins) || 0,
      level: Number(row?.level) || 1,
    };
  }

  function resolveUserJids(userJid, identityMap = null) {
    const jids = [];
    const base = String(userJid || '').trim();
    if (base) jids.push(base);

    if (identityMap?.resolve) {
      const alt = String(identityMap.resolve(base) || '').trim();
      if (alt && !jids.includes(alt)) jids.push(alt);
    }
    if (identityMap?.getPn) {
      const pn = String(identityMap.getPn(base) || '').trim();
      if (pn && !jids.includes(pn)) jids.push(pn);
    }
    if (identityMap?.getLid) {
      const lid = String(identityMap.getLid(base) || '').trim();
      if (lid && !jids.includes(lid)) jids.push(lid);
    }
    return jids;
  }

  /**
   * Verifica se o usuário comprou e possui um carro ativo (não sucateado) no inventário.
   * @param {{ scopeKey: string, userJid: string, identityMap?: any }} input
   * @returns {boolean}
   */
  function ownsCar({ scopeKey, userJid, identityMap = null }) {
    if (!scopeKey || !userJid) return false;

    const jids = resolveUserJids(userJid, identityMap);

    if (marketRepository?.listInventory) {
      for (const jid of jids) {
        const inventory = marketRepository.listInventory(jid, scopeKey);
        if (inventory.some((item) => item.itemId === 'carro' && item.condition !== 'broken')) {
          return true;
        }
      }
    }

    try {
      const placeholders = jids.map(() => '?').join(',');
      const row = db()
        .prepare(
          `SELECT id FROM ${ANALYTICS_SCHEMA}.fun_inventory
           WHERE scope_key = ? AND user_jid IN (${placeholders}) AND item_id = 'carro' AND condition != 'broken'
           LIMIT 1`
        )
        .get(String(scopeKey), ...jids);
      return Boolean(row);
    } catch {
      return false;
    }
  }

  /**
   * Localiza o escopo onde o usuário possui um carro ativo (ou quebrado).
   * Essencial em DMs onde o usuário pode ter adquirido o carro em outro grupo.
   * @param {{ userJid: string, preferredScopeKey?: string, identityMap?: any }} input
   * @returns {{ scopeKey: string | null, condition: 'ok' | 'broken' | null, owns: boolean }}
   */
  function findCarScope({ userJid, preferredScopeKey = '', identityMap = null } = {}) {
    if (!userJid) return { scopeKey: null, condition: null, owns: false };

    // 1. Se preferredScopeKey tiver carro ativo, prioriza ele
    if (preferredScopeKey && ownsCar({ scopeKey: preferredScopeKey, userJid, identityMap })) {
      return { scopeKey: String(preferredScopeKey), condition: 'ok', owns: true };
    }

    const jids = resolveUserJids(userJid, identityMap);

    try {
      const placeholders = jids.map(() => '?').join(',');
      const rows = db()
        .prepare(
          `SELECT scope_key, condition, acquired_at FROM ${ANALYTICS_SCHEMA}.fun_inventory
           WHERE user_jid IN (${placeholders}) AND item_id = 'carro'
           ORDER BY CASE WHEN condition != 'broken' THEN 0 ELSE 1 END, acquired_at DESC`
        )
        .all(...jids);

      if (!rows.length) {
        return { scopeKey: null, condition: null, owns: false };
      }

      const activeCar = rows.find((r) => r.condition !== 'broken');
      if (activeCar) {
        return { scopeKey: String(activeCar.scope_key), condition: 'ok', owns: true };
      }

      // Se só tem quebrado
      return { scopeKey: String(rows[0].scope_key), condition: 'broken', owns: false };
    } catch {
      return { scopeKey: null, condition: null, owns: false };
    }
  }

  /**
   * Obtém o estado do carro e metadados para visualização/dashboard.
   * @param {{ scopeKey: string, userJid: string, now?: number }} input
   */
  function getCarState({ scopeKey, userJid, now = Date.now() }) {
    const isOwner = ownsCar({ scopeKey, userJid });
    const userStats = stats(scopeKey, userJid, now);
    const state = carRepository.ensure(scopeKey, userJid, now);

    return {
      scopeKey: String(scopeKey),
      userJid: String(userJid),
      ownsCar: isOwner,
      coins: Number(userStats.coins) || 0,
      level: Number(userStats.level) || 1,
      catalogRevision: CAR_CATALOG_REVISION,
      state,
      catalog: CAR_CATALOG,
    };
  }

  /**
   * Aplica customizações com validação, cálculo de orçamento e transação atômica de moedas.
   * @param {object} input
   */
  function applyCustomization(input = {}) {
    const {
      scopeKey,
      userJid,
      customizations = {},
      idempotencyKey = '',
      funConfig = {},
      now = Date.now(),
    } = input;

    if (funConfig.carEnabled === false) {
      return { ok: false, reason: 'car-disabled' };
    }

    if (!ownsCar({ scopeKey, userJid })) {
      return { ok: false, reason: 'car-not-owned' };
    }

    const validation = validateCarCustomization(customizations);
    if (!validation.ok) {
      return { ok: false, reason: 'invalid-customization', errors: validation.errors };
    }

    const current = carRepository.ensure(scopeKey, userJid, now);
    const desired = { ...current, ...validation.sanitized };

    // Idempotência
    const cleanIdempotencyKey = String(idempotencyKey || '').trim();
    const payloadHash = cleanIdempotencyKey
      ? hashCarOperation(validation.sanitized)
      : '';

    if (cleanIdempotencyKey) {
      const prevOp = carRepository.operation(scopeKey, userJid, cleanIdempotencyKey);
      if (prevOp) {
        if (prevOp.payloadHash === payloadHash) {
          return { ...prevOp.result, replayed: true };
        }
        return { ok: false, reason: 'idempotency-key-reused' };
      }
    }

    const userStats = stats(scopeKey, userJid, now);
    const currentCoins = Number(userStats.coins) || 0;
    const quote = calculateCarCustomizationQuote(current, desired);

    if (quote.total > currentCoins) {
      return {
        ok: false,
        reason: 'insufficient-coins',
        need: quote.total,
        coins: currentCoins,
      };
    }

    const database = db();
    const ts = Number(now) || Date.now();

    const transaction = database.transaction(() => {
      // 1. Debitar moedas se houver custo
      if (quote.total > 0) {
        const update = database
          .prepare(
            `UPDATE ${ANALYTICS_SCHEMA}.fun_user_stats
             SET coins = coins - ?, updated_at = ?
             WHERE user_jid = ? AND scope_key = ? AND coins >= ?`
          )
          .run(quote.total, ts, String(userJid), String(scopeKey), quote.total);

        if (update.changes !== 1) {
          throw new Error('insufficient-coins');
        }

        const ledger = database.prepare(
          `INSERT INTO ${ANALYTICS_SCHEMA}.fun_coin_ledger (scope_key, from_jid, to_jid, amount, reason, created_at)
           VALUES (?, NULL, ?, ?, ?, ?)`
        );

        for (const item of quote.items) {
          ledger.run(
            String(scopeKey),
            String(userJid),
            -item.cost,
            `car-custom:${item.category}:${item.id}`,
            ts
          );
        }
      }

      // 2. Salvar novo estado do carro
      const savedState = carRepository.save(scopeKey, userJid, desired, ts);

      // 3. Obter saldo restante
      const updatedCoins = currentCoins - quote.total;

      const result = {
        ok: true,
        state: savedState,
        coins: updatedCoins,
        debited: quote.total,
        purchased: quote.items,
      };

      if (cleanIdempotencyKey && payloadHash) {
        carRepository.saveOperation(
          scopeKey,
          userJid,
          cleanIdempotencyKey,
          payloadHash,
          result,
          ts
        );
      }

      return result;
    });

    try {
      return transaction();
    } catch (err) {
      if (err.message === 'insufficient-coins') {
        return { ok: false, reason: 'insufficient-coins', need: quote.total, coins: currentCoins };
      }
      throw err;
    }
  }

  /**
   * Renderiza a imagem do carro atual em PNG.
   * @param {{ scopeKey: string, userJid: string, ownerName?: string, customSharp?: any }} options
   */
  async function renderCarScreenshot(options = {}) {
    const { scopeKey, userJid, ownerName = '', customSharp = null } = options;

    if (!ownsCar({ scopeKey, userJid })) {
      return { ok: false, reason: 'car-not-owned' };
    }

    const state = carRepository.ensure(scopeKey, userJid);
    const pngBuffer = await renderCarPng(state, {
      ownerName,
      userJid,
      sharp: customSharp || sharp,
    });

    return {
      ok: true,
      buffer: pngBuffer,
      state,
    };
  }

  return {
    ownsCar,
    findCarScope,
    getCarState,
    applyCustomization,
    renderCarScreenshot,
    buildCarSvg: (state, opts) => buildCarSvg(state, opts),
  };
}
