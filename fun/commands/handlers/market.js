/**
 * Mercado utilitário, armas, inventário, bazar e assalto.
 */

import { parseAmountFromArgs, resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf, displayNameOnly } from '../../utils/userLabel.js';

function arrow(trend) {
  if (trend === 'up') return '↑';
  if (trend === 'down') return '↓';
  return '→';
}

function findInv(list, token) {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  let hit = list.find((i) => i.id === t);
  if (hit) return hit;
  hit = list.find((i) => i.id.startsWith(t) || i.id.replace(/-/g, '').startsWith(t));
  if (hit) return hit;
  hit = list.find((i) => i.itemId === t && i.condition === 'ok' && !i.listed);
  if (hit) return hit;
  return list.find((i) => i.itemId === t) || null;
}

function formatRetry(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m`;
}

export async function handleGalleryCommand({
  scopeKey,
  marketService,
  funConfig,
  reply,
}) {
  if (!marketService) {
    await reply('Mercado indisponível.');
    return { handled: true };
  }
  await reply(marketService.formatGallery(scopeKey, funConfig));
  return { handled: true };
}

export async function handleWeaponsCommand({
  userJid,
  scopeKey,
  marketService,
  funConfig,
  reply,
}) {
  if (!marketService) {
    await reply('Armas indisponíveis.');
    return { handled: true };
  }
  await reply(marketService.formatWeaponsShop(scopeKey, funConfig, userJid));
  return { handled: true };
}

export async function handleInventoryCommand({
  userJid,
  scopeKey,
  marketService,
  funConfig,
  reply,
}) {
  if (!marketService) {
    await reply('Inventário indisponível.');
    return { handled: true };
  }
  const items = marketService.inventoryOf(userJid, scopeKey, funConfig);
  if (!items.length) {
    await reply(
      [
        '🎒 *Inventário vazio*',
        'Mercado: `/mercado` · Armas: `/armas` (sua chave: `/comprar chave_armas`)',
        'Munição: `/adquirir municao` no `/mercado`',
      ].join('\n')
    );
    return { handled: true };
  }

  const ready = (id) =>
    items.filter((i) => i.itemId === id && i.condition === 'ok' && !i.listed).length;
  const ammoReady = ready('municao');
  const gasReady = ready('gasolina');

  const lines = [
    '🎒 *Seu arsenal / mochila*',
    `🔫 Munição pronta: *${ammoReady}* tiro(s) · ⛽ Gasolina: *${gasReady}*`,
    '',
  ];
  for (const it of items) {
    const col = it.collectible;
    const status =
      it.condition === 'broken'
        ? '💔 quebrado'
        : it.listed
          ? `📌 bazar ${it.listingPrice}c`
          : 'ok';
    const uses =
      it.usesLeft >= 0 ? ` · ${it.usesLeft} usos` : col?.uses === 1 ? ' · consumível' : '';
    lines.push(
      `${col?.emoji || '▪️'} *${col?.name || it.itemId}* (${status}${uses})`,
      `   id \`${it.id.slice(0, 8)}\` · mercado *${it.marketPrice}* ${arrow(it.trend)}`,
      col?.benefit ? `   ${col.benefit}` : null,
      it.condition === 'broken'
        ? `   \`/consertar ${it.id.slice(0, 8)}\` · *${it.repairCost}*c`
        : `   \`/vender ${it.id.slice(0, 8)} <preço>\``,
      ''
    );
  }
  const arsenal = marketService.factionArsenal?.(scopeKey) || [];
  if (arsenal.length) {
    lines.push('*Arsenal das panelinhas* (troféus)');
    for (const f of arsenal.slice(0, 5)) {
      lines.push(`${f.emoji || '🏴‍☠️'} ${f.name}: ${f.pieces} arma(s) · poder ${f.score}`);
    }
  }
  await reply(lines.filter((l) => l != null).join('\n'));
  return { handled: true };
}

