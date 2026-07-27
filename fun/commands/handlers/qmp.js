import { resolveUserTarget } from '../../utils/mentions.js';
import { isCanonicalUserJid } from '../../utils/identity.js';
import { nameOf, displayNameOnly } from '../../utils/userLabel.js';
import { parseQmpSubcommand } from '../../services/qmpService.js';
import { formatQmpWeeklyLeaderboard } from '../../formatters/rankCard.js';
import { renderLeaderboardPng } from '../../formatters/rankCardImage.js';

async function resolveVoteTarget({
  mentionedJids,
  args,
  userJid,
  identityMap,
  sock,
  scopeKey,
  listContacts,
}) {
  const contacts = typeof listContacts === 'function' ? listContacts() : [];
  const mentions = Array.isArray(mentionedJids) ? [...mentionedJids] : [];

  if (mentions.length >= 1) {
    const r = await resolveUserTarget({
      mentionedJids: mentions,
      args: [],
      excludeJid: userJid,
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    if (r.jid && r.jid !== userJid) return r.jid;
  }

  // tenta nome nos args (sem subcomando)
  const textArgs = (args || []).filter((a) => {
    const n = String(a || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    return !['rank', 'ranking', 'top', 'fechar', 'close', 'encerrar'].includes(n);
  });

  if (textArgs.length) {
    const r = await resolveUserTarget({
      args: textArgs,
      mentionedJids: [],
      excludeJid: userJid,
      identityMap,
      sock,
      groupJid: scopeKey,
      contacts,
    });
    if (r.jid && r.jid !== userJid) return r.jid;
  }

  return '';
}

export async function handleQmpCommand({
  userJid,
  scopeKey,
  isGroup,
  funConfig,
  qmpService,
  getContactDisplayName,
  listContacts,
  reply,
  replyImage,
  args = [],
  mentionedJids = [],
  sock,
  identityMap,
}) {
  if (!qmpService) {
    await reply('QMP indisponível no momento.');
    return { handled: true };
  }

  if (funConfig?.qmpEnabled === false) {
    await reply('Quem é Mais Provável? está desligado neste bot.');
    return { handled: true };
  }

  if (!isGroup) {
    await reply('QMP é só no *grupo* — a zoação precisa de plateia.');
    return { handled: true };
  }

  const sub = parseQmpSubcommand(args);
  const label = (jid) => nameOf(getContactDisplayName, jid);

  // ── Ranking semanal ──────────────────────────────────────────────
  if (sub.kind === 'rank') {
    const data = qmpService.getWeeklyRank({
      scopeKey,
      userJid,
      funConfig,
    });

    const enriched = (data.entries || []).map((e) => ({
      ...e,
      displayName: displayNameOnly(getContactDisplayName, e.userJid),
      // reutiliza card de mensagens: messageCount = votos
      messageCount: e.votes,
      xp: e.votes,
      level: e.votes,
    }));

    const text =
      typeof formatQmpWeeklyLeaderboard === 'function'
        ? formatQmpWeeklyLeaderboard({
            entries: enriched,
            yourRank: data.position?.rank,
            yourTotal: data.position?.total,
            yourVotes: data.position?.votes,
            weekKey: data.weekKey,
            limit: data.limit,
          })
        : qmpService.formatWeeklyRankText({
            entries: data.entries,
            position: data.position,
            weekKey: data.weekKey,
            limit: data.limit,
            nameOf: label,
          });

    if (
      funConfig.rankCardImage !== false &&
      typeof replyImage === 'function' &&
      enriched.length > 0
    ) {
      try {
        const png = renderLeaderboardPng({
          title: 'MAIS PROVÁVEL',
          theme: 'messages',
          entries: enriched,
          yourRank: data.position?.rank,
          yourTotal: data.position?.total,
          yourExtra:
            data.position?.votes != null ? `${data.position.votes} votos` : '',
          footer: `Semana ${data.weekKey} · reseta segunda`,
        });
        await replyImage(png, `👑 QMP · semana ${data.weekKey}`);
        return { handled: true, image: true, sub: 'rank' };
      } catch {
        // fallback texto
      }
    }

    await reply(text);
    return { handled: true, sub: 'rank' };
  }

  // ── Histórico (pergunta + ganhador) ──────────────────────────────
  if (sub.kind === 'history') {
    const hist = qmpService.getHistory({ scopeKey, funConfig });
    await reply(
      qmpService.formatHistory({
        rounds: hist.rounds || [],
        limit: hist.limit || funConfig.qmpHistoryLimit || 8,
        nameOf: label,
      })
    );
    return { handled: true, sub: 'history', count: hist.rounds?.length || 0 };
  }

  // ── Forçar tom (pesada / leve) ────────────────────────────────────
  if (sub.kind === 'heavy' || sub.kind === 'light') {
    // se rest tem menção-alvo, não é force — mas pesada sozinha abre rodada
    const forceTone = sub.kind === 'heavy' ? 'heavy' : 'normal';
    const customFromRest = sub.rest.length ? sub.rest.join(' ') : '';
    // se o resto parece @voto, não trata como custom de pergunta
    const looksLikeOnlyVote =
      Boolean(mentionedJids?.length) &&
      (!customFromRest || customFromRest.replace(/@\S+/g, '').trim().length < 3);

    if (looksLikeOnlyVote) {
      // cai no fluxo de voto abaixo com force ignore
    } else {
      const started = await qmpService.startRound({
        scopeKey,
        userJid,
        customText: customFromRest,
        source: customFromRest ? 'custom' : 'llm',
        funConfig,
        forceTone,
      });
      if (!started.ok) {
        if (started.reason === 'active-exists' && started.question) {
          await reply(
            [
              'Já tem uma rodada aberta:',
              `*${started.question.prompt}*`,
              '',
              'Mencione alguém ou `/qmp fechar`.',
            ].join('\n')
          );
          return { handled: true, sub: sub.kind };
        }
        await reply(
          started.reason === 'empty-prompt'
            ? 'Descreve a situação ou só manda `/qmp pesada`.'
            : 'Não deu pra abrir a rodada.'
        );
        return { handled: true, sub: sub.kind };
      }
      await reply(
        qmpService.formatQuestionAnnouncement(started.question, {
          voteCount: 0,
          auto: false,
        })
      );
      return { handled: true, sub: sub.kind, tone: started.tone, provider: started.provider };
    }
  }

  // ── Encerrar rodada ──────────────────────────────────────────────
  if (sub.kind === 'close') {
    const closed = qmpService.closeRound({ scopeKey, funConfig });
    if (!closed.ok) {
      await reply(
        closed.reason === 'no-active'
          ? 'Não tem rodada QMP aberta agora. Use `/qmp` pra começar.'
          : 'Não deu pra fechar a rodada.'
      );
      return { handled: true, sub: 'close' };
    }

    await reply(
      qmpService.formatRoundResult({
        question: closed.question,
        tally: closed.tally,
        totalVotes: closed.totalVotes,
        nameOf: label,
      })
    );
    return { handled: true, sub: 'close', closed: true };
  }

  // ── Voto por menção (com rodada ativa) ────────────────────────────
  const voteTarget = await resolveVoteTarget({
    mentionedJids,
    args: sub.kind === 'custom' ? sub.rest : args,
    userJid,
    identityMap,
    sock,
    scopeKey,
    listContacts,
  });

  // Se tem menção e não é texto longo de pergunta, tenta votar
  const looksLikeVote =
    Boolean(voteTarget) &&
    (mentionedJids?.length > 0 ||
      (sub.kind === 'custom' && sub.rest.length <= 2 && isCanonicalUserJid(voteTarget)));

  if (looksLikeVote && voteTarget) {
    const vote = qmpService.castVote({
      scopeKey,
      voterJid: userJid,
      targetJid: voteTarget,
      funConfig,
    });

    if (vote.ok) {
      await reply(
        qmpService.formatVoteConfirm({
          voterLabel: label(userJid),
          targetLabel: label(voteTarget),
          voteCount: vote.voteCount,
          question: vote.question,
        })
      );
      return { handled: true, sub: 'vote', voted: true };
    }

    if (vote.reason === 'already-voted') {
      await reply('Você já votou nesta rodada. Um voto por pessoa!');
      return { handled: true, sub: 'vote' };
    }
    if (vote.reason === 'self-vote') {
      await reply('Não vale votar em si mesmo. Escolhe outra vítima 😈');
      return { handled: true, sub: 'vote' };
    }
    if (vote.reason === 'no-active' || vote.reason === 'question-expired') {
      // cai pra criar pergunta se o user mandou texto custom junto
      if (sub.kind !== 'custom' || mentionedJids?.length) {
        await reply(
          'Não tem rodada aberta. Use `/qmp` ou `/qmp sua ideia` pra começar.'
        );
        return { handled: true, sub: 'vote' };
      }
    } else if (vote.reason !== 'no-active') {
      await reply('Não deu pra registrar o voto. Tenta de novo.');
      return { handled: true, sub: 'vote' };
    }
  }

  // ── Nova rodada ──────────────────────────────────────────────────
  const started = await qmpService.startRound({
    scopeKey,
    userJid,
    customText: sub.kind === 'custom' ? sub.rest.join(' ') : '',
    source: sub.kind === 'custom' ? 'custom' : 'llm',
    funConfig,
    forceTone: null,
  });

  if (!started.ok) {
    if (started.reason === 'active-exists' && started.question) {
      await reply(
        [
          'Já tem uma rodada aberta:',
          `*${started.question.prompt}*`,
          '',
          `Votos: *${started.voteCount || 0}*`,
          'Mencione alguém ou `/qmp @pessoa` pra votar.',
          '`/qmp fechar` encerra · `/qmp rank` ranking da semana.',
        ].join('\n')
      );
      return { handled: true, sub: 'active' };
    }
    if (started.reason === 'empty-prompt') {
      await reply('Descreve a situação. Ex.: `/qmp pular aula`');
      return { handled: true };
    }
    if (started.reason === 'disabled') {
      await reply('QMP está desligado.');
      return { handled: true };
    }
    await reply('Não deu pra abrir a rodada. Tenta de novo.');
    return { handled: true };
  }

  await reply(
    qmpService.formatQuestionAnnouncement(started.question, {
      voteCount: 0,
      auto: false,
    })
  );
  return { handled: true, sub: 'start', provider: started.provider };
}

/**
 * Voto passivo: mensagem com menção enquanto há rodada ativa.
 * @returns {Promise<{ handled: boolean, voted?: boolean }>}
 */
export async function tryPassiveQmpVote({
  userJid,
  scopeKey,
  isGroup,
  funConfig,
  qmpService,
  mentionedJids = [],
  getContactDisplayName,
  listContacts,
  reply,
  sock,
  identityMap,
}) {
  if (!isGroup || !qmpService || funConfig?.qmpEnabled === false) {
    return { handled: false };
  }
  if (!mentionedJids?.length) return { handled: false };

  const target = await resolveVoteTarget({
    mentionedJids,
    args: [],
    userJid,
    identityMap,
    sock,
    scopeKey,
    listContacts,
  });
  if (!target || !isCanonicalUserJid(target)) return { handled: false };

  const vote = qmpService.castVote({
    scopeKey,
    voterJid: userJid,
    targetJid: target,
    funConfig,
  });

  if (!vote.ok) {
    // silencioso em already-voted / no-active — não spamma o chat
    if (vote.reason === 'already-voted') {
      return { handled: false, reason: 'already-voted' };
    }
    return { handled: false, reason: vote.reason };
  }

  const label = (jid) => nameOf(getContactDisplayName, jid);
  if (typeof reply === 'function') {
    await reply(
      qmpService.formatVoteConfirm({
        voterLabel: label(userJid),
        targetLabel: label(target),
        voteCount: vote.voteCount,
        question: vote.question,
      })
    );
  }
  return { handled: true, voted: true };
}
