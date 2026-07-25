export async function handleNsfwForceCommand({
  userJid,
  chatJid,
  isGroup,
  scopeKey,
  reply,
  nsfwVoteRepository,
}) {
  if (!isGroup || !chatJid) {
    await reply('Comando disponível apenas em grupos.');
    return { handled: true };
  }

  const groupJid = chatJid;

  const alreadyEnabled = nsfwVoteRepository.getPermitirNsfw(groupJid);

  if (alreadyEnabled) {
    nsfwVoteRepository.setPermitirNsfw(groupJid, false);
    await reply(
      '🔞 NSFW desativado à força!\n\n' +
      'Comandos NSFW bloqueados neste grupo.'
    );
    return { handled: true };
  }

  const activeVote = nsfwVoteRepository.getActiveVote(groupJid);
  if (activeVote) {
    nsfwVoteRepository.encerrarVotacao({
      voteId: activeVote.id,
      resultado: 'sim',
      agora: Date.now(),
    });
  }

  nsfwVoteRepository.setPermitirNsfw(groupJid, true);

  await reply(
    '🔞 NSFW ativado à força!\n\n' +
    'Comandos NSFW liberados neste grupo.'
  );

  return { handled: true };
}
