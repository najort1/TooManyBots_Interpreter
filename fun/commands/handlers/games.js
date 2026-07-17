import { parseAmountFromArgs, resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';

function parseFlipArgs(args = []) {
  const amount = parseAmountFromArgs(args);
  let choice = null;
  for (const arg of args) {
    const t = String(arg || '').trim().toLowerCase();
    if (!t || /^\d+$/.test(t)) continue;
    // tenta parse via gameService depois; aqui só pega o token
    if (/^(cara|coroa|c|k|heads|tails|h|t|frente|verso)$/i.test(t)) {
      choice = t;
      break;
    }
  }
  return { amount, choice };
}

async function flavorItalic(flavorService, scenario, vars) {
  if (!flavorService?.italicLine) return null;
  try {
    return await flavorService.italicLine(scenario, vars);
  } catch {
    return null;
  }
}

export async function handleFlipCommand({
  userJid,
  scopeKey,
  gameService,
  funConfig,
  reply,
  args,
  flavorService,
}) {
  const { amount, choice } = parseFlipArgs(args);
  const min = funConfig.flipMin || 5;
  const max = funConfig.flipMax || 80;

  if (!amount || !choice) {
    await reply(
      [
        '🪙 *Cara ou coroa*',
        `Uso: \`/cf 20 cara\` ou \`/cf 20 coroa\``,
        `Você *escolhe o lado*. Se acertar, dobra a aposta.`,
        `Min *${min}* · max *${max}* coins`,
      ].join('\n')
    );
    return { handled: true };
  }

  const result = gameService.soloFlip({
    userJid,
    scopeKey,
    amount,
    choice,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'missing-choice') {
      await reply('Escolha o lado: `cara` ou `coroa`.\nEx.: `/cf 10 cara`');
      return { handled: true };
    }
    if (result.reason === 'invalid-amount') {
      await reply(`Aposte entre *${result.min}* e *${result.max}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'cooldown') {
      await reply(`Aguarde *${result.retryIn}* pra jogar de novo.`);
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Saldo insuficiente (*${result.coins}* coins).`);
      return { handled: true };
    }
    await reply('Não rolou o flip.');
    return { handled: true };
  }

  // vitória só se lado sorteado === escolha (defesa contra bugs antigos)
  const won = Boolean(result.win) && result.pick === result.side;
  const fl = await flavorItalic(flavorService, won ? 'flip_win' : 'flip_lose', {
    pick: result.pick,
    side: result.side,
  });
  const lines = [
    '🪙 *Cara ou coroa*',
    `Sua aposta: *${result.pick}*`,
    `Moeda: *${result.side}*`,
    won
      ? `Acertou! *+${result.profit}* coins 🎉`
      : `Errou. *−${result.stake}* coins 😅`,
    result.usedLucky ? '🔮 Amuleto da loja usado nesta rodada.' : null,
    `Saldo: *${result.coins}*`,
    fl,
  ];
  await reply(lines.filter(Boolean).join('\n'));
  return { handled: true, result: { ...result, win: won } };
}

export async function handleJobCommand({
  userJid,
  scopeKey,
  gameService,
  funConfig,
  reply,
  flavorService,
}) {
  const result = gameService.doJob({ userJid, scopeKey, funConfig });
  if (!result.ok) {
    if (result.reason === 'cooldown') {
      await reply(`Você já trabalhou. Volte em *${result.retryIn}*.`);
      return { handled: true };
    }
    await reply('Não deu pra trabalhar agora.');
    return { handled: true };
  }

  const fl = await flavorItalic(flavorService, 'job_done', { flavor: result.flavor });
  await reply(
    [
      '💼 *Trabalho*',
      `Você ${result.flavor} e ganhou *+${result.gain}* coins.`,
      `Saldo: *${result.coins}*`,
      fl,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}

export async function handleLuckyCommand({
  userJid,
  scopeKey,
  gameService,
  funConfig,
  reply,
  flavorService,
}) {
  const result = gameService.doLucky({ userJid, scopeKey, funConfig });
  if (!result.ok) {
    if (result.reason === 'cooldown') {
      await reply(`Sorte já usada. Próxima em *${result.retryIn}*.`);
      return { handled: true };
    }
    await reply('Não rolou a sorte.');
    return { handled: true };
  }

  const fl = await flavorItalic(flavorService, result.hit ? 'lucky_hit' : 'lucky_miss', {});
  if (result.hit) {
    await reply(
      [`🍀 *Sorte!* Você ganhou *+${result.gain}* coins.`, `Saldo: *${result.coins}*`, fl]
        .filter(Boolean)
        .join('\n')
    );
  } else {
    await reply(
      [`🌑 Azar… saiu nada desta vez.`, `Saldo: *${result.coins}*`, fl].filter(Boolean).join('\n')
    );
  }
  return { handled: true, result };
}

export async function handleBetCommand({
  userJid,
  scopeKey,
  gameService,
  funConfig,
  getContactDisplayName,
  listContacts,
  reply,
  args,
  mentionedJids,
  quotedParticipant,
  sock,
  identityMap,
}) {
  const amount = parseAmountFromArgs(args);
  let choice = null;
  for (const arg of args) {
    const t = String(arg || '').trim();
    if (!t || /^\d+$/.test(t)) continue;
    if (gameService.parseCoinSide?.(t)) {
      choice = t;
      break;
    }
  }

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
  const target = resolved.jid;
  const p = funConfig?.prefix || '/';

  if (!amount || !target || !isCanonicalUserJid(target) || !choice) {
    await reply(
      [
        'Uso: `/aposta @pessoa 20 cara`',
        'Você escolhe o lado; a outra pessoa fica com o oposto.',
        'Aceite: `/aceitar` · recusa: `/recusar`',
        `Min *${funConfig.betMin || 5}* · max *${funConfig.betMax || 150}*`,
      ].join('\n')
    );
    return { handled: true };
  }

  const result = gameService.proposeBet({
    fromJid: userJid,
    toJid: target,
    scopeKey,
    amount,
    choice,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'missing-choice') {
      await reply('Escolha o lado: `cara` ou `coroa`.\nEx.: `/aposta @fulano 20 cara`');
      return { handled: true };
    }
    if (result.reason === 'invalid-amount') {
      await reply(`Aposte entre *${result.min}* e *${result.max}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Você não tem coins suficientes (*${result.coins}*).`);
      return { handled: true };
    }
    if (result.reason === 'target-insufficient') {
      await reply(`*${nameOf(getContactDisplayName, target)}* não tem coins suficientes.`);
      return { handled: true };
    }
    await reply('Não foi possível criar a aposta.');
    return { handled: true };
  }

  const oppSide = result.choice === 'cara' ? 'coroa' : 'cara';
  await reply(
    [
      '🪙 *Desafio: cara ou coroa*',
      `*${nameOf(getContactDisplayName, userJid)}* (*${result.choice}*) vs *${nameOf(getContactDisplayName, target)}* (*${oppSide}*)`,
      `Aposta: *${result.amount}* coins cada · pot *${result.amount * 2}*`,
      '',
      `*${nameOf(getContactDisplayName, target)}*: \`${p}aceitar\` ou \`${p}recusar\``,
      '_Expira em 5 minutos._',
    ].join('\n')
  );
  return { handled: true, result };
}
