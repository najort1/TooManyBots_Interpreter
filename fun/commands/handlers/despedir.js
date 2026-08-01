/**
 * /despedir — envia apenas o poema de despedida e registra no ranking.
 *
 * - Sem cooldown (multiplas chamadas permitidas).
 * - Sem custo em coins.
 * - A resposta ao usuario é SOMENTE o poema (sem flavour/headers extras).
 */

const FAREWELL_POEM = [
  'Despeço-me do grupo em claro lamento,',
  'Escrevo estas linhas com pesar profundo,',
  'É o adeus que trago neste desalento,',
  'Ao ver que me perdi no teu mundo.',
  '',
  'Escolheste a dedo quem quiseste ao lado,',
  'E eu, à margem, fiquei a observar,',
  'Entre os eleitos, um nome ingrato e marcado,',
  'De quem prefiro sequer me lembrar.',
  '',
  'O nordestino, cuja face já se esvai,',
  'Na névoa turva do que foi amizade,',
  'Transformou-se em algo que já não me atrai,',
  'Perdeu o brilho da antiga lealdade.',
  '',
  'Respeito, oh, respeito, esse bem precioso,',
  'Que deveria guiar cada escolha feita,',
  'Faltou-me agora, e sinto-me tão desgostoso,',
  'Ao ver que nossa confiança é desfeita.',
  '',
  'Não peço, por favor, que me traga de volta,',
  'Não há desejo de seguir esse caminho,',
  'Não quero o grupo onde já perdi a volta,',
  'Onde o meu espaço ficou tão sozinho.',
  '',
  'Que não recorram a outros para me buscar,',
  'Nem peçam aos adm que me reintroduzam,',
  'Esqueça meu nome, e deixe-me calar,',
  'Pois nessa escolha, por fim, nos separam.',
  '',
  'Assim, encerro este ciclo com saudade,',
  'Mas com a certeza de que é o necessário,',
  'Parto com o peito cheio de verdade,',
  'E deixo o grupo em seu novo cenário.',
].join('\n');

export async function handleDespedirCommand({
  userJid,
  scopeKey,
  farewellService = null,
  newsService = null,
  reply,
  args = [],
  funConfig = {},
}) {
  const sub = String(args[0] || '').trim().toLowerCase();

  // Compat: `/despedir rank` também mostra ranking.
  if (['rank', 'ranking', 'top', 'placar'].includes(sub)) {
    if (!farewellService) {
      await reply('Ranking de despedidas indisponível.');
      return { handled: true };
    }
    const limit = Math.max(5, Math.min(20, Number(funConfig?.rankLimit) || 10));
    const entries = farewellService.getRanking(scopeKey, limit);
    const userPos = farewellService.getUserPosition(userJid, scopeKey);
    const total = farewellService.totalByGroup(scopeKey);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = ['👋 *RANKING DE DESPEDIDAS*', ''];
    if (!entries.length) {
      lines.push('Ninguém se despediu neste grupo ainda.');
    } else {
      for (const e of entries) {
        const mark = medals[e.rank - 1] || `${e.rank}.`;
        lines.push(`${mark} *${e.displayName}* — ${e.count} despedida${e.count > 1 ? 's' : ''}`);
      }
      lines.push('');
      lines.push(`Total no grupo: *${total}* despedida${total > 1 ? 's' : ''}`);
      if (userPos.count > 0) {
        lines.push(`Você: *${userPos.count}* despedida${userPos.count > 1 ? 's' : ''} (#${userPos.rank})`);
      } else {
        lines.push('Você ainda não se despediu aqui. Use `/despedir`.');
      }
    }
    await reply(lines.join('\n'));
    return { handled: true };
  }

  // Sem cooldown — sempre registra.
  try {
    farewellService?.register?.({ scopeKey, userJid, now: Date.now() });
  } catch {
    /* registro é best-effort; não bloqueia o poema */
  }

  // Evento extra só quando não houver farewellService disponível.
  try {
    if (!farewellService) {
      newsService?.log?.(scopeKey, 'despedir', { userJid, payload: {}, now: Date.now() });
    }
  } catch {
    /* ignore */
  }

  // Restrição explícita: somente o poema, nenhuma outra mensagem.
  await reply(FAREWELL_POEM);
  return { handled: true };
}
