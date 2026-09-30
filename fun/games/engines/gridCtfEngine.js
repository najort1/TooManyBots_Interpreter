/**
 * Grid CTF Engine (Capture a Bandeira Tático)
 * Jogo multiplayer autoritativo para 2 a 8 jogadores divididos entre panelinhas/times.
 *
 * Otimizado para Cloudflare Quick Tunnel e conexões móveis:
 * - Ações discretas no servidor via POST /action em vez de streaming contínuo a 60 FPS.
 * - Cooldowns validados no servidor para garantir ritmo tático justo e evitar flooding.
 * - Servidor autoritativo para física de grade, obstáculos, tackles, bandeiras e pontuação.
 */

export const GRID_CTF_CONSTANTS = Object.freeze({
  DEFAULT_WIDTH: 12,
  DEFAULT_HEIGHT: 8,
  POINTS_TO_WIN: 3,
  MATCH_DURATION_MS: 4 * 60 * 1000, // 4 minutos
  MOVE_COOLDOWN_MS: 350,
  TACKLE_COOLDOWN_MS: 800,
  DASH_COOLDOWN_MS: 2000,
  RESPAWN_DURATION_MS: 3000,
  FLAG_AUTO_RETURN_MS: 20000, // Se caída por 20s, retorna à base
  TEAMS: {
    BLUE: 'blue',
    RED: 'red',
  },
  ACTIONS: {
    MOVE: 'move',
    TACKLE: 'tackle',
    DASH: 'dash',
  },
  DIRECTIONS: {
    UP: 'up',
    DOWN: 'down',
    LEFT: 'left',
    RIGHT: 'right',
  },
});

/**
 * Cria os obstáculos táticos padrão da arena criando 3 corredores (Norte, Centro, Sul).
 * Paredes simétricas nas colunas centrais e intermediárias.
 */
function createDefaultObstacles() {
  return new Set([
    '3,1', '3,6', // Coberturas intermediárias base azul
    '5,2', '5,5', // Trincheiras de fronteira oeste
    '6,2', '6,5', // Trincheiras de fronteira leste
    '8,1', '8,6', // Coberturas intermediárias base vermelha
  ]);
}

/**
 * Retorna os deltas x, y para cada direção cardeal.
 */
function getDirectionOffset(direction) {
  switch (String(direction || '').toLowerCase().trim()) {
    case GRID_CTF_CONSTANTS.DIRECTIONS.UP:
      return { dx: 0, dy: -1 };
    case GRID_CTF_CONSTANTS.DIRECTIONS.DOWN:
      return { dx: 0, dy: 1 };
    case GRID_CTF_CONSTANTS.DIRECTIONS.LEFT:
      return { dx: -1, dy: 0 };
    case GRID_CTF_CONSTANTS.DIRECTIONS.RIGHT:
      return { dx: 1, dy: 0 };
    default:
      return null;
  }
}

/**
 * Retorna se as coordenadas dadas estão dentro da base do time indicado.
 */
function isInsideTeamBase(x, y, team, width = 12, height = 8) {
  if (team === GRID_CTF_CONSTANTS.TEAMS.BLUE) {
    return x >= 0 && x <= 1 && y >= 2 && y <= 5;
  }
  if (team === GRID_CTF_CONSTANTS.TEAMS.RED) {
    return x >= width - 2 && x <= width - 1 && y >= 2 && y <= 5;
  }
  return false;
}

/**
 * Retorna o time ao qual pertence o território de uma coordenada x.
 * Colunas da metade esquerda são do time Azul; metade direita do Vermelho.
 */
function getTerritoryTeam(x, width = 12) {
  const mid = Math.floor(width / 2);
  return x < mid ? GRID_CTF_CONSTANTS.TEAMS.BLUE : GRID_CTF_CONSTANTS.TEAMS.RED;
}

function resolveConfigNum(val, fallback, minAllowed = 0) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = Number(val);
  return Number.isFinite(n) ? Math.max(minAllowed, n) : fallback;
}

/**
 * Factory principal do Grid CTF Engine.
 *
 * @param {object} room Sala criada pelo GameManager
 * @param {object} options Opções de configuração e injeção
 * @returns {object} Instância do motor do jogo
 */
