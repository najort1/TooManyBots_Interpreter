import { formatPanelinhaGuide } from '../../formatters/panelinhaGuide.js';
import { nameOf } from '../../utils/userLabel.js';

function pct(score) {
  return `${Math.round((Number(score) || 0) * 100)}%`;
}

async function flavorItalic(flavorService, scenario, vars) {
  if (!flavorService?.italicLine) return null;
  try {
    return await flavorService.italicLine(scenario, vars);
  } catch {
    return null;
  }
}

export async function handleFactionCommand({
  userJid,
  scopeKey,
  factionService,
  funConfig,
  getContactDisplayName,
  reply,
  args,
  flavorService,
}) {
  if (funConfig.factionsEnabled === false) {
    await reply('Facções desligadas neste bot.');
    return { handled: true };
  }

  const sub = String(args[0] || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const rest = args.slice(1);
  const p = funConfig.prefix || '/';

  if (!sub || sub === 'help' || sub === 'ajuda') {
    await reply(
      [
        '🏴‍☠️ *Facções*',
        `\`${p}faccao criar Nome\` — cria (custa coins)`,
        `\`${p}faccao entrar Nome\``,
        `\`${p}faccao sair\` — taxa de saída`,
        `\`${p}faccao info [Nome]\``,
        `\`${p}faccao rank\``,
        `\`${p}faccao doar 50\` — pro cofre`,
        '',
        'Veja também: `/panelinha` · `/ponte` · `/missao` · `/evento`',
      ].join('\n')
    );
    return { handled: true };
  }

  if (sub === 'criar' || sub === 'create') {
    const name = rest.join(' ').trim();
    if (!name) {
      await reply(`Uso: \`${p}faccao criar Nome da Panelinha\``);
      return { handled: true };
    }
    const result = factionService.create({
      scopeKey,
      userJid,
      name,
      funConfig,
    });
    if (!result.ok) {
      if (result.reason === 'name-taken') {
        await reply('Já existe facção com esse nome.');
        return { handled: true };
      }
      if (result.reason === 'already-in-faction') {
        await reply('Você já está numa facção. Use `/faccao sair` primeiro.');
        return { handled: true };
      }
      if (result.reason === 'insufficient-funds') {
        await reply(`Criar facção custa *${result.cost}* coins. Você tem *${result.coins}*.`);
        return { handled: true };
      }
      await reply('Não deu pra criar a facção.');
      return { handled: true };
    }
    const fl = await flavorItalic(flavorService, 'faction_create', {
      name: result.faction.name,
      user: nameOf(getContactDisplayName, userJid),
    });
    await reply(
      [
        '🏴‍☠️ *Nova facção registrada*',
        `Nome: *${result.faction.name}*`,
        `Líder: *${nameOf(getContactDisplayName, userJid)}*`,
        `Membros: 1/${result.maxMembers}`,
        `Cofre: 0 coins`,
        result.cost ? `Taxa de fundação: −${result.cost} coins` : null,
        '',
        fl || '_A panelinha agora é oficial._',
        `Use \`${p}faccao entrar ${result.faction.name}\` pra entrar · \`${p}faccao doar 50\``,
      ]
        .filter(Boolean)
        .join('\n')
    );
    return { handled: true, result };
  }

  if (sub === 'entrar' || sub === 'join') {
    const name = rest.join(' ').trim();
    if (!name) {
      await reply(`Uso: \`${p}faccao entrar Nome\``);
      return { handled: true };
    }
    const result = factionService.join({
      scopeKey,
      userJid,
      name,
      funConfig,
    });
    if (!result.ok) {
      if (result.reason === 'not-found') {
        await reply('Facção não encontrada.');
        return { handled: true };
      }
      if (result.reason === 'already-in-faction') {
        await reply('Você já está numa facção.');
        return { handled: true };
      }
      if (result.reason === 'full') {
        await reply('Essa facção está cheia.');
        return { handled: true };
      }
      await reply('Não deu pra entrar.');
      return { handled: true };
    }
    const count = factionService.getUserFaction(scopeKey, userJid);
    const fl = await flavorItalic(flavorService, 'faction_join', {
      name: result.faction.name,
      user: nameOf(getContactDisplayName, userJid),
    });
    await reply(
      [
        `✅ *${nameOf(getContactDisplayName, userJid)}* entrou no *${result.faction.name}*.`,
        'Membros atualizados · use `/ponte` e `/faccao info`.',
        fl,
      ]
        .filter(Boolean)
        .join('\n')
    );
    return { handled: true, result, count };
  }

  if (sub === 'sair' || sub === 'leave') {
    const result = factionService.leave({ scopeKey, userJid, funConfig });
    if (!result.ok) {
      if (result.reason === 'not-in-faction') {
        await reply('Você não está em nenhuma facção.');
        return { handled: true };
      }
      if (result.reason === 'insufficient-funds') {
        await reply(`Sair custa *${result.cost}* coins. Você tem *${result.coins}*.`);
        return { handled: true };
      }
      await reply('Não deu pra sair.');
      return { handled: true };
    }
    const fl = await flavorItalic(flavorService, 'faction_leave', {
      name: result.faction.name,
      user: nameOf(getContactDisplayName, userJid),
      dissolved: result.dissolved ? 'sim' : 'não',
    });
    await reply(
      [
        `👋 Você saiu de *${result.faction.name}*.`,
        result.dissolved ? 'A facção foi *dissolvida* (ninguém restou).' : null,
        result.cost ? `Taxa: −${result.cost} coins · saldo *${result.coins}*` : null,
        fl,
      ]
        .filter(Boolean)
        .join('\n')
    );
    return { handled: true, result };
  }

  if (sub === 'doar' || sub === 'donate') {
    const amount = Number(rest[0]);
    const result = factionService.donate({
      scopeKey,
      userJid,
      amount,
    });
    if (!result.ok) {
      if (result.reason === 'not-in-faction') {
        await reply('Entre numa facção primeiro.');
        return { handled: true };
      }
      if (result.reason === 'insufficient-funds') {
        await reply(`Saldo insuficiente (*${result.coins}*).`);
        return { handled: true };
      }
      await reply(`Uso: \`${p}faccao doar 50\``);
      return { handled: true };
    }
    await reply(
      [
        `🏦 *${nameOf(getContactDisplayName, userJid)}* depositou *${result.amount}* coins no cofre do *${result.faction.name}*.`,
        `Cofre atual: *${result.faction.vaultCoins}*`,
        `Seu saldo: *${result.coins}*`,
      ].join('\n')
    );
    return { handled: true, result };
  }

  if (sub === 'info') {
    const name = rest.join(' ').trim() || null;
    const result = factionService.info({
      scopeKey,
      name,
      userJid: name ? null : userJid,
      funConfig,
    });
    if (!result.ok) {
      await reply(name ? 'Facção não encontrada.' : 'Você não está em facção. Use `/faccao rank`.');
      return { handled: true };
    }
    const f = result.faction;
    const lines = [
      `${f.emoji} *${f.name}*`,
      `Líder: *${nameOf(getContactDisplayName, f.leaderJid)}*`,
      `Membros: *${result.memberCount}/${result.maxMembers}*`,
      `Cofre: *${f.vaultCoins}* coins`,
    ];
    if (result.bridge?.ready) {
      lines.push(
        `Ponte Social: *${pct(result.bridge.score)}* (${result.bridge.external} ext / ${result.bridge.internal} int)`,
        result.bridge.debuff ? '💀 Debuff *Panelinha oficial* ativo' : '✅ Ponte saudável'
      );
    } else {
      lines.push(
        `Ponte Social: ainda sem dados (min ${funConfig.bridgeMinActions || 10} ações na semana)`
      );
    }
    lines.push('', '*Membros:*');
    for (const m of result.members.slice(0, 12)) {
      const role = m.role === 'leader' ? '👑' : '•';
      lines.push(`${role} ${nameOf(getContactDisplayName, m.userJid)}`);
    }
    await reply(lines.join('\n'));
    return { handled: true, result };
  }

  if (sub === 'rank' || sub === 'ranking') {
    const result = factionService.rank({ scopeKey, funConfig });
    if (!result.rows.length) {
      await reply('Nenhuma facção ainda. Crie com `/faccao criar Nome`.');
      return { handled: true };
    }
    const lines = ['🏆 *Rank de Facções* (este grupo)', ''];
    result.rows.forEach((row, i) => {
      const ponte = row.bridge?.ready ? pct(row.bridge.score) : '—';
      lines.push(
        `${i + 1}. *${row.faction.name}* — cofre *${row.faction.vaultCoins}* · ponte *${ponte}* · ${row.memberCount} membros`
      );
    });
    lines.push('', '_Ponte Social pesa no score. Isolados sobem menos._');
    await reply(lines.join('\n'));
    return { handled: true, result };
  }

  await reply(`Subcomando desconhecido. Use \`${p}faccao\` sem args pra ver a lista.`);
  return { handled: true };
}

export async function handlePanelinhaCommand({
  scopeKey,
  bridgeService,
  funConfig,
  reply,
}) {
  if (!bridgeService) {
    await reply('Ponte Social indisponível.');
    return { handled: true };
  }
  const report = bridgeService.listPanelinhaReport(scopeKey, funConfig);
  const minActions = funConfig.bridgeMinActions || 10;
  const lines = [
    '🔬 *Relatório da CIA do Grupo*',
    `Semana: *${report.weekKey}*`,
    '',
    '*Quem mais joga só no próprio time* (pior Ponte Social primeiro):',
    '_1º = facção que menos mistura com o resto do chat_',
    '',
  ];

  if (!report.rows.length) {
    lines.push('Sem facções ainda. Crie com `/faccao criar Nome`.');
  } else {
    report.rows.forEach((row, i) => {
      const b = row.bridge;
      if (!b.ready) {
        lines.push(
          `${i + 1}. *${row.faction.name}* — ainda sem placar (precisa de ~${minActions} ações na semana)`
        );
        return;
      }
      const score = pct(b.score);
      const mark = b.debuff ? ' 😬 clube fechado' : '';
      lines.push(
        `${i + 1}. *${row.faction.name}* — ponte *${score}* (ext ${b.external} · int ${b.internal})${mark}`
      );
    });
    const ready = report.rows.filter(r => r.bridge.ready);
    if (ready.length) {
      const best = [...ready].sort((a, b) => b.bridge.score - a.bridge.score)[0];
      const worst = [...ready].sort((a, b) => a.bridge.score - b.bridge.score)[0];
      lines.push('', `🏅 Mais misturam: *${best.faction.name}*`);
      lines.push(`💀 Mais panelinha: *${worst.faction.name}*`);
    }
  }
  lines.push(
    '',
    'Como subir a ponte: `/pay`, `/aposta`, `/ship` com *outra facção*.',
    'Guia completo (no privado): `/comopanelinha`'
  );
  await reply(lines.join('\n'));
  return { handled: true };
}

/**
 * Guia panelinha — sempre no chat atual (sem DM).
 */
export async function handlePanelinhaGuideCommand({ funConfig, reply }) {
  const text = formatPanelinhaGuide(funConfig.prefix || '/', funConfig);
  await reply(text);
  return { handled: true, private: false };
}

export async function handlePonteCommand({
  userJid,
  scopeKey,
  factionService,
  bridgeService,
  funConfig,
  reply,
}) {
  const uf = factionService.getUserFaction(scopeKey, userJid);
  if (!uf) {
    await reply('Você não está em facção. `/faccao criar` ou `/faccao entrar`.');
    return { handled: true };
  }
  const bridge = bridgeService.getFactionBridge(scopeKey, uf.faction.id, funConfig);
  const lines = [
    `🌉 *Ponte Social — ${uf.faction.name}*`,
    bridge.ready
      ? `Score: *${pct(bridge.score)}*${bridge.debuff ? ' (ruim)' : ' (ok)'}`
      : `Score: ainda calculando (min ${funConfig.bridgeMinActions || 10} ações)`,
    `Ações internas: *${bridge.internal}* · externas: *${bridge.external}*`,
  ];
  if (bridge.debuff) {
    lines.push(
      `Debuff ativo: _"Panelinha oficial"_ — XP de daily ×${funConfig.bridgeDebuffXpMult || 0.9} até a ponte passar de ${Math.round((funConfig.bridgeDebuffThreshold || 0.25) * 100)}%.`
    );
  }
  await reply(lines.join('\n'));
  return { handled: true };
}
