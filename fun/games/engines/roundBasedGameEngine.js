/**
 * Motor Unificado de Jogos de Rodadas Síncronas (Round-Based Game Engine).
 *
 * Utilizado por:
 * - 👑 Colinas (King of the Hill)
 * - 🚩 Grande Golpe (Capture a Bandeira / Assalto)
 *
 * Princípios de Resiliência:
 * - 100% aderente às restrições do Cloudflare Quick Tunnel (sem necessidade de SSE de alta frequência).
 * - Ciclo determinístico: Fase de Decisão (15s) -> Fase de Revelação (4s).
 * - Isolamento de privacidade entre equipes: o time rival NUNCA recebe votos ou sugestões antes do reveal.
 * - Resolução matemática pura delegada a tacticalResolution.js.
 */

import {
  COLINAS_CONSTANTS,
  GOLPE_CONSTANTS,
  resolveColinas,
  resolveGolpe,
} from './tacticalResolution.js';

export const ROUND_PHASES = Object.freeze({
  IDLE: 'idle',
  ROUND: 'round',
  REVEAL: 'reveal',
  ENDED: 'ended',
});

/**
 * Factory do Motor de Rodadas Táticas.
 *
 * @param {object} room Sala gerenciada pelo GameManager
 * @param {object} options
 * @param {'king_of_the_hill'|'grid_ctf'} options.gameType
 * @param {Function} [options.now]
 * @param {object} [options.gameManager]
 * @param {number} [options.totalRounds]
 * @param {number} [options.roundDurationMs]
 * @param {number} [options.revealDurationMs]
 * @returns {object} Interface do motor de jogo
 */
