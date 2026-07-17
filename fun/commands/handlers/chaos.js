/**
 * Handlers: roleta russa, cancelar, fofoca, oráculo maluco, illuminati.
 * Texto de caos: IA principal (Zen → Ollama → template via flavorService).
 */

import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';

function nameOf(getContactDisplayName, jid) {
  return (
    (typeof getContactDisplayName === 'function' && getContactDisplayName(jid)) ||
    String(jid || '').split('@')[0] ||
    'Fulano'
  );
}

/**
 * Cascata IA (Zen→Ollama→template). Prefer chaosLine; senão line; senão template local.
 * Injeta lore do grupo quando groupMemoryService existir.
 */
async function chaosText(flavorService, scenario, vars, templateFn, loreOpts = {}) {
  const safe =
    typeof templateFn === 'function' ? () => templateFn() : () => String(templateFn || '').trim();

  const merged = { ...(vars || {}) };
  if (loreOpts.groupMemoryService && loreOpts.scopeKey && !merged.groupLore) {
    try {
      merged.groupLore = loreOpts.groupMemoryService.buildLoreContext(loreOpts.scopeKey, {
        userJids: loreOpts.userJids || [],
        limit: 5,
        funConfig: loreOpts.funConfig || {},
      });
    } catch {
      // ignore
    }
  }

  if (!flavorService) return safe();

  try {
    let text = '';
    if (typeof flavorService.chaosLine === 'function') {
      text = await flavorService.chaosLine(scenario, merged);
    } else if (typeof flavorService.line === 'function') {
      text = await flavorService.line(scenario, merged);
    }
    const t = String(text || '').trim();
    if (t) return t;
  } catch {
    // cai no template
  }
  return safe();
}

function loreBag(ctx) {
  return {
    groupMemoryService: ctx.groupMemoryService,
    scopeKey: ctx.scopeKey,
    funConfig: ctx.funConfig,
    userJids: ctx.userJids || [],
  };
}

export async function handleRussianCommand({
  userJid,
  scopeKey,
  isGroup,
  chaosService,
  funConfig,
  reply,
  flavorService,
  groupMemoryService,
}) {
  if (!isGroup) {
    await reply('Roleta russa só no *grupo*. Lá o mico é coletivo.');
    return { handled: true };
  }
  if (!chaosService) {
    await reply('Roleta russa offline.');
    return { handled: true };
  }

  const result = chaosService.startRussian({ userJid, scopeKey, funConfig });
  if (!result.ok) {
    if (result.reason === 'already-running') {
      await reply(
        [
          '☠️ *Roleta russa* já está na mesa.',
          `Câmaras restantes: *${result.remaining}/${result.chambers}*`,
          'Puxe o gatilho: `/puxar`',
        ].join('\n')
      );
      return { handled: true };
    }
    await reply('Não deu pra girar o tambor.');
    return { handled: true };
  }

  const deathMin = Math.round((result.deathMs || 15 * 60_000) / 60_000);
  const fl = await chaosText(
    flavorService,
    'russian_start',
    { chambers: result.chambers, deathMin },
    () =>
      `Tambor com *${result.chambers}* câmaras · *1* bala. Cada um faz \`/puxar\`. Quem levar, “morre” (virtualmente).`,
    loreBag({ groupMemoryService, scopeKey, funConfig, userJids: [userJid] })
  );

  await reply(
    [
      '☠️ *Roleta russa*',
      fl,
      '',
      `Punição: *sem XP por ${deathMin} min*.`,
      'Comando: `/puxar`',
      '',
      '_Não é real. É só o grupo sendo o grupo._',
    ].join('\n')
  );
  return { handled: true, result };
}

