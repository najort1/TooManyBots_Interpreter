import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';
import { fmt } from '../../messages/index.js';

export async function handleBountyCommand({
  userJid,
  scopeKey,
  bountyService,
  getContactDisplayName,
  listContacts,
  reply,
  args = [],
  mentionedJids = [],
  quotedParticipant = '',
  sock,
  identityMap,
  funConfig,
}) {
  if (!bountyService) {
    await reply('Sistema de recompensas indisponível.');
    return { handled: true };
  }

  const sub = String(args[0] || '').trim().toLowerCase();

  // 1. /bounty lista ou /recompensas
  if (sub === 'lista' || sub === 'listar' || sub === 'rank') {
    const list = bountyService.listActiveBounties(scopeKey, 10);
    if (!list.length) {
      await reply('🎯 *Mural de Recompensas do Submundo*\nNenhum contrato ativo no momento. Todos estão em paz (por enquanto).');
      return { handled: true, list };
    }

    const lines = [
      '🎯 *Mural de Recompensas do Submundo*',
      '_Assalte ou vença o alvo para embolsar a recompensa!_',
      '',
    ];

    list.forEach((b, i) => {
      const targetName = nameOf(getContactDisplayName, b.targetJid);
      const issuerName = nameOf(getContactDisplayName, b.issuerJid);
      const reasonStr = b.reason ? ` · "${b.reason}"` : '';
      lines.push(`${i + 1}. 💀 *${targetName}* — Prêmio: *${b.bountyAmount}* coins (por ${issuerName}${reasonStr}) [id: \`${b.id.slice(0, 8)}\`]`);
    });

    lines.push('', '💡 Dica: Dê `/assaltar @alvo` para caçar o procurado.');
    await reply(lines.join('\n'));
    return { handled: true, list };
  }

  // 2. /bounty cancelar [id]
  if (sub === 'cancelar' || sub === 'remover') {
    const bountyIdQuery = String(args[1] || '').trim();
    if (!bountyIdQuery) {
      await reply('Uso: `/bounty cancelar [id_do_contrato]`');
      return { handled: true };
    }

    const all = bountyService.listActiveBounties(scopeKey, 50);
    const targetBounty = all.find((b) => b.id === bountyIdQuery || b.id.startsWith(bountyIdQuery));
    if (!targetBounty) {
      await reply('Contrato não encontrado ou já expirado/resgatado.');
      return { handled: true };
    }

    const cancelRes = bountyService.cancelBounty({
      scopeKey,
      bountyId: targetBounty.id,
      userJid,
    });

    if (!cancelRes.ok) {
      if (cancelRes.reason === 'not-owner') {
        await reply('Você só pode cancelar recompensas que você mesmo colocou.');
        return { handled: true };
      }
      await reply('Falha ao cancelar contrato.');
      return { handled: true };
    }

    await reply(`🎯 Contrato cancelado. Você recebeu *${cancelRes.refunded}* coins de volta (taxa de 20% retida pelo submundo).`);
    return { handled: true, result: cancelRes };
  }

  // 3. /bounty @alvo [valor] [motivo...]
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

  const targetJid = resolved.jid;
  if (!targetJid || !isCanonicalUserJid(targetJid)) {
    await reply(
      [
        '🎯 *Contratos de Vingança (Bounty)*',
        'Coloque a cabeça de um rival a prêmio para o grupo caçar!',
        '',
        'Uso: `/bounty @alvo [valor] [motivo]`',
        'Exemplo: `/bounty @fulano 200 Me assaltou covardemente`',
        '',
        'Outros comandos:',
        '• `/bounty lista` — ver alvos procurados',
        '• `/bounty cancelar [id]` — cancelar seu contrato',
      ].join('\n')
    );
    return { handled: true };
  }

  // Extrai valor numérico dos argumentos
  let amount = 0;
  const reasonTokens = [];
  for (const a of args) {
    const clean = String(a).replace(/^@/, '').trim();
    if (!amount && /^\d+$/.test(clean) && Number(clean) >= 10 && Number(clean) < 1_000_000) {
      amount = Math.floor(Number(clean));
    } else if (!clean.includes('@') && clean !== sub) {
      reasonTokens.push(clean);
    }
  }

  if (amount < 20) {
    await reply('O valor mínimo para colocar uma recompensa é de *20* coins.');
    return { handled: true };
  }

  const reason = reasonTokens.join(' ').trim();
  const res = bountyService.createBounty({
    scopeKey,
    issuerJid: userJid,
    targetJid,
    amount,
    reason,
  });

  if (!res.ok) {
    if (res.reason === 'self-target') {
      await reply('Você não pode colocar uma recompensa na própria cabeça.');
      return { handled: true };
    }
    if (res.reason === 'spouse-target') {
      await reply('Proibido colocar a cabeça do cônjuge a prêmio. Resolva na DR ou use `/divorcio`!');
      return { handled: true };
    }
    if (res.reason === 'same-faction') {
      await reply('Fogo amigo proibido! Você não pode colocar bounty em um membro da sua própria panelinha.');
      return { handled: true };
    }
    if (res.reason === 'insufficient-balance') {
      await reply(fmt.insufficientBalance({ required: res.required, current: res.current }));
      return { handled: true };
    }
    await reply('Não foi possível registrar a recompensa.');
    return { handled: true };
  }

  const issuerName = nameOf(getContactDisplayName, userJid);
  const targetName = nameOf(getContactDisplayName, targetJid);

  await reply(
    [
      '💀🎯 *CONTRATO DE CAÇA EMITIDO NO SUBMUNDO!*',
      `*${issuerName}* colocou a cabeça de *${targetName}* a prêmio!`,
      `💰 Recompensa líquida: *${res.bounty.bountyAmount}* coins (taxa de 20% retida)`,
      reason ? `📜 Motivo: _"${reason}"_` : null,
      '',
      `🗡️ *Qualquer jogador que assaltar ${targetName} com sucesso receberá a recompensa!*`,
      `ID do Contrato: \`${res.bounty.id.slice(0, 8)}\``,
    ]
      .filter(Boolean)
      .join('\n')
  );

  return { handled: true, result: res };
}
