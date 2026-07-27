import { listShopItems } from '../../shop/catalog.js';
import { fmt } from '../../messages/index.js';

function formatDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}min` : `${h}h`;
}

export async function handleShopCommand({
  reply,
  effectsRepository,
  userJid,
  scopeKey,
  shopService = null,
}) {
  const items =
    typeof shopService?.list === 'function' ? shopService.list() : listShopItems();
  const lines = [
    '🛒 *Loja Fun*',
    'Coins servem pra isso — gaste e ganhe vantagem.',
    '',
  ];

  for (const item of items) {
    const stock =
      item.id === 'crime_immunity_pass' && item.stockLabel
        ? ` · ${item.stockLabel}`
        : '';
    lines.push(
      `${item.emoji} *${item.id}* — ${item.price} coins${stock}`,
      `   ${item.name}: ${item.description}`,
      ''
    );
  }

  lines.push('Comprar: `/comprar chave_armas` · `/comprar boost_xp` · `/comprar crime_immunity_pass`');
  lines.push('Título: `/titulo MeuNick`');
  lines.push('');
  lines.push('_Chave de armas é *só sua* — não libera o grupo._');
  lines.push('_Crime Immunity Pass: 1 por semana no servidor (3 dias ou 20 crimes)._');
  lines.push('_Rua (estoque finito + preço vivo):_ `/mercado` · `/armas`');
  lines.push('_Players:_ `/bazar` · farm: `/assaltar banco` · for fun: `/assaltar @user`');

  if (effectsRepository) {
    const active = effectsRepository.listActiveEffects(userJid, scopeKey);
    if (active.length) {
      lines.push('', '*Seus buffs ativos:*');
      for (const e of active) {
        if (e.expiresAt > 0 && e.charges > 0 && e.payload?.useCharges) {
          const left = e.expiresAt - Date.now();
          lines.push(
            `• ${e.effectKey} · ~${formatDuration(Math.max(0, left))} · ${e.charges} usos`
          );
        } else if (e.expiresAt > 0) {
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
      await reply(fmt.itemNotFound({ command: 'loja' }));
      return { handled: true };
    }
    if (result?.reason === 'insufficient-funds') {
      await reply(fmt.insufficientBalance({ required: result.price, current: result.coins }));
      return { handled: true };
    }
    if (result?.reason === 'already-owned') {
      await reply(
        result.item?.id === 'chave_armas'
          ? 'Você *já tem* a chave de armas nesta conta. É individual — não vende de novo.'
          : fmt.alreadyOwned()
      );
      return { handled: true };
    }
    if (result?.reason === 'title-required') {
      await reply(`Informe o título (até ${result.maxLen} caracteres).`);
      return { handled: true };
    }
    if (result?.reason === 'weekly-sold-out') {
      const h = Math.ceil((Number(result.retryInMs) || 0) / 3_600_000);
      await reply(
        `🕶️ *Crime Immunity Pass* esgotado esta semana (só 1 no servidor).` +
          (h > 0 ? ` Volta em ~${h}h.` : '')
      );
      return { handled: true };
    }
    if (result?.reason === 'already-active') {
      await reply('Você já tem esse efeito ativo.');
      return { handled: true };
    }
    await reply(fmt.genericError({ command: 'comprar' }));
    return { handled: true };
  }

  const item = result.item;
  const lines = [
    '✅ *Compra feita*',
    `${item.emoji} *${item.name}* (−${item.price} coins)`,
    item.description,
    `Saldo: *${result.coins}*`,
  ];
  if (item.id === 'chave_armas') {
    lines.push('_Só *você* acessa `/armas` com isso. O grupo continua na corrida._');
  }
  if (item.id === 'crime_immunity_pass' && result.immunity?.active) {
    lines.push(
      `Imunidade: *${result.immunity.remainingUses}* crimes ou até o prazo — Wanted ainda sobe devagar.`
    );
  }
  if (result.title) lines.push(`Título: *${result.title}*`);
  await reply(lines.join('\n'));
  return { handled: true, result };
}
