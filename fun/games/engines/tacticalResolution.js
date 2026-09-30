/**
 * Funções puras de resolução e constantes para os jogos táticos de rodadas:
 * - 👑 Colinas (King of the Hill)
 * - 🚩 Grande Golpe (Capture a Bandeira / Assalto)
 *
 * Princípio Arquitetural:
 * - Funções 100% determinísticas e puras (sem I/O, sem estado global).
 * - Executam idênticas no servidor em produção e na suíte de testes / simulações de bots.
 */

export const COLINAS_CONSTANTS = Object.freeze({
  TOTAL_ROUNDS: 6,
  ROUND_DURATION_MS: 15_000,
  REVEAL_DURATION_MS: 6_000,
  HILLS: Object.freeze(['alfa', 'bravo', 'charlie']),
  BASE_VALUES: Object.freeze({
    alfa: 5,
    bravo: 3,
    charlie: 2,
  }),
  DEFAULT_AFK_HILL: 'charlie',
  MAX_BOMBS_PER_PLAYER: 1,
  MAX_BOMBS_PER_TEAM: 1,
  BOMB_MODES: Object.freeze({
    PER_PLAYER: 'per_player', // 1 bomba por jogador na partida inteira
    PER_TEAM: 'per_team',     // 1 bomba compartilhada por equipe na partida inteira
    DISABLED: 'disabled',     // Bombas desativadas
  }),
  DEFAULT_BOMB_MODE: 'per_player',
});

export const GOLPE_CONSTANTS = Object.freeze({
  TOTAL_ROUNDS: 6,
  ROUND_DURATION_MS: 15_000,
  REVEAL_DURATION_MS: 6_000,
  ROUTES: Object.freeze(['floresta', 'tunel', 'ponte']),
  ROUTE_VALUES: Object.freeze({
    floresta: 1,
    tunel: 2,
    ponte: 3,
  }),
  DEFAULT_AFK_ROUTE: 'floresta',
  // Em 3v2 estrutural: o time menor ataca 4 das 6 rodadas (rodadas 0, 2, 3, 5) e o maior 2 (rodadas 1, 4)
  UNEVEN_3V2_STRUCTURE: Object.freeze({
    SMALLER_ATTACK_ROUNDS: Object.freeze([0, 2, 3, 5]),
    BIGGER_ATTACK_ROUNDS: Object.freeze([1, 4]),
  }),
});

/**
 * Resolução pura de uma rodada de Colinas.
 *
 * Ordem de Resolução:
 * 1. Bombas: Colina com pelo menos 1 bomba é zerada para ambos os times e seu pote acumulado é destruído.
 *    Bombas extras na mesma colina são consumidas sem efeito adicional.
 * 2. Maioria: Em cada colina restante, o time com maior quantidade de membros leva todos os pontos do pote.
 * 3. Empate em times desiguais (3v2): Se houver empate numérico estrito (ex: 1v1 ou 2v2) e os times têm tamanhos totais desiguais, o time menor vence!
 * 4. Empate em times iguais (ou ninguém): Ninguém pontua e o valor da colina acumula (+ valor base) para a próxima rodada!
 *
 * @param {Array<{ userJid: string, teamId: string, hill: 'alfa'|'bravo'|'charlie', useBomb?: boolean }>} votes
 * @param {{
 *   pots?: { alfa?: number, bravo?: number, charlie?: number },
 *   teamsCount?: Record<string, number>,
 *   teamIds?: string[]
 * }} state
 * @returns {{
 *   roundScores: Record<string, number>,
 *   newPots: Record<string, number>,
 *   reports: Array<{
 *     hill: string,
 *     winnerTeamId: string|null,
 *     pointsAwarded: number,
 *     reason: 'bomb_exploded'|'majority'|'smaller_team_tiebreak'|'tied_accumulated'|'empty_accumulated',
 *     bombers: string[],
 *     votesByTeam: Record<string, number>,
 *     message: string
 *   }>
 * }}
 */