export async function handlePullCommand({
  userJid,
  scopeKey,
  isGroup,
  chaosService,
  funConfig,
  getContactDisplayName,
  reply,
  flavorService,
  groupMemoryService,
}) {
  if (!isGroup) {
    await reply('`/puxar` só funciona na roleta do *grupo*.');
    return { handled: true };
  }
  if (!chaosService) {
    await reply('Gatilho emperrado.');
    return { handled: true };
  }

  const result = chaosService.pullTrigger({ userJid, scopeKey, funConfig });
  const who = nameOf(getContactDisplayName, userJid);

  if (!result.ok) {
    if (result.reason === 'no-game') {
      await reply('Nenhuma roleta aberta. Comece com `/roletarussa`.');
      return { handled: true };
    }
    if (result.reason === 'too-fast') {
      await reply('Calma no gatilho — um puxão por vez.');
      return { handled: true };
    }
    await reply('O tambor não girou.');
    return { handled: true };
  }

  if (result.died) {
    const fl = await chaosText(
      flavorService,
      'russian_dead',
      { user: who, deathLabel: result.deathLabel },
      () => `*${who}* foi de base (virtual). XP em luto por *${result.deathLabel}*.`,
      loreBag({ groupMemoryService, scopeKey, funConfig, userJids: [userJid] })
    );
    await reply(
      [
        '☠️ *BANG*',
        `*${who}* levou a bala (virtual).`,
        `Sem XP por *${result.deathLabel}* neste grupo.`,
        fl,
      ]
        .filter(Boolean)
        .join('\n')
    );
    return { handled: true, result };
  }

  const fl = await chaosText(
    flavorService,
    'russian_click',
    { user: who, remaining: result.remaining, chambers: result.chambers },
    () => `*${who}* ouviu o click. Restam *${result.remaining}* câmaras.`,
    loreBag({ groupMemoryService, scopeKey, funConfig, userJids: [userJid] })
  );
  await reply(
    [
      '🔫 *Click*',
      `*${who}* puxou… câmara vazia.`,
      `Restam *${result.remaining}* de *${result.chambers}*.`,
      result.remaining > 0 ? 'Próximo: `/puxar`' : 'Tambor esgotado. Milagre coletivo.',
      fl,
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, result };
}

export async function handleCancelCommand({
  userJid,
  scopeKey,
  chaosService,
  funConfig,
  getContactDisplayName,
  listContacts,
  reply,
  args,
  mentionedJids,
  quotedParticipant,
  sock,
  identityMap,
  flavorService,
  groupMemoryService,
}) {
  if (!chaosService) {
    await reply('Tribunal offline.');
    return { handled: true };
  }

  const cd = chaosService.checkCooldown('cancel', userJid, scopeKey, funConfig);
  if (!cd.ok) {
    await reply(`Tribunal em intervalo. Volta em *${cd.retryIn}*.`);
    return { handled: true };
  }

  const contacts = typeof listContacts === 'function' ? listContacts() : [];
  const resolved = await resolveUserTarget({
    args,
    mentionedJids,
    quotedParticipant,
    excludeJid: '',
    identityMap,
    sock,
    groupJid: scopeKey,
    contacts,
  });
  const target = resolved?.jid;
  if (!target || !isCanonicalUserJid(target)) {
    await reply('Uso: `/cancelar @pessoa` (ou responda a msg dela).');
    return { handled: true };
  }

  const name = nameOf(getContactDisplayName, target);
  const body = await chaosText(
    flavorService,
    'cancel_absurd',
    { user: name },
    () => chaosService.cancelAbsurd(name),
    loreBag({ groupMemoryService, scopeKey, funConfig, userJids: [target, userJid] })
  );

  await reply(
    ['🚫 *Cancelamento*', body, '', '_Motivo 100% absurdo. Não é sério._'].filter(Boolean).join('\n')
  );
  return { handled: true, provider: flavorService?.lastProvider?.() };
}

export async function handleGossipCommand({
  userJid,
  scopeKey,
  chaosService,
  funConfig,
  getContactDisplayName,
  listContacts,
  reply,
  args,
  mentionedJids,
  quotedParticipant,
  sock,
  identityMap,
  flavorService,
  groupMemoryService,
}) {
  if (!chaosService) {
    await reply('Rádio peão offline.');
    return { handled: true };
  }

  const cd = chaosService.checkCooldown('gossip', userJid, scopeKey, funConfig);
  if (!cd.ok) {
    await reply(`Fofoqueiros em silêncio por *${cd.retryIn}*.`);
    return { handled: true };
  }

  const contacts = typeof listContacts === 'function' ? listContacts() : [];
  const resolved = await resolveUserTarget({
    args,
    mentionedJids,
    quotedParticipant,
    excludeJid: '',
    identityMap,
    sock,
    groupJid: scopeKey,
    contacts,
  });
  const target = resolved?.jid;
  if (!target || !isCanonicalUserJid(target)) {
    await reply('Uso: `/fofoca @pessoa` (sempre falsa).');
    return { handled: true };
  }

  const name = nameOf(getContactDisplayName, target);
  const body = await chaosText(
    flavorService,
    'gossip_fake',
    { user: name },
    () => chaosService.gossipFake(name),
    loreBag({ groupMemoryService, scopeKey, funConfig, userJids: [target, userJid] })
  );

  await reply(
    ['👂 *Fofoca*', body, '', '_Falsa. Inventada. Sem provas. Só o grupo._']
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, provider: flavorService?.lastProvider?.() };
}

export async function handleOracleCommand({
  userJid,
  scopeKey,
  chaosService,
  funConfig,
  reply,
  args,
  flavorService,
  groupMemoryService,
}) {
  if (!chaosService) {
    await reply('Oráculo dormindo.');
    return { handled: true };
  }

  const question = (args || []).join(' ').trim();
  if (!question) {
    await reply(
      [
        '🔮 *Oráculo maluco*',
        'Uso: `/oraculo Vou namorar?`',
        'Respostas *insanas* (IA). Não é tarô (`/tarot`).',
      ].join('\n')
    );
    return { handled: true };
  }

  const cd = chaosService.checkCooldown('oracle', userJid, scopeKey, funConfig);
  if (!cd.ok) {
    await reply(`Astros em cooldown. *${cd.retryIn}*.`);
    return { handled: true };
  }

  const qShort = question.slice(0, 160);
  const body = await chaosText(
    flavorService,
    'oracle_insane',
    { question: qShort },
    () => chaosService.oracleInsane(qShort),
    loreBag({ groupMemoryService, scopeKey, funConfig, userJids: [userJid] })
  );

  await reply(['🔮 *Oráculo maluco*', '', body].join('\n'));
  return { handled: true, provider: flavorService?.lastProvider?.() };
}

export async function handleIlluminatiCommand({
  userJid,
  scopeKey,
  chaosService,
  funConfig,
  getContactDisplayName,
  reply,
  flavorService,
  groupMemoryService,
}) {
  if (!chaosService) {
    await reply('Sociedade secreta offline.');
    return { handled: true };
  }

  const cd = chaosService.checkCooldown('illuminati', userJid, scopeKey, funConfig);
  if (!cd.ok) {
    await reply(`Arquivos selados por *${cd.retryIn}*.`);
    return { handled: true };
  }

  let targetJid = chaosService.pickRandomMember({
    scopeKey,
    excludeJid: '',
    limit: 40,
  });
  if (!targetJid) targetJid = userJid;

  const name = nameOf(getContactDisplayName, targetJid);
  const body = await chaosText(
    flavorService,
    'illuminati_theory',
    { user: name },
    () => chaosService.illuminatiTheory(name),
    loreBag({ groupMemoryService, scopeKey, funConfig, userJids: [targetJid, userJid] })
  );

  await reply(
    [
      '👁️ *Illuminati*',
      body,
      '',
      '_Teoria aleatória. Nenhuma prova. Todos culpados._',
    ]
      .filter(Boolean)
      .join('\n')
  );
  return { handled: true, targetJid, provider: flavorService?.lastProvider?.() };
}
