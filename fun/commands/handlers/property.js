/**
 * Comandos de negócios: /propriedades, /negocio, /coletar
 */

import { nameOf } from '../../utils/userLabel.js';

export async function handlePropertyCommand({
  userJid,
  scopeKey,
  propertyService,
  achievementService = null,
  newsService = null,
  funConfig,
  reply,
  args = [],
}) {
  if (!propertyService || funConfig.propertiesEnabled === false) {
    await reply('Negócios desligados neste bot.');
    return { handled: true };
  }

  const sub = String(args[0] || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!sub || sub === 'lista' || sub === 'list' || sub === 'help' || sub === 'ajuda') {
    await reply(propertyService.formatList(scopeKey, userJid, funConfig));
    return { handled: true };
  }

  if (sub === 'comprar' || sub === 'buy') {
    const id = args[1] || args.slice(1).join('_');
    const result = propertyService.buy({
      userJid,
      scopeKey,
      propertyId: id,
      funConfig,
    });
    if (!result.ok) {
      if (result.reason === 'unknown') {
        await reply('Negócio inválido. `/negocio` pra ver o catálogo.');
        return { handled: true };
      }
      if (result.reason === 'already-owned') {
        await reply(`Você já tem *${result.def?.name || id}*.`);
        return { handled: true };
      }
      if (result.reason === 'max-owned') {
        await reply(`Limite de *${result.max}* negócios. Coleta e lucra antes de expandir.`);
        return { handled: true };
      }
      if (result.reason === 'no-coins') {
        await reply(`Faltam coins. Precisa *${result.need}*c · você tem *${result.coins}*c.`);
        return { handled: true };
      }
      await reply('Não deu pra comprar.');
      return { handled: true };
    }

    const unlocked =
      achievementService?.check?.(userJid, scopeKey, 'property_buy', {}, funConfig) || [];
    newsService?.log?.(scopeKey, 'property_buy', {
      userJid,
      payload: { name: result.def.name, cost: result.def.cost },
    });
    achievementService?.check?.(
      userJid,
      scopeKey,
      'coins',
      { coins: result.coins },
      funConfig
    );

    const lines = [
      `${result.def.emoji} *Negócio comprado:* ${result.def.name}`,
      `Custo *${result.def.cost}*c · renda ~*${result.def.incomePerTick}*c/tick (buffer)`,
      `Saldo: *${result.coins}*c`,
      '_Renda enche o caixa. Use `/coletar` pra sacar._',
    ];
    if (unlocked.length) {
      lines.push(
        '',
        ...unlocked.map((u) => `🏆 *${u.icon} ${u.name}*`)
      );
    }
    await reply(lines.join('\n'));
    return { handled: true, result };
  }

  if (sub === 'consertar' || sub === 'reparar' || sub === 'repair') {
    const id = args[1] || args.slice(1).join('_');
    const result = propertyService.repair({
      userJid,
      scopeKey,
      propertyId: id,
      funConfig,
    });
    if (!result.ok) {
      if (result.reason === 'unknown') {
        await reply('Use: `/negocio consertar barraca`');
        return { handled: true };
      }
      if (result.reason === 'not-owned') {
        await reply('Você não tem esse negócio.');
        return { handled: true };
      }
      if (result.reason === 'full-health') {
        await reply(`${result.def.emoji} *${result.def.name}* já tá inteiro.`);
        return { handled: true };
      }
      if (result.reason === 'no-coins') {
        await reply(`Conserto custa *${result.need}*c · você tem *${result.coins}*c.`);
        return { handled: true };
      }
      await reply('Não deu pra consertar.');
      return { handled: true };
    }
    await reply(
      [
        `🔧 *${result.def.emoji} ${result.def.name}* consertado.`,
        `Gastou *${result.cost}*c · vida 100% · saldo *${result.coins}*c`,
      ].join('\n')
    );
    return { handled: true, result };
  }

  await reply(propertyService.formatList(scopeKey, userJid, funConfig));
  return { handled: true };
}

export async function handleCollectCommand({
  userJid,
  scopeKey,
  propertyService,
  achievementService = null,
  newsService = null,
  funConfig,
  reply,
  getContactDisplayName,
}) {
  if (!propertyService || funConfig.propertiesEnabled === false) {
    await reply('Negócios desligados neste bot.');
    return { handled: true };
  }

  const result = propertyService.collect({ userJid, scopeKey, funConfig });
  if (!result.ok) {
    if (result.reason === 'empty') {
      await reply('Caixa vazio. Espera o tick do mundo encher o buffer.');
      return { handled: true };
    }
    await reply('Nada pra coletar.');
    return { handled: true };
  }

  const unlocked =
    achievementService?.check?.(
      userJid,
      scopeKey,
      'property_collect',
      { amount: result.total },
      funConfig
    ) || [];
  achievementService?.check?.(
    userJid,
    scopeKey,
    'coins',
    { coins: result.coins },
    funConfig
  );
  if (result.total >= 40) {
    newsService?.log?.(scopeKey, 'property_collect', {
      userJid,
      payload: { amount: result.total },
    });
  }

  const detail =
    result.details
      ?.map((d) => `· ${d.propertyType}: *${d.amount}*c`)
      .join('\n') || '';

  const who = nameOf(getContactDisplayName, userJid);
  const lines = [
    `💵 *Coleta* ${who}`,
    `Sacou *${result.total}*c do caixa dos negócios.`,
    detail,
    `Saldo: *${result.coins}*c`,
  ];
  if (unlocked.length) {
    lines.push('', ...unlocked.map((u) => `🏆 *${u.icon} ${u.name}*`));
  }
  await reply(lines.filter(Boolean).join('\n'));
  return { handled: true, result };
}
