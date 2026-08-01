/**
 * /despedida rank — exibe ranking de quem mais se despediu no grupo.
 *
 * - Sem cooldown.
 * - Formato: card de texto simples (sem PNG — os themes de imagem
 *   são hardcoded por commandId e nenhum cobre despedidas).
 * - Ordenação: count decrescente. Desempate: quem despediu antes (lastAt ASC).
 */

const EMPTY_LINE = 'Ninguém se despediu neste grupo ainda.';

export async function handleDespedidaRankCommand({
  userJid,
  scopeKey,
  farewellService = null,
  reply,
  args = [],
  funConfig = {},
}) {
  // Aceita "/despedida rank" ou só "/despedida" (alias já mapeia p/ DESPEDIDA_RANK).
  const sub = String(args[0] || '').trim().toLowerCase();
  if (sub && !['rank', 'ranking', 'top', 'placar'].includes(sub)) {
    await reply('Use `/despedida rank` para ver o ranking de despedidas.');
    return { handled: true };
  }

  if (!farewellService) {
    await reply('Ranking de despedidas indisponível.');
    return { handled: true };
  }

  const limit = Math.max(5, Math.min(20, Number(funConfig?.rankLimit) || 10));
  const entries = farewellService.getRanking(scopeKey, limit);
  const userPos = farewellService.getUserPosition(userJid, scopeKey);
  const total = farewellService.totalByGroup(scopeKey);

  const lines = ['👋 *RANKING DE DESPEDIDAS*', ''];
  if (!entries.length) {
    lines.push(EMPTY_LINE);
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    for (const e of entries) {
      const mark = medals[e.rank - 1] || `${e.rank}.`;
      lines.push(`${mark} *${e.displayName}* — ${e.count} despedida${e.count > 1 ? 's' : ''}`);
    }
    lines.push('');
    lines.push(`Total no grupo: *${total}* despedida${total > 1 ? 's' : ''}`);
    if (userPos.count > 0) {
      lines.push(
        `Você: *${userPos.count}* despedida${userPos.count > 1 ? 's' : ''} (#${userPos.rank})`
      );
    } else {
      lines.push('Você ainda não se despediu aqui. Use `/despedir`.');
    }
  }

  await reply(lines.join('\n'));
  return { handled: true };
}
