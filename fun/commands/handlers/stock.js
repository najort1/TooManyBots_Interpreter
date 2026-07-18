/**
 * Comandos da bolsa: /bolsa e /carteira
 */

import {
  renderBolsaBoardPng,
  renderCarteiraCardPng,
} from '../../formatters/rankCardImage.js';

/** Caption de imagem no WhatsApp (limite prático). */
const WA_CAPTION_MAX = 1024;

/**
 * Caption da imagem: WA ~1024 chars.
 * Board do zap já é enxuto (sem blurb de empresa); se ainda estourar, corta.
 */
function boardCaptionForImage(board) {
  const text = String(board || '');
  if (text.length <= WA_CAPTION_MAX) return text;
  return text.slice(0, WA_CAPTION_MAX - 1) + '…';
}

/**
 * Uma única mensagem: imagem + caption; senão só texto.
 * Detalhes das empresas ficam no link da corretora web.
 */
async function replyBoardOnce(stockService, scopeKey, funConfig, reply, replyImage) {
  const board = stockService.formatBoard(scopeKey, funConfig);
  const canImage =
    funConfig.rankCardImage !== false && typeof replyImage === 'function';

  if (canImage) {
    try {
      const quotes = stockService.listQuotes(scopeKey, funConfig);
      if (quotes.length) {
        const png = renderBolsaBoardPng({ quotes });
        await replyImage(png, boardCaptionForImage(board));
        return { image: true };
      }
    } catch {
      // cai no texto
    }
  }

  await reply(board);
  return { image: false };
}

async function replyPortfolioOnce(
  stockService,
  userJid,
  scopeKey,
  funConfig,
  reply,
  replyImage
) {
  const text = stockService.formatPortfolio(userJid, scopeKey, funConfig);
  const canImage =
    funConfig.rankCardImage !== false &&
    typeof replyImage === 'function' &&
    text.length <= WA_CAPTION_MAX;

  if (canImage) {
    try {
      const div = stockService.payDividends({ userJid, scopeKey, funConfig });
      const port = stockService.portfolio(userJid, scopeKey, funConfig);
      if (port.positions?.length) {
        const png = renderCarteiraCardPng({
          positions: port.positions,
          totalValue: port.totalValue,
          unrealized: port.unrealized,
          dividendTotal: div.total || 0,
        });
        await replyImage(png, text);
        return { image: true };
      }
    } catch {
      // cai no texto
    }
  }

  await reply(text);
  return { image: false };
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
    const out = await replyBoardOnce(
      stockService,
      scopeKey,
      funConfig,
      reply,
      replyImage
    );
    return { handled: true, image: out.image };
  }

  if (sub === 'carteira' || sub === 'portfolio' || sub === 'portifolio') {
    const out = await replyPortfolioOnce(
      stockService,
      userJid,
      scopeKey,
      funConfig,
      reply,
      replyImage
    );
    return { handled: true, image: out.image };
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
  const out = await replyPortfolioOnce(
    stockService,
    userJid,
    scopeKey,
    funConfig,
    reply,
    replyImage
  );
  return { handled: true, image: out.image };
}
