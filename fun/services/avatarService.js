import { getAvatarItem, isAvatarSlot, listAvatarItems } from '../shop/avatars.js';
import {
  AVATAR_CATALOG_REVISION,
  getAvatarProduct,
  getProductIdsForSlots,
  listAvatarItems as listAvatarV2Items,
  listAvatarProducts,
  validateAvatarAppearance,
} from '../../shared/avatar/domain.js';
import {
  getEquippedProductIds,
  migrateLegacyAvatarState,
  projectV2ToLegacy,
} from '../../shared/avatar/legacyMigration.js';
import { hashAvatarOperation } from '../db/funAvatarV2Repository.js';

export function createAvatarService({ repository, avatarRepository, avatarV2Repository, getDatabase } = {}) {
  if (!repository || !avatarRepository) throw new Error('[fun/avatar] repository obrigatório');
  const enabled = (config = {}) => config.avatarEnabled !== false;
  const legacyState = ({ scopeKey, userJid, now = Date.now() }) => avatarRepository.ensure(scopeKey, userJid, now);
  const isOwned = (item, current, level) => item.cost === 0 && Number(level) >= item.unlockLevel || current.unlocked.includes(item.id);

  function stats(scopeKey, userJid, now) {
    return repository.getUserStats(userJid, scopeKey) || repository.ensureUserRow(userJid, scopeKey, now);
  }

  function v2State({ scopeKey, userJid, now = Date.now() }) {
    if (!avatarV2Repository) return migrateLegacyAvatarState(legacyState({ scopeKey, userJid, now }));
    const current = avatarV2Repository.get(scopeKey, userJid);
    if (current) return current;
    const migrated = migrateLegacyAvatarState(legacyState({ scopeKey, userJid, now }));
    return avatarV2Repository.create(scopeKey, userJid, migrated, now);
  }

  function get({ scopeKey, userJid, now = Date.now() }) {
    const current = v2State({ scopeKey, userJid, now });
    const legacy = avatarRepository.get(scopeKey, userJid);
    const userStats = stats(scopeKey, userJid, now);
    const level = Number(userStats.level) || 1;
    const catalog = listAvatarV2Items().map((item) => {
      const product = getAvatarProduct(item.sourceProductId);
      return {
        ...item,
        unlockLevel: product.unlockLevel,
        cost: product.cost,
        category: product.category,
        owned: ownsProduct(product, current, level),
      };
    });
    return {
      ...current,
      legacySlots: legacy?.slots || projectV2ToLegacy(current.slots),
      level,
      coins: Number(userStats.coins) || 0,
      catalog,
    };
  }

  function apply(input) {
    if (!enabled(input.funConfig)) return { ok: false, reason: 'avatar-disabled' };
    if (!avatarV2Repository || !getDatabase) return { ok: false, reason: 'avatar-v2-unavailable' };
    const validation = validateAvatarAppearance(input.slots);
    if (!validation.ok) return { ok: false, reason: 'invalid-appearance', errors: validation.errors };
    if (Number(input.catalogRevision) !== AVATAR_CATALOG_REVISION) {
      return { ok: false, reason: 'catalog-revision-conflict', catalogRevision: AVATAR_CATALOG_REVISION };
    }
    const idempotencyKey = String(input.idempotencyKey || '').trim();
    if (!idempotencyKey) return { ok: false, reason: 'idempotency-key-required' };
    const payload = { slots: validation.slots, expectedRevision: Number(input.expectedRevision), catalogRevision: AVATAR_CATALOG_REVISION };
    const payloadHash = hashAvatarOperation(payload);
    const previous = avatarV2Repository.operation(input.scopeKey, input.userJid, idempotencyKey);
    if (previous) return previous.payloadHash === payloadHash
      ? { ...previous.result, replayed: true }
      : { ok: false, reason: 'idempotency-key-reused' };

    const current = v2State(input);
    if (Number(input.expectedRevision) !== current.revision) {
      return { ok: false, reason: 'appearance-revision-conflict', current };
    }
    const userStats = stats(input.scopeKey, input.userJid, input.now);
    const quote = buildQuote(validation.slots, current, Number(userStats.level) || 1);
    if (quote.locked.length) return { ok: false, reason: 'level-locked', itemIds: quote.locked };
    if (quote.total > 0 && !sameQuote(input.confirmedPurchase, quote)) {
      return { ok: false, reason: 'purchase-confirmation-required', quote };
    }
    if ((Number(userStats.coins) || 0) < quote.total) {
      return { ok: false, reason: 'insufficient-coins', need: quote.total, coins: Number(userStats.coins) || 0 };
    }

    return saveLookTransaction({ input, current, quote, slots: validation.slots, payloadHash, idempotencyKey });
  }

  function saveLookTransaction({ input, current, quote, slots, payloadHash, idempotencyKey }) {
    const db = getDatabase();
    const timestamp = Number(input.now) || Date.now();
    const run = db.transaction(() => {
      if (quote.total > 0) debitPremium(db, input, quote, timestamp);
      const next = avatarV2Repository.save(input.scopeKey, input.userJid, {
        ...current,
        revision: current.revision + 1,
        catalogRevision: AVATAR_CATALOG_REVISION,
        slots,
        unlocked: [...current.unlocked, ...quote.itemIds],
      }, timestamp);
      avatarRepository.save(input.scopeKey, input.userJid, {
        slots: projectV2ToLegacy(slots),
        unlocked: [...current.unlocked, ...quote.itemIds],
      }, timestamp);
      const coins = Number(repository.getUserStats(input.userJid, input.scopeKey)?.coins) || 0;
      const result = { ok: true, state: next, coins, purchased: quote.itemIds };
      avatarV2Repository.saveOperation(input.scopeKey, input.userJid, idempotencyKey, payloadHash, result, timestamp);
      return result;
    });
    return run();
  }

  function equip({ scopeKey, userJid, itemId, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const item = getAvatarItem(itemId);
    if (!item || !isAvatarSlot(item.slot)) return { ok: false, reason: 'unknown-item' };
    const current = legacyState({ scopeKey, userJid, now });
    const userStats = stats(scopeKey, userJid, now);
    if (!isOwned(item, current, Number(userStats.level) || 1)) return { ok: false, reason: 'not-owned', item };
    const saved = avatarRepository.save(scopeKey, userJid, { slots: { ...current.slots, [item.slot]: item.id }, unlocked: current.unlocked }, now);
    return { ok: true, state: saved, item };
  }

  function buy({ scopeKey, userJid, itemId, funConfig = {}, now = Date.now() }) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    const item = getAvatarItem(itemId);
    if (!item || item.cost <= 0) return { ok: false, reason: 'not-purchasable' };
    const current = legacyState({ scopeKey, userJid, now });
    if (current.unlocked.includes(item.id)) return { ok: false, reason: 'already-owned', item };
    const userStats = stats(scopeKey, userJid, now);
    if ((Number(userStats.coins) || 0) < item.cost) return { ok: false, reason: 'no-coins', need: item.cost, coins: Number(userStats.coins) || 0 };
    repository.addCoins({ userJid, scopeKey, amount: -item.cost, now, reason: 'avatar-buy:' + item.id });
    const saved = avatarRepository.save(scopeKey, userJid, { slots: current.slots, unlocked: [...current.unlocked, item.id] }, now);
    return { ok: true, item, state: saved, coins: repository.getUserStats(userJid, scopeKey)?.coins || 0 };
  }

  return { get, apply, equip, buy, publicAvatar: (state) => publicAvatar(state || {}) };
}

