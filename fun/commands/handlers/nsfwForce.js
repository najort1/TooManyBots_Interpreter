import { isGroupAdmin } from '../../utils/groupMembership.js';

export async function handleNsfwForceCommand({
  sock,
  userJid,
  chatJid,
  isGroup,
  scopeKey,
  reply,
  nsfwVoteRepository,
}) {
  if (!isGroup || !chatJid) {
    await reply('Comando disponível apenas em grupos.');
    return { handled: true, success: false, reason: 'not-group' };
  }

  const groupJid = chatJid;

  const isAdmin = await isGroupAdmin(sock, groupJid, userJid);
  if (!isAdmin) {
    await reply('⚠️ Apenas administradores do grupo podem forçar a ativação ou desativação de comandos NSFW.');
    return { handled: true, success: false, reason: 'user-not-admin' };
  }

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
