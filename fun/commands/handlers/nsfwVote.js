const VOTE_DURATION_MS = 24 * 60 * 60 * 1000;

async function tryEncerrarEAvisar({ vote, totalMembros, nsfwService, nsfwVoteRepository, reply }) {
  const result = nsfwService.tryEncerrar(vote, totalMembros);
  if (!result.ok) return;

  const voteFinal = nsfwVoteRepository.getVoteById(result.encerrado.id);
  const sim = voteFinal.votosSim;
  const nao = voteFinal.votosNao;
  const totalV = voteFinal.totalMembros;

  if (result.result === 'sim') {
    await reply(
      '🗳️ Votação NSFW encerrada.\n\n' +
      `Sim: ${sim} · Não: ${nao}\n` +
      `Quórum: ${sim + nao}/${totalV}\n\n` +
      '✅ Comandos NSFW liberados neste grupo.'
    );
  } else if (result.result === 'nao') {
    await reply(
      '🗳️ Votação NSFW encerrada.\n\n' +
      `Sim: ${sim} · Não: ${nao}\n` +
      `Quórum: ${sim + nao}/${totalV}\n\n` +
      '❌ Comandos NSFW continuam bloqueados.'
    );
  } else if (result.result === 'empate') {
    await reply(
      '🗳️ Votação NSFW encerrada (empate).\n\n' +
      `Sim: ${sim} · Não: ${nao}\n` +
      `Quórum: ${sim + nao}/${totalV}\n\n` +
      '✅ Desempate: sim vence. Comandos NSFW liberados.'
    );
  }
}

async function processarVoto({ vote, userJid, voto, nsfwVoteRepository, reply, groupJid }) {
  if (nsfwVoteRepository.hasUserVoted(vote.id, userJid)) {
    const label = voto === 'sim' ? 'a favor' : 'contra';
    await reply(`Você já votou ${label} nesta votação.`);
    return null;
  }

  const result = nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid, voto });
  if (!result.ok) {
    await reply('Erro ao registrar voto. Tente de novo.');
    return null;
  }

  return nsfwVoteRepository.getVoteById(vote.id);
}

export async function handleNsfwEnableCommand({
  userJid,
  chatJid,
  isGroup,
  scopeKey,
  funConfig,
  reply,
  sock,
  nsfwVoteRepository,
  nsfwService,
  membershipService,
}) {
  if (!isGroup || !chatJid) {
    await reply('Comando disponível apenas em grupos.');
    return { handled: true };
  }

  const groupJid = chatJid;

  const alreadyEnabled = nsfwVoteRepository.getPermitirNsfw(groupJid);
  if (alreadyEnabled) {
    await reply('Comandos NSFW já estão habilitados neste grupo.');
    return { handled: true };
  }

  const activeVote = nsfwVoteRepository.getActiveVote(groupJid);

  if (activeVote) {
    const updated = await processarVoto({
      vote: activeVote,
      userJid,
      voto: 'sim',
      nsfwVoteRepository,
      reply,
      groupJid,
    });
    if (!updated) return { handled: true };

    const count = nsfwVoteRepository.countBallots(updated.id);
    const total = updated.totalMembros || 0;
    await reply(`🗳️ Seu voto foi registrado como *sim*.\nVotos: ${count}/${total} (mín ${Math.ceil(total * 0.5)})`);

    await tryEncerrarEAvisar({ vote: updated, totalMembros: total, nsfwService, nsfwVoteRepository, reply });
    return { handled: true };
  }

  let totalMembros = 0;
  try {
    const members = await membershipService.getGroupMembers(sock, groupJid, funConfig);
    totalMembros = members.set.size;
  } catch {
    await reply('Não foi possível obter a lista de membros do grupo. Tente de novo.');
    return { handled: true };
  }

  if (totalMembros < 3) {
    await reply('O grupo precisa ter pelo menos 3 membros para realizar uma votação.');
    return { handled: true };
  }

  const agora = Date.now();
  const expiraEm = agora + VOTE_DURATION_MS;
  let vote;
  try {
    vote = nsfwVoteRepository.createVote({ scopeKey: groupJid, expiraEm, totalMembros, agora });
  } catch (err) {
    await reply('Erro ao criar votação. Tente de novo.');
    return { handled: true };
  }

  const registro = nsfwVoteRepository.registerVoto({ voteId: vote.id, userJid, voto: 'sim' });
  if (!registro.ok) {
    await reply('Votação criada, mas não foi possível registrar seu voto. Tente /nsfw_enable de novo.');
    return { handled: true };
  }

  const voteAtual = nsfwVoteRepository.getVoteById(vote.id);

  const required = Math.ceil(totalMembros * 0.5);
  const msg = [
    '🗳️ Votação NSFW iniciada!',
    '',
    'Deseja habilitar comandos NSFW neste grupo?',
    '',
    `Membros: *${totalMembros}*`,
    `Votos necessários (50%): *${required}*`,
    `Prazo: *24 horas*`,
    '',
    'Envie `/nsfw_enable` para votar *sim*.',
    'Envie `/nsfw_r` para votar *não*.',
    'Abstenções não contam.',
    '',
    'Se sim vencer, comandos NSFW serão liberados.',
    'Se não vencer, continuará bloqueado.',
  ].join('\n');

  await reply(msg);

  await tryEncerrarEAvisar({ vote: voteAtual, totalMembros, nsfwService, nsfwVoteRepository, reply });
  return { handled: true };
}

export async function handleNsfwRejectCommand({
  userJid,
  chatJid,
  isGroup,
  scopeKey,
  funConfig,
  reply,
  sock,
  nsfwVoteRepository,
  nsfwService,
  membershipService,
}) {
  if (!isGroup || !chatJid) {
    await reply('Comando disponível apenas em grupos.');
    return { handled: true };
  }

  const groupJid = chatJid;

  const activeVote = nsfwVoteRepository.getActiveVote(groupJid);
  if (!activeVote) {
    await reply('Não há votação NSFW ativa neste grupo.');
    return { handled: true };
  }

  const updated = await processarVoto({
    vote: activeVote,
    userJid,
    voto: 'nao',
    nsfwVoteRepository,
    reply,
    groupJid,
  });
  if (!updated) return { handled: true };

  const count = nsfwVoteRepository.countBallots(updated.id);
  const total = updated.totalMembros || 0;
  await reply(`🗳️ Seu voto foi registrado como *não*.\nVotos: ${count}/${total} (mín ${Math.ceil(total * 0.5)})`);

  await tryEncerrarEAvisar({ vote: updated, totalMembros: total, nsfwService, nsfwVoteRepository, reply });
  return { handled: true };
}