export function createRoundBasedGameEngine(room, {
  gameType = 'king_of_the_hill',
  now = Date.now,
  gameManager = null,
  totalRounds = 6,
  roundDurationMs = 15_000,
  revealDurationMs = 6_000,
} = {}) {
  if (!room) {
    throw new Error('[roundBasedGameEngine] Objeto room é obrigatório');
  }

  const gm = gameManager || room.gameManager || null;
  const isColinas = gameType === 'king_of_the_hill';
  const isGolpe = gameType === 'grid_ctf';

  // --- ESTADO DO MOTOR ---
  let phase = ROUND_PHASES.IDLE;
  let currentRoundIndex = -1; // 0 a totalRounds - 1
  let phaseStartedAt = 0;
  let phaseEndsAt = 0;
  let phaseTimeout = null;

  // Times da partida (Team A e Team B)
  // Map<teamId, { id: string, name: string, emoji: string, score: number, members: string[] }>
  const teams = new Map();
  // Map<userJid, { userJid: string, username: string, teamId: string, factionId: string, factionName: string, emoji: string }>
  const playerTeamMap = new Map();

  // Histórico de bombas por jogador em Colinas (userJid -> boolean)
  const bombsUsed = new Map();

  // Histórico da última escolha de cada jogador (para fallback AFK)
  const lastChoices = new Map();

  // Votos da rodada atual: Map<userJid, { userJid, teamId, choice: string, useBomb?: boolean, timestamp }>
  const currentVotes = new Map();

  // Sugestões táticas em tempo real para o canal da equipe (Map<userJid, { userJid, choice, timestamp }>)
  const teamSuggestions = new Map();

  // Chat tático rápido por equipe: Map<teamId, Array<{ userJid: string, username: string, text: string, timestamp: number }>>
  const teamTacticalMessages = new Map();

  // Estado específico de Colinas: potes acumulados
  let colinasPots = { ...COLINAS_CONSTANTS.BASE_VALUES };

  // Histórico de relatórios de todas as rodadas reveladas
  const roundHistory = [];

  function broadcast(eventName, payload) {
    if (gm?.broadcast) {
      gm.broadcast(room, eventName, payload);
    } else if (room.clients) {
      const dataStr = JSON.stringify(payload);
      const message = `event: ${eventName}\ndata: ${dataStr}\n\n`;
      for (const res of room.clients) {
        try {
          res.write(message);
        } catch {
          room.clients.delete(res);
        }
      }
    }
  }

  function clearAllTimers() {
    if (phaseTimeout) {
      clearTimeout(phaseTimeout);
      phaseTimeout = null;
    }
  }

  /**
   * Distribui os jogadores em dois times mantendo membros da mesma panelinha juntos quando possível.
   */
  function setupTeams() {
    teams.clear();
    playerTeamMap.clear();

    const roomFactions = Array.from(room.factions?.values() || []);
    const roomPlayers = Array.from(room.players?.values() || []);

    if (roomFactions.length >= 2) {
      // 2 panelinhas competindo
      const f1 = roomFactions[0];
      const f2 = roomFactions[1];

      teams.set(f1.id, {
        id: f1.id,
        name: f1.name,
        emoji: f1.emoji || '🔵',
        score: 0,
        members: [],
      });

      teams.set(f2.id, {
        id: f2.id,
        name: f2.name,
        emoji: f2.emoji || '🔴',
        score: 0,
        members: [],
      });

      for (const p of roomPlayers) {
        const facId = p.faction?.id || f1.id;
        const targetTeamId = teams.has(facId) ? facId : f1.id;
        const teamObj = teams.get(targetTeamId);
        teamObj.members.push(p.userJid);

        playerTeamMap.set(p.userJid, {
          userJid: p.userJid,
          username: p.username,
          teamId: targetTeamId,
          factionId: p.faction?.id || targetTeamId,
          factionName: teamObj.name,
          emoji: teamObj.emoji,
        });
      }
    } else {
      // Menos de 2 panelinhas: divide os jogadores igualmente em Time A (Azul) e Time B (Vermelho)
      const tA = { id: 'team_a', name: 'Time Azul', emoji: '🔵', score: 0, members: [] };
      const tB = { id: 'team_b', name: 'Time Vermelho', emoji: '🔴', score: 0, members: [] };
      teams.set('team_a', tA);
      teams.set('team_b', tB);

      roomPlayers.forEach((p, idx) => {
        const team = idx % 2 === 0 ? tA : tB;
        team.members.push(p.userJid);
        playerTeamMap.set(p.userJid, {
          userJid: p.userJid,
          username: p.username,
          teamId: team.id,
          factionId: p.faction?.id || team.id,
          factionName: team.name,
          emoji: team.emoji,
        });
      });
    }

    // Inicializa filas de mensagens táticas
    for (const teamId of teams.keys()) {
      teamTacticalMessages.set(teamId, []);
    }
  }

  /**
   * Determina qual time está atacando na rodada atual (para Grande Golpe).
   * Em times iguais:
   *   Rodadas ímpares (0, 2, 4): Time 1 ataca.
   *   Rodadas pares (1, 3, 5): Time 2 ataca.
   * Em times desiguais (3v2):
   *   Compensação estrutural: o time menor ataca 4 das 6 rodadas (0, 2, 3, 5) e o maior 2 (1, 4).
   */
  function getAttackingTeamId(roundIdx = currentRoundIndex) {
    const teamIds = Array.from(teams.keys());
    if (teamIds.length < 2) return teamIds[0] || null;

    const t0 = teamIds[0];
    const t1 = teamIds[1];
    const count0 = teams.get(t0)?.members?.length ?? 0;
    const count1 = teams.get(t1)?.members?.length ?? 0;

    // Compensação estrutural em 3v2: time menor ataca mais vezes
    if (count0 !== count1 && count0 > 0 && count1 > 0) {
      const smallerTeamId = count0 < count1 ? t0 : t1;
      const biggerTeamId = count0 < count1 ? t1 : t0;
      const smallerRounds = GOLPE_CONSTANTS.UNEVEN_3V2_STRUCTURE.SMALLER_ATTACK_ROUNDS;
      return smallerRounds.includes(roundIdx) ? smallerTeamId : biggerTeamId;
    }

    return roundIdx % 2 === 0 ? t0 : t1;
  }

  function getDefendingTeamId(roundIdx = currentRoundIndex) {
    const attacking = getAttackingTeamId(roundIdx);
    const teamIds = Array.from(teams.keys());
    return teamIds.find(id => id !== attacking) || teamIds[0];
  }

  /**
   * Inicia uma nova rodada tática (Fase de Decisão de 15 segundos).
   */
  function startRound(roundIndex) {
    clearAllTimers();

    if (roundIndex >= totalRounds) {
      finishGame();
      return;
    }

    currentRoundIndex = roundIndex;
    phase = ROUND_PHASES.ROUND;
    phaseStartedAt = now();
    phaseEndsAt = phaseStartedAt + roundDurationMs;

    currentVotes.clear();
    teamSuggestions.clear();

    const attackingTeamId = isGolpe ? getAttackingTeamId(roundIndex) : null;
    const defendingTeamId = isGolpe ? getDefendingTeamId(roundIndex) : null;

    broadcast('round_started', {
      round: currentRoundIndex + 1,
      totalRounds,
      phase: ROUND_PHASES.ROUND,
      timeRemainingMs: roundDurationMs,
      remainingSeconds: Math.ceil(roundDurationMs / 1000),
      attackingTeamId,
      defendingTeamId,
      pots: isColinas ? colinasPots : undefined,
      scores: getScoresPayload(),
    });

    phaseTimeout = setTimeout(() => {
      endRoundPhase();
    }, roundDurationMs);
  }

  /**
   * Encerra a fase de votação e resolve a rodada (Fase de Revelação de 4 segundos).
   */
  function endRoundPhase() {
    clearAllTimers();

    if (phase !== ROUND_PHASES.ROUND) return;

    phase = ROUND_PHASES.REVEAL;
    phaseStartedAt = now();
    phaseEndsAt = phaseStartedAt + revealDurationMs;

    // 1. Aplica fallback AFK para quem não votou
    for (const [userJid, pData] of playerTeamMap.entries()) {
      if (!currentVotes.has(userJid)) {
        const lastChoice = lastChoices.get(userJid);
        const defaultChoice = isColinas
          ? (lastChoice || COLINAS_CONSTANTS.DEFAULT_AFK_HILL)
          : (lastChoice || GOLPE_CONSTANTS.DEFAULT_AFK_ROUTE);

        currentVotes.set(userJid, {
          userJid,
          teamId: pData.teamId,
          choice: defaultChoice,
          useBomb: false, // AFK nunca gasta bomba
          isAfk: true,
          timestamp: now(),
        });
      }
    }

    // Atualiza histórico de escolhas
    for (const [userJid, v] of currentVotes.entries()) {
      lastChoices.set(userJid, v.choice);
      if (v.useBomb) {
        bombsUsed.set(userJid, true);
      }
    }

    const votesArray = Array.from(currentVotes.values()).map(v => ({
      userJid: v.userJid,
      teamId: v.teamId,
      hill: v.choice,
      route: v.choice,
      useBomb: Boolean(v.useBomb),
    }));

    const teamIds = Array.from(teams.keys());
    const teamsCount = {
      [teamIds[0]]: teams.get(teamIds[0])?.members.length || 0,
      [teamIds[1]]: teams.get(teamIds[1])?.members.length || 0,
    };

    let roundResult = null;

    if (isColinas) {
      roundResult = resolveColinas(votesArray, {
        pots: colinasPots,
        teamsCount,
        teamIds,
      });

      // Aplica pontuação nas equipes e na sala
      colinasPots = roundResult.newPots;
      for (const [teamId, scoreGained] of Object.entries(roundResult.roundScores)) {
        const t = teams.get(teamId);
        if (t) t.score += scoreGained;
        if (room.factions?.has(teamId)) {
          room.factions.get(teamId).score += scoreGained;
        }
      }
    } else {
      const attackingTeamId = getAttackingTeamId(currentRoundIndex);
      roundResult = resolveGolpe(votesArray, attackingTeamId, {
        teamsCount,
        teamIds,
        smallerTeamId: teamsCount[teamIds[0]] < teamsCount[teamIds[1]]
          ? teamIds[0]
          : teamsCount[teamIds[1]] < teamsCount[teamIds[0]]
            ? teamIds[1]
            : null,
      });

      const t = teams.get(attackingTeamId);
      if (t) t.score += roundResult.totalPoints;
      if (room.factions?.has(attackingTeamId)) {
        room.factions.get(attackingTeamId).score += roundResult.totalPoints;
      }
    }

    const roundReport = {
      round: currentRoundIndex + 1,
      totalRounds,
      gameType,
      roundResult,
      votes: votesArray.map(v => {
        const p = playerTeamMap.get(v.userJid);
        return {
          userJid: v.userJid,
          username: p?.username || 'Jogador',
          teamId: v.teamId,
          choice: v.hill || v.route,
          useBomb: v.useBomb,
          isAfk: Boolean(currentVotes.get(v.userJid)?.isAfk),
        };
      }),
      scores: getScoresPayload(),
    };

    roundHistory.push(roundReport);

    broadcast('round_reveal', {
      ...roundReport,
      remainingSeconds: Math.ceil(revealDurationMs / 1000),
    });

    phaseTimeout = setTimeout(() => {
      const nextIndex = currentRoundIndex + 1;
      if (nextIndex < totalRounds) {
        startRound(nextIndex);
      } else {
        finishGame();
      }
    }, revealDurationMs);
  }

  /**
   * Finaliza o jogo e notifica o GameManager.
   */
  async function finishGame() {
    clearAllTimers();
    if (phase === ROUND_PHASES.ENDED) return;
    phase = ROUND_PHASES.ENDED;

    let winningTeamId = null;
    const teamList = Array.from(teams.values());

    if (teamList.length >= 2) {
      if (teamList[0].score > teamList[1].score) winningTeamId = teamList[0].id;
      else if (teamList[1].score > teamList[0].score) winningTeamId = teamList[1].id;
      else {
        const count0 = teamList[0].members?.length ?? 0;
        const count1 = teamList[1].members?.length ?? 0;
        // Desempate em times desiguais (3v2): mérito ao time menor
        if (count0 !== count1 && count0 > 0 && count1 > 0) {
          winningTeamId = count0 < count1 ? teamList[0].id : teamList[1].id;
        } else if (isColinas) {
          // Desempate em Colinas: mais colinas dominadas no histórico
          let wins0 = 0;
          let wins1 = 0;
          for (const rh of roundHistory) {
            for (const rep of rh.roundResult?.reports || []) {
              if (rep.winnerTeamId === teamList[0].id) wins0++;
              if (rep.winnerTeamId === teamList[1].id) wins1++;
            }
          }
          if (wins0 > wins1) winningTeamId = teamList[0].id;
          else if (wins1 > wins0) winningTeamId = teamList[1].id;
        }
      }
    }

    const winnerFaction = winningTeamId && room.factions?.has(winningTeamId)
      ? room.factions.get(winningTeamId)
      : null;

    const finalStats = {
      gameType,
      totalRounds,
      winningTeamId,
      winnerFaction,
      scores: getScoresPayload(),
      roundHistory,
      completedAt: now(),
    };

    broadcast('game_finished', finalStats);

    const activeGm = gm || room.gameManager;
    if (activeGm?.finishGame) {
      try {
        await activeGm.finishGame(room.id, winningTeamId, finalStats);
      } catch (err) {
        console.error('[roundBasedGameEngine] Erro ao invocar gameManager.finishGame:', err);
      }
    }
  }

  function getScoresPayload() {
    return Array.from(teams.values()).map(t => ({
      teamId: t.id,
      name: t.name,
      emoji: t.emoji,
      score: t.score,
      playerCount: t.members.length,
    }));
  }

  // --- TRATAMENTO DE AÇÕES ---

  async function handleAction(playerSession, actionData = {}) {
    const userJid = playerSession?.userJid || playerSession?.player?.userJid;
    if (!userJid || !playerTeamMap.has(userJid)) {
      return { ok: false, error: 'player_not_in_game', message: 'Você não está cadastrado nesta partida.' };
    }

    const pData = playerTeamMap.get(userJid);
    const action = String(actionData.action || '').trim().toLowerCase();

    // 1. AÇÃO: VOTO OFICIAL DA RODADA (escolha de colina ou rota)
    if (action === 'vote' || action === 'vote_hill' || action === 'vote_route') {
      if (phase !== ROUND_PHASES.ROUND) {
        return { ok: false, error: 'not_in_round_phase', message: 'Aguarde o início da próxima rodada para votar.' };
      }

      const rawChoice = String(actionData.choice || actionData.hill || actionData.route || '').trim().toLowerCase();

      if (isColinas) {
        if (!COLINAS_CONSTANTS.HILLS.includes(rawChoice)) {
          return { ok: false, error: 'invalid_hill', message: 'Escolha Alfa, Bravo ou Charlie.' };
        }

        const wantsBomb = Boolean(actionData.useBomb);
        const alreadyUsed = Boolean(bombsUsed.get(userJid));

        if (wantsBomb && alreadyUsed) {
          return { ok: false, error: 'bomb_already_used', message: 'Você já usou sua Bomba nesta partida!' };
        }

        currentVotes.set(userJid, {
          userJid,
          teamId: pData.teamId,
          choice: rawChoice,
          useBomb: wantsBomb,
          timestamp: now(),
        });

        // Também atualiza a sugestão do jogador para sua panelinha
        teamSuggestions.set(userJid, { userJid, choice: rawChoice, timestamp: now() });

        return {
          ok: true,
          choice: rawChoice,
          useBomb: wantsBomb,
          hasRemainingBomb: !alreadyUsed && !wantsBomb,
        };
      }

      if (isGolpe) {
        if (!GOLPE_CONSTANTS.ROUTES.includes(rawChoice)) {
          return { ok: false, error: 'invalid_route', message: 'Escolha Floresta, Túnel ou Ponte.' };
        }

        currentVotes.set(userJid, {
          userJid,
          teamId: pData.teamId,
          choice: rawChoice,
          timestamp: now(),
        });

        teamSuggestions.set(userJid, { userJid, choice: rawChoice, timestamp: now() });

        return {
          ok: true,
          choice: rawChoice,
        };
      }
    }

    // 2. AÇÃO: SUGESTÃO / MARCAÇÃO TÁTICA (Sem confirmar voto obrigatório)
    if (action === 'suggest') {
      const rawChoice = String(actionData.choice || '').trim().toLowerCase();
      teamSuggestions.set(userJid, { userJid, choice: rawChoice, timestamp: now() });
      return { ok: true, suggested: rawChoice };
    }

    // 3. AÇÃO: MENSAGEM NO CHAT TÁTICO DA PANELINHA
    if (action === 'team_message') {
      const msg = String(actionData.message || '').trim().slice(0, 100);
      if (!msg) return { ok: false, error: 'empty_message' };

      const list = teamTacticalMessages.get(pData.teamId) || [];
      list.push({
        userJid,
        username: pData.username,
        text: msg,
        timestamp: now(),
      });
      if (list.length > 20) list.shift();

      return { ok: true, sent: true };
    }

    return { ok: false, error: 'unknown_action', message: 'Ação desconhecida.' };
  }

  /**
   * Retorna o estado público filtrado para a sessão do jogador que fez a requisição.
   * Garante isolamento estrito: durante a fase de escolha, votos da equipe rival são omitidos!
   */
  function getPublicState(forPlayerSession = null) {
    const viewerJid = forPlayerSession?.userJid || forPlayerSession?.player?.userJid || null;
    const viewerTeamId = viewerJid && playerTeamMap.has(viewerJid)
      ? playerTeamMap.get(viewerJid).teamId
      : null;

    const remainingSeconds = Math.max(0, Math.ceil((phaseEndsAt - now()) / 1000));

    // Sugestões visíveis: apenas da panelinha do espectador
    const myTeamSuggestions = {};
    if (viewerTeamId) {
      for (const [uJid, s] of teamSuggestions.entries()) {
        const p = playerTeamMap.get(uJid);
        if (p && p.teamId === viewerTeamId) {
          myTeamSuggestions[s.choice] = (myTeamSuggestions[s.choice] || 0) + 1;
        }
      }
    }

    const myCurrentVote = viewerJid && currentVotes.has(viewerJid)
      ? {
        choice: currentVotes.get(viewerJid).choice,
        useBomb: currentVotes.get(viewerJid).useBomb,
      }
      : null;

    const myTeamChat = viewerTeamId ? (teamTacticalMessages.get(viewerTeamId) || []) : [];

    return {
      gameType,
      phase,
      currentRound: currentRoundIndex,
      totalRounds,
      remainingSeconds,
      timeRemainingMs: Math.max(0, phaseEndsAt - now()),
      scores: getScoresPayload(),
      attackingTeamId: isGolpe ? getAttackingTeamId(currentRoundIndex) : null,
      defendingTeamId: isGolpe ? getDefendingTeamId(currentRoundIndex) : null,
      pots: isColinas ? colinasPots : undefined,
      viewerTeamId,
      myCurrentVote,
      myBombAvailable: viewerJid ? !bombsUsed.get(viewerJid) : true,
      myTeamSuggestions,
      myTeamChat,
      lastRoundReport: roundHistory.length > 0 ? roundHistory[roundHistory.length - 1] : null,
      roundHistory,
    };
  }

  async function start() {
    if (phase !== ROUND_PHASES.IDLE) return false;
    setupTeams();
    startRound(0);
    return true;
  }

  function cleanup() {
    clearAllTimers();
    phase = ROUND_PHASES.ENDED;
  }

  return {
    gameType,
    start,
    cleanup,
    handleAction,
    getPublicState,
    setupTeams,
  };
}
