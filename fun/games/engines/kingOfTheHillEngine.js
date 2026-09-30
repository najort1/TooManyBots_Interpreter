/**
 * Motor do Jogo 3: King of the Hill (Domínio do Território)
 * Projetado para 4 a 8 jogadores divididos em panelinhas rivais.
 *
 * Princípio Arquitetural: Otimização Extrema de Rede
 * - Os clientes calculam a movimentação física dos personagens localmente a 60fps.
 * - O servidor é authoritative e processa apenas eventos pontuais via POST /action:
 *   - entered_zone: Jogador cruzou o raio de uma das zonas estratégicas (A, B ou C)
 *   - left_zone: Jogador saiu da zona estratégica
 *   - use_ability: Disparo de habilidade tática (push, shield, shockwave)
 *   - eliminated: Jogador foi empurrado para o abismo ou derrotado na arena
 *
 * Avaliação Periódica do Servidor:
 * - A cada 2 segundos (tick), avalia a maioria em cada zona e concede +2% de controle.
 * - Primeira panelinha a atingir 100% de controle ou a maior porcentagem ao final
 *   de 3 minutos vence a disputa!
 */

export const KOTH_CONSTANTS = Object.freeze({
  MIN_PLAYERS: 4,
  MAX_PLAYERS: 8,
  TICK_INTERVAL_MS: 2000,
  MATCH_DURATION_MS: 180_000, // 3 minutos
  CONTROL_PERCENT_PER_TICK: 2, // +2% por zona dominada no tick
  TARGET_CONTROL_PERCENT: 100, // 100% para vitória
  RESPAWN_DURATION_MS: 5000, // 5 segundos para reviver
  ABILITIES: Object.freeze({
    PUSH: { id: 'push', cooldownMs: 6000, name: 'Empurrão Focado' },
    SHIELD: { id: 'shield', cooldownMs: 12000, durationMs: 4000, name: 'Escudo Protetor' },
    SHOCKWAVE: { id: 'shockwave', cooldownMs: 15000, name: 'Onda de Choque' },
  }),
});

/**
 * Zonas táticas pré-definidas na arena.
 */
export const DEFAULT_ZONES = Object.freeze({
  A: {
    id: 'A',
    name: 'Zona Alfa',
    x: 250,
    y: 200,
    radius: 80,
    color: '#3b82f6',
  },
  B: {
    id: 'B',
    name: 'Zona Bravo',
    x: 500,
    y: 350,
    radius: 95,
    color: '#8b5cf6',
  },
  C: {
    id: 'C',
    name: 'Zona Charlie',
    x: 750,
    y: 200,
    radius: 80,
    color: '#ec4899',
  },
});

/**
 * Renderiza uma barra de progresso visual de texto / ASCII para a UI.
 * Exemplo: renderProgressBar(82) -> "████████░░ 82%"
 *
 * @param {number} percent - Valor de 0 a 100
 * @param {number} length - Quantidade de blocos totais (padrão 10)
 * @returns {string}
 */
