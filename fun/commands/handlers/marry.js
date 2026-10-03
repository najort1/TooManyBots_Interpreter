import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';
import { flavorWithLore } from '../../utils/flavorLore.js';
import { fmt } from '../../messages/index.js';

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
  groupMemoryService,
  profileService,
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
    await reply(fmt.genericError({ command: 'marry' }));
    return { handled: true };
  }

  const loreCtx = {
    groupMemoryService,
    profileService,
    scopeKey,
    userJids: [userJid, target],
    funConfig,
    limit: Infinity,
  };

  if (result.married && result.reason === 'mutual') {
    const fl = await flavorWithLore(
      flavorService,
      'marry_mutual',
      { a: me, b: other },
      loreCtx
    );
    await reply(
      [`💍 Pedido mútuo! *${me}* e *${other}* se casaram neste grupo!`, fl]
        .filter(Boolean)
        .join('\n')
    );
    return { handled: true, result };
  }

  const fl = await flavorWithLore(
    flavorService,
    'marry_propose',
    { me, other },
    loreCtx
  );
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
  bondService,
  coinsService,
  repository,
  getContactDisplayName,
  funConfig,
  reply,
  achievementService = null,
  newsService = null,
}) {
  const cost = Math.max(0, Math.floor(Number(funConfig?.divorceCost) || 40));
  if (cost > 0 && repository) {
    const bal = coinsService?.getBalance?.(userJid, scopeKey)
      ?? repository.getUserStats(userJid, scopeKey)?.coins
      ?? 0;
    if (bal < cost) {
      await reply(fmt.insufficientBalance({ required: cost, current: bal }));
      return { handled: true };
    }
  }

  // Verifica infidelidade antes de desfazer o casamento
  const existingMarriage = relationshipService.getMarriage?.(userJid, scopeKey);
  let infidelityClaim = null;

  if (existingMarriage?.partnerJid && bondService?.getBondWithDecay) {
    const bond = bondService.getBondWithDecay(scopeKey, userJid, existingMarriage.partnerJid);
    const inf = bond?.flags?.lastInfidelity;
    // Se o adultério aconteceu nas últimas 48 horas
    if (inf && (Date.now() - (inf.at || 0)) < 48 * 60 * 60 * 1000) {
      infidelityClaim = inf;
    }
  }

  const result = relationshipService.divorce({ userJid, scopeKey });
  if (!result.ok) {
    await reply('Você não está casado(a) neste grupo.');
    return { handled: true };
  }

  const partnerJid = result.partnerJid;
  const partner = nameOf(getContactDisplayName, partnerJid);
  const me = nameOf(getContactDisplayName, userJid);

  let litigationBonus = 0;
  if (infidelityClaim && repository) {
    // Se o solicitante foi a vítima da traição
    if (infidelityClaim.adultererJid === partnerJid) {
      const adultererStats = repository.getUserStats(partnerJid, scopeKey);
      const adultererBal = Math.max(0, Number(adultererStats?.coins) || 0);
      const rawBonus = Math.floor(adultererBal * 0.20); // 20% de pensão/indenização
      // Proteção de estabilidade econômica: mínimo 30, máximo 5000 coins, limitado ao saldo real
      litigationBonus = adultererBal > 0 ? Math.min(adultererBal, Math.min(5000, Math.max(30, rawBonus))) : 0;

      if (litigationBonus > 0) {
        if (typeof repository.transferCoins === 'function') {
          const xfer = repository.transferCoins({
            fromJid: partnerJid,
            toJid: userJid,
            scopeKey,
            amount: litigationBonus,
            reason: 'divorce-adultery-alimony',
          });
          if (!xfer.ok) {
            litigationBonus = 0;
          }
        } else {
          repository.addCoins({
            userJid: partnerJid,
            scopeKey,
            amount: -litigationBonus,
            reason: 'divorce-adultery-fine',
          });
          repository.addCoins({
            userJid,
            scopeKey,
            amount: litigationBonus,
            reason: 'divorce-adultery-alimony',
          });
        }
      }
    }
  } else if (cost > 0 && repository) {
    repository.addCoins({
      userJid,
      scopeKey,
      amount: -cost,
      reason: 'divorce-fee',
    });
  }

  const balAfter = repository?.getUserStats?.(userJid, scopeKey)?.coins;

  if (litigationBonus > 0) {
    await reply(
      [
        '⚖️💔 *DIVÓRCIO LITIGIOSO POR INFIDELIDADE!*',
        `*${me}* provou o adultério de *${partner}* perante a comunidade!`,
        `Pensão/Indenização: *+${litigationBonus}* coins transferidos de *${partner}* para *${me}*!`,
        balAfter != null ? `Seu novo saldo: *${balAfter}* coins.` : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  } else {
    await reply(
      [
        `💔 Divórcio registrado. Adeus, *${partner}*.`,
        cost > 0 ? `Taxa: *−${cost}* coins${balAfter != null ? ` · saldo *${balAfter}*` : ''}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  try {
    const unlocked =
      achievementService?.check?.(userJid, scopeKey, 'divorce', {}, funConfig) || [];
    newsService?.log?.(scopeKey, 'divorce', {
      userJid,
      payload: { partner: partner, litigation: litigationBonus > 0 },
    });
    if (unlocked.length) {
      await reply(unlocked.map((u) => `🏆 *${u.icon} ${u.name}*`).join('\n'));
    }
  } catch {
    /* ignore */
  }
  return { handled: true, result };
}
