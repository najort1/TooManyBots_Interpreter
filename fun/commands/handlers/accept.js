import { ACTION_TYPE } from '../../constants.js';
import { nameOf } from '../../utils/userLabel.js';

async function flavorItalic(flavorService, scenario, vars) {
  if (!flavorService?.italicLine) return null;
  try {
    return await flavorService.italicLine(scenario, vars);
  } catch {
    return null;
  }
}

export async function handleAcceptCommand({
  userJid,
  scopeKey,
  relationshipService,
  gameService,
  casinoService,
  getContactDisplayName,
  reply,
  socialHooks,
  funConfig,
  flavorService,
  achievementService = null,
  newsService = null,
}) {
  const pending = gameService.peekIncoming(userJid, scopeKey);
  if (!pending) {
    await reply('Não há pedido ou aposta esperando você.');
    return { handled: true };
  }

  if (pending.actionType === ACTION_TYPE.MARRY) {
    const result = relationshipService.acceptMarry({ userJid, scopeKey });
    if (!result.ok) {
      if (result.reason === 'already-married' || result.reason === 'partner-married') {
        await reply('Não deu pra casar — alguém já está casado(a).');
        return { handled: true };
      }
      await reply('Pedido expirado ou inválido.');
      return { handled: true };
    }
    if (typeof socialHooks?.onSocialPair === 'function') {
      socialHooks.onSocialPair({
        scopeKey,
        fromJid: result.fromJid,
        toJid: result.toJid,
        kind: 'marry',
        funConfig,
      });
    }
    const a = nameOf(getContactDisplayName, result.fromJid);
    const b = nameOf(getContactDisplayName, result.toJid);
    const fl = await flavorItalic(flavorService, 'marry_accept', { a, b });
    await reply(
      [`💍 *Casamento confirmado!*`, `*${a}* ❤️ *${b}*`, fl].filter(Boolean).join('\n')
    );
    try {
      for (const jid of [result.fromJid, result.toJid]) {
        achievementService?.check?.(jid, scopeKey, 'marry', {}, funConfig);
      }
      newsService?.log?.(scopeKey, 'marry', {
        userJid: result.fromJid,
        payload: { a, b },
      });
    } catch {
      /* ignore */
    }
    return { handled: true, result };
  }

  if (pending.actionType === ACTION_TYPE.BET_COINFLIP) {
    const result = gameService.acceptBet({ userJid, scopeKey });
    if (!result.ok) {
      if (result.reason === 'a-insufficient') {
        await reply('Quem desafiou não tem coins suficientes agora.');
        return { handled: true };
      }
      if (result.reason === 'b-insufficient') {
        await reply(`Você não tem coins suficientes (precisa de *${pending.payload?.amount || '?'}*).`);
        return { handled: true };
      }
      await reply('Aposta expirada ou inválida.');
      return { handled: true };
    }

    let missionLine = null;
    if (typeof socialHooks?.onSocialPair === 'function') {
      const hook = socialHooks.onSocialPair({
        scopeKey,
        fromJid: result.fromJid,
        toJid: result.toJid,
        kind: 'bet',
        funConfig,
      });
      if (hook?.mission?.completed) {
        missionLine = '🏁 Squad completou a missão mista! Recompensas enviadas.';
      } else if (hook?.eventBonus) {
        missionLine = `⚡ Evento: +${hook.eventBonus.bonusCoins} coins cross-panelinha`;
      }
    }

    const challengerPick = pending.payload?.choice || '?';
    const oppPick = challengerPick === 'cara' ? 'coroa' : 'cara';
    const winnerName = nameOf(getContactDisplayName, result.winnerJid);
    const loserName = nameOf(getContactDisplayName, result.loserJid);
    const fl = await flavorItalic(flavorService, 'bet_result', {
      winner: winnerName,
      loser: loserName,
      side: result.side,
    });
    await reply(
      [
        '🪙 *Cara ou coroa — resultado*',
        `*${nameOf(getContactDisplayName, result.fromJid)}* era *${challengerPick}* · *${nameOf(getContactDisplayName, result.toJid)}* era *${oppPick}*`,
        `Saiu: *${result.side}*`,
        `🏆 Vencedor: *${winnerName}* (pot *${result.pot}*)`,
        `💀 Perdeu: *${loserName}*`,
        result.shieldRefund
          ? `🛡️ Escudo devolveu *${result.shieldRefund}* coins ao perdedor`
          : null,
        `Saldo vencedor: *${result.winnerCoins}*`,
        missionLine,
        fl,
      ]
        .filter(Boolean)
        .join('\n')
    );
    return { handled: true, result };
  }

  if (pending.actionType === ACTION_TYPE.BET_DICE) {
    if (!casinoService) {
      await reply('Duelo de dados indisponível.');
      return { handled: true };
    }
    const result = casinoService.acceptDiceDuel({ userJid, scopeKey });
    if (!result.ok) {
      if (result.reason === 'a-insufficient') {
        await reply('Quem desafiou não tem coins suficientes agora.');
        return { handled: true };
      }
      if (result.reason === 'b-insufficient') {
        await reply(`Você não tem coins suficientes (precisa de *${pending.payload?.amount || '?'}*).`);
        return { handled: true };
      }
      await reply('Desafio expirado ou inválido.');
      return { handled: true };
    }
    if (result.tie) {
      await reply(
        [
          '🎲 *Dados — empate*',
          `*${nameOf(getContactDisplayName, result.fromJid)}* tirou *${result.aRoll}* · *${nameOf(getContactDisplayName, result.toJid)}* tirou *${result.bRoll}*`,
          'Stake devolvida aos dois.',
        ].join('\n')
      );
      return { handled: true, result };
    }
    await reply(
      [
        '🎲 *Dados — resultado*',
        `*${nameOf(getContactDisplayName, result.fromJid)}* tirou *${result.aRoll}*`,
        `*${nameOf(getContactDisplayName, result.toJid)}* tirou *${result.bRoll}*`,
        `🏆 *${nameOf(getContactDisplayName, result.winnerJid)}* leva pot *${result.pot}*`,
        `Saldo vencedor: *${result.winnerCoins}*`,
      ].join('\n')
    );
    return { handled: true, result };
  }

  await reply('Não entendi o pedido pendente. Tente de novo.');
  return { handled: true };
}