export async function handleBazaarCommand({
  userJid,
  scopeKey,
  marketService,
  getContactDisplayName,
  reply,
  args = [],
}) {
  if (!marketService) {
    await reply('Bazar indisponível.');
    return { handled: true };
  }

  const sub = String(args[0] || '').trim().toLowerCase();
  if (sub === 'comprar' || sub === 'buy') {
    const listingId = String(args[1] || '').trim();
    const open = marketService.listOpenListings(scopeKey);
    const listing =
      open.find((l) => l.id === listingId) ||
      open.find((l) => l.id.startsWith(listingId));
    if (!listing) {
      await reply('Anúncio não encontrado.');
      return { handled: true };
    }
    const result = marketService.buyFromBazaar({
      userJid,
      scopeKey,
      listingId: listing.id,
    });
    if (!result.ok) {
      if (result.reason === 'insufficient-funds') {
        await reply(`Faltam coins. Preço *${result.price}*, você tem *${result.coins}*.`);
        return { handled: true };
      }
      if (result.reason === 'self-buy') {
        await reply('Não compra o próprio anúncio. `/vender cancelar <id>`');
        return { handled: true };
      }
      await reply('Compra no bazar falhou.');
      return { handled: true };
    }
    await reply(
      [
        '🛍️ *Comprou no bazar*',
        `${result.collectible?.emoji || ''} *${result.collectible?.name}* por *${result.price}*`,
        `de ${nameOf(getContactDisplayName, result.sellerJid)} · saldo *${result.coins}*`,
      ].join('\n')
    );
    return { handled: true, result };
  }

  const listings = marketService.listOpenListings(scopeKey);
  if (!listings.length) {
    await reply(
      [
        '🏪 *Bazar de jogadores*',
        'Nada à venda.',
        'Liste: `/vender <id> <preço>` (ids em `/inventario`)',
        '_Aqui o dono da gasolina dita o preço pra quem tem carro sem combustível._',
      ].join('\n')
    );
    return { handled: true };
  }

  const lines = [
    '🏪 *Bazar de jogadores*',
    '_Não é a /loja de buffs nem o estoque do bot._',
    '',
  ];
  for (const l of listings) {
    const col = marketService.getCollectible(l.itemId);
    lines.push(
      `${col?.emoji || '▪️'} *${col?.name || l.itemId}* — *${l.price}*c`,
      `   ${nameOf(getContactDisplayName, l.sellerJid)} · \`${l.id.slice(0, 8)}\``,
      `   \`/bazar comprar ${l.id.slice(0, 8)}\``,
      ''
    );
  }
  await reply(lines.join('\n'));
  return { handled: true };
}

export async function handleSellItemCommand({
  userJid,
  scopeKey,
  marketService,
  funConfig,
  reply,
  args = [],
}) {
  if (!marketService) {
    await reply('Venda indisponível.');
    return { handled: true };
  }

  const head = String(args[0] || '').trim().toLowerCase();
  if (head === 'cancelar' || head === 'cancel') {
    const token = String(args[1] || '').trim();
    const open = marketService
      .listOpenListings(scopeKey)
      .filter((l) => l.sellerJid === userJid);
    const listing =
      open.find((l) => l.id === token) || open.find((l) => l.id.startsWith(token));
    if (!listing) {
      await reply('Anúncio não encontrado.');
      return { handled: true };
    }
    marketService.cancelListing({ userJid, scopeKey, listingId: listing.id });
    await reply('Anúncio cancelado.');
    return { handled: true };
  }

  const invToken = String(args[0] || '').trim();
  const price = parseAmountFromArgs(args.slice(1));
  if (!invToken || !price) {
    await reply(
      [
        'Uso: `/vender <id> <preço>`',
        'Ex.: quem tem *gasolina* pode cobrar caro de quem tem *carro*.',
        '`/inventario` lista ids · `/vender cancelar <id>`',
      ].join('\n')
    );
    return { handled: true };
  }

  const bag = marketService.inventoryOf(userJid, scopeKey, funConfig);
  const inv = findInv(bag, invToken);
  if (!inv) {
    await reply('Item não encontrado. `/inventario`');
    return { handled: true };
  }

  const result = marketService.listOnBazaar({
    userJid,
    scopeKey,
    inventoryId: inv.id,
    price,
  });
  if (!result.ok) {
    if (result.reason === 'broken') {
      await reply('Quebrado não vende. `/consertar`');
      return { handled: true };
    }
    if (result.reason === 'already-listed') {
      await reply('Já está no bazar.');
      return { handled: true };
    }
    await reply('Não listou.');
    return { handled: true };
  }

  await reply(
    [
      '📌 *No bazar*',
      `${result.collectible?.emoji || ''} *${result.collectible?.name}* · *${price}*c`,
      `id \`${result.listing.id.slice(0, 8)}\``,
    ].join('\n')
  );
  return { handled: true, result };
}