export function resolveColinas(votes = [], state = {}) {
  const teamIds = state.teamIds || (state.teamsCount ? Object.keys(state.teamsCount) : ['A', 'B']);
  const team1 = teamIds[0] || 'A';
  const team2 = teamIds[1] || 'B';

  const countTeam1 = state.teamsCount?.[team1] ?? 0;
  const countTeam2 = state.teamsCount?.[team2] ?? 0;
  const isUneven = countTeam1 > 0 && countTeam2 > 0 && countTeam1 !== countTeam2;
  const smallerTeamId = isUneven ? (countTeam1 < countTeam2 ? team1 : team2) : null;

  const currentPots = {
    alfa: state.pots?.alfa ?? COLINAS_CONSTANTS.BASE_VALUES.alfa,
    bravo: state.pots?.bravo ?? COLINAS_CONSTANTS.BASE_VALUES.bravo,
    charlie: state.pots?.charlie ?? COLINAS_CONSTANTS.BASE_VALUES.charlie,
  };

  const newPots = { ...currentPots };
  const roundScores = {
    [team1]: 0,
    [team2]: 0,
  };
  const reports = [];

  for (const hill of COLINAS_CONSTANTS.HILLS) {
    const hillVotes = votes.filter(v => String(v.hill || '').toLowerCase() === hill);
    const votesT1 = hillVotes.filter(v => v.teamId === team1);
    const votesT2 = hillVotes.filter(v => v.teamId === team2);
    const bombers = hillVotes.filter(v => Boolean(v.useBomb)).map(v => v.userJid);

    const hillPot = currentPots[hill];
    const votesByTeam = {
      [team1]: votesT1.length,
      [team2]: votesT2.length,
    };

    // 1. REGRA DA BOMBA
    if (bombers.length > 0) {
      newPots[hill] = COLINAS_CONSTANTS.BASE_VALUES[hill]; // Pote acumulado destruído, volta ao base
      reports.push({
        hill,
        winnerTeamId: null,
        pointsAwarded: 0,
        reason: 'bomb_exploded',
        bombers,
        votesByTeam,
        message: `💣 Bomba detonada em ${hill.toUpperCase()}! ${bombers.length} bomba(s) usada(s). Ninguém pontuou e o pote foi destruído!`,
      });
      continue;
    }

    const c1 = votesT1.length;
    const c2 = votesT2.length;

    // Se ninguém foi para a colina
    if (c1 === 0 && c2 === 0) {
      newPots[hill] = hillPot + COLINAS_CONSTANTS.BASE_VALUES[hill];
      reports.push({
        hill,
        winnerTeamId: null,
        pointsAwarded: 0,
        reason: 'empty_accumulated',
        bombers: [],
        votesByTeam,
        message: `💨 ${hill.toUpperCase()} ficou vazia! O pote acumulou para ${newPots[hill]} pts.`,
      });
      continue;
    }

    // 2. APURAÇÃO DE MAIORIA
    if (c1 > c2) {
      roundScores[team1] += hillPot;
      newPots[hill] = COLINAS_CONSTANTS.BASE_VALUES[hill];
      reports.push({
        hill,
        winnerTeamId: team1,
        pointsAwarded: hillPot,
        reason: 'majority',
        bombers: [],
        votesByTeam,
        message: `👑 ${team1} dominou ${hill.toUpperCase()} por maioria (${c1} x ${c2})! +${hillPot} pts.`,
      });
    } else if (c2 > c1) {
      roundScores[team2] += hillPot;
      newPots[hill] = COLINAS_CONSTANTS.BASE_VALUES[hill];
      reports.push({
        hill,
        winnerTeamId: team2,
        pointsAwarded: hillPot,
        reason: 'majority',
        bombers: [],
        votesByTeam,
        message: `👑 ${team2} dominou ${hill.toUpperCase()} por maioria (${c2} x ${c1})! +${hillPot} pts.`,
      });
    } else {
      // EMPATE NUMÉRICO (c1 === c2 && c1 > 0)
      // 3. Empate em times desiguais (3v2): vence o time menor
      if (isUneven && smallerTeamId) {
        roundScores[smallerTeamId] += hillPot;
        newPots[hill] = COLINAS_CONSTANTS.BASE_VALUES[hill];
        reports.push({
          hill,
          winnerTeamId: smallerTeamId,
          pointsAwarded: hillPot,
          reason: 'smaller_team_tiebreak',
          bombers: [],
          votesByTeam,
          message: `⚖️ Empate (${c1} x ${c2}) em ${hill.toUpperCase()}! Vitória do time menor (${smallerTeamId}) por desempate tático! +${hillPot} pts.`,
        });
      } else {
        // 4. Empate com times iguais: acumula pote
        newPots[hill] = hillPot + COLINAS_CONSTANTS.BASE_VALUES[hill];
        reports.push({
          hill,
          winnerTeamId: null,
          pointsAwarded: 0,
          reason: 'tied_accumulated',
          bombers: [],
          votesByTeam,
          message: `⚔️ Disputa acirrada em ${hill.toUpperCase()} (${c1} x ${c2})! Empate! O pote acumulou para ${newPots[hill]} pts.`,
        });
      }
    }
  }

  return {
    roundScores,
    newPots,
    reports,
  };
}