export async function handleDeclineCommand({
  userJid,
  scopeKey,
  relationshipService,
  gameService,
  casinoService,
  getContactDisplayName,
  reply,
}) {
  const pending = gameService.peekIncoming(userJid, scopeKey);
  if (!pending) {
    await reply('Não há pedido ou aposta esperando você.');
    return { handled: true };
  }

  if (pending.actionType === ACTION_TYPE.MARRY) {
    const result = relationshipService.declineMarry({ userJid, scopeKey });
    if (!result.ok) {
      await reply('Pedido expirado ou inválido.');
      return { handled: true };
    }
    await reply(
      `💔 *${nameOf(getContactDisplayName, result.toJid)}* recusou o pedido de *${nameOf(getContactDisplayName, result.fromJid)}*.`
    );
    return { handled: true, result };
  }

  if (pending.actionType === ACTION_TYPE.BET_COINFLIP) {
    const result = gameService.declineBet({ userJid, scopeKey });
    if (!result.ok) {
      await reply('Aposta expirada ou inválida.');
      return { handled: true };
    }
    await reply(
      `🪙 *${nameOf(getContactDisplayName, result.toJid)}* recusou a aposta de *${result.amount}* coins de *${nameOf(getContactDisplayName, result.fromJid)}*.`
    );
    return { handled: true, result };
  }

  if (pending.actionType === ACTION_TYPE.BET_DICE) {
    const result = casinoService?.declineDiceDuel?.({ userJid, scopeKey }) || {
      ok: false,
    };
    if (!result.ok) {
      await reply('Desafio expirado ou inválido.');
      return { handled: true };
    }
    await reply(
      `🎲 *${nameOf(getContactDisplayName, result.toJid)}* recusou o desafio de *${result.amount}* coins de *${nameOf(getContactDisplayName, result.fromJid)}*.`
    );
    return { handled: true, result };
  }

  await reply('Não entendi o pedido pendente.');
  return { handled: true };
}
