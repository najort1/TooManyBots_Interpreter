import { parseAmountFromArgs, resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';

function nameOf(getContactDisplayName, jid) {
  return (
    (typeof getContactDisplayName === 'function' && getContactDisplayName(jid)) ||
    String(jid || '').split('@')[0]
  );
}

function colorLabel(c) {
  if (c === 'red') return 'vermelho';
  if (c === 'black') return 'preto';
  if (c === 'green') return 'verde';
  return String(c || '?');
}

async function fl(flavorService, scenario, vars) {
  if (!flavorService?.italicLine) return null;
  try {
    return await flavorService.italicLine(scenario, vars);
  } catch {
    return null;
  }
}

export async function handleRouletteCommand({
  userJid,
  scopeKey,
  casinoService,
  funConfig,
  reply,
  args,
  flavorService,
}) {
  const parsed = casinoService.parseRouletteBet(args);
  if (!parsed.amount || !parsed.choice) {
    await reply(
      [
        '🎡 *Roleta*',
        'Uso: `/roleta 20 vermelho` · `/roleta 15 preto` · `/roleta 10 17`',
        `Min *${funConfig.casinoMin || 5}* · max *${funConfig.casinoMax || 100}*`,
      ].join('\n')
    );
    return { handled: true };
  }

  const result = casinoService.playRoulette({
    userJid,
    scopeKey,
    amount: parsed.amount,
    choice: parsed.choice,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'cooldown') {
      await reply(`Roleta em cooldown. Volte em *${result.retryIn}*.`);
      return { handled: true };
    }
    if (result.reason === 'invalid-amount') {
      await reply(`Aposte entre *${result.min}* e *${result.max}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Saldo insuficiente (*${result.coins}* coins).`);
      return { handled: true };
    }
    await reply('Não rolou a roleta.');
    return { handled: true };
  }

  const pick =
    result.choice.type === 'color'
      ? colorLabel(result.choice.value)
      : String(result.choice.value);
  const flavor = await fl(flavorService, result.win ? 'flip_win' : 'flip_lose', {});
  await reply(
    [
      '🎡 *Roleta*',
      `Aposta: *${result.stake}* em *${pick}*`,
      `Bola: *${result.ball}* (${colorLabel(result.color)})`,
      result.win
        ? `Ganhou *+${result.payout}* coins 🎉`
        : `Perdeu *−${result.stake}* coins`,
      result.usedCharm ? '🔮 Ficha da roleta usada.' : null,
      result.happy > 1 ? `🍸 Happy hour x${result.happy}` : null,
      result.jackpotHit ? `💰 *JACKPOT!* +${result.jackpotHit} coins` : null,
      `Jackpot do grupo: *${result.pot}*`,
      `Saldo: *${result.coins}*`,
      flavor,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}

export async function handleSlotCommand({
  userJid,
  scopeKey,
  casinoService,
  funConfig,
  reply,
  args,
  flavorService,
}) {
  const amount = parseAmountFromArgs(args);
  if (!amount) {
    await reply(
      [
        '🎰 *Slot*',
        'Uso: `/slot 15`',
        `Min *${funConfig.casinoMin || 5}* · max *${funConfig.casinoMax || 100}*`,
      ].join('\n')
    );
    return { handled: true };
  }

  const result = casinoService.playSlot({
    userJid,
    scopeKey,
    amount,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'cooldown') {
      await reply(`Slot em cooldown. Volte em *${result.retryIn}*.`);
      return { handled: true };
    }
    if (result.reason === 'invalid-amount') {
      await reply(`Aposte entre *${result.min}* e *${result.max}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Saldo insuficiente (*${result.coins}* coins).`);
      return { handled: true };
    }
    await reply('Slot travou. Tente de novo.');
    return { handled: true };
  }

  const flavor = await fl(flavorService, result.win ? 'lucky_hit' : 'lucky_miss', {});
  await reply(
    [
      '🎰 *Slot*',
      `${result.reels.join(' · ')}`,
      result.win
        ? `Pagou *x${result.mult}* → *+${result.payout}* coins`
        : `Nada… *−${result.stake}* coins`,
      result.usedCharm ? '✨ Alavanca dourada usada.' : null,
      result.happy > 1 ? `🍸 Happy hour x${result.happy}` : null,
      result.jackpotHit ? `💰 *JACKPOT!* +${result.jackpotHit}` : null,
      `Jackpot: *${result.pot}* · Saldo: *${result.coins}*`,
      flavor,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}

export async function handleJackpotCommand({ scopeKey, casinoService, reply }) {
  const j = casinoService.getJackpot(scopeKey);
  await reply(
    [
      '💰 *Jackpot do grupo*',
      `Pot atual: *${j.pot}* coins`,
      '_Alimenta com % de cada aposta do cassino. Sorte rara no spin._',
    ].join('\n')
  );
  return { handled: true, pot: j.pot };
}

export async function handleDiceDuelCommand({
  userJid,
  scopeKey,
  casinoService,
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
  const p = funConfig.prefix || '/';

  if (!amount || !target || !isCanonicalUserJid(target)) {
    await reply(
      [
        '🎲 *Desafio de dados*',
        'Uso: `/desafio @pessoa 30`',
        'Maior d20 leva o pot. Aceite: `/aceitar`',
        `Min *${funConfig.diceDuelMin || 5}* · max *${funConfig.diceDuelMax || 150}*`,
      ].join('\n')
    );
    return { handled: true };
  }

  const result = casinoService.proposeDiceDuel({
    fromJid: userJid,
    toJid: target,
    scopeKey,
    amount,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'invalid-amount') {
      await reply(`Aposte entre *${result.min}* e *${result.max}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Você não tem coins (*${result.coins}*).`);
      return { handled: true };
    }
    if (result.reason === 'target-insufficient') {
      await reply(`*${nameOf(getContactDisplayName, target)}* não tem coins suficientes.`);
      return { handled: true };
    }
    await reply('Não deu pra criar o desafio.');
    return { handled: true };
  }

  await reply(
    [
      '🎲 *Desafio de dados*',
      `*${nameOf(getContactDisplayName, userJid)}* desafiou *${nameOf(getContactDisplayName, target)}* por *${result.amount}* coins.`,
      `*${nameOf(getContactDisplayName, target)}*: \`${p}aceitar\` ou \`${p}recusar\``,
      '_Expira em 5 minutos._',
    ].join('\n')
  );
  return { handled: true, result };
}

export async function handleCrashCommand({
  userJid,
  scopeKey,
  casinoService,
  funConfig,
  reply,
  args,
}) {
  const amount = parseAmountFromArgs(args);
  if (!amount) {
    await reply(
      [
        '🚀 *Crash*',
        'Uso: `/crash 20` — foguete sobe. Use `/sair` pra descer.',
        `Min *${funConfig.crashMin || 5}* · max *${funConfig.crashMax || 80}*`,
      ].join('\n')
    );
    return { handled: true };
  }

  const result = casinoService.startCrash({
    userJid,
    scopeKey,
    amount,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'cooldown') {
      await reply(`Crash em cooldown. Volte em *${result.retryIn}*.`);
      return { handled: true };
    }
    if (result.reason === 'already-flying') {
      await reply('Você já está no foguete. Use `/sair`.');
      return { handled: true };
    }
    if (result.reason === 'invalid-amount') {
      await reply(`Aposte entre *${result.min}* e *${result.max}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Saldo insuficiente (*${result.coins}* coins).`);
      return { handled: true };
    }
    await reply('Não decolou.');
    return { handled: true };
  }

  const sec = Math.round((result.ttlMs || 45000) / 1000);
  await reply(
    [
      '🚀 *Crash — em voo*',
      `Stake *${result.stake}* travada.`,
      `Use \`/sair\` em até *${sec}s* pra descer com o multiplicador do momento.`,
      '_Se passar do crash point, perde tudo._',
    ].join('\n')
  );
  return { handled: true, result };
}

export async function handleCashoutCommand({
  userJid,
  scopeKey,
  casinoService,
  funConfig,
  reply,
  flavorService,
}) {
  const result = casinoService.cashoutCrash({ userJid, scopeKey, funConfig });
  if (!result.ok) {
    await reply('Nenhum voo ativo. Use `/crash 20` primeiro.');
    return { handled: true };
  }

  const flavor = await fl(flavorService, result.crashed ? 'flip_lose' : 'flip_win', {});
  if (result.crashed) {
    await reply(
      [
        '💥 *Crash!*',
        `Explodiu em *${result.crashAt}x* (você estava em ~${result.currentMult}x).`,
        `Perdeu *−${result.stake}* coins`,
        `Saldo: *${result.coins}*`,
        flavor,
      ]
        .filter(Boolean)
        .join('\n')
    );
  } else {
    await reply(
      [
        '🪂 *Cashout*',
        `Desceu em *${result.currentMult}x* (crash era ${result.crashAt}x).`,
        `Recebeu *+${result.payout}* coins`,
        result.happy > 1 ? `🍸 Happy hour x${result.happy}` : null,
        `Saldo: *${result.coins}*`,
        flavor,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
  return { handled: true, result };
}

export async function handleBlackjackCommand({
  userJid,
  scopeKey,
  casinoService,
  funConfig,
  reply,
  args,
}) {
  const amount = parseAmountFromArgs(args);
  if (!amount) {
    await reply(
      [
        '🃏 *Blackjack*',
        'Uso: `/bj 25` → depois `/hit` ou `/stand`',
        `Min *${funConfig.blackjackMin || 5}* · max *${funConfig.blackjackMax || 80}*`,
      ].join('\n')
    );
    return { handled: true };
  }

  const result = casinoService.startBlackjack({
    userJid,
    scopeKey,
    amount,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'cooldown') {
      await reply(`Blackjack em cooldown. Volte em *${result.retryIn}*.`);
      return { handled: true };
    }
    if (result.reason === 'already-playing') {
      await reply('Mão aberta. Use `/hit` ou `/stand`.');
      return { handled: true };
    }
    if (result.reason === 'invalid-amount') {
      await reply(`Aposte entre *${result.min}* e *${result.max}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Saldo insuficiente (*${result.coins}* coins).`);
      return { handled: true };
    }
    await reply('Não abriu a mão.');
    return { handled: true };
  }

  if (result.done) {
    await reply(
      [
        '🃏 *Blackjack*',
        `Você: ${casinoService.formatHand(result.player)} (*${result.pTotal}*)`,
        `Dealer: ${casinoService.formatHand(result.dealer)} (*${result.dTotal}*)`,
        result.result === 'blackjack'
          ? `Blackjack! *+${result.payout}* coins`
          : result.result === 'push'
            ? 'Empate — stake devolvida.'
            : `Resultado: *${result.result}*`,
        `Saldo: *${result.coins}*`,
      ].join('\n')
    );
    return { handled: true, result };
  }

  await reply(
    [
      '🃏 *Blackjack*',
      `Você: ${casinoService.formatHand(result.player)} (*${result.pTotal}*)`,
      `Dealer: ${casinoService.formatHand([result.dealerVisible])} ?`,
      'Comandos: `/hit` · `/stand`',
    ].join('\n')
  );
  return { handled: true, result };
}

export async function handleHitCommand({
  userJid,
  scopeKey,
  casinoService,
  funConfig,
  reply,
}) {
  const result = casinoService.hitBlackjack({ userJid, scopeKey, funConfig });
  if (!result.ok) {
    await reply('Sem mão aberta. Use `/bj 20`.');
    return { handled: true };
  }
  if (result.done) {
    await reply(
      [
        '🃏 *Estourou*',
        `Você: ${casinoService.formatHand(result.player)} (*${result.pTotal}*)`,
        `−${result.stake} coins · saldo *${result.coins}*`,
      ].join('\n')
    );
    return { handled: true, result };
  }
  await reply(
    [
      '🃏 *Hit*',
      `Você: ${casinoService.formatHand(result.player)} (*${result.pTotal}*)`,
      `Dealer: ${casinoService.formatHand([result.dealerVisible])} ?`,
      '`/hit` ou `/stand`',
    ].join('\n')
  );
  return { handled: true, result };
}

export async function handleStandCommand({
  userJid,
  scopeKey,
  casinoService,
  funConfig,
  reply,
  flavorService,
}) {
  const result = casinoService.standBlackjack({ userJid, scopeKey, funConfig });
  if (!result.ok) {
    await reply('Sem mão aberta. Use `/bj 20`.');
    return { handled: true };
  }
  const flavor = await fl(
    flavorService,
    result.result === 'win' ? 'flip_win' : result.result === 'push' ? 'ship' : 'flip_lose',
    {}
  );
  const msg =
    result.result === 'win'
      ? `Você ganhou *+${result.payout}* coins`
      : result.result === 'push'
        ? 'Empate — stake devolvida'
        : `Perdeu *−${result.stake}* coins`;
  await reply(
    [
      '🃏 *Stand*',
      `Você: ${casinoService.formatHand(result.player)} (*${result.pTotal}*)`,
      `Dealer: ${casinoService.formatHand(result.dealer)} (*${result.dTotal}*)`,
      msg,
      `Saldo: *${result.coins}*`,
      flavor,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}

export async function handleTournamentCommand({
  userJid,
  scopeKey,
  casinoService,
  funConfig,
  getContactDisplayName,
  reply,
  args,
}) {
  const sub = String(args[0] || '').trim().toLowerCase();
  if (sub === 'status' || sub === 'info') {
    const t = casinoService.tournamentStatus(scopeKey);
    if (!t) {
      await reply('Nenhum torneio aberto. Use `/torneio 20` pra entrar/criar.');
      return { handled: true };
    }
    await reply(
      [
        '🏆 *Torneio aberto*',
        `Entrada: *${t.entryFee}* · pot *${t.pot}*`,
        `Jogadores: *${t.players.length}/${funConfig.tournamentSize || 4}*`,
        t.players.map((j, i) => `${i + 1}. ${nameOf(getContactDisplayName, j)}`).join('\n'),
      ].join('\n')
    );
    return { handled: true };
  }

  const fee = parseAmountFromArgs(args);
  const result = casinoService.joinTournament({
    userJid,
    scopeKey,
    entryFee: fee || 0,
    funConfig,
  });

  if (!result.ok) {
    if (result.reason === 'already-in') {
      await reply('Você já está no torneio aberto. `/torneio status`');
      return { handled: true };
    }
    if (result.reason === 'invalid-amount') {
      await reply(`Entrada entre *${result.min}* e *${result.max}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'insufficient-funds') {
      await reply(`Precisa de *${result.fee}* coins. Você tem *${result.coins}*.`);
      return { handled: true };
    }
    await reply('Não entrou no torneio.');
    return { handled: true };
  }

  if (result.finished) {
    const t = result.tournament;
    const b = t.bracket || {};
    await reply(
      [
        '🏆 *Torneio finalizado!*',
        `Pot: *${result.pot}* → 🥇 *${nameOf(getContactDisplayName, result.winnerJid)}*`,
        b.semi1
          ? `Semi1: ${nameOf(getContactDisplayName, b.semi1.a)} ${b.semi1.aRoll} × ${b.semi1.bRoll} ${nameOf(getContactDisplayName, b.semi1.b)}`
          : null,
        b.semi2
          ? `Semi2: ${nameOf(getContactDisplayName, b.semi2.a)} ${b.semi2.aRoll} × ${b.semi2.bRoll} ${nameOf(getContactDisplayName, b.semi2.b)}`
          : null,
        b.final
          ? `Final: ${nameOf(getContactDisplayName, b.final.a)} ${b.final.aRoll} × ${b.final.bRoll} ${nameOf(getContactDisplayName, b.final.b)}`
          : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
    return { handled: true, result };
  }

  await reply(
    [
      '🏆 *Entrou no torneio*',
      `Taxa *${result.fee}* · pot *${result.tournament.pot}*`,
      `Faltam *${result.need}* jogador(es) pra começar (4 no total).`,
      `Saldo: *${result.coins}*`,
    ].join('\n')
  );
  return { handled: true, result };
}

export async function handleRankCasinoCommand({
  userJid,
  scopeKey,
  casinoService,
  getContactDisplayName,
  reply,
  effectiveRates,
  funConfig,
}) {
  const limit = effectiveRates?.rankLimit || funConfig.rankLimit || 10;
  const board = casinoService.rankCasino(scopeKey, limit);
  const mine = casinoService.getUserCasinoStats(userJid, scopeKey);

  if (!board.length) {
    await reply('Ainda sem histórico de cassino neste grupo. Jogue `/roleta` ou `/slot`.');
    return { handled: true };
  }

  const lines = ['🃏 *Rank Cassino* (lucro/prejuízo)', ''];
  for (const row of board) {
    const sign = row.profit >= 0 ? '+' : '';
    lines.push(
      `${row.rank}. *${nameOf(getContactDisplayName, row.userJid)}* — ${sign}${row.profit} (${row.games} jogos)`
    );
  }
  lines.push(
    '',
    `Você: *${mine.profit >= 0 ? '+' : ''}${mine.profit}* · apostado ${mine.wagered} · ${mine.games} jogos`
  );
  await reply(lines.join('\n'));
  return { handled: true, board };
}
