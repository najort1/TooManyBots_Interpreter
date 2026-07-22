const VOTE_DURATION_MS = 24 * 60 * 60 * 1000;
const REQUIRED_PCT = 0.5;

function checkImpossibilidade(vote, totalMembros) {
  const sim = vote.votosSim;
  const nao = vote.votosNao;
  const restante = totalMembros - (sim + nao);
  if (restante <= 0) return null;
  const maioria = Math.ceil(totalMembros * REQUIRED_PCT);
  const faltaSim = maioria - sim;
  const faltaNao = maioria - nao;
  if (faltaSim > restante && faltaNao > restante) return null;
  if (faltaSim > restante) return 'nao';
  if (faltaNao > restante) return 'sim';
  return null;
}

function checkMaioriaAbsoluta(vote, totalMembros, agora) {
  const totalVotos = vote.votosSim + vote.votosNao;
  const requiredVotes = Math.ceil(totalMembros * REQUIRED_PCT);
  if (totalVotos < requiredVotes) return null;
  if (vote.votosSim > vote.votosNao) return 'sim';
  if (vote.votosNao > vote.votosSim) return 'nao';
  if (vote.votosSim === vote.votosNao && totalVotos >= requiredVotes) {
    return 'sim';
  }
  return null;
}

function checkVencimento(vote, agora) {
  if (vote.status !== 'active') return null;
  if (vote.expiraEm <= agora) {
    if (vote.votosSim > vote.votosNao) return 'sim';
    if (vote.votosNao > vote.votosSim) return 'nao';
    return 'empate';
  }
  return null;
}

export function createFunNsfwService({ nsfwVoteRepository, groupRepository }) {
  function getVoteStatus(vote, totalMembros) {
    const agora = Date.now();
    const result =
      checkVencimento(vote, agora) ||
      checkMaioriaAbsoluta(vote, totalMembros, agora) ||
      checkImpossibilidade(vote, totalMembros) ||
      null;
    return {
      voteId: vote.id,
      scopeKey: vote.scopeKey,
      status: vote.status,
      criadaEm: vote.criadaEm,
      expiraEm: vote.expiraEm,
      votosSim: vote.votosSim,
      votosNao: vote.votosNao,
      totalMembros,
      requiredVotes: Math.ceil(totalMembros * REQUIRED_PCT),
      result,
      encerradaEm: vote.encerradaEm,
    };
  }

  function tryEncerrar(vote, totalMembros) {
    const agora = Date.now();
    const result =
      checkVencimento(vote, agora) ||
      checkMaioriaAbsoluta(vote, totalMembros, agora) ||
      checkImpossibilidade(vote, totalMembros) ||
      null;
    if (!result) return { ok: false, result: null };
    const encerrado = nsfwVoteRepository.encerrarVotacao({
      voteId: vote.id,
      resultado: result,
      agora,
    });
    if (result === 'sim') {
      nsfwVoteRepository.setPermitirNsfw(vote.scopeKey, true);
    }
    return { ok: true, result, encerrado };
  }

  function processVoteResult(vote) {
    if (vote.resultado === 'sim') {
      nsfwVoteRepository.setPermitirNsfw(vote.scopeKey, true);
      return { ok: true, nsfwEnabled: true };
    }
    return { ok: true, nsfwEnabled: false };
  }

  return {
    getVoteStatus,
    tryEncerrar,
    processVoteResult,
  };
}
