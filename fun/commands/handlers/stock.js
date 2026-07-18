/**
 * Comandos da bolsa: /bolsa e /carteira
 */

import {
  renderBolsaBoardPng,
  renderCarteiraCardPng,
} from '../../formatters/rankCardImage.js';

async function tryReplyBoardImage(stockService, scopeKey, funConfig, replyImage) {
  if (funConfig.rankCardImage === false || typeof replyImage !== 'function') return false;
  try {
    const quotes = stockService.listQuotes(scopeKey, funConfig);
    if (!quotes.length) return false;
    const png = renderBolsaBoardPng({ quotes });
    await replyImage(png, '📈 Corretora do Beco');
    return true;
  } catch {
    return false;
  }
}

async function tryReplyPortfolioImage(stockService, userJid, scopeKey, funConfig, replyImage) {
  if (funConfig.rankCardImage === false || typeof replyImage !== 'function') return false;
  try {
    const div = stockService.payDividends({ userJid, scopeKey, funConfig });
    const port = stockService.portfolio(userJid, scopeKey, funConfig);
    const png = renderCarteiraCardPng({
      positions: port.positions,
      totalValue: port.totalValue,
      unrealized: port.unrealized,
      dividendTotal: div.total || 0,
    });
    await replyImage(png, '💼 Sua carteira');
    return true;
  } catch {
    return false;
  }
}

export async function handleBolsaCommand({
  userJid,
  scopeKey,
  stockService,
  funConfig,
  reply,
  replyImage,
  args = [],
  achievementService = null,
}) {
  if (!stockService) {
    await reply('Bolsa indisponível.');
    return { handled: true };
  }
  if (funConfig.bolsaEnabled === false) {
    await reply('Bolsa fechada no beco agora.');
    return { handled: true };
  }

  const sub = String(args[0] || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!sub || sub === 'lista' || sub === 'board' || sub === 'cotacao' || sub === 'cotações') {
    if (await tryReplyBoardImage(stockService, scopeKey, funConfig, replyImage)) {
      return { handled: true, image: true };
    }
    await reply(stockService.formatBoard(scopeKey, funConfig));
    return { handled: true };
  }

  if (sub === 'carteira' || sub === 'portfolio' || sub === 'portifolio') {
    if (await tryReplyPortfolioImage(stockService, userJid, scopeKey, funConfig, replyImage)) {
      return { handled: true, image: true };
    }
    await reply(stockService.formatPortfolio(userJid, scopeKey, funConfig));
    return { handled: true };
  }

  if (sub === 'comprar' || sub === 'buy' || sub === 'compra') {
    const token = String(args[1] || '').trim();
    const qty = args[2];
    if (!token || !qty) {
      await reply('Uso: `/bolsa comprar bombatech 3`');
      return { handled: true };
    }
    const result = stockService.buy({
      userJid,
      scopeKey,
      token,
      qty,
      funConfig,
    });
    await reply(stockService.formatTradeResult(result));
    if (result?.ok) {
      try {
        const unlocked =
          achievementService?.check?.(userJid, scopeKey, 'stock_buy', {}, funConfig) || [];
        if (unlocked.length) {
          await reply(unlocked.map((u) => `🏆 *${u.icon} ${u.name}*`).join('\n'));
        }
      } catch {
        /* ignore */
      }
    }
    return { handled: true };
  }

  if (sub === 'vender' || sub === 'sell' || sub === 'venda') {
    const token = String(args[1] || '').trim();
    const qty = args[2];
    if (!token || !qty) {
      await reply('Uso: `/bolsa vender bombatech 1`');
      return { handled: true };
    }
    const result = stockService.sell({
      userJid,
      scopeKey,
      token,
      qty,
      funConfig,
    });
    await reply(stockService.formatTradeResult(result));
    return { handled: true };
  }

  await reply(
    [
      '📈 *Corretora do Beco*',
      '`/bolsa` — cotações',
      '`/bolsa comprar <ticker> <qtd>`',
      '`/bolsa vender <ticker> <qtd>`',
      '`/carteira` — suas ações',
    ].join('\n')
  );
  return { handled: true };
}

export async function handleCarteiraCommand({
  userJid,
  scopeKey,
  stockService,
  funConfig,
  reply,
  replyImage,
}) {
  if (!stockService) {
    await reply('Carteira indisponível.');
    return { handled: true };
  }
  if (funConfig.bolsaEnabled === false) {
    await reply('Bolsa fechada no beco agora.');
    return { handled: true };
  }
  if (await tryReplyPortfolioImage(stockService, userJid, scopeKey, funConfig, replyImage)) {
    return { handled: true, image: true };
  }
  await reply(stockService.formatPortfolio(userJid, scopeKey, funConfig));
  return { handled: true };
}
