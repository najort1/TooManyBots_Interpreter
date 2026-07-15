import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';

function nameOf(getContactDisplayName, jid) {
  return (
    (typeof getContactDisplayName === 'function' && getContactDisplayName(jid)) ||
    String(jid || '').split('@')[0]
  );
}

async function flavorItalic(flavorService, scenario, vars) {
  if (!flavorService?.italicLine) return null;
  try {
    return await flavorService.italicLine(scenario, vars);
  } catch {
    return null;
  }
}

export async function handleMarryCommand({
  userJid,
  scopeKey,
  relationshipService,
  getContactDisplayName,
  listContacts,
  reply,
  args,
  mentionedJids,
  quotedParticipant,
  sock,
  identityMap,
  funConfig,
  flavorService,
}) {
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

  if (!target || !isCanonicalUserJid(target)) {
    await reply('Uso: `/marry @pessoa` — a pessoa precisa *aceitar*.');
    return { handled: true };
  }

  const result = relationshipService.proposeMarry({
    userJid,
    partnerJid: target,
    scopeKey,
  });

  const me = nameOf(getContactDisplayName, userJid);
  const other = nameOf(getContactDisplayName, target);
  const p = funConfig?.prefix || '/';

  if (!result.ok) {
    if (result.reason === 'already-married') {
      await reply(`Você já é casado(a) com *${nameOf(getContactDisplayName, result.partnerJid)}*. Use \`/divorce\` primeiro.`);
      return { handled: true };
    }
    if (result.reason === 'partner-married') {
      await reply(`*${other}* já está casado(a).`);
      return { handled: true };
    }
    if (result.reason === 'self-marry') {
      await reply('Não dá pra casar consigo mesmo.');
      return { handled: true };
    }
    await reply('Não foi possível enviar o pedido.');
    return { handled: true };
  }

  if (result.married && result.reason === 'mutual') {
    const fl = await flavorItalic(flavorService, 'marry_mutual', { a: me, b: other });
    await reply(
      [`💍 Pedido mútuo! *${me}* e *${other}* se casaram neste grupo!`, fl]
        .filter(Boolean)
        .join('\n')
    );
    return { handled: true, result };
  }

  const fl = await flavorItalic(flavorService, 'marry_propose', { me, other });
  await reply(
    [
      '💍 *Pedido de casamento*',
      `*${me}* pediu *${other}* em casamento!`,
      '',
      `*${other}*, responda:`,
      `• \`${p}aceitar\` — sim 💍`,
      `• \`${p}recusar\` — não 💔`,
      '',
      fl,
      '_Expira em 5 minutos._',
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}

export async function handleDivorceCommand({
  userJid,
  scopeKey,
  relationshipService,
  coinsService,
  repository,
  getContactDisplayName,
  funConfig,
  reply,
}) {
  const cost = Math.max(0, Math.floor(Number(funConfig?.divorceCost) || 40));
  if (cost > 0 && repository) {
    const bal = coinsService?.getBalance?.(userJid, scopeKey)
      ?? repository.getUserStats(userJid, scopeKey)?.coins
      ?? 0;
    if (bal < cost) {
      await reply(`Divórcio custa *${cost}* coins. Você tem *${bal}*.`);
      return { handled: true };
    }
  }

  const result = relationshipService.divorce({ userJid, scopeKey });
  if (!result.ok) {
    await reply('Você não está casado(a) neste grupo.');
    return { handled: true };
  }

  if (cost > 0 && repository) {
    repository.addCoins({
      userJid,
      scopeKey,
      amount: -cost,
      reason: 'divorce-fee',
    });
  }

  const partner = nameOf(getContactDisplayName, result.partnerJid);
  const balAfter = repository?.getUserStats?.(userJid, scopeKey)?.coins;
  await reply(
    [
      `💔 Divórcio registrado. Adeus, *${partner}*.`,
      cost > 0 ? `Taxa: *−${cost}* coins${balAfter != null ? ` · saldo *${balAfter}*` : ''}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}
