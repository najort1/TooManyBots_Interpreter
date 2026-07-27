/**
 * Persistência de cartas colecionáveis, favoritos e anúncios no bazar.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import { getCardDef } from '../shop/cards.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapCard(row) {
  if (!row) return null;
  const cardKey = String(row.card_key || '');
  const def = getCardDef(cardKey);
  return {
    id: String(row.id || ''),
    userJid: String(row.user_jid || ''),
    scopeKey: String(row.scope_key || ''),
    cardKey,
    cardName: String(row.card_name || def?.displayName || ''),
    species: String(row.species || def?.species || ''),
    variant: String(row.variant || def?.variant || ''),
    displayName: String(row.card_name || def?.displayName || ''),
    tier: Math.min(5, Math.max(1, Math.floor(Number(row.tier) || 1))),
    imageFile: String(row.image_file || def?.imageFile || ''),
    imagePath: def?.imagePath || '',
    boughtPrice: row.bought_price == null ? null : Math.floor(Number(row.bought_price) || 0),
    listed: Boolean(Number(row.listed) || 0),
    createdAt: Number(row.created_at) || 0,
  };
}

function mapListing(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    scopeKey: String(row.scope_key || ''),
    sellerJid: String(row.seller_jid || ''),
    cardId: String(row.card_id || ''),
    price: Math.max(0, Math.floor(Number(row.price) || 0)),
    createdAt: Number(row.created_at) || 0,
    status: String(row.status || 'open'),
  };
}

export function createFunCardRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function getById(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_cards WHERE id = ?`)
      .get(String(id || ''));
    return mapCard(row);
  }

  function findByIdPrefix(scopeKey, userJid, token) {
    ensureSchema();
    const t = String(token || '').trim().toLowerCase();
    if (!t) return null;
    const exact = getById(t);
    if (
      exact &&
      exact.scopeKey === String(scopeKey || '') &&
      exact.userJid === String(userJid || '')
    ) {
      return exact;
    }
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_cards
         WHERE scope_key = ? AND user_jid = ? AND lower(id) LIKE ? || '%'
         ORDER BY created_at DESC LIMIT 5`
      )
      .all(String(scopeKey || ''), String(userJid || ''), t);
    if (rows.length === 1) return mapCard(rows[0]);
    if (rows.length > 1) {
      // preferência: match mais curto / primeiro
      return mapCard(rows[0]);
    }
    return null;
  }

  function listByUser(scopeKey, userJid, { includeListed = true } = {}) {
    ensureSchema();
    let sql = `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_user_cards
               WHERE scope_key = ? AND user_jid = ?`;
    if (!includeListed) sql += ' AND listed = 0';
    sql += ' ORDER BY tier DESC, created_at DESC';
    const rows = getDatabase()
      .prepare(sql)
      .all(String(scopeKey || ''), String(userJid || ''));
    return rows.map(mapCard).filter(Boolean);
  }

  function countByUser(scopeKey, userJid) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_user_cards
         WHERE scope_key = ? AND user_jid = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''));
    return Number(row?.n) || 0;
  }

  function insert({
    userJid,
    scopeKey,
    cardKey,
    cardName,
    species = '',
    variant = '',
    tier = 1,
    imageFile = '',
    boughtPrice = null,
    now = Date.now(),
  }) {
    ensureSchema();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    const price =
      boughtPrice == null || boughtPrice === ''
        ? null
        : Math.max(0, Math.floor(Number(boughtPrice) || 0));
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_user_cards
         (id, user_jid, scope_key, card_key, card_name, species, variant, tier,
          image_file, bought_price, listed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        id,
        String(userJid || ''),
        String(scopeKey || ''),
        String(cardKey || ''),
        String(cardName || ''),
        String(species || ''),
        String(variant || ''),
        Math.min(5, Math.max(1, Math.floor(Number(tier) || 1))),
        String(imageFile || ''),
        price,
        ts
      );
    return getById(id);
  }

  function transferOwner(cardId, toUserJid, { boughtPrice = null, now = Date.now() } = {}) {
    ensureSchema();
    const card = getById(cardId);
    if (!card) return null;
    const price =
      boughtPrice === undefined
        ? card.boughtPrice
        : boughtPrice == null
          ? null
          : Math.max(0, Math.floor(Number(boughtPrice) || 0));
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_cards
         SET user_jid = ?, bought_price = ?, listed = 0
         WHERE id = ?`
      )
      .run(String(toUserJid || ''), price, String(cardId || ''));
    // limpa favorito do dono anterior se era esta carta
    clearFavoriteIfCard(card.userJid, card.scopeKey, cardId);
    void now;
    return getById(cardId);
  }

  function setListed(cardId, listed) {
    ensureSchema();
    getDatabase()
      .prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_user_cards SET listed = ? WHERE id = ?`)
      .run(listed ? 1 : 0, String(cardId || ''));
    return getById(cardId);
  }

  function deleteCard(cardId) {
    ensureSchema();
    const card = getById(cardId);
    if (!card) return false;
    const db = getDatabase();
    db.prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_card_listings WHERE card_id = ?`).run(
      String(cardId)
    );
    db.prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_favorite_cards WHERE card_id = ?`
    ).run(String(cardId));
    db.prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_user_cards WHERE id = ?`).run(String(cardId));
    return true;
  }

  // ── Favoritos ──────────────────────────────────────────

  function getFavorite(scopeKey, userJid) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT card_id FROM ${ANALYTICS_SCHEMA}.fun_favorite_cards
         WHERE scope_key = ? AND user_jid = ?`
      )
      .get(String(scopeKey || ''), String(userJid || ''));
    if (!row?.card_id) return null;
    const card = getById(row.card_id);
    if (!card || card.userJid !== String(userJid || '') || card.scopeKey !== String(scopeKey || '')) {
      // favorito órfão
      clearFavorite(scopeKey, userJid);
      return null;
    }
    return { ...card, favorite: true };
  }

  function setFavorite(scopeKey, userJid, cardId, now = Date.now()) {
    ensureSchema();
    const card = getById(cardId);
    if (!card) return { ok: false, reason: 'not-found' };
    if (card.userJid !== String(userJid || '') || card.scopeKey !== String(scopeKey || '')) {
      return { ok: false, reason: 'not-owner' };
    }
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_favorite_cards
         (user_jid, scope_key, card_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_jid, scope_key) DO UPDATE SET
           card_id = excluded.card_id,
           updated_at = excluded.updated_at`
      )
      .run(String(userJid || ''), String(scopeKey || ''), String(cardId || ''), Number(now) || Date.now());
    return { ok: true, card: getFavorite(scopeKey, userJid) };
  }

  function clearFavorite(scopeKey, userJid) {
    ensureSchema();
    getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_favorite_cards
         WHERE scope_key = ? AND user_jid = ?`
      )
      .run(String(scopeKey || ''), String(userJid || ''));
  }

  function clearFavoriteIfCard(userJid, scopeKey, cardId) {
    ensureSchema();
    getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_favorite_cards
         WHERE user_jid = ? AND scope_key = ? AND card_id = ?`
      )
      .run(String(userJid || ''), String(scopeKey || ''), String(cardId || ''));
  }

  // ── Listings (bazar de cartas) ──────────────────────────

  function createListing({
    scopeKey,
    sellerJid,
    cardId,
    price,
    now = Date.now(),
  }) {
    ensureSchema();
    const id = randomUUID();
    const ts = Number(now) || Date.now();
    const ask = Math.max(1, Math.floor(Number(price) || 0));
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_card_listings
         (id, scope_key, seller_jid, card_id, price, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'open')`
      )
      .run(id, String(scopeKey || ''), String(sellerJid || ''), String(cardId || ''), ask, ts);
    setListed(cardId, true);
    return getListing(id);
  }

  function getListing(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_card_listings WHERE id = ?`)
      .get(String(id || ''));
    return mapListing(row);
  }

  function findListingByPrefix(scopeKey, token) {
    ensureSchema();
    const t = String(token || '').trim().toLowerCase();
    if (!t) return null;
    const exact = getListing(t);
    if (exact && exact.scopeKey === String(scopeKey || '') && exact.status === 'open') {
      return exact;
    }
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_card_listings
         WHERE scope_key = ? AND status = 'open' AND lower(id) LIKE ? || '%'
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(String(scopeKey || ''), t);
    return mapListing(row);
  }

  function findOpenListingByCard(cardId) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_card_listings
         WHERE card_id = ? AND status = 'open' LIMIT 1`
      )
      .get(String(cardId || ''));
    return mapListing(row);
  }

  function listOpenListings(scopeKey, limit = 30) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_card_listings
         WHERE scope_key = ? AND status = 'open'
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(1, Math.min(100, Math.floor(Number(limit) || 30))));
    return rows.map(mapListing).filter(Boolean);
  }

  function closeListing(id, status = 'sold') {
    ensureSchema();
    const listing = getListing(id);
    if (!listing) return null;
    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_card_listings SET status = ? WHERE id = ?`
      )
      .run(String(status || 'sold'), String(id || ''));
    if (listing.cardId) setListed(listing.cardId, false);
    return getListing(id);
  }

  /**
   * Troca atômica de donos de duas cartas (A↔B).
   */
  function swapOwners(cardIdA, userJidB, cardIdB, userJidA) {
    ensureSchema();
    const db = getDatabase();
    const tx = db.transaction(() => {
      const a = getById(cardIdA);
      const b = getById(cardIdB);
      if (!a || !b) return { ok: false, reason: 'not-found' };
      if (a.listed || b.listed) return { ok: false, reason: 'listed' };
      if (a.userJid !== userJidA || b.userJid !== userJidB) {
        return { ok: false, reason: 'owner-mismatch' };
      }
      if (a.scopeKey !== b.scopeKey) return { ok: false, reason: 'scope-mismatch' };

      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_cards SET user_jid = ? WHERE id = ?`
      ).run(String(userJidB), String(cardIdA));
      db.prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_user_cards SET user_jid = ? WHERE id = ?`
      ).run(String(userJidA), String(cardIdB));

      clearFavoriteIfCard(userJidA, a.scopeKey, cardIdA);
      clearFavoriteIfCard(userJidB, b.scopeKey, cardIdB);

      return {
        ok: true,
        cardToB: getById(cardIdA),
        cardToA: getById(cardIdB),
      };
    });
    return tx();
  }

  return {
    ensureSchema,
    getById,
    findByIdPrefix,
    listByUser,
    countByUser,
    insert,
    transferOwner,
    setListed,
    deleteCard,
    getFavorite,
    setFavorite,
    clearFavorite,
    createListing,
    getListing,
    findListingByPrefix,
    findOpenListingByCard,
    listOpenListings,
    closeListing,
    swapOwners,
  };
}