export function createGridCtfEngine(room, {
  funConfig = {},
  now = Date.now,
  gameManager = null,
} = {}) {
  if (!room) throw new Error('[gridCtfEngine] room é obrigatório');

  // Configurações e limites (permite 0 em testes quando explicitamente passado)
  const width = Math.max(8, Number(funConfig.gridCtfWidth) || GRID_CTF_CONSTANTS.DEFAULT_WIDTH);
  const height = Math.max(6, Number(funConfig.gridCtfHeight) || GRID_CTF_CONSTANTS.DEFAULT_HEIGHT);
  const pointsToWin = Math.max(1, Number(funConfig.gridCtfPointsToWin) || GRID_CTF_CONSTANTS.POINTS_TO_WIN);
  const matchDurationMs = Math.max(30000, Number(funConfig.gridCtfDurationMs) || GRID_CTF_CONSTANTS.MATCH_DURATION_MS);

  const moveCooldownMs = resolveConfigNum(funConfig.gridCtfMoveCooldownMs, GRID_CTF_CONSTANTS.MOVE_COOLDOWN_MS, 0);
  const tackleCooldownMs = resolveConfigNum(funConfig.gridCtfTackleCooldownMs, GRID_CTF_CONSTANTS.TACKLE_COOLDOWN_MS, 0);
  const dashCooldownMs = resolveConfigNum(funConfig.gridCtfDashCooldownMs, GRID_CTF_CONSTANTS.DASH_COOLDOWN_MS, 0);
  const respawnDurationMs = resolveConfigNum(funConfig.gridCtfRespawnDurationMs, GRID_CTF_CONSTANTS.RESPAWN_DURATION_MS, 0);
  const flagAutoReturnMs = resolveConfigNum(funConfig.gridCtfFlagAutoReturnMs, GRID_CTF_CONSTANTS.FLAG_AUTO_RETURN_MS, 0);

  // Conjunto de obstáculos fixos ("x,y")
  const obstacles = createDefaultObstacles();

  // Estado das Equipes
  const teams = {
    [GRID_CTF_CONSTANTS.TEAMS.BLUE]: {
      id: GRID_CTF_CONSTANTS.TEAMS.BLUE,
      name: 'Time Azul',
      color: '#3b82f6',
      score: 0,
      baseArea: { xMin: 0, xMax: 1, yMin: 2, yMax: 5 },
      flagBase: { x: 1, y: 3 },
      respawn: { x: 0, y: 3 },
      factionIds: new Set(),
    },
    [GRID_CTF_CONSTANTS.TEAMS.RED]: {
      id: GRID_CTF_CONSTANTS.TEAMS.RED,
      name: 'Time Vermelho',
      color: '#ef4444',
      score: 0,
      baseArea: { xMin: width - 2, xMax: width - 1, yMin: 2, yMax: 5 },
      flagBase: { x: width - 2, y: 3 },
      respawn: { x: width - 1, y: 3 },
      factionIds: new Set(),
    },
  };

  // Estado das Bandeiras
  const flags = {
    [GRID_CTF_CONSTANTS.TEAMS.BLUE]: {
      team: GRID_CTF_CONSTANTS.TEAMS.BLUE,
      x: teams[GRID_CTF_CONSTANTS.TEAMS.BLUE].flagBase.x,
      y: teams[GRID_CTF_CONSTANTS.TEAMS.BLUE].flagBase.y,
      baseX: teams[GRID_CTF_CONSTANTS.TEAMS.BLUE].flagBase.x,
      baseY: teams[GRID_CTF_CONSTANTS.TEAMS.BLUE].flagBase.y,
      status: 'at_base', // 'at_base' | 'carried' | 'dropped'
      carrierId: null,
      droppedAt: null,
    },
    [GRID_CTF_CONSTANTS.TEAMS.RED]: {
      team: GRID_CTF_CONSTANTS.TEAMS.RED,
      x: teams[GRID_CTF_CONSTANTS.TEAMS.RED].flagBase.x,
      y: teams[GRID_CTF_CONSTANTS.TEAMS.RED].flagBase.y,
      baseX: teams[GRID_CTF_CONSTANTS.TEAMS.RED].flagBase.x,
      baseY: teams[GRID_CTF_CONSTANTS.TEAMS.RED].flagBase.y,
      status: 'at_base',
      carrierId: null,
      droppedAt: null,
    },
  };

  /** @type {Map<string, object>} */
  const players = new Map();

  let matchStartedAt = null;
  let matchEndsAt = null;
  let matchStatus = 'waiting'; // 'waiting' | 'in_progress' | 'finished'
  let winnerTeam = null;
  let winnerFaction = null;

  let tickTimer = null;

  /**
   * Envia evento de broadcast com resiliência para clientes conectados.
   */
  function broadcast(eventName, payload) {
    if (room.gameManager?.broadcast) {
      room.gameManager.broadcast(room, eventName, payload);
      return;
    }
    if (gameManager?.broadcast) {
      gameManager.broadcast(room, eventName, payload);
      return;
    }
    if (room.clients) {
      const dataStr = JSON.stringify(payload);
      const msg = `event: ${eventName}\ndata: ${dataStr}\n\n`;
      for (const res of room.clients) {
        try {
          res.write(msg);
        } catch {
          room.clients.delete(res);
        }
      }
    }
  }

  /**
   * Finaliza a partida delegando para o GameManager.
   */
  async function finalizeMatch(winningTeamId, reason = 'score_reached') {
    if (matchStatus === 'finished') return;
    matchStatus = 'finished';
    winnerTeam = winningTeamId;
    cleanup();

    // Determina a panelinha vencedora
    let winningFactionId = null;
    if (winningTeamId) {
      const teamFactionIds = Array.from(teams[winningTeamId].factionIds);
      if (teamFactionIds.length > 0) {
        // Encontra a panelinha do time que teve maior pontuação acumulada na sala
        let topScore = -1;
        for (const fId of teamFactionIds) {
          const fac = room.factions?.get(fId);
          if (fac && fac.score >= topScore) {
            topScore = fac.score;
            winningFactionId = fId;
          }
        }
        if (!winningFactionId) winningFactionId = teamFactionIds[0];
      }
    }

    if (winningFactionId && room.factions?.has(winningFactionId)) {
      winnerFaction = room.factions.get(winningFactionId);
    }

    const matchStats = {
      winnerTeam,
      reason,
      blueScore: teams.blue.score,
      redScore: teams.red.score,
      durationSec: Math.round((now() - (matchStartedAt || now())) / 1000),
      players: Array.from(players.values()).map(p => ({
        userJid: p.userJid,
        username: p.username,
        team: p.team,
        score: p.score,
        captures: p.stats.captures,
        tackles: p.stats.tackles,
        returns: p.stats.returns,
      })),
    };

    if (room.gameManager?.finishGame) {
      await room.gameManager.finishGame(room.id, winningFactionId, matchStats);
    } else if (gameManager?.finishGame) {
      await gameManager.finishGame(room.id, winningFactionId, matchStats);
    } else {
      room.status = 'finished';
      broadcast('game_finished', {
        winnerFaction,
        winnerTeam,
        extraStats: matchStats,
      });
    }
  }

  /**
   * Retorna os pontos de spawn iniciais para o time especificado.
   */
  function getSpawnPositionsForTeam(team, count) {
    const list = [];
    const isBlue = team === GRID_CTF_CONSTANTS.TEAMS.BLUE;
    const xBase = isBlue ? 0 : width - 1;
    const xSecondary = isBlue ? 1 : width - 2;

    const ySlots = [2, 3, 4, 5, 1, 6];
    for (let i = 0; i < count; i++) {
      if (i < ySlots.length) {
        list.push({ x: xBase, y: ySlots[i] });
      } else {
        const secIndex = i - ySlots.length;
        list.push({ x: xSecondary, y: ySlots[secIndex % ySlots.length] });
      }
    }
    return list;
  }

  /**
   * Distribui os jogadores da sala entre os dois times (Azul e Vermelho),
   * preservando panelinhas no mesmo time sempre que viável.
   */
  function distributePlayers() {
    players.clear();
    teams.blue.factionIds.clear();
    teams.red.factionIds.clear();

    const roomPlayers = Array.from(room.players?.values() || []);
    if (roomPlayers.length === 0) return;

    // Agrupa jogadores por panelinha
    const factionMap = new Map();
    for (const p of roomPlayers) {
      const fId = p.faction?.id || 'solo';
      if (!factionMap.has(fId)) {
        factionMap.set(fId, []);
      }
      factionMap.get(fId).push(p);
    }

    // Ordena panelinhas por maior quantidade de membros
    const sortedFactions = Array.from(factionMap.entries()).sort(
      (a, b) => b[1].length - a[1].length
    );

    const blueList = [];
    const redList = [];

    if (sortedFactions.length === 1) {
      // Mesma panelinha dividida entre amigos
      const allMembers = sortedFactions[0][1];
      const factionId = sortedFactions[0][0];
      teams.blue.factionIds.add(factionId);
      teams.red.factionIds.add(factionId);

      allMembers.forEach((p, idx) => {
        if (idx % 2 === 0) blueList.push(p);
        else redList.push(p);
      });
    } else {
      // 2 ou mais panelinhas: aloca cada panelinha para o time menor
      for (const [factionId, members] of sortedFactions) {
        if (blueList.length <= redList.length) {
          blueList.push(...members);
          teams.blue.factionIds.add(factionId);
        } else {
          redList.push(...members);
          teams.red.factionIds.add(factionId);
        }
      }
    }

    // Inicializa posições no time Azul
    const blueSpawns = getSpawnPositionsForTeam(GRID_CTF_CONSTANTS.TEAMS.BLUE, blueList.length);
    blueList.forEach((p, i) => {
      const spawn = blueSpawns[i] || { x: 0, y: 3 };
      players.set(p.userJid, {
        userJid: p.userJid,
        username: p.username,
        faction: p.faction || null,
        team: GRID_CTF_CONSTANTS.TEAMS.BLUE,
        x: spawn.x,
        y: spawn.y,
        facing: GRID_CTF_CONSTANTS.DIRECTIONS.RIGHT,
        hasFlag: false,
        carryingFlagTeam: null,
        lastMoveAt: 0,
        lastTackleAt: 0,
        lastDashAt: 0,
        respawningUntil: 0,
        isRespawning: false,
        score: 0,
        stats: { captures: 0, tackles: 0, returns: 0, dashes: 0 },
      });
    });

    // Inicializa posições no time Vermelho
    const redSpawns = getSpawnPositionsForTeam(GRID_CTF_CONSTANTS.TEAMS.RED, redList.length);
    redList.forEach((p, i) => {
      const spawn = redSpawns[i] || { x: width - 1, y: 3 };
      players.set(p.userJid, {
        userJid: p.userJid,
        username: p.username,
        faction: p.faction || null,
        team: GRID_CTF_CONSTANTS.TEAMS.RED,
        x: spawn.x,
        y: spawn.y,
        facing: GRID_CTF_CONSTANTS.DIRECTIONS.LEFT,
        hasFlag: false,
        carryingFlagTeam: null,
        lastMoveAt: 0,
        lastTackleAt: 0,
        lastDashAt: 0,
        respawningUntil: 0,
        isRespawning: false,
        score: 0,
        stats: { captures: 0, tackles: 0, returns: 0, dashes: 0 },
      });
    });
  }

  /**
   * Reseta as duas bandeiras para suas respectivas bases.
   */
  function resetFlags() {
    flags.blue.x = flags.blue.baseX;
    flags.blue.y = flags.blue.baseY;
    flags.blue.status = 'at_base';
    flags.blue.carrierId = null;
    flags.blue.droppedAt = null;

    flags.red.x = flags.red.baseX;
    flags.red.y = flags.red.baseY;
    flags.red.status = 'at_base';
    flags.red.carrierId = null;
    flags.red.droppedAt = null;

    for (const player of players.values()) {
      player.hasFlag = false;
      player.carryingFlagTeam = null;
    }
  }

  /**
   * Retorna se a célula (x, y) é válida, desobstruída e sem sobreposição de aliado.
   */
  function isCellPassable(x, y, movingPlayerJid = null) {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    if (obstacles.has(`${x},${y}`)) return false;

    // Checa colisão com aliados ou inimigos
    for (const other of players.values()) {
      if (other.userJid === movingPlayerJid) continue;
      if (other.isRespawning || other.connected === false) continue;
      if (other.x === x && other.y === y) {
        return false;
      }
    }
    return true;
  }

  /**
   * Encontra jogador presente em uma célula (x, y).
   */
  function getPlayerAt(x, y, excludeJid = null) {
    if (x < 0 || x >= width || y < 0 || y >= height) return null;
    for (const p of players.values()) {
      if (p.userJid === excludeJid) continue;
      if (p.isRespawning || p.connected === false) continue;
      if (p.x === x && p.y === y) return p;
    }
    return null;
  }

  /**
   * Encontra o primeiro ponto livre no respawn do time.
   */
  function findFreeRespawnPosition(team) {
    const defaultRespawn = teams[team].respawn;
    if (isCellPassable(defaultRespawn.x, defaultRespawn.y)) {
      return defaultRespawn;
    }
    const xBase = team === GRID_CTF_CONSTANTS.TEAMS.BLUE ? 0 : width - 1;
    for (let y = 0; y < height; y++) {
      if (isCellPassable(xBase, y)) {
        return { x: xBase, y };
      }
    }
    return defaultRespawn;
  }

  /**
   * Aplica derrubada (tackle) a um jogador que sofreu a investida.
   */
  function applyTackleKnockout(target, attacker) {
    const currentTime = now();
    const droppedFlag = target.hasFlag ? flags[target.carryingFlagTeam] : null;

    if (droppedFlag) {
      droppedFlag.status = 'dropped';
      droppedFlag.carrierId = null;
      droppedFlag.droppedAt = currentTime;
      droppedFlag.x = target.x;
      droppedFlag.y = target.y;

      target.hasFlag = false;
      target.carryingFlagTeam = null;
    }

    // Manda de volta para o respawn da sua base
    const respawnPos = findFreeRespawnPosition(target.team);
    target.x = respawnPos.x;
    target.y = respawnPos.y;
    target.isRespawning = true;
    target.respawningUntil = currentTime + respawnDurationMs;

    // Atualiza pontuação do atacante
    attacker.stats.tackles += 1;
    attacker.score += 25;

    return {
      targetJid: target.userJid,
      attackerJid: attacker.userJid,
      droppedFlagTeam: droppedFlag ? droppedFlag.team : null,
      dropX: droppedFlag ? droppedFlag.x : null,
      dropY: droppedFlag ? droppedFlag.y : null,
      targetRespawn: respawnPos,
    };
  }

  /**
   * Processa a captura da bandeira adversária ou recuperação da própria bandeira.
   */
  function checkFlagInteractions(player, currentTime) {
    const enemyTeam = player.team === GRID_CTF_CONSTANTS.TEAMS.BLUE
      ? GRID_CTF_CONSTANTS.TEAMS.RED
      : GRID_CTF_CONSTANTS.TEAMS.BLUE;

    const alliedFlag = flags[player.team];
    const enemyFlag = flags[enemyTeam];

    const events = [];

    // 1. Tocar na bandeira aliada caída -> Recupera imediatamente para a base
    if (alliedFlag.status === 'dropped' && alliedFlag.x === player.x && alliedFlag.y === player.y) {
      alliedFlag.status = 'at_base';
      alliedFlag.x = alliedFlag.baseX;
      alliedFlag.y = alliedFlag.baseY;
      alliedFlag.droppedAt = null;
      alliedFlag.carrierId = null;

      player.stats.returns += 1;
      player.score += 30;

      events.push({
        type: 'flag_returned',
        team: player.team,
        returnedBy: player.userJid,
        message: `🛡️ ${player.username} recuperou a bandeira do ${teams[player.team].name}!`,
      });
    }

    // 2. Tocar na bandeira inimiga (na base ou caída no chão) -> Vira portador
    if (
      !player.hasFlag &&
      (enemyFlag.status === 'at_base' || enemyFlag.status === 'dropped') &&
      enemyFlag.x === player.x &&
      enemyFlag.y === player.y
    ) {
      enemyFlag.status = 'carried';
      enemyFlag.carrierId = player.userJid;
      enemyFlag.droppedAt = null;

      player.hasFlag = true;
      player.carryingFlagTeam = enemyTeam;
      player.score += 20;

      events.push({
        type: 'flag_captured',
        team: enemyTeam,
        carrierId: player.userJid,
        carrierName: player.username,
        message: `🚩 ${player.username} capturou a bandeira do ${teams[enemyTeam].name}!`,
      });
    }

    // 3. Atualiza posição da bandeira se o jogador estiver carregando
    if (player.hasFlag && player.carryingFlagTeam) {
      const carried = flags[player.carryingFlagTeam];
      if (carried && carried.carrierId === player.userJid) {
        carried.x = player.x;
        carried.y = player.y;
      }

      // 4. Checa se o portador levou a bandeira inimiga até a sua própria base -> PONTO!
      if (isInsideTeamBase(player.x, player.y, player.team, width, height)) {
        teams[player.team].score += 1;
        player.stats.captures += 1;
        player.score += 100;

        // Bonifica a pontuação da panelinha do jogador na sala
        if (player.faction?.id && room.factions?.has(player.faction.id)) {
          const fac = room.factions.get(player.faction.id);
          fac.score += 1;
        }

        // Reseta a bandeira pontuada de volta para a base inimiga
        carried.status = 'at_base';
        carried.x = carried.baseX;
        carried.y = carried.baseY;
        carried.carrierId = null;
        carried.droppedAt = null;

        player.hasFlag = false;
        player.carryingFlagTeam = null;

        events.push({
          type: 'point_scored',
          scoringTeam: player.team,
          scorerId: player.userJid,
          scorerName: player.username,
          scores: { blue: teams.blue.score, red: teams.red.score },
          message: `🎯 PONTO! ${player.username} marcou para o ${teams[player.team].name}! (${teams.blue.score} x ${teams.red.score})`,
        });

        // Checa condição de vitória por pontos
        if (teams[player.team].score >= pointsToWin) {
          finalizeMatch(player.team, 'points_reached');
        }
      }
    }

    return events;
  }

  /**
   * Ciclo de tick a cada 1s para contagem regressiva, expiração de respawns
   * e auto-retorno de bandeiras abandonadas no chão.
   */
  function onTick() {
    if (matchStatus !== 'in_progress') return;

    const currentTime = now();
    let stateChanged = false;
    const deltaEvents = [];

    // Checa expiração do tempo de jogo (4 minutos)
    if (currentTime >= matchEndsAt) {
      let winningTeam = null;
      if (teams.blue.score > teams.red.score) winningTeam = GRID_CTF_CONSTANTS.TEAMS.BLUE;
      else if (teams.red.score > teams.blue.score) winningTeam = GRID_CTF_CONSTANTS.TEAMS.RED;

      finalizeMatch(winningTeam, 'time_expired');
      return;
    }

    // Checa auto-retorno de bandeiras caídas
    for (const flag of Object.values(flags)) {
      if (flag.status === 'dropped' && flag.droppedAt) {
        if (currentTime - flag.droppedAt >= flagAutoReturnMs) {
          flag.status = 'at_base';
          flag.x = flag.baseX;
          flag.y = flag.baseY;
          flag.droppedAt = null;
          flag.carrierId = null;
          stateChanged = true;

          deltaEvents.push({
            type: 'flag_auto_returned',
            team: flag.team,
            message: `⏱️ A bandeira do ${teams[flag.team].name} retornou à base por inatividade!`,
          });
        }
      }
    }

    // Atualiza estado de respawn dos jogadores
    for (const player of players.values()) {
      if (player.isRespawning && currentTime >= player.respawningUntil) {
        player.isRespawning = false;
        stateChanged = true;
      }
    }

    // Se houve mudança de estado durante o tick, transmite aos jogadores
    if (stateChanged || deltaEvents.length > 0) {
      broadcast('ctf_update', {
        type: 'tick',
        remainingSeconds: Math.max(0, Math.ceil((matchEndsAt - currentTime) / 1000)),
        flags,
        players: getPublicPlayers(),
        events: deltaEvents,
      });
    }
  }

  /**
   * Retorna os dados públicos dos jogadores para consumo da UI e clientes.
   */
  function getPublicPlayers() {
    return Array.from(players.values()).map(p => ({
      userJid: p.userJid,
      username: p.username,
      faction: p.faction,
      team: p.team,
      x: p.x,
      y: p.y,
      facing: p.facing,
      hasFlag: p.hasFlag,
      isRespawning: p.isRespawning,
      respawningUntil: p.respawningUntil,
      score: p.score,
      stats: p.stats,
    }));
  }

  // --- MÉTODOS PÚBLICOS DA INTERFACE COM O GAMEMANAGER ---

  /**
   * Inicia a partida do Grid CTF.
   */
  async function start() {
    matchStartedAt = now();
    matchEndsAt = matchStartedAt + matchDurationMs;
    matchStatus = 'in_progress';

    // 1. Distribui os jogadores nos times Azul e Vermelho
    distributePlayers();

    // 2. Posiciona bandeiras nas bases
    resetFlags();

    // 3. Inicia o timer de tick a cada 1000ms
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(onTick, 1000);
    if (tickTimer && typeof tickTimer.unref === 'function') {
      tickTimer.unref();
    }

    const startPayload = {
      type: 'ctf_start',
      grid: {
        width,
        height,
        obstacles: Array.from(obstacles),
        territorySplitX: Math.floor(width / 2),
      },
      teams: {
        blue: { name: teams.blue.name, color: teams.blue.color, base: teams.blue.baseArea },
        red: { name: teams.red.name, color: teams.red.color, base: teams.red.baseArea },
      },
      flags,
      players: getPublicPlayers(),
      startsAt: matchStartedAt,
      endsAt: matchEndsAt,
      remainingSeconds: Math.ceil(matchDurationMs / 1000),
      pointsToWin,
    };

    broadcast('ctf_start', startPayload);
    return { ok: true, state: startPayload };
  }

  /**
   * Processa uma ação autoritativa de um jogador (move, tackle, dash).
   *
   * @param {object} playerSession Sessão autenticada do jogador
   * @param {object} actionData Dados da ação recebidos no POST /action
   */
  async function handleAction(playerSession, actionData = {}) {
    if (matchStatus !== 'in_progress') {
      return { ok: false, error: 'game_not_in_progress', message: 'A partida não está em andamento.' };
    }

    const userJid = playerSession?.userJid;
    const player = players.get(userJid);
    if (!player) {
      return { ok: false, error: 'player_not_in_game', message: 'Você não está cadastrado nesta partida.' };
    }

    const currentTime = now();

    // 1. Checa se o jogador está aguardando respawn após sofrer knockout
    if (player.isRespawning) {
      if (currentTime < player.respawningUntil) {
        return {
          ok: false,
          error: 'respawning',
          message: 'Você foi derrubado e está renascendo na base.',
          retryInMs: Math.max(0, player.respawningUntil - currentTime),
        };
      }
      player.isRespawning = false;
    }

    const action = String(actionData.action || '').trim().toLowerCase();
    const actionEvents = [];
    let delta = null;

    // --- AÇÃO 1: MOVE (MOVIMENTO DISCRETO COM COOLDOWN) ---
    if (action === GRID_CTF_CONSTANTS.ACTIONS.MOVE) {
      const elapsed = currentTime - player.lastMoveAt;
      if (elapsed < moveCooldownMs) {
        return {
          ok: false,
          error: 'cooldown',
          retryInMs: moveCooldownMs - elapsed,
        };
      }

      const direction = String(actionData.direction || '').toLowerCase().trim();
      const offset = getDirectionOffset(direction);
      if (!offset) {
        return { ok: false, error: 'invalid_direction', message: 'Direção inválida. Use up, down, left ou right.' };
      }

      const targetX = player.x + offset.dx;
      const targetY = player.y + offset.dy;
      player.facing = direction;

      // Checa colisão com obstáculo ou limites do mapa
      if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height || obstacles.has(`${targetX},${targetY}`)) {
        player.lastMoveAt = currentTime;
        return { ok: false, error: 'blocked', message: 'Caminho bloqueado por obstáculo ou limite da arena.' };
      }

      // Checa se a célula está ocupada por outro jogador
      const existingOccupant = getPlayerAt(targetX, targetY, player.userJid);
      if (existingOccupant) {
        // Se for inimigo e o jogador estiver em território amigo (ou o oponente tiver a bandeira), resolve combate automático!
        if (existingOccupant.team !== player.team) {
          const occupantTerritory = getTerritoryTeam(existingOccupant.x, width);
          // Oponente pode ser derrubado se ele for portador da bandeira OU se for invasor em território do atacante
          const canKnockout = existingOccupant.hasFlag || occupantTerritory === player.team;

          if (canKnockout) {
            const tackleResult = applyTackleKnockout(existingOccupant, player);
            player.lastMoveAt = currentTime;
            player.x = targetX;
            player.y = targetY;

            actionEvents.push({
              type: 'tackle_knockout',
              attackerJid: player.userJid,
              targetJid: existingOccupant.userJid,
              message: `💥 ${player.username} atropelou ${existingOccupant.username} ao avançar!`,
              ...tackleResult,
            });

            // Checa bandeiras na nova posição
            const flagEvents = checkFlagInteractions(player, currentTime);
            actionEvents.push(...flagEvents);

            delta = {
              action: 'move_with_tackle',
              player: { userJid: player.userJid, x: player.x, y: player.y, facing: player.facing, hasFlag: player.hasFlag, score: player.score },
              target: { userJid: existingOccupant.userJid, x: existingOccupant.x, y: existingOccupant.y, isRespawning: true },
              flags,
              scores: { blue: teams.blue.score, red: teams.red.score },
              events: actionEvents,
            };

            broadcast('ctf_update', delta);
            return { ok: true, delta };
          }
        }

        // Se colidir com aliado ou não puder derrubar o inimigo, bloqueia movimento
        player.lastMoveAt = currentTime;
        return { ok: false, error: 'cell_occupied', message: 'Célula ocupada por outro jogador.' };
      }

      // Movimento livre autorizado
      player.x = targetX;
      player.y = targetY;
      player.lastMoveAt = currentTime;

      // Processa bandeiras
      const flagEvents = checkFlagInteractions(player, currentTime);
      actionEvents.push(...flagEvents);

      delta = {
        action: 'move',
        player: {
          userJid: player.userJid,
          x: player.x,
          y: player.y,
          facing: player.facing,
          hasFlag: player.hasFlag,
          score: player.score,
        },
        flags,
        scores: { blue: teams.blue.score, red: teams.red.score },
        events: actionEvents,
      };

      broadcast('ctf_update', delta);
      return { ok: true, delta };
    }

    // --- AÇÃO 2: TACKLE (INVESTIDA DE COMBATE ADJACENTE) ---
    if (action === GRID_CTF_CONSTANTS.ACTIONS.TACKLE) {
      const elapsed = currentTime - player.lastTackleAt;
      if (elapsed < tackleCooldownMs) {
        return { ok: false, error: 'cooldown', retryInMs: tackleCooldownMs - elapsed };
      }

      player.lastTackleAt = currentTime;

      // Procura oponente nas células adjacentes (ortogonais)
      const adjacentOffsets = [
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
      ];

      let targetOponent = null;
      for (const off of adjacentOffsets) {
        const nx = player.x + off.dx;
        const ny = player.y + off.dy;
        const occupant = getPlayerAt(nx, ny, player.userJid);
        if (occupant && occupant.team !== player.team) {
          targetOponent = occupant;
          break;
        }
      }

      if (!targetOponent) {
        return { ok: false, error: 'no_target_adjacent', message: 'Nenhum oponente ao alcance do Tackle.' };
      }

      // Validação tática: Tackle só tem sucesso se o atacante estiver enfrentando invasor em território amigo,
      // ou se o oponente for o portador da bandeira!
      const targetTerritory = getTerritoryTeam(targetOponent.x, width);
      const canTackle = targetOponent.hasFlag || targetTerritory === player.team;

      if (!canTackle) {
        return {
          ok: false,
          error: 'tackle_disadvantage',
          message: 'Você não pode derrubar oponentes dentro do território deles a menos que carreguem a bandeira!',
        };
      }

      const tackleData = applyTackleKnockout(targetOponent, player);
      actionEvents.push({
        type: 'tackle_knockout',
        attackerJid: player.userJid,
        targetJid: targetOponent.userJid,
        message: `🛡️ TACKLE! ${player.username} derrubou ${targetOponent.username}!`,
        ...tackleData,
      });

      delta = {
        action: 'tackle',
        attacker: { userJid: player.userJid, score: player.score, tackles: player.stats.tackles },
        target: { userJid: targetOponent.userJid, x: targetOponent.x, y: targetOponent.y, isRespawning: true },
        flags,
        scores: { blue: teams.blue.score, red: teams.red.score },
        events: actionEvents,
      };

      broadcast('ctf_update', delta);
      return { ok: true, delta };
    }

    // --- AÇÃO 3: DASH (ARRANCADA RÁPIDA DE 2 CÉLULAS) ---
    if (action === GRID_CTF_CONSTANTS.ACTIONS.DASH) {
      const elapsed = currentTime - player.lastDashAt;
      if (elapsed < dashCooldownMs) {
        return { ok: false, error: 'cooldown', retryInMs: dashCooldownMs - elapsed };
      }

      const direction = String(actionData.direction || player.facing || '').toLowerCase().trim();
      const offset = getDirectionOffset(direction);
      if (!offset) {
        return { ok: false, error: 'invalid_direction', message: 'Direção inválida para o Dash.' };
      }

      player.lastDashAt = currentTime;
      player.lastMoveAt = currentTime;
      player.facing = direction;
      player.stats.dashes += 1;

      // Tenta avançar até 2 células; pode atravessar jogadores intermediários se a 2ª célula for passável
      let finalX = player.x;
      let finalY = player.y;

      const step1X = player.x + offset.dx;
      const step1Y = player.y + offset.dy;
      const isStep1WithinBounds = step1X >= 0 && step1X < width && step1Y >= 0 && step1Y < height && !obstacles.has(`${step1X},${step1Y}`);

      if (isStep1WithinBounds) {
        const step2X = step1X + offset.dx;
        const step2Y = step1Y + offset.dy;

        // Se a 2ª célula for passável, aterrissa nela (atravessando jogador em step1 se houver)
        if (isCellPassable(step2X, step2Y, player.userJid)) {
          finalX = step2X;
          finalY = step2Y;
        } else if (isCellPassable(step1X, step1Y, player.userJid)) {
          // Senão, se a 1ª for passável, para na 1ª
          finalX = step1X;
          finalY = step1Y;
        }
      }

      if (finalX === player.x && finalY === player.y) {
        return { ok: false, error: 'dash_blocked', message: 'Caminho bloqueado para o Dash.' };
      }

      player.x = finalX;
      player.y = finalY;

      const flagEvents = checkFlagInteractions(player, currentTime);
      actionEvents.push(...flagEvents);

      delta = {
        action: 'dash',
        player: {
          userJid: player.userJid,
          x: player.x,
          y: player.y,
          facing: player.facing,
          hasFlag: player.hasFlag,
          score: player.score,
        },
        flags,
        scores: { blue: teams.blue.score, red: teams.red.score },
        events: actionEvents,
      };

      broadcast('ctf_update', delta);
      return { ok: true, delta };
    }

    return { ok: false, error: 'unknown_action', message: `Ação não reconhecida: ${action}` };
  }

  /**
   * Retorna a visão pública do estado atual da partida para os clientes e API.
   */
  function getPublicState() {
    const currentTime = now();
    const remainingSeconds = matchEndsAt ? Math.max(0, Math.ceil((matchEndsAt - currentTime) / 1000)) : 0;

    return {
      gameType: 'grid_ctf',
      status: matchStatus,
      grid: {
        width,
        height,
        obstacles: Array.from(obstacles),
        territorySplitX: Math.floor(width / 2),
      },
      teams: {
        blue: {
          id: teams.blue.id,
          name: teams.blue.name,
          color: teams.blue.color,
          score: teams.blue.score,
          base: teams.blue.baseArea,
        },
        red: {
          id: teams.red.id,
          name: teams.red.name,
          color: teams.red.color,
          score: teams.red.score,
          base: teams.red.baseArea,
        },
      },
      flags,
      players: getPublicPlayers(),
      scores: {
        blue: teams.blue.score,
        red: teams.red.score,
      },
      timing: {
        startedAt: matchStartedAt,
        endsAt: matchEndsAt,
        remainingSeconds,
      },
      cooldowns: {
        move: moveCooldownMs,
        tackle: tackleCooldownMs,
        dash: dashCooldownMs,
        respawn: respawnDurationMs,
      },
      winnerTeam,
      winnerFaction,
    };
  }

  /**
   * Trata a desconexão de um jogador durante a partida.
   * Se o jogador estiver carregando uma bandeira, ela é derrubada ('dropped') na posição atual.
   */
  function handlePlayerDisconnect(userJid) {
    if (matchStatus !== 'in_progress') {
      return { ok: false, error: 'game_not_in_progress', message: 'A partida não está em andamento.' };
    }

    const player = players.get(userJid);
    if (!player) {
      return { ok: false, error: 'player_not_in_game', message: 'Jogador não encontrado nesta partida.' };
    }

    const currentTime = now();
    const events = [];
    let droppedFlag = null;

    if (player.hasFlag && player.carryingFlagTeam) {
      droppedFlag = flags[player.carryingFlagTeam];
      if (droppedFlag) {
        droppedFlag.status = 'dropped';
        droppedFlag.carrierId = null;
        droppedFlag.droppedAt = currentTime;
        droppedFlag.x = player.x;
        droppedFlag.y = player.y;

        events.push({
          type: 'flag_dropped_on_disconnect',
          team: droppedFlag.team,
          carrierId: player.userJid,
          carrierName: player.username,
          x: droppedFlag.x,
          y: droppedFlag.y,
          message: `⚠️ ${player.username} desconectou e largou a bandeira do ${teams[droppedFlag.team].name}!`,
        });
      }

      player.hasFlag = false;
      player.carryingFlagTeam = null;
    }

    player.connected = false;
    player.isRespawning = true;
    player.respawningUntil = Infinity;
    player.x = -1;
    player.y = -1;

    events.push({
      type: 'player_disconnected',
      userJid: player.userJid,
      username: player.username,
      message: `🔌 ${player.username} desconectou-se da partida.`,
    });

    broadcast('ctf_update', {
      action: 'player_disconnect',
      userJid: player.userJid,
      flags,
      events,
    });

    return {
      ok: true,
      userJid,
      droppedFlag: droppedFlag ? { ...droppedFlag } : null,
      events,
    };
  }

  /**
   * Limpa os timers e encerra o ciclo de vida do motor.
   */
  function cleanup() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  return {
    start,
    handleAction,
    handlePlayerDisconnect,
    onPlayerDisconnect: handlePlayerDisconnect,
    getPublicState,
    cleanup,
  };
}

export default createGridCtfEngine;
