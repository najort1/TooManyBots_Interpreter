import { parseAmountFromArgs, resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';

export async function handlePayCommand({
  userJid,
  scopeKey,
  coinsService,
  getContactDisplayName,
  listContacts,
  reply,
  args,
  mentionedJids,
  quotedParticipant,
  sock,
  identityMap,
  socialHooks,
  funConfig,
}) {
  const amount = parseAmountFromArgs(args);
  if (!amount) {
    await reply('Uso: `/pay 50 @pessoa` (marque o contato, responda a msg, ou use o nome).');
    return { handled: true };
  }

  const contacts =
    typeof listContacts === 'function'
      ? listContacts()
      : [];

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

  if (!target || !isCanonicalUserJid(target)) {
    await reply(
      [
        'Não achei a pessoa pra pagar.',
        'Marque com @ na lista de menções, responda a mensagem dela, ou use o número (DDI).',
        'Ex.: `/pay 5 @fulano` ou responda a msg + `/pay 5`',
      ].join('\n')
    );
    return { handled: true, reason: 'target-unresolved' };
  }

  if (target === userJid) {
    await reply('Não dá pra pagar a si mesmo.');
    return { handled: true };
  }

  const result = coinsService.transfer({
    fromJid: userJid,
    toJid: target,
    scopeKey,
    amount,
  });

  if (!result.ok) {
    if (result.reason === 'insufficient-funds') {
      await reply(`Saldo insuficiente. Você tem *${result.fromCoins}* coins.`);
      return { handled: true };
    }
    if (result.reason === 'self-transfer') {
      await reply('Não dá pra pagar a si mesmo.');
      return { handled: true };
    }
    await reply('Não foi possível transferir.');
    return { handled: true };
  }

  const toName = nameOf(getContactDisplayName, target);

  let eventLine = null;
  if (typeof socialHooks?.onSocialPair === 'function') {
    const hook = socialHooks.onSocialPair({
      scopeKey,
      fromJid: userJid,
      toJid: target,
      kind: 'pay',
      funConfig,
    });
    if (hook?.eventBonus) {
      eventLine = `⚡ Evento: +${hook.eventBonus.bonusCoins} coins e XP pra ambos (*${hook.eventBonus.mult}x*)`;
    }
  }

  await reply(
    [
      '💸 *Pagamento*',
      `Você enviou *${result.amount}* coins para *${toName}*.`,
      `Seu saldo: *${result.fromCoins}*`,
      result.toCoins != null ? `Saldo dela(e): *${result.toCoins}*` : null,
      eventLine,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result, target };
}