export function renderProgressBar(percent, length = 10) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const rounded = Math.round(safePercent);
  const filled = Math.max(0, Math.min(length, Math.round((rounded / 100) * length)));
  const empty = Math.max(0, length - filled);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${rounded}%`;
}

/**
 * Cria uma nova instância do motor King of the Hill para a sala.
 *
 * @param {object} room - Objeto da sala gerenciada pelo GameManager
 * @param {object} options
 * @param {object} [options.funConfig]
 * @param {Function} [options.now]
 * @param {object} [options.gameManager]
 * @param {number} [options.tickIntervalMs]
 * @param {number} [options.matchDurationMs]
 * @param {object} [options.zonesConfig]
 * @returns {object} Interface do motor de jogo
 */
export function createKingOfTheHillEngine(room, {
  funConfig = {},
  now = Date.now,
  gameManager = null,
  tickIntervalMs = KOTH_CONSTANTS.TICK_INTERVAL_MS,
  matchDurationMs = KOTH_CONSTANTS.MATCH_DURATION_MS,
  zonesConfig = DEFAULT_ZONES,
} = {}) {
  if (!room) {
    throw new Error('[kingOfTheHillEngine] A sala (room) é obrigatória.');
  }

  // Resolve referência ao GameManager para término e broadcast
  const gm = room.gameManager || gameManager || null;

  // Estado interno das Zonas
  /** @type {Map<string, { id: string, name: string, x: number, y: number, radius: number, color: string, controllingFactionId: string|null, status: 'neutral'|'controlled'|'contested', playersPresent: Set<string> }>} */
  const zones = new Map();
  for (const [id, cfg] of Object.entries(zonesConfig)) {
    zones.set(id, {
      id: cfg.id || id,
      name: cfg.name || `Zona ${id}`,
      x: cfg.x ?? 0,
      y: cfg.y ?? 0,
      radius: cfg.radius ?? 80,
      color: cfg.color ?? '#ffffff',
      controllingFactionId: null,
      status: 'neutral',
      playersPresent: new Set(),
    });
  }

  // Progresso percentual por panelinha (0 a 100)
  /** @type {Map<string, number>} */
  const factionProgress = new Map();

  // Estado e estatísticas de cada jogador
  /**
   * @type {Map<string, {
   *   userJid: string,
   *   username: string,
   *   factionId: string,
   *   factionName: string,
   *   isAlive: boolean,
   *   currentZoneId: string|null,
   *   shieldUntil: number,
   *   respawnAt: number|null,
   *   cooldowns: { push: number, shield: number, shockwave: number },
   *   kills: number,
   *   deaths: number,
   *   respawnTimer: any
   * }>}
   */
  const playerStates = new Map();

  let tickInterval = null;
  let matchTimeout = null;
  let isRunning = false;
  let isFinished = false;
  let startedAt = 0;
  let endsAt = 0;

  /**
   * Transmite evento SSE para todos os clientes conectados.
   */
  function broadcastEvent(eventName, payload) {
    if (gm?.broadcast) {
      gm.broadcast(room, eventName, payload);
      return;
    }

    if (room.broadcast) {
      room.broadcast(eventName, payload);
      return;
    }

    if (room.clients instanceof Set) {
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

  /**
   * Inicializa o estado de um jogador na partida.
   */
  function initPlayerState(playerData) {
    const userJid = playerData?.userJid;
    if (!userJid) return null;

    const factionId = playerData?.faction?.id || 'unknown';
    const factionName = playerData?.faction?.name || 'Sem Panelinha';

    if (!factionProgress.has(factionId)) {
      factionProgress.set(factionId, 0);
    }

    const state = {
      userJid,
      username: playerData.username || 'Jogador',
      factionId,
      factionName,
      isAlive: true,
      currentZoneId: null,
      shieldUntil: 0,
      respawnAt: null,
      cooldowns: {
        push: 0,
        shield: 0,
        shockwave: 0,
      },
      kills: 0,
      deaths: 0,
      respawnTimer: null,
    };

    playerStates.set(userJid, state);
    return state;
  }

  /**
   * Sincroniza jogadores já registrados na sala.
   */
  function syncExistingPlayers() {
    if (room.players instanceof Map) {
      for (const player of room.players.values()) {
        initPlayerState(player);
      }
    }
    if (room.factions instanceof Map) {
      for (const fac of room.factions.values()) {
        if (!factionProgress.has(fac.id)) {
          factionProgress.set(fac.id, 0);
        }
      }
    }
  }

  /**
   * Avalia e atualiza o estado de respawn de um jogador com base no timestamp atual.
   * Garante coerência contra drift de timers do servidor ou avanços de tempo simulado.
   */
  function checkAndResolveRespawn(pState, currentTime) {
    if (!pState.isAlive && pState.respawnAt && currentTime >= pState.respawnAt) {
      pState.isAlive = true;
      pState.respawnAt = null;
      if (pState.respawnTimer) {
        clearTimeout(pState.respawnTimer);
        pState.respawnTimer = null;
      }
      broadcastEvent('player_respawned', {
        userJid: pState.userJid,
        username: pState.username,
        factionId: pState.factionId,
      });
    }
  }

  /**
   * Avalia a ocupação de todas as zonas no tick e distribui pontos.
   */
  function evaluateZonesTick() {
    if (!isRunning || isFinished) return;

    const currentTime = now();
    const tickZoneResults = [];
    const scoringFactions = new Map(); // factionId -> número de zonas dominadas neste tick

    // Atualiza estado de respawn de todos os jogadores para o tick atual
    for (const pState of playerStates.values()) {
      checkAndResolveRespawn(pState, currentTime);
    }

    for (const [zoneId, zone] of zones.entries()) {
      // Contabiliza jogadores vivos de cada panelinha presentes na zona (snapshot seguro)
      const factionPresence = new Map(); // factionId -> userJids[]

      for (const userJid of Array.from(zone.playersPresent)) {
        const pState = playerStates.get(userJid);
        if (pState && pState.isAlive && pState.currentZoneId === zoneId) {
          const list = factionPresence.get(pState.factionId) || [];
          list.push(userJid);
          factionPresence.set(pState.factionId, list);
        } else {
          // Limpa inconsistência se o jogador não estiver mais vivo ou na zona
          zone.playersPresent.delete(userJid);
        }
      }

      // Se ninguém estiver na zona
      if (factionPresence.size === 0) {
        zone.controllingFactionId = null;
        zone.status = 'neutral';
        tickZoneResults.push({
          zoneId,
          status: 'neutral',
          controllingFactionId: null,
          playerCounts: {},
        });
        continue;
      }

      // Encontra a panelinha com mais jogadores na zona
      let highestCount = 0;
      let majorityFactionId = null;
      let isTie = false;
      const playerCounts = {};

      for (const [fId, members] of factionPresence.entries()) {
        const count = members.length;
        playerCounts[fId] = count;

        if (count > highestCount) {
          highestCount = count;
          majorityFactionId = fId;
          isTie = false;
        } else if (count === highestCount && highestCount > 0) {
          isTie = true;
        }
      }

      if (isTie || !majorityFactionId) {
        // Empate de presenças: a zona fica em disputa e ninguém pontua
        zone.status = 'contested';
        zone.controllingFactionId = null;
        tickZoneResults.push({
          zoneId,
          status: 'contested',
          controllingFactionId: null,
          playerCounts,
        });
      } else {
        // Panelinha com maioria estrita domina a zona
        zone.status = 'controlled';
        zone.controllingFactionId = majorityFactionId;
        const currentZonesControlled = scoringFactions.get(majorityFactionId) || 0;
        scoringFactions.set(majorityFactionId, currentZonesControlled + 1);

        tickZoneResults.push({
          zoneId,
          status: 'controlled',
          controllingFactionId: majorityFactionId,
          playerCounts,
        });
      }
    }

    // Aplica o ganho percentual (+2% por zona dominada) para as panelinhas vencedoras
    const winnersAtTarget = [];

    for (const [fId, zonesControlledCount] of scoringFactions.entries()) {
      const addedPercent = zonesControlledCount * KOTH_CONSTANTS.CONTROL_PERCENT_PER_TICK;
      const currentProgress = factionProgress.get(fId) || 0;
      const newProgress = Math.min(KOTH_CONSTANTS.TARGET_CONTROL_PERCENT, currentProgress + addedPercent);
      factionProgress.set(fId, newProgress);

      // Atualiza score no room.factions para refletir nos metadados gerais
      if (room.factions?.has(fId)) {
        room.factions.get(fId).score = newProgress;
      }

      if (newProgress >= KOTH_CONSTANTS.TARGET_CONTROL_PERCENT) {
        winnersAtTarget.push(fId);
      }
    }

    // Transmite o progresso atualizado e estado das zonas para todos os clientes
    broadcastEvent('koth_tick', {
      timeRemainingMs: Math.max(0, endsAt - currentTime),
      zones: tickZoneResults,
      factionProgress: getFactionProgressPayload(),
    });

    // Se alguma panelinha atingiu 100%, encerra a partida imediatamente
    if (winnersAtTarget.length > 0) {
      if (winnersAtTarget.length === 1) {
        endMatch(winnersAtTarget[0], 'target_control_reached');
      } else {
        // Múltiplas facções atingiram 100% no mesmo tick: desempate por kills/stats
        endMatch(null, 'target_control_reached');
      }
    }
  }

  /**
   * Monta o payload de progresso das panelinhas com a barra visual formatada.
   */
  function getFactionProgressPayload() {
    const list = [];
    for (const [factionId, progress] of factionProgress.entries()) {
      const factionMeta = room.factions?.get(factionId) || {
        id: factionId,
        name: 'Panelinha',
        emoji: '👑',
      };

      list.push({
        id: factionId,
        name: factionMeta.name,
        emoji: factionMeta.emoji,
        progress,
        progressBar: renderProgressBar(progress, 10),
      });
    }

    // Ordena da maior pontuação para a menor
    return list.sort((a, b) => b.progress - a.progress);
  }

  /**
   * Finaliza a partida e aciona o término no GameManager.
   */
  function endMatch(declaredWinnerFactionId = null, reason = 'time_expired') {
    if (isFinished) return;
    isFinished = true;
    isRunning = false;

    cleanupTimers();

    // Determina o vencedor se não fornecido
    let winningFactionId = declaredWinnerFactionId;
    if (!winningFactionId) {
      let maxProgress = -1;
      let tie = false;

      for (const [fId, progress] of factionProgress.entries()) {
        if (progress > maxProgress) {
          maxProgress = progress;
          winningFactionId = fId;
          tie = false;
        } else if (progress === maxProgress && maxProgress >= 0) {
          tie = true;
        }
      }

      // Em caso de empate na liderança por tempo, desempata por kills totais da panelinha (e menor número de mortes como critério secundário)
      if (tie) {
        let bestKills = -1;
        let bestDeaths = Infinity;
        let killTieBreakerId = null;

        for (const [fId, progress] of factionProgress.entries()) {
          if (progress === maxProgress) {
            let totalKills = 0;
            let totalDeaths = 0;
            for (const p of playerStates.values()) {
              if (p.factionId === fId) {
                totalKills += p.kills;
                totalDeaths += p.deaths;
              }
            }
            if (totalKills > bestKills || (totalKills === bestKills && totalDeaths < bestDeaths)) {
              bestKills = totalKills;
              bestDeaths = totalDeaths;
              killTieBreakerId = fId;
            }
          }
        }
        if (killTieBreakerId) {
          winningFactionId = killTieBreakerId;
        }
      }
    }

    // Sincroniza as pontuações finais na sala
    for (const [fId, progress] of factionProgress.entries()) {
      if (room.factions?.has(fId)) {
        room.factions.get(fId).score = progress;
      }
    }

    const stats = {
      reason,
      durationMs: now() - startedAt,
      factionRankings: getFactionProgressPayload(),
      playersStats: Array.from(playerStates.values()).map(p => ({
        userJid: p.userJid,
        username: p.username,
        factionId: p.factionId,
        kills: p.kills,
        deaths: p.deaths,
      })),
    };

    // Notifica GameManager se disponível
    if (gm?.finishGame) {
      gm.finishGame(room.id, winningFactionId, stats);
    } else if (room.gameManager?.finishGame) {
      room.gameManager.finishGame(room.id, winningFactionId, stats);
    } else {
      broadcastEvent('game_finished', {
        winningFactionId,
        stats,
      });
    }
  }

  /**
   * Limpa todos os timers ativos.
   */
  function cleanupTimers() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    if (matchTimeout) {
      clearTimeout(matchTimeout);
      matchTimeout = null;
    }
    for (const p of playerStates.values()) {
      if (p.respawnTimer) {
        clearTimeout(p.respawnTimer);
        p.respawnTimer = null;
      }
    }
  }

  /**
   * Hook para quando um jogador entra na sala durante a espera.
   */
  function onPlayerJoin(playerData) {
    return initPlayerState(playerData);
  }

  /**
   * Inicia o motor do jogo, disparando o loop periódico de 2s e o cronômetro total.
   */
  async function start() {
    if (isRunning) return true;

    syncExistingPlayers();

    isRunning = true;
    isFinished = false;
    startedAt = now();
    endsAt = startedAt + matchDurationMs;

    // Dispara o timer do tick a cada 2 segundos
    tickInterval = setInterval(() => {
      evaluateZonesTick();
    }, tickIntervalMs);

    // Dispara o timeout de fim da partida após 3 minutos
    matchTimeout = setTimeout(() => {
      endMatch(null, 'time_expired');
    }, matchDurationMs);

    broadcastEvent('koth_started', {
      startedAt,
      endsAt,
      matchDurationMs,
      zones: getPublicZones(),
      factionProgress: getFactionProgressPayload(),
    });

    return true;
  }

  /**
   * Retorna representação pública das zonas.
   */
  function getPublicZones() {
    const res = {};
    for (const [id, z] of zones.entries()) {
      res[id] = {
        id: z.id,
        name: z.name,
        x: z.x,
        y: z.y,
        radius: z.radius,
        color: z.color,
        status: z.status,
        controllingFactionId: z.controllingFactionId,
        playersCount: z.playersPresent.size,
      };
    }
    return res;
  }

  /**
   * Retorna o estado público atualizado para sincronização via GET /room ou SSE init.
   */
  function getPublicState() {
    const currentTime = now();
    const timeRemainingMs = Math.max(0, endsAt - currentTime);

    // Garante resolução de respawn atualizada
    for (const p of playerStates.values()) {
      checkAndResolveRespawn(p, currentTime);
    }

    return {
      gameType: 'king_of_the_hill',
      isRunning,
      isFinished,
      timeRemainingMs,
      matchDurationMs,
      zones: getPublicZones(),
      factionProgress: getFactionProgressPayload(),
      players: Array.from(playerStates.values()).map(p => ({
        userJid: p.userJid,
        username: p.username,
        factionId: p.factionId,
        isAlive: p.isAlive,
        currentZoneId: p.currentZoneId,
        isShielded: p.shieldUntil > currentTime,
        respawnRemainingMs: p.respawnAt ? Math.max(0, p.respawnAt - currentTime) : 0,
        kills: p.kills,
        deaths: p.deaths,
        cooldowns: {
          push: Math.max(0, (p.cooldowns.push || 0) - currentTime),
          shield: Math.max(0, (p.cooldowns.shield || 0) - currentTime),
          shockwave: Math.max(0, (p.cooldowns.shockwave || 0) - currentTime),
        },
      })),
    };
  }

  /**
   * Trata uma ação recebida de um jogador autenticado via POST /action.
   *
   * @param {object} playerSession - Sessão do jogador ({ userJid, username, faction })
   * @param {object} actionData - Payload da ação
   * @returns {Promise<object>} Resultado da ação
   */
  async function handleAction(playerSession, actionData) {
    if (!isRunning || isFinished) {
      return { ok: false, error: 'game_not_active', message: 'A partida não está em andamento.' };
    }

    const userJid = playerSession?.userJid;
    if (!userJid) {
      return { ok: false, error: 'unauthorized', message: 'Identificação de jogador ausente.' };
    }

    let pState = playerStates.get(userJid);
    if (!pState) {
      pState = initPlayerState(playerSession);
    }

    const action = String(actionData?.action || '').trim().toLowerCase();
    const currentTime = now();

    // Sincroniza respawn do jogador caso o timer tenha expirado
    checkAndResolveRespawn(pState, currentTime);

    switch (action) {
      // -----------------------------------------------------------------------
      // 1. entered_zone: Jogador entrou em uma zona
      // -----------------------------------------------------------------------
      case 'entered_zone': {
        if (!pState.isAlive) {
          return { ok: false, error: 'player_dead', message: 'Você está aguardando respawn.' };
        }

        const rawZoneId = String(actionData?.zoneId || '').trim().toUpperCase();
        if (!zones.has(rawZoneId)) {
          return { ok: false, error: 'invalid_zone', message: `Zona '${rawZoneId}' inexistente.` };
        }

        const targetZone = zones.get(rawZoneId);

        // Se já está na mesma zona, ação idempotente sem flood de eventos
        if (pState.currentZoneId === rawZoneId && targetZone.playersPresent.has(userJid)) {
          return {
            ok: true,
            zoneId: rawZoneId,
            playersInZone: targetZone.playersPresent.size,
            alreadyInZone: true,
          };
        }

        // Se já estava em outra zona, remove da anterior
        if (pState.currentZoneId && pState.currentZoneId !== rawZoneId) {
          const oldZone = zones.get(pState.currentZoneId);
          if (oldZone) oldZone.playersPresent.delete(userJid);
        }

        // Adiciona na nova zona
        targetZone.playersPresent.add(userJid);
        pState.currentZoneId = rawZoneId;

        broadcastEvent('player_entered_zone', {
          userJid,
          username: pState.username,
          factionId: pState.factionId,
          zoneId: rawZoneId,
        });

        return {
          ok: true,
          zoneId: rawZoneId,
          playersInZone: targetZone.playersPresent.size,
        };
      }

      // -----------------------------------------------------------------------
      // 2. left_zone: Jogador saiu de uma zona
      // -----------------------------------------------------------------------
      case 'left_zone': {
        const rawZoneId = String(actionData?.zoneId || pState.currentZoneId || '').trim().toUpperCase();
        if (zones.has(rawZoneId)) {
          const targetZone = zones.get(rawZoneId);
          targetZone.playersPresent.delete(userJid);
        }

        if (pState.currentZoneId === rawZoneId || !rawZoneId) {
          pState.currentZoneId = null;
        }

        broadcastEvent('player_left_zone', {
          userJid,
          username: pState.username,
          factionId: pState.factionId,
          zoneId: rawZoneId,
        });

        return { ok: true, leftZoneId: rawZoneId };
      }

      // -----------------------------------------------------------------------
      // 3. use_ability: Disparo de habilidades táticas
      // -----------------------------------------------------------------------
      case 'use_ability': {
        if (!pState.isAlive) {
          return { ok: false, error: 'player_dead', message: 'Você está aguardando respawn.' };
        }

        const abilityName = String(actionData?.ability || '').trim().toLowerCase();
        const abilityDef = KOTH_CONSTANTS.ABILITIES[abilityName.toUpperCase()];

        if (!abilityDef) {
          return {
            ok: false,
            error: 'invalid_ability',
            message: `Habilidade '${abilityName}' desconhecida. Use 'push', 'shield' ou 'shockwave'.`,
          };
        }

        // Verifica Cooldown
        const readyAt = pState.cooldowns[abilityName] || 0;
        if (readyAt > currentTime) {
          const waitSeconds = Math.ceil((readyAt - currentTime) / 1000);
          return {
            ok: false,
            error: 'ability_on_cooldown',
            message: `Habilidade em recarga! Aguarde ${waitSeconds}s.`,
            remainingCooldownMs: readyAt - currentTime,
          };
        }

        // Resolução e validação específica de cada habilidade
        if (abilityName === 'shield') {
          // Aplica o cooldown
          pState.cooldowns[abilityName] = currentTime + abilityDef.cooldownMs;
          pState.shieldUntil = currentTime + abilityDef.durationMs;

          broadcastEvent('ability_used', {
            ability: 'shield',
            userJid,
            username: pState.username,
            durationMs: abilityDef.durationMs,
          });

          return {
            ok: true,
            ability: 'shield',
            durationMs: abilityDef.durationMs,
          };
        }

        if (abilityName === 'push') {
          const targetId = String(actionData?.targetPlayerId || '').trim();
          if (!targetId) {
            return { ok: false, error: 'missing_target', message: 'Nenhum jogador alvo informado para o empurrão.' };
          }

          if (targetId === userJid) {
            return { ok: false, error: 'self_target', message: 'Você não pode empurrar a si mesmo!' };
          }

          const targetState = playerStates.get(targetId);
          if (!targetState || !targetState.isAlive) {
            return { ok: false, error: 'target_not_available', message: 'Alvo inválido ou indisponível.' };
          }

          if (targetState.factionId === pState.factionId) {
            return { ok: false, error: 'same_team', message: 'Você não pode empurrar um colega da sua panelinha!' };
          }

          // Pré-requisitos válidos -> Aplica o cooldown do push
          pState.cooldowns[abilityName] = currentTime + abilityDef.cooldownMs;

          // Se o alvo estiver protegido por escudo, o empurrão é anulado
          if (targetState.shieldUntil > currentTime) {
            broadcastEvent('ability_blocked', {
              ability: 'push',
              byUserJid: userJid,
              targetUserJid: targetId,
              reason: 'shielded',
            });
            return {
              ok: true,
              blocked: true,
              message: 'O alvo estava protegido por um escudo protetor!',
            };
          }

          // Empurra o alvo para fora de qualquer zona
          if (targetState.currentZoneId && zones.has(targetState.currentZoneId)) {
            zones.get(targetState.currentZoneId).playersPresent.delete(targetId);
          }
          const prevZone = targetState.currentZoneId;
          targetState.currentZoneId = null;

          broadcastEvent('ability_used', {
            ability: 'push',
            userJid,
            username: pState.username,
            targetUserJid: targetId,
            targetUsername: targetState.username,
            pushedFromZone: prevZone,
          });

          return {
            ok: true,
            ability: 'push',
            targetUserJid: targetId,
            pushedFromZone: prevZone,
          };
        }

        if (abilityName === 'shockwave') {
          // Aplica o cooldown
          pState.cooldowns[abilityName] = currentTime + abilityDef.cooldownMs;

          const currentZone = pState.currentZoneId;
          const affectedPlayers = [];

          if (currentZone && zones.has(currentZone)) {
            const z = zones.get(currentZone);
            for (const otherJid of Array.from(z.playersPresent)) {
              if (otherJid === userJid) continue;
              const otherState = playerStates.get(otherJid);
              if (otherState && otherState.isAlive && otherState.factionId !== pState.factionId) {
                // Se não estiver de escudo, é arremessado para fora da zona
                if (otherState.shieldUntil <= currentTime) {
                  z.playersPresent.delete(otherJid);
                  otherState.currentZoneId = null;
                  affectedPlayers.push({
                    userJid: otherJid,
                    username: otherState.username,
                  });
                }
              }
            }
          }

          broadcastEvent('ability_used', {
            ability: 'shockwave',
            userJid,
            username: pState.username,
            zoneId: currentZone,
            affectedPlayers,
          });

          return {
            ok: true,
            ability: 'shockwave',
            zoneId: currentZone,
            affectedCount: affectedPlayers.length,
          };
        }

        return { ok: true, ability: abilityName };
      }

      // -----------------------------------------------------------------------
      // 4. eliminated: Jogador foi eliminado (caiu da arena ou derrotado)
      // -----------------------------------------------------------------------
      case 'eliminated': {
        // Se já estiver morto/respawning, não processa duas vezes
        if (!pState.isAlive) {
          return { ok: false, error: 'already_eliminated', message: 'O jogador já está aguardando respawn.' };
        }

        // Se estiver com escudo ativo no momento, ignora a eliminação
        if (pState.shieldUntil > currentTime) {
          return {
            ok: false,
            error: 'shield_protected',
            message: 'Eliminação prevenida pelo escudo ativo!',
          };
        }

        // Remove de qualquer zona imediatamente
        if (pState.currentZoneId && zones.has(pState.currentZoneId)) {
          zones.get(pState.currentZoneId).playersPresent.delete(userJid);
        }
        const eliminatedZone = pState.currentZoneId || String(actionData?.zoneId || '');
        pState.currentZoneId = null;

        pState.isAlive = false;
        pState.deaths += 1;
        pState.respawnAt = currentTime + KOTH_CONSTANTS.RESPAWN_DURATION_MS;

        // Se houver agressor de facção rival, computa a kill (ignora fogo amigo)
        const byPlayerId = String(actionData?.byPlayerId || '').trim();
        let killerState = null;
        if (byPlayerId && playerStates.has(byPlayerId) && byPlayerId !== userJid) {
          const candidateKiller = playerStates.get(byPlayerId);
          if (candidateKiller && candidateKiller.factionId !== pState.factionId) {
            killerState = candidateKiller;
            killerState.kills += 1;
          }
        }

        // Agenda o respawn automático após 5 segundos
        pState.respawnTimer = setTimeout(() => {
          if (!isRunning || isFinished) return;
          checkAndResolveRespawn(pState, now());
        }, KOTH_CONSTANTS.RESPAWN_DURATION_MS);

        broadcastEvent('player_eliminated', {
          userJid,
          username: pState.username,
          factionId: pState.factionId,
          byUserJid: killerState?.userJid || null,
          byUsername: killerState?.username || null,
          zoneId: eliminatedZone,
          respawnDurationMs: KOTH_CONSTANTS.RESPAWN_DURATION_MS,
        });

        return {
          ok: true,
          eliminated: true,
          respawnDurationMs: KOTH_CONSTANTS.RESPAWN_DURATION_MS,
        };
      }

      default: {
        return {
          ok: false,
          error: 'unknown_action',
          message: `Ação '${action}' não reconhecida pelo motor de King of the Hill.`,
        };
      }
    }
  }

  /**
   * Limpeza completa do motor da sala.
   */
  function cleanup() {
    isRunning = false;
    isFinished = true;
    cleanupTimers();
  }

  return {
    start,
    handleAction,
    getPublicState,
    cleanup,
    onPlayerJoin,
    // Exposição para testes e inspeção
    _zones: zones,
    _factionProgress: factionProgress,
    _playerStates: playerStates,
    _evaluateZonesTick: evaluateZonesTick,
    _endMatch: endMatch,
  };
}