export async function handleBuyCollectibleCommand({
  userJid,
  scopeKey,
  marketService,
  funConfig,
  reply,
  args = [],
}) {
  if (!marketService) {
    await reply('Loja indisponível.');
    return { handled: true };
  }
  const itemId = String(args[0] || '').trim();
  if (!itemId) {
    await reply('Uso: `/adquirir gasolina` ou `/adquirir pistola`');
    return { handled: true };
  }

  const col = marketService.getCollectible(itemId);
  const shop = col?.weaponShop ? 'weapons' : 'utility';

  const result = marketService.buyFromShop({
    userJid,
    scopeKey,
    itemId,
    funConfig,
    shop,
  });

  if (!result.ok) {
    if (result.reason === 'unknown-item') {
      await reply('Item desconhecido. `/mercado` ou `/armas`.');
      return { handled: true };
    }
    if (result.reason === 'no-license') {
      await reply(
        [
          'Armas trancadas *pra você*.',
          'A chave é *individual* — quem compra não libera o grupo.',
          'Compre a sua: `/comprar chave_armas` na `/loja`.',
        ].join('\n')
      );
      return { handled: true };
    }
    if (result.reason === 'out-of-stock') {
      await reply('Esgotado neste grupo. Espere reposição ou compre no `/bazar`.');
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Faltam coins. Preço *${result.price}*, você tem *${result.coins}*.`);
      return { handled: true };
    }
    if (result.reason === 'wrong-shop') {
      await reply(
        col?.weaponShop
          ? 'Isso é arma — use `/armas` (com chave) e `/adquirir`.'
          : 'Isso é do mercado de rua — `/mercado`.'
      );
      return { handled: true };
    }
    await reply('Compra falhou.');
    return { handled: true };
  }

  const bag = marketService.inventoryOf(userJid, scopeKey, funConfig);
  const ammoReady = bag.filter(
    (i) => i.itemId === 'municao' && i.condition === 'ok' && !i.listed
  ).length;
  const needsAmmo = result.item.requires === 'municao';

  await reply(
    [
      '✅ *Comprou*',
      `${result.item.emoji} *${result.item.name}* — *${result.price}*c ${arrow(result.trend)}`,
      `Estoque do grupo: *${result.stockLeft}* · id \`${result.inventory.id.slice(0, 8)}\``,
      needsAmmo
        ? `_Sua munição agora: *${ammoReady}* tiro(s)_ · veja em \`/inventario\` · compre: \`/adquirir municao\``
        : result.item.requires
          ? `_Lembre: precisa de *${result.item.requires}* · \`/inventario\``
          : null,
      result.item.id === 'municao'
        ? `_Munição pronta: *${ammoReady}* tiro(s)_ · \`/inventario\``
        : null,
      `Saldo *${result.coins}* · ${result.item.benefit}`,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}

export async function handleRepairItemCommand({
  userJid,
  scopeKey,
  marketService,
  funConfig,
  reply,
  args = [],
}) {
  if (!marketService) {
    await reply('Conserto indisponível.');
    return { handled: true };
  }
  const token = String(args[0] || '').trim();
  if (!token) {
    await reply('Uso: `/consertar <id>`');
    return { handled: true };
  }
  const bag = marketService.inventoryOf(userJid, scopeKey, funConfig);
  const inv = findInv(bag, token);
  if (!inv) {
    await reply('Item não encontrado.');
    return { handled: true };
  }
  const result = marketService.repairItem({
    userJid,
    scopeKey,
    inventoryId: inv.id,
    funConfig,
  });
  if (!result.ok) {
    if (result.reason === 'not-broken') {
      await reply('Não está quebrado.');
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Conserto *${result.price}*c · você tem *${result.coins}*.`);
      return { handled: true };
    }
    await reply('Não consertou.');
    return { handled: true };
  }
  await reply(
    `🔧 *${result.collectible?.name}* consertado por *${result.cost}*c · saldo *${result.coins}*`
  );
  return { handled: true, result };
}

/** Roteiro besteirol longo (não frase curta). */
async function assaultFlavor(flavorService, scenario, vars) {
  try {
    if (typeof flavorService?.assaultStory === 'function') {
      return await flavorService.assaultStory(scenario, vars);
    }
    if (typeof flavorService?.line === 'function') {
      return await flavorService.line(scenario, vars);
    }
    if (typeof flavorService?.italicLine === 'function') {
      return await flavorService.italicLine(scenario, vars);
    }
  } catch {
    return null;
  }
  return null;
}

function assaultScenario(result) {
  const ok = Boolean(result?.success);
  if (result?.mode === 'bank') return ok ? 'assault_bank_win' : 'assault_bank_fail';
  if (result?.mode === 'shop') return ok ? 'assault_shop_win' : 'assault_shop_fail';
  return ok ? 'assault_player_win' : 'assault_player_fail';
}

export async function handleAssaultCommand({
  userJid,
  scopeKey,
  marketService,
  funConfig,
  getContactDisplayName,
  listContacts,
  reply,
  flavorService,
  achievementService = null,
  newsService = null,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  sock,
  identityMap,
}) {
  if (!marketService?.assault) {
    await reply('Assalto indisponível.');
    return { handled: true };
  }

  const first = String(args[0] || '').trim();
  const heist =
    typeof marketService.resolveHeistTarget === 'function'
      ? marketService.resolveHeistTarget(first)
      : null;

  // sem args (ou “help” / “ev”): help + tabela de EV
  if (
    !first ||
    ['help', 'ajuda', 'ev', 'info', 'tabela'].includes(first.toLowerCase())
  ) {
    const text =
      typeof marketService.formatAssaultHelp === 'function'
        ? marketService.formatAssaultHelp(scopeKey, funConfig, userJid)
        : 'Uso: `/assaltar banco` · `/assaltar lojinha` · `/assaltar @pessoa`';
    await reply(text);
    return { handled: true };
  }

  let result;
  let pvpName = '';

  if (heist) {
    result = marketService.assault({
      attackerJid: userJid,
      heistToken: first,
      scopeKey,
      funConfig,
    });
  } else {
    const contacts = typeof listContacts === 'function' ? listContacts() : [];
    const resolved = await resolveUserTarget({
      args,
      mentionedJids,
      quotedParticipant,
      excludeJid: userJid,
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    const target = resolved?.jid;
    if (!target || !isCanonicalUserJid(target)) {
      await reply(
        typeof marketService.formatAssaultHelp === 'function'
          ? marketService.formatAssaultHelp(scopeKey, funConfig, userJid)
          : 'Uso: `/assaltar banco` · `/assaltar lojinha` · `/assaltar @pessoa`'
      );
      return { handled: true };
    }
    pvpName = nameOf(getContactDisplayName, target);
    result = marketService.assault({
      attackerJid: userJid,
      targetJid: target,
      scopeKey,
      funConfig,
    });
  }

  if (!result.ok) {
    if (result.reason === 'no-weapon') {
      await reply('Sem arma pronta. `/armas` (com chave) ou `/bazar`.');
      return { handled: true };
    }
    if (result.reason === 'no-ammo') {
      await reply('Arma de fogo sem *municao*. Compre no `/mercado` ou no `/bazar`.');
      return { handled: true };
    }
    if (result.reason === 'target-poor') {
      await reply(
        'Alvo sem grana o bastante. Prefira `/assaltar banco` ou `/assaltar lojinha` pra farmar.'
      );
      return { handled: true };
    }
    if (result.reason === 'cooldown') {
      await reply(`Esfria a mão. Próximo assalto em *${formatRetry(result.retryInMs)}*.`);
      return { handled: true };
    }
    await reply('Assalto inválido. `/assaltar` pra ver modos e EV.');
    return { handled: true };
  }

  const chancePct = Math.round((result.chance || 0) * 100);
  const isNpc = result.mode === 'bank' || result.mode === 'shop';
  const heistLabel =
    result.heistLabel || (result.mode === 'bank' ? 'Banco central' : 'Lojinha da esquina');
  // Roteiro LLM precisa de NOME legível (não @JID) — senão inventa "Marlison"
  const attackerStoryName = displayNameOnly(getContactDisplayName, userJid);
  const targetStoryName = isNpc
    ? heistLabel
    : displayNameOnly(getContactDisplayName, result.targetJid || '') || pvpName;
  const weaponLabel = [result.weapon?.emoji, result.weapon?.name].filter(Boolean).join(' ').trim();

  const story = await assaultFlavor(flavorService, assaultScenario(result), {
    attacker: attackerStoryName,
    target: targetStoryName,
    weapon: weaponLabel || result.weapon?.id || '',
    mode: result.mode || 'player',
    success: result.success ? 'sim' : 'nao',
    gas: result.usedGas ? 'sim' : 'nao',
  });

  const header = !result.success
    ? isNpc
      ? '🚨 *Heist falhou*'
      : '🚨 *Assalto falhou*'
    : result.mode === 'bank'
      ? '🏦 *Banco arrombado*'
      : result.mode === 'shop'
        ? '🏪 *Lojinha arrombada*'
        : '💀 *Assalto em player*';

  const stats = !result.success
    ? [
        `Alvo: *${isNpc ? heistLabel : pvpName}* · chance ~*${chancePct}%*`,
        `Arma: ${result.weapon?.emoji || ''} ${result.weapon?.name || '?'}`,
        result.usedGas ? 'Usou gasolina na fuga (mesmo assim deu ruim).' : null,
        result.fine > 0
          ? `Multa de fuga: *${result.fine}*c (teto baixo — não sangra conta cheia).`
          : null,
        `Saldo: *${result.coins}*`,
      ]
    : isNpc
      ? [
          `Levou *${result.stolen}* coins de *${heistLabel}*`,
          `Chance ~*${chancePct}%* · ${result.weapon?.emoji || ''} ${result.weapon?.name}`,
          result.usedGas ? 'Fuga com combustível ajudou.' : null,
          `Saldo: *${result.coins}*`,
          '_Farm principal. Players (`/assaltar @user`) é for fun com grana menor._',
        ]
      : [
          `Tirou *${result.stolen}* coins de *${pvpName}*`,
          result.stolenBuffer > 0
            ? `· Caixa do negócio (*${result.propertyName || 'propriedade'}*): *${result.stolenBuffer}*c${result.propertyDamage ? ` · dano ${result.propertyDamage}` : ''}`
            : null,
          result.stolenWallet > 0 ? `· Bolso: *${result.stolenWallet}*c` : null,
          `Chance ~*${chancePct}%* · ${result.weapon?.emoji || ''} ${result.weapon?.name}`,
          result.usedGas ? 'Fuga com combustível ajudou.' : null,
          `Seu saldo: *${result.coins}* · alvo: *${result.targetCoins}*`,
          '_Quer grana de verdade?_ `/assaltar banco`',
        ];

  await reply(
    [header, '', story || null, story ? '────────' : null, ...stats]
      .filter((l) => l != null && l !== false)
      .join('\n')
  );

  // hooks: conquistas + jornal
  try {
    if (result.success) {
      achievementService?.check?.(userJid, scopeKey, 'assault_win', {}, funConfig);
      newsService?.log?.(scopeKey, 'assault_win', {
        userJid,
        payload: {
          amount: result.stolen,
          buffer: result.stolenBuffer || 0,
          target: pvpName,
        },
      });
      if (result.stolenBuffer > 0) {
        newsService?.log?.(scopeKey, 'property_rob', {
          userJid,
          payload: {
            amount: result.stolenBuffer,
            name: result.propertyName,
          },
        });
      }
    } else {
      achievementService?.check?.(userJid, scopeKey, 'assault_fail', {}, funConfig);
    }
  } catch {
    /* ignore hooks */
  }

  return { handled: true, result };
}

export async function handleMarketEventCommand({
  scopeKey,
  marketService,
  funConfig,
  getContactDisplayName,
  reply,
  replyToChat,
  isGroup,
  args = [],
}) {
  if (!marketService) {
    await reply('Mercado indisponível.');
    return { handled: true };
  }
  const force = ['agora', 'force', 'forcar', 'forçar'].includes(
    String(args[0] || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  );

  const result = await marketService.runMarketEvent({
    scopeKey,
    funConfig,
    force,
  });

  if (!result.ok) {
    if (result.reason === 'too-soon') {
      const m = Math.ceil((result.retryInMs || 0) / 60000);
      await reply(`Próximo evento de mercado em ~*${m}m*.`);
      return { handled: true };
    }
    await reply('Sem evento agora.');
    return { handled: true };
  }

  const text = marketService.formatEventAnnouncement(result, getContactDisplayName);
  if (isGroup && typeof replyToChat === 'function') await replyToChat(text);
  else await reply(text);
  return { handled: true, result };
}
