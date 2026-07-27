/**
 * Lógica de cartas: packs, inventário, trocas, favoritos e bazar.
 */

import { ACTION_TYPE, PROPOSAL_TTL_MS } from '../constants.js';
import {
  loadCardCatalog,
  rollRandomCard,
  PACK_COST,
  MAX_PACKS_PER_OPEN,
  tierLabel,
  formatCardLine,
  getCardDef,
} from '../shop/cards.js';

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export function createCardService({
  repository,
  cardRepository,
  actionRepository = null,
  random = Math.random,
} = {}) {
  if (!repository) throw new Error('[fun/cardService] repository required');
  if (!cardRepository) throw new Error('[fun/cardService] cardRepository required');

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.cardsEnabled !== false,
      packCost: Math.max(1, Math.floor(numOr(funConfig.cardPackCost, PACK_COST))),
      maxPacks: Math.max(1, Math.floor(numOr(funConfig.cardMaxPacksPerOpen, MAX_PACKS_PER_OPEN))),
      tradeTtlMs: Math.max(30_000, Math.floor(numOr(funConfig.cardTradeTtlMs, PROPOSAL_TTL_MS))),
    };
  }

  function listInventory(userJid, scopeKey) {
    const cards = cardRepository.listByUser(scopeKey, userJid);
    const fav = cardRepository.getFavorite(scopeKey, userJid);
    const favId = fav?.id || '';
    return cards.map((c) => ({
      ...c,
      favorite: c.id === favId,
    }));
  }

  function formatInventory(userJid, scopeKey, funConfig = {}) {
    const p = funConfig.prefix || '/';
    const o = opts(funConfig);
    const cards = listInventory(userJid, scopeKey);
    const bal =
      repository.getUserStats(userJid, scopeKey)?.coins ??
      repository.ensureUserRow(userJid, scopeKey).coins;

    if (!cards.length) {
      return [
        '🃏 *Suas cartas*',
        'Inventário vazio.',
        `Abra packs: \`${p}cartas abrir 1\` (*${o.packCost}*c cada)`,
        `Saldo: *${bal}*c`,
      ].join('\n');
    }

    const byTier = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    for (const c of cards) byTier[c.tier] = (byTier[c.tier] || 0) + 1;

    const lines = [
      '🃏 *Suas cartas*',
      `Total *${cards.length}* · T5 ${byTier[5]} · T4 ${byTier[4]} · T3 ${byTier[3]} · T2 ${byTier[2]} · T1 ${byTier[1]}`,
      `Pack: *${o.packCost}*c · saldo *${bal}*c`,
      '',
    ];
    const show = cards.slice(0, 40);
    for (const c of show) {
      lines.push(formatCardLine(c));
    }
    if (cards.length > show.length) {
      lines.push(`_…e mais ${cards.length - show.length}_`);
    }
    lines.push(
      '',
      `\`${p}cartas abrir <n>\` · \`${p}cartas favoritar <id>\``,
      `\`${p}cartas trocar <id> @user\` · \`${p}cartas vender <id> <preço>\``
    );
    return lines.join('\n');
  }

  /**
   * Abre N packs (1 carta aleatória por pack). Debita coins atomicamente por pack.
   */
  function openPacks({ userJid, scopeKey, quantity = 1, funConfig = {}, now = Date.now() }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };

    const catalog = loadCardCatalog();
    if (!catalog.length) return { ok: false, reason: 'no-catalog' };

    const qty = Math.floor(Number(quantity) || 0);
    if (qty < 1) return { ok: false, reason: 'invalid-qty' };
    if (qty > o.maxPacks) return { ok: false, reason: 'max-packs', max: o.maxPacks };

    const totalCost = o.packCost * qty;
    const bal =
      repository.getUserStats(userJid, scopeKey)?.coins ??
      repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < totalCost) {
      return {
        ok: false,
        reason: 'no-coins',
        need: totalCost,
        coins: bal,
        packCost: o.packCost,
      };
    }

    const spend = repository.addCoins({
      userJid,
      scopeKey,
      amount: -totalCost,
      now,
      reason: `card-pack:${qty}`,
    });
    if (!spend.ok) return { ok: false, reason: 'spend-failed' };

    const opened = [];
    for (let i = 0; i < qty; i++) {
      const def = rollRandomCard(random);
      if (!def) continue;
      const card = cardRepository.insert({
        userJid,
        scopeKey,
        cardKey: def.key,
        cardName: def.displayName,
        species: def.species,
        variant: def.variant,
        tier: def.tier,
        imageFile: def.imageFile,
        boughtPrice: o.packCost,
        now,
      });
      if (card) opened.push(card);
    }

    if (!opened.length) {
      // devolve coins se nada saiu (catálogo vazio no meio)
      repository.addCoins({
        userJid,
        scopeKey,
        amount: totalCost,
        now,
        reason: 'card-pack-refund',
      });
      return { ok: false, reason: 'no-catalog' };
    }

    return {
      ok: true,
      cards: opened,
      quantity: opened.length,
      cost: o.packCost * opened.length,
      packCost: o.packCost,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function setFavorite({ userJid, scopeKey, cardId }) {
    const card =
      cardRepository.getById(cardId) ||
      cardRepository.findByIdPrefix(scopeKey, userJid, cardId);
    if (!card) return { ok: false, reason: 'not-found' };
    return cardRepository.setFavorite(scopeKey, userJid, card.id);
  }

  function getFavorite(userJid, scopeKey) {
    return cardRepository.getFavorite(scopeKey, userJid);
  }

  /**
   * Propõe troca: A oferece cardId para B.
   * B completa com completeTrade (oferece a carta dele).
   */
  function proposeTrade({
    userJid,
    scopeKey,
    cardId,
    targetJid,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    if (!actionRepository) return { ok: false, reason: 'no-actions' };
    if (!targetJid || targetJid === userJid) return { ok: false, reason: 'invalid-target' };

    const card =
      cardRepository.getById(cardId) ||
      cardRepository.findByIdPrefix(scopeKey, userJid, cardId);
    if (!card || card.userJid !== userJid || card.scopeKey !== scopeKey) {
      return { ok: false, reason: 'not-found' };
    }
    if (card.listed) return { ok: false, reason: 'listed' };

    const action = actionRepository.createAction({
      scopeKey,
      actionType: ACTION_TYPE.CARD_TRADE,
      fromJid: userJid,
      toJid: targetJid,
      payload: {
        offerCardId: card.id,
        offerCardName: card.displayName || card.cardName,
        offerTier: card.tier,
      },
      ttlMs: o.tradeTtlMs,
      now,
    });

    return { ok: true, action, card, expiresAt: action.expiresAt };
  }

  /**
   * Completa troca pendente: userJid (B) oferece counterCardId.
   * Atomicidade via swapOwners no repositório.
   */
  function completeTrade({
    userJid,
    scopeKey,
    cardId,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    if (!actionRepository) return { ok: false, reason: 'no-actions' };

    const pending = actionRepository.getLatestIncoming({
      scopeKey,
      toJid: userJid,
      actionType: ACTION_TYPE.CARD_TRADE,
      now,
    });
    if (!pending) return { ok: false, reason: 'no-pending' };

    const offerCardId = String(pending.payload?.offerCardId || '');
    const fromJid = pending.fromJid;

    const myCard =
      cardRepository.getById(cardId) ||
      cardRepository.findByIdPrefix(scopeKey, userJid, cardId);
    if (!myCard || myCard.userJid !== userJid || myCard.scopeKey !== scopeKey) {
      return { ok: false, reason: 'not-found' };
    }
    if (myCard.listed) return { ok: false, reason: 'listed' };
    if (myCard.id === offerCardId) return { ok: false, reason: 'same-card' };

    const offerCard = cardRepository.getById(offerCardId);
    if (!offerCard || offerCard.userJid !== fromJid || offerCard.scopeKey !== scopeKey) {
      actionRepository.deleteAction(pending.id);
      return { ok: false, reason: 'offer-gone' };
    }
    if (offerCard.listed) {
      actionRepository.deleteAction(pending.id);
      return { ok: false, reason: 'offer-listed' };
    }

    const swap = cardRepository.swapOwners(offerCardId, userJid, myCard.id, fromJid);
    if (!swap?.ok) {
      return { ok: false, reason: swap?.reason || 'swap-failed' };
    }

    actionRepository.deleteAction(pending.id);

    return {
      ok: true,
      fromJid,
      toJid: userJid,
      cardReceived: swap.cardToB,
      cardGiven: swap.cardToA,
    };
  }

  function declineTrade({ userJid, scopeKey, now = Date.now() }) {
    if (!actionRepository) return { ok: false, reason: 'no-actions' };
    const pending = actionRepository.getLatestIncoming({
      scopeKey,
      toJid: userJid,
      actionType: ACTION_TYPE.CARD_TRADE,
      now,
    });
    if (!pending) return { ok: false, reason: 'no-pending' };
    actionRepository.deleteAction(pending.id);
    return {
      ok: true,
      fromJid: pending.fromJid,
      toJid: userJid,
      cardName: pending.payload?.offerCardName || '',
    };
  }

  function peekTrade(userJid, scopeKey, now = Date.now()) {
    if (!actionRepository) return null;
    return actionRepository.getLatestIncoming({
      scopeKey,
      toJid: userJid,
      actionType: ACTION_TYPE.CARD_TRADE,
      now,
    });
  }

  // ── Bazar de cartas ────────────────────────────────────

  function listOnBazaar({ userJid, scopeKey, cardId, price, now = Date.now() }) {
    const card =
      cardRepository.getById(cardId) ||
      cardRepository.findByIdPrefix(scopeKey, userJid, cardId);
    if (!card || card.userJid !== userJid || card.scopeKey !== scopeKey) {
      return { ok: false, reason: 'not-found' };
    }
    if (card.listed || cardRepository.findOpenListingByCard(card.id)) {
      return { ok: false, reason: 'already-listed' };
    }
    const ask = Math.floor(Number(price) || 0);
    if (ask < 1 || ask > 1_000_000) return { ok: false, reason: 'invalid-price' };

    const listing = cardRepository.createListing({
      scopeKey,
      sellerJid: userJid,
      cardId: card.id,
      price: ask,
      now,
    });
    return { ok: true, listing, card };
  }

  function cancelListing({ userJid, scopeKey, listingId }) {
    const listing =
      cardRepository.getListing(listingId) ||
      cardRepository.findListingByPrefix(scopeKey, listingId);
    if (!listing || listing.scopeKey !== scopeKey || listing.status !== 'open') {
      return { ok: false, reason: 'not-found' };
    }
    if (listing.sellerJid !== userJid) return { ok: false, reason: 'not-owner' };
    cardRepository.closeListing(listing.id, 'cancelled');
    return { ok: true, listing };
  }

  function buyFromBazaar({ userJid, scopeKey, listingId, now = Date.now() }) {
    const listing =
      cardRepository.getListing(listingId) ||
      cardRepository.findListingByPrefix(scopeKey, listingId);
    if (!listing || listing.scopeKey !== scopeKey || listing.status !== 'open') {
      return { ok: false, reason: 'not-found' };
    }
    if (listing.sellerJid === userJid) return { ok: false, reason: 'self-buy' };

    const card = cardRepository.getById(listing.cardId);
    if (!card || card.userJid !== listing.sellerJid) {
      cardRepository.closeListing(listing.id, 'cancelled');
      return { ok: false, reason: 'item-gone' };
    }

    const price = listing.price;
    const bal =
      repository.getUserStats(userJid, scopeKey)?.coins ??
      repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < price) {
      return { ok: false, reason: 'insufficient-funds', coins: bal, price };
    }

    const spend = repository.addCoins({
      userJid,
      scopeKey,
      amount: -price,
      now,
      reason: `card-bazaar-buy:${listing.id}`,
    });
    if (!spend.ok) return { ok: false, reason: 'spend-failed' };

    repository.addCoins({
      userJid: listing.sellerJid,
      scopeKey,
      amount: price,
      now,
      reason: `card-bazaar-sell:${listing.id}`,
    });

    const moved = cardRepository.transferOwner(card.id, userJid, {
      boughtPrice: price,
      now,
    });
    cardRepository.closeListing(listing.id, 'sold');

    return {
      ok: true,
      listing,
      card: moved,
      price,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      sellerJid: listing.sellerJid,
    };
  }

  function listOpenCardListings(scopeKey, limit = 30) {
    const listings = cardRepository.listOpenListings(scopeKey, limit);
    return listings.map((l) => {
      const card = cardRepository.getById(l.cardId);
      return {
        ...l,
        card,
        kind: 'card',
      };
    });
  }

  function resolveCardImagePath(card) {
    if (!card) return '';
    if (card.imagePath) return card.imagePath;
    const def = getCardDef(card.cardKey);
    return def?.imagePath || '';
  }

  return {
    opts,
    listInventory,
    formatInventory,
    openPacks,
    setFavorite,
    getFavorite,
    proposeTrade,
    completeTrade,
    declineTrade,
    peekTrade,
    listOnBazaar,
    cancelListing,
    buyFromBazaar,
    listOpenCardListings,
    resolveCardImagePath,
    packCost: PACK_COST,
    tierLabel,
  };
}
