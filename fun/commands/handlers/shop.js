import { listShopItems } from '../../shop/catalog.js';

function formatDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}min` : `${h}h`;
}

export async function handleShopCommand({ reply, effectsRepository, userJid, scopeKey }) {
  const items = listShopItems();
  const lines = [
    '🛒 *Loja Fun*',
    'Coins servem pra isso — gaste e ganhe vantagem.',
    '',
  ];

  for (const item of items) {
    lines.push(
      `${item.emoji} *${item.id}* — ${item.price} coins`,
      `   ${item.name}: ${item.description}`,
      ''
    );
  }

  lines.push('Comprar: `/comprar boost_xp`');
  lines.push('Título: `/titulo MeuNick` (custa o item title)');

  if (effectsRepository) {
    const active = effectsRepository.listActiveEffects(userJid, scopeKey);
    if (active.length) {
      lines.push('', '*Seus buffs ativos:*');
      for (const e of active) {
        if (e.expiresAt > 0) {
          const left = e.expiresAt - Date.now();
          lines.push(`• ${e.effectKey} · ~${formatDuration(Math.max(0, left))}`);
        } else if (e.charges > 0) {
          lines.push(`• ${e.effectKey} · ${e.charges}x`);
        }
      }
    }
  }

  await reply(lines.join('\n'));
  return { handled: true };
}

export async function handleBuyCommand({
  userJid,
  scopeKey,
  shopService,
  funConfig,
  reply,
  args,
}) {
  const itemId = String(args[0] || '').trim().toLowerCase();
  if (!itemId) {
    await reply('Uso: `/comprar boost_xp` — veja a lista em `/loja`.');
    return { handled: true };
  }

  if (itemId === 'title' || itemId === 'titulo') {
    const titleText = args.slice(1).join(' ').trim();
    if (!titleText) {
      await reply('Uso: `/comprar title Lenda` ou `/titulo Lenda`');
      return { handled: true };
    }
    const result = shopService.buy({
      userJid,
      scopeKey,
      itemId: 'title',
      titleText,
      funConfig,
    });
    return replyBuyResult(reply, result);
  }

  const result = shopService.buy({
    userJid,
    scopeKey,
    itemId,
    funConfig,
  });
  return replyBuyResult(reply, result);
}

export async function handleTitleCommand({
  userJid,
  scopeKey,
  shopService,
  funConfig,
  reply,
  args,
}) {
  const titleText = args.join(' ').trim();
  if (!titleText) {
    await reply('Uso: `/titulo Lenda` — custa o item da loja (title).');
    return { handled: true };
  }
  const result = shopService.buy({
    userJid,
    scopeKey,
    itemId: 'title',
    titleText,
    funConfig,
  });
  return replyBuyResult(reply, result);
}

async function replyBuyResult(reply, result) {
  if (!result?.ok) {
    if (result?.reason === 'unknown-item') {
      await reply('Item desconhecido. Veja `/loja`.');
      return { handled: true };
    }
    if (result?.reason === 'insufficient-funds') {
      await reply(`Faltam coins. Preço *${result.price}*, você tem *${result.coins}*.`);
      return { handled: true };
    }
    if (result?.reason === 'title-required') {
      await reply(`Informe o título (até ${result.maxLen} caracteres).`);
      return { handled: true };
    }
    await reply('Não foi possível comprar.');
    return { handled: true };
  }

  const item = result.item;
  const lines = [
    '✅ *Compra feita*',
    `${item.emoji} *${item.name}* (−${item.price} coins)`,
    item.description,
    `Saldo: *${result.coins}*`,
  ];
  if (result.title) lines.push(`Título: *${result.title}*`);
  await reply(lines.join('\n'));
  return { handled: true, result };
}