/**
 * Resolução pura de uma rodada de Grande Golpe (Capture a Bandeira / Assalto).
 *
 * Cada guardião barra exatamente 1 invasor na mesma rota.
 * Invasores não barrados roubam relíquias com o valor da rota.
 * Em 3v2, quando o time menor ataca, recebe +1 ponto por invasor não barrado.
 *
 * @param {Array<{ userJid: string, teamId: string, route: 'floresta'|'tunel'|'ponte' }>} votes
 * @param {string} attackingTeamId
 * @param {{
 *   teamIds?: string[],
 *   teamsCount?: Record<string, number>,
 *   smallerTeamId?: string|null
 * }} options
 * @returns {{
 *   attackingTeamId: string,
 *   defendingTeamId: string,
 *   totalPoints: number,
 *   routes: Array<{
 *     route: string,
 *     invaders: string[],
 *     guardians: string[],
 *     blockedCount: number,
 *     passedCount: number,
 *     routeUnitValue: number,
 *     pointsEarned: number,
 *     message: string
 *   }>
 * }}
 */
export function resolveGolpe(votes = [], attackingTeamId, options = {}) {
  const teamIds = options.teamIds || (options.teamsCount ? Object.keys(options.teamsCount) : ['A', 'B']);
  const defendingTeamId = teamIds.find(id => id !== attackingTeamId) || (attackingTeamId === 'A' ? 'B' : 'A');

  const countAttacker = options.teamsCount?.[attackingTeamId] ?? 0;
  const countDefender = options.teamsCount?.[defendingTeamId] ?? 0;
  const isSmallerAttacking = Boolean(
    options.smallerTeamId
      ? options.smallerTeamId === attackingTeamId
      : countAttacker > 0 && countDefender > 0 && countAttacker < countDefender
  );

  const attackers = votes.filter(v => v.teamId === attackingTeamId);
  const defenders = votes.filter(v => v.teamId === defendingTeamId);

  let totalPoints = 0;
  const routeReports = [];

  for (const route of GOLPE_CONSTANTS.ROUTES) {
    const routeAttackers = attackers.filter(v => String(v.route || '').toLowerCase() === route);
    const routeDefenders = defenders.filter(v => String(v.route || '').toLowerCase() === route);

    const invaders = routeAttackers.map(v => v.userJid);
    const guardians = routeDefenders.map(v => v.userJid);

    const invadersCount = invaders.length;
    const guardiansCount = guardians.length;

    const blockedCount = Math.min(invadersCount, guardiansCount);
    const passedCount = invadersCount - blockedCount;

    let routeUnitValue = GOLPE_CONSTANTS.ROUTE_VALUES[route];
    if (options.bonus && isSmallerAttacking) {
      routeUnitValue += options.bonus;
    }

    const pointsEarned = passedCount * routeUnitValue;
    totalPoints += pointsEarned;

    let message = '';
    if (invadersCount === 0 && guardiansCount === 0) {
      message = `Nenhum movimento em ${route.toUpperCase()}.`;
    } else if (invadersCount === 0 && guardiansCount > 0) {
      message = `🛡️ ${guardiansCount} guardião(ões) protegeram ${route.toUpperCase()}, mas nenhum invasor apareceu.`;
    } else if (passedCount === 0 && invadersCount > 0) {
      message = `🚫 EMBOSCADA! Todos os ${invadersCount} invasor(es) foram interceptados por ${guardiansCount} guardião(ões) em ${route.toUpperCase()}!`;
    } else if (blockedCount > 0 && passedCount > 0) {
      message = `⚡ ${blockedCount} invasor(es) foram barrados, mas ${passedCount} conseguiram passar em ${route.toUpperCase()}! (+${pointsEarned} pts)`;
    } else {
      message = `🎯 ROTA LIVRE! ${passedCount} invasor(es) passaram sem defesa em ${route.toUpperCase()}! (+${pointsEarned} pts)`;
    }

    routeReports.push({
      route,
      invaders,
      guardians,
      blockedCount,
      passedCount,
      routeUnitValue,
      pointsEarned,
      message,
    });
  }

  return {
    attackingTeamId,
    defendingTeamId,
    totalPoints,
    routes: routeReports,
  };
}