function ownsProduct(product, current, level) {
  return product.cost === 0 && level >= product.unlockLevel
    || current.unlocked.includes(product.id)
    || getEquippedProductIds(current.slots).includes(product.id);
}

function buildQuote(slots, current, level) {
  const required = getProductIdsForSlots(slots).map(getAvatarProduct).filter(Boolean);
  const premium = required.filter((product) => product.cost > 0 && !ownsProduct(product, current, level));
  const locked = required.filter((product) => product.cost === 0 && product.unlockLevel > level && !current.unlocked.includes(product.id));
  return {
    catalogRevision: AVATAR_CATALOG_REVISION,
    itemIds: premium.map((product) => product.id),
    total: premium.reduce((sum, product) => sum + product.cost, 0),
    locked: locked.map((product) => product.id),
  };
}

function sameQuote(confirmed, actual) {
  if (!confirmed) return false;
  const left = [...(confirmed.itemIds || [])].map(String).sort();
  const right = [...actual.itemIds].sort();
  return Number(confirmed.total) === actual.total
    && Number(confirmed.catalogRevision) === actual.catalogRevision
    && JSON.stringify(left) === JSON.stringify(right);
}

function debitPremium(db, input, quote, timestamp) {
  const update = db.prepare(`
    UPDATE analytics.fun_user_stats
    SET coins = coins - ?, updated_at = ?
    WHERE user_jid = ? AND scope_key = ? AND coins >= ?
  `).run(quote.total, timestamp, String(input.userJid), String(input.scopeKey), quote.total);
  if (update.changes !== 1) throw new Error('insufficient-coins');
  const ledger = db.prepare(`
    INSERT INTO analytics.fun_coin_ledger (scope_key, from_jid, to_jid, amount, reason, created_at)
    VALUES (?, NULL, ?, ?, ?, ?)
  `);
  for (const itemId of quote.itemIds) {
    const product = getAvatarProduct(itemId);
    ledger.run(String(input.scopeKey), String(input.userJid), -product.cost, `avatar-buy:${itemId}`, timestamp);
  }
}

function publicAvatar(state) {
  return {
    schemaVersion: Number(state.schemaVersion) || 2,
    revision: Number(state.revision) || 1,
    catalogRevision: Number(state.catalogRevision) || AVATAR_CATALOG_REVISION,
    slots: state.slots || {},
    legacySlots: state.legacySlots || projectV2ToLegacy(state.slots || {}),
    level: Number(state.level) || 1,
  };
}
