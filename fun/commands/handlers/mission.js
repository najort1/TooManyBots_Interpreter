import { nameOf } from '../../utils/userLabel.js';

function formatMission(mission, getContactDisplayName) {
  const progress = mission.progress || {};
  const lines = [
    '🎯 *Operação Mistura*',
    `Status: *${mission.status}* · expira em ${new Date(mission.expiresAt).toLocaleString('pt-BR')}`,
    '',
    '*Squad (facções diferentes):*',
  ];
  for (const m of mission.members || []) {
    lines.push(
      `• ${nameOf(getContactDisplayName, m.userJid)} (*${m.factionName || '?'}*)`
    );
  }
  lines.push('', '*Objetivos:*');
  for (const g of mission.goals || []) {
    let done = Boolean(progress[g.id]);
    if (g.id === 'daily' && progress.dailyMap) {
      const doneCount = Object.keys(progress.dailyMap).length;
      const total = (mission.members || []).length;
      lines.push(
        `${done ? '✅' : '⬜'} ${g.label} (${doneCount}/${total})`
      );
    } else {
      lines.push(`${done ? '✅' : '⬜'} ${g.label}`);
    }
  }
  lines.push('', `Prêmio: *${mission.rewardEach}* coins cada`);
  return lines.join('\n');
}

async function flavorItalic(flavorService, scenario, vars) {
  if (!flavorService?.italicLine) return null;
  try {
    return await flavorService.italicLine(scenario, vars);
  } catch {
    return null;
  }
}

export async function handleMissionCommand({
  userJid,
  scopeKey,
  missionService,
  funConfig,
  getContactDisplayName,
  reply,
  args,
  flavorService,
}) {
  const sub = String(args[0] || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (sub === 'spawn' || sub === 'nova' || sub === 'start') {
    const spawned = missionService.spawn({ scopeKey, funConfig });
    if (!spawned.ok) {
      if (spawned.reason === 'need-factions') {
        await reply(
          `Precisa de pelo menos *2 facções* com membros. Agora: ${spawned.factions || 0}.`
        );
        return { handled: true };
      }
      await reply('Não deu pra montar o squad. Crie mais facções ou entre em alguma.');
      return { handled: true };
    }
    const fl = await flavorItalic(flavorService, 'mission_spawn', {
      members: (spawned.mission?.members || []).length,
    });
    const body = formatMission(spawned.mission, getContactDisplayName);
    await reply(fl ? `${body}\n\n${fl}` : body);
    return { handled: true, result: spawned };
  }

  const status = missionService.statusForUser(scopeKey, userJid);
  if (!status.ok) {
    await reply(
      [
        'Nenhuma missão mista ativa.',
        'Use `/missao spawn` (ou aguarde o bot sortear) depois de ter 2+ facções.',
        'Objetivos típicos: daily do squad, aposta entre membros, ship do squad.',
      ].join('\n')
    );
    return { handled: true };
  }

  let text = formatMission(status.mission, getContactDisplayName);
  if (!status.isMember) {
    text += '\n\n_Você não está neste squad — assista o caos._';
  }
  await reply(text);
  return { handled: true, status };
}

export async function handleSquadCommand(ctx) {
  return handleMissionCommand(ctx);
}

export async function handleEventCommand({
  scopeKey,
  eventService,
  funConfig,
  reply,
  args,
}) {
  const sub = String(args[0] || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Usuários não iniciam eventos — só consultam status
  if (sub === 'start' || sub === 'iniciar' || sub === 'spawn' || sub === 'happy' || sub === 'happyhour' || sub === 'cassino') {
    await reply(
      [
        'Os *eventos são sorteados pelo bot* — ninguém inicia na mão.',
        'Use `/evento` pra ver se tem algo rolando.',
        '_Trégua falsa e happy hour aparecem de surpresa no grupo._',
      ].join('\n')
    );
    return { handled: true, denied: true };
  }

  const status = eventService.getStatus(scopeKey);
  if (!status.active) {
    const cdMs = eventService.cooldownRemaining?.(scopeKey, funConfig) || 0;
    const cdMin = cdMs > 0 ? Math.ceil(cdMs / 60000) : 0;
    await reply(
      [
        'Nenhum evento ativo agora.',
        'O bot sorteia sozinho: *trégua falsa* (cross-facção) ou *happy hour* (cassino).',
        cdMin > 0 ? `Próxima janela de sorteio em ~*${cdMin}* min (cooldown).` : 'Fica de olho no chat — pode cair a qualquer momento.',
      ].join('\n')
    );
    return { handled: true };
  }

  if (status.eventType === 'casino_happy') {
    await reply(
      [
        '🍸 *Happy hour ativo*',
        `Payouts cassino *x${status.multiplier}*`,
        `Tempo restante: ~*${Math.ceil(status.remainingMs / 60000)}* min`,
        'Vale: `/roleta` · `/slot` · `/crash` · `/bj`',
      ].join('\n')
    );
    return { handled: true, status };
  }

  await reply(
    [
      '⚡ *Evento ativo: TRÉGUA FALSA*',
      `Multiplicador: *${status.multiplier}x* em interações cross-facção`,
      `Tempo restante: ~*${Math.ceil(status.remainingMs / 60000)}* min`,
      'Vale para: `/pay` · `/aposta` · `/ship` entre facções diferentes',
    ].join('\n')
  );
  return { handled: true, status };
}
