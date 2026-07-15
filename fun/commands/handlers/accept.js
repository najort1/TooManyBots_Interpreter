import { ACTION_TYPE } from '../../constants.js';

function nameOf(getContactDisplayName, jid) {
  return (
    (typeof getContactDisplayName === 'function' && getContactDisplayName(jid)) ||
    String(jid || '').split('@')[0]
  );
}

export async function handleAcceptCommand({
  userJid,
  scopeKey,
  relationshipService,
  gameService,
  getContactDisplayName,
  reply,
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
    await reply(
      `💍 *Casamento confirmado!*\n*${nameOf(getContactDisplayName, result.fromJid)}* ❤️ *${nameOf(getContactDisplayName, result.toJid)}*`
    );
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

    const challengerPick = pending.payload?.choice || '?';
    const oppPick = challengerPick === 'cara' ? 'coroa' : 'cara';
    await reply(
      [
        '🪙 *Cara ou coroa — resultado*',
        `*${nameOf(getContactDisplayName, result.fromJid)}* era *${challengerPick}* · *${nameOf(getContactDisplayName, result.toJid)}* era *${oppPick}*`,
        `Saiu: *${result.side}*`,
        `🏆 Vencedor: *${nameOf(getContactDisplayName, result.winnerJid)}* (pot *${result.pot}*)`,
        `💀 Perdeu: *${nameOf(getContactDisplayName, result.loserJid)}*`,
        result.shieldRefund
          ? `🛡️ Escudo devolveu *${result.shieldRefund}* coins ao perdedor`
          : null,
        `Saldo vencedor: *${result.winnerCoins}*`,
      ]
        .filter(Boolean)
        .join('\n')
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

  await reply('Não entendi o pedido pendente.');
  return { handled: true };
}
