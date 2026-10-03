import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf } from '../../utils/userLabel.js';
import { fmt } from '../../messages/index.js';
import { DEFAULT_TRIAL_BAIL } from '../../services/trialService.js';

export async function handleTrialCommand({
  userJid,
  scopeKey,
  trialService,
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
  if (!trialService) {
    await reply('O Tribunal do Povo está em recesso no momento.');
    return { handled: true };
  }

  const sub = String(args[0] || '').trim().toLowerCase();

  // 1. /tribunal status ou /tribunal ver
  if (sub === 'status' || sub === 'ativo' || sub === 'ver') {
    const active = trialService.getActiveTrial(scopeKey);
    if (!active) {
      await reply('⚖️ *O Tribunal do Povo está silencioso.*\nNenhum julgamento em andamento no momento.');
      return { handled: true };
    }

    const remSec = Math.max(0, Math.ceil((active.endsAt - Date.now()) / 1000));
    const accuserName = nameOf(getContactDisplayName, active.accuserJid);
    const defendantName = nameOf(getContactDisplayName, active.defendantJid);

    const hasWeightDiff =
      (active.guiltyWeighted != null && active.guiltyWeighted !== active.guiltyVotes) ||
      (active.innocentWeighted != null && active.innocentWeighted !== active.innocentVotes);
    const scoreLine = hasWeightDiff
      ? `🗳️ Placar Parcial: 🔴 *${active.guiltyVotes}* Culpado (${active.guiltyWeighted} pts) vs 🟢 *${active.innocentVotes}* Inocente (${active.innocentWeighted} pts)`
      : `🗳️ Placar Parcial: 🔴 *${active.guiltyVotes}* Culpado vs 🟢 *${active.innocentVotes}* Inocente`;

    await reply(
      [
        '⚖️ *JULGAMENTO EM ANDAMENTO!*',
        `Acusador: *${accuserName}*`,
        `Réu no Banco dos Réus: *${defendantName}*`,
        `Acusação: _"${active.evidenceSummary || 'Quebra da paz comunitária'}"_`,
        '',
        scoreLine,
        `⏱️ Tempo restante de votação: *${remSec}s*`,
        '',
        'Use `/voto culpado` ou `/voto inocente` para decidir o destino do réu!',
      ].join('\n')
    );
    return { handled: true, trial: active };
  }

  // 2. /tribunal resolver (se o tempo expirou)
  if (sub === 'resolver' || sub === 'veredito') {
    const active = trialService.getActiveTrial(scopeKey);
    if (!active) {
      await reply('Nenhum julgamento pendente de resolução.');
      return { handled: true };
    }
    const resolved = trialService.resolveTrial(active.id);
    return announceVerdict(resolved, active, getContactDisplayName, reply);
  }

  // 3. /tribunal @alvo [motivo da queixa]
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

  const defendantJid = resolved.jid;
  if (!defendantJid || !isCanonicalUserJid(defendantJid)) {
    await reply(
      [
        '⚖️ *O Tribunal do Povo*',
        'Abra um processo público com jurados populares contra quem cometeu uma infração social!',
        '',
        'Uso: `/tribunal @alvo [acusação]`',
        'Exemplo: `/tribunal @fulano Me deu calote e beijou meu ex`',
        '',
        'Regras do Tribunal:',
        `• Caução judicial: *${DEFAULT_TRIAL_BAIL}* coins debitados do acusador.`,
        '• Se condenado: o réu paga multa de 10% do saldo e a caução volta ao acusador + indenização.',
        `• Se absolvido: acusador responde por Litigância de Má-Fé e PERDE os ${DEFAULT_TRIAL_BAIL} coins para o réu!`,
        '• Votação rápida de *90 segundos* aberta a todos do grupo.',
      ].join('\n')
    );
    return { handled: true };
  }

  const chargeParts = [];
  for (const a of args) {
    const clean = String(a).replace(/^@/, '').trim();
    if (!clean.includes('@') && clean !== sub) {
      chargeParts.push(clean);
    }
  }
  const rawCharge = chargeParts.join(' ').replace(/[_*`~]/g, '').trim().slice(0, 150);
  const charge = rawCharge || 'Quebra da ordem comunitária e conduta desordeira';

  const res = trialService.openTrial({
    scopeKey,
    accuserJid: userJid,
    defendantJid,
    charge,
    durationMs: 90_000,
  });

  if (!res.ok) {
    if (res.reason === 'self-accusation') {
      await reply('Você não pode abrir um processo contra si mesmo no Tribunal!');
      return { handled: true };
    }
    if (res.reason === 'trial-in-progress') {
      await reply('Já existe um julgamento acontecendo neste grupo! Aguarde o veredito atual com `/tribunal status`.');
      return { handled: true };
    }
    if (res.reason === 'defendant-immune') {
      await reply('🛡️ Este réu foi julgado recentemente e possui Imunidade Judicial temporária!');
      return { handled: true };
    }
    if (res.reason === 'insufficient-bail') {
      await reply(fmt.insufficientBalance({ required: res.required, current: res.current }));
      return { handled: true };
    }
    await reply('Falha ao abrir a sessão do Tribunal.');
    return { handled: true };
  }

  const accuserName = nameOf(getContactDisplayName, userJid);
  const defendantName = nameOf(getContactDisplayName, defendantJid);

  await reply(
    [
      '⚖️🚨 *SESSÃO EXTRAORDINÁRIA DO TRIBUNAL DO POVO!*',
      `Acusador: *${accuserName}* (caução de 150 coins depositada)`,
      `Réu Convocado: *${defendantName}*`,
      `📜 Acusação Formal: _"${charge}"_`,
      '',
      '🗳️ *JURADOS DO GRUPO, VOTEM AGORA:*',
      '• `/voto culpado` — condenação e multa comunitária',
      '• `/voto inocente` — absolvição e indenização por litigância de má-fé',
      '',
      '⏱️ A sessão encerra em *90 segundos*!',
    ].join('\n')
  );

  return { handled: true, result: res };
}

export async function handleVoteCommand({
  userJid,
  scopeKey,
  trialService,
  getContactDisplayName,
  reply,
  args = [],
}) {
  if (!trialService) {
    await reply('Tribunal indisponível.');
    return { handled: true };
  }

  const active = trialService.getActiveTrial(scopeKey);
  if (!active) {
    await reply('Nenhum julgamento em andamento neste grupo para votar.');
    return { handled: true };
  }

  const choice = String(args[0] || '').trim().toLowerCase();
  if (choice !== 'culpado' && choice !== 'inocente') {
    await reply('Uso: `/voto culpado` ou `/voto inocente`');
    return { handled: true };
  }

  const voteRes = trialService.vote({
    trialId: active.id,
    voterJid: userJid,
    vote: choice,
  });

  if (!voteRes.ok) {
    if (voteRes.reason === 'defendant-cannot-vote') {
      await reply('O réu não pode votar em seu próprio julgamento!');
      return { handled: true };
    }
    if (voteRes.reason === 'already-voted') {
      await reply('Você já registrou seu voto neste julgamento.');
      return { handled: true };
    }
    if (voteRes.reason === 'voting-ended') {
      await reply('O prazo deste julgamento já encerrou! Digite `/tribunal veredito`.');
      return { handled: true };
    }
    await reply('Não foi possível computar o voto.');
    return { handled: true };
  }

  const voterName = nameOf(getContactDisplayName, userJid);
  const icon = choice === 'culpado' ? '🔴' : '🟢';

  await reply(`${icon} *${voterName}* votou *${choice.toUpperCase()}* no Tribunal do Povo!`);
  return { handled: true, result: voteRes };
}

async function announceVerdict(resolved, active, getContactDisplayName, reply) {
  const accuserName = nameOf(getContactDisplayName, active.accuserJid);
  const defendantName = nameOf(getContactDisplayName, active.defendantJid);

  if (resolved.status === 'dismissed') {
    await reply(
      [
        '⚖️🛡️ *PROCESSO ARQUIVADO!*',
        `O réu *${defendantName}* possui Imunidade Judicial ativa.`,
        `A caução judicial de *${DEFAULT_TRIAL_BAIL}* coins foi restituída integralmente a *${accuserName}*.`,
      ].join('\n')
    );
  } else if (resolved.status === 'convicted') {
    await reply(
      [
        '⚖️🔨 *VEREDITO: RÉU CONDENADO!*',
        `O Tribunal do Povo considerou *${defendantName}* CULPADO(A)!`,
        `Multa aplicada ao réu: *−${resolved.penaltyCoins}* coins`,
        `Caução e recompensa restituídas a *${accuserName}*: *+${resolved.accuserPayout}* coins`,
        `🏷️ *${defendantName}* recebeu o efeito público de *Condenado(a)* por 24 horas!`,
      ].join('\n')
    );
  } else {
    await reply(
      [
        '⚖️🕊️ *VEREDITO: RÉU ABSOLVIDO!*',
        `O Tribunal do Povo considerou *${defendantName}* INOCENTE!`,
        '⚖️ *LITIGÂNCIA DE MÁ-FÉ CONFIGURADA:*',
        `A acusação foi julgada infundada. *${accuserName}* perdeu a caução judicial de 150 coins, transferida integralmente a *${defendantName}* como indenização por danos morais!`,
      ].join('\n')
    );
  }
  return { handled: true, result: resolved };
}
