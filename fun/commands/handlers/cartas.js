/**
 * /cartas — inventário, packs, trocas, favoritos e venda no bazar.
 */

import { parseAmountFromArgs, resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';
import { fmt } from '../../messages/index.js';
import { tierLabel } from '../../shop/cards.js';
import {
  renderCollectibleCardPng,
  renderCollectibleCardGridPng,
} from '../../formatters/rankCardImage.js';

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function helpText(p) {
  return [
    '🃏 *Cartas*',
    `\`${p}cartas\` — seu inventário`,
    `\`${p}cartas abrir <n>\` — pack (*30*c · 1 carta · máx. 4)`,
    `\`${p}cartas favoritar <id>\` — vitrine no /perfil`,
    `\`${p}cartas trocar <id> @user\` — propõe troca`,
    `\`${p}cartas trocar <id>\` — completa troca pendente`,
    `\`${p}cartas vender <id> <preço>\` — bazar`,
    `\`${p}cartas cancelar <id>\` — tira do bazar`,
    `\`${p}bazar\` — vê anúncios (itens + cartas)`,
  ].join('\n');
}

async function maybeSendCardImage(replyImage, cardService, card, caption) {
  if (typeof replyImage !== 'function' || !card) return false;
  try {
    const imagePath = cardService.resolveCardImagePath(card);
    if (!imagePath) return false;
    const png = await renderCollectibleCardPng({
      imagePath,
      displayName: card.displayName || card.cardName,
      tier: card.tier,
      favorite: Boolean(card.favorite),
    });
    if (png) {
      await replyImage(png, caption || '');
      return true;
    }
  } catch {
    /* fallback texto */
  }
  return false;
}

/** 1 carta = imagem única · 2–4 = grid único (máx. 4 packs). */
async function maybeSendOpenPackImages(replyImage, cardService, cards, caption) {
  if (typeof replyImage !== 'function' || !cards?.length) return false;
  try {
    if (cards.length === 1) {
      return maybeSendCardImage(replyImage, cardService, cards[0], caption);
    }
    const payload = cards.slice(0, 4).map((c) => ({
      imagePath: cardService.resolveCardImagePath(c),
      displayName: c.displayName || c.cardName,
      cardName: c.cardName,
      tier: c.tier,
    }));
    const png = await renderCollectibleCardGridPng({ cards: payload });
    if (png) {
      await replyImage(png, caption || `🃏 ${cards.length} cartas`);
      return true;
    }
  } catch {
    /* fallback: melhor carta */
    const best = [...cards].sort((a, b) => b.tier - a.tier)[0];
    return maybeSendCardImage(replyImage, cardService, best, caption);
  }
  return false;
}

export async function handleCartasCommand({
  userJid,
  scopeKey,
  cardService,
  funConfig = {},
  reply,
  replyImage,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  getContactDisplayName,
  listContacts,
  identityMap,
  sock,
}) {
  if (!cardService || funConfig.cardsEnabled === false) {
    await reply('Cartas desligadas neste bot.');
    return { handled: true };
  }

  const p = funConfig.prefix || '/';
  const sub = norm(args[0]);
  const rest = args.slice(1);

  // ── lista / help ──
  if (!sub || sub === 'lista' || sub === 'list' || sub === 'inv' || sub === 'inventario') {
    await reply(cardService.formatInventory(userJid, scopeKey, funConfig));
    return { handled: true };
  }

  if (sub === 'help' || sub === 'ajuda' || sub === '?') {
    await reply(helpText(p));
    return { handled: true };
  }

  // ── abrir packs ──
  if (sub === 'abrir' || sub === 'open' || sub === 'pack' || sub === 'packs') {
    let qty = Math.floor(Number(rest[0]) || 0);
    if (!qty && rest[0] == null) qty = 1;
    const result = cardService.openPacks({
      userJid,
      scopeKey,
      quantity: qty,
      funConfig,
    });
    if (!result.ok) {
      if (result.reason === 'no-coins') {
        await reply(
          fmt.insufficientBalance({ required: result.need, current: result.coins })
        );
        return { handled: true };
      }
      if (result.reason === 'invalid-qty') {
        await reply(`Uso: \`${p}cartas abrir 1\` (máx. *4* packs)`);
        return { handled: true };
      }
      if (result.reason === 'max-packs') {
        await reply(`Máximo *${result.max}* packs por vez (grid de até 4 cartas).`);
        return { handled: true };
      }
      if (result.reason === 'no-catalog') {
        await reply('Catálogo de cartas vazio no servidor.');
        return { handled: true };
      }
      await reply(fmt.genericError({ command: 'cartas abrir' }));
      return { handled: true };
    }

    const lines = [
      '🎁 *Pack aberto!*',
      `Gastou *${result.cost}*c · saldo *${result.coins}*c`,
      '',
    ];
    for (const c of result.cards) {
      lines.push(`• *${c.displayName || c.cardName}* ${tierLabel(c.tier)}`);
      lines.push(`  id \`${c.id.slice(0, 8)}\``);
    }
    lines.push('', `Favoritar: \`${p}cartas favoritar <id>\``);
    await reply(lines.join('\n'));

    // 1 carta → imagem única · 2–4 → um grid com todas
    const cap =
      result.cards.length === 1
        ? `🃏 ${result.cards[0].displayName} · ${tierLabel(result.cards[0].tier)}`
        : `🃏 Pack · ${result.cards.length} cartas`;
    await maybeSendOpenPackImages(replyImage, cardService, result.cards, cap);
    return { handled: true, result };
  }

  // ── favoritar ──
  if (sub === 'favoritar' || sub === 'favorite' || sub === 'fav' || sub === 'star') {
    const id = String(rest[0] || '').trim();
    if (!id) {
      await reply(`Uso: \`${p}cartas favoritar <id>\``);
      return { handled: true };
    }
    const result = cardService.setFavorite({ userJid, scopeKey, cardId: id });
    if (!result.ok) {
      if (result.reason === 'not-found' || result.reason === 'not-owner') {
        await reply('Carta não encontrada no seu inventário.');
        return { handled: true };
      }
      await reply(fmt.genericError({ command: 'cartas favoritar' }));
      return { handled: true };
    }
    const c = result.card;
    await reply(
      [
        '⭐ *Favorita definida*',
        `*${c.displayName || c.cardName}* ${tierLabel(c.tier)}`,
        'Aparece no `/perfil`.',
      ].join('\n')
    );
    await maybeSendCardImage(
      replyImage,
      cardService,
      { ...c, favorite: true },
      `⭐ Favorita · ${c.displayName} · ${tierLabel(c.tier)}`
    );
    return { handled: true, result };
  }

  // ── trocar ──
  if (sub === 'trocar' || sub === 'trade' || sub === 'swap') {
    const idToken = String(rest[0] || '').trim();
    if (!idToken) {
      await reply(
        [
          `Uso: \`${p}cartas trocar <id> @user\` (propõe)`,
          `Ou: \`${p}cartas trocar <seu id>\` (completa pendente)`,
        ].join('\n')
      );
      return { handled: true };
    }

    const contacts = typeof listContacts === 'function' ? listContacts() : [];
    let targetJid = '';
    try {
      const resolved = await resolveUserTarget({
        args: rest.slice(1),
        mentionedJids,
        quotedParticipant,
        excludeJid: userJid,
        identityMap,
        sock,
        groupJid: scopeKey,
        contacts,
      });
      if (resolved?.jid && isCanonicalUserJid(resolved.jid)) {
        targetJid = resolved.jid;
      }
    } catch {
      targetJid = '';
    }
    if (!targetJid) {
      targetJid =
        (mentionedJids || []).find((j) => j && j !== userJid && isCanonicalUserJid(j)) || '';
    }

    // Completa troca se já há proposta pendente e não há alvo (ou alvo = proponente)
    const pending = cardService.peekTrade(userJid, scopeKey);
    if (pending && (!targetJid || targetJid === pending.fromJid)) {
      const result = cardService.completeTrade({
        userJid,
        scopeKey,
        cardId: idToken,
        funConfig,
      });
      if (!result.ok) {
        if (result.reason === 'not-found') {
          await reply('Sua carta não foi encontrada.');
          return { handled: true };
        }
        if (result.reason === 'listed') {
          await reply('Tire a carta do bazar antes de trocar.');
          return { handled: true };
        }
        if (result.reason === 'offer-gone' || result.reason === 'offer-listed') {
          await reply('A carta oferecida não está mais disponível.');
          return { handled: true };
        }
        if (result.reason === 'no-pending') {
          await reply('Não há troca esperando você. Peça com `@user`.');
          return { handled: true };
        }
        await reply('Troca falhou. Tente de novo.');
        return { handled: true };
      }
      const a = nameOf(getContactDisplayName, result.fromJid);
      const b = nameOf(getContactDisplayName, result.toJid);
      await reply(
        [
          '🔄 *Troca concluída!*',
          `*${a}* → *${result.cardReceived?.displayName}* ${tierLabel(result.cardReceived?.tier)}`,
          `*${b}* → *${result.cardGiven?.displayName}* ${tierLabel(result.cardGiven?.tier)}`,
        ].join('\n')
      );
      return { handled: true, result };
    }

    if (!targetJid) {
      await reply(`Marque alguém: \`${p}cartas trocar <id> @user\``);
      return { handled: true };
    }

    const result = cardService.proposeTrade({
      userJid,
      scopeKey,
      cardId: idToken,
      targetJid,
      funConfig,
    });
    if (!result.ok) {
      if (result.reason === 'not-found') {
        await reply('Carta não encontrada. Veja ids em `/cartas`.');
        return { handled: true };
      }
      if (result.reason === 'listed') {
        await reply('Carta no bazar não troca. Cancele o anúncio antes.');
        return { handled: true };
      }
      if (result.reason === 'invalid-target') {
        await reply('Alvo inválido.');
        return { handled: true };
      }
      await reply(fmt.genericError({ command: 'cartas trocar' }));
      return { handled: true };
    }

    const who = nameOf(getContactDisplayName, targetJid);
    await reply(
      [
        '🔄 *Proposta de troca*',
        `Você oferece *${result.card.displayName}* ${tierLabel(result.card.tier)}`,
        `Para: *${who}*`,
        '',
        `${who}: \`${p}cartas trocar <seu id>\` pra aceitar`,
        'Ou recuse com `/recusar`',
      ].join('\n')
    );
    return { handled: true, result };
  }

  // ── vender no bazar ──
  if (sub === 'vender' || sub === 'sell' || sub === 'listar') {
    const idToken = String(rest[0] || '').trim();
    const price = parseAmountFromArgs(rest.slice(1));
    if (!idToken || !price) {
      await reply(`Uso: \`${p}cartas vender <id> <preço>\``);
      return { handled: true };
    }
    const result = cardService.listOnBazaar({
      userJid,
      scopeKey,
      cardId: idToken,
      price,
    });
    if (!result.ok) {
      if (result.reason === 'not-found') {
        await reply('Carta não encontrada.');
        return { handled: true };
      }
      if (result.reason === 'already-listed') {
        await reply('Já está no bazar.');
        return { handled: true };
      }
      if (result.reason === 'invalid-price') {
        await reply('Preço inválido (1–1000000).');
        return { handled: true };
      }
      await reply('Não listou.');
      return { handled: true };
    }
    await reply(
      [
        '📌 *Carta no bazar*',
        `*${result.card.displayName}* ${tierLabel(result.card.tier)} · *${price}*c`,
        `anúncio \`${result.listing.id.slice(0, 8)}\``,
        `Comprar: \`${p}bazar comprar ${result.listing.id.slice(0, 8)}\``,
      ].join('\n')
    );
    return { handled: true, result };
  }

  // ── cancelar anúncio ──
  if (sub === 'cancelar' || sub === 'cancel') {
    const token = String(rest[0] || '').trim();
    if (!token) {
      await reply(`Uso: \`${p}cartas cancelar <id do anúncio>\``);
      return { handled: true };
    }
    const result = cardService.cancelListing({
      userJid,
      scopeKey,
      listingId: token,
    });
    if (!result.ok) {
      await reply('Anúncio não encontrado ou não é seu.');
      return { handled: true };
    }
    await reply('Anúncio de carta cancelado.');
    return { handled: true, result };
  }

  // fallback: trata args[0] como id de favoritar se parecer uuid prefix? senão help
  await reply(helpText(p));
  return { handled: true };
}
