import { randomBytes } from 'node:crypto';
import { getPublicBaseUrl } from '../utils/publicUrl.js';
import { createQuizRoyaleEngine } from './engines/quizRoyaleEngine.js';
import { createGridCtfEngine } from './engines/gridCtfEngine.js';
import { createKingOfTheHillEngine } from './engines/kingOfTheHillEngine.js';

export const GAME_TYPES = Object.freeze({
  QUIZ_ROYALE: 'quiz_royale',
  GRID_CTF: 'grid_ctf',
  KING_OF_THE_HILL: 'king_of_the_hill',
});

export const GAME_METADATA = Object.freeze({
  [GAME_TYPES.QUIZ_ROYALE]: {
    name: 'Quiz Royale das Panelinhas',
    emoji: '🧠',
    minPlayers: 4,
    maxPlayers: 20,
    description: 'Batalha de perguntas e respostas com temas dinâmicos gerados por IA!',
  },
  [GAME_TYPES.GRID_CTF]: {
    name: 'Capture a Bandeira Tático (Grid CTF)',
    emoji: '🚩',
    minPlayers: 2,
    maxPlayers: 8,
    description: 'Capture a bandeira inimiga e traga para a sua base em uma arena tática!',
  },
  [GAME_TYPES.KING_OF_THE_HILL]: {
    name: 'King of the Hill (Domínio do Território)',
    emoji: '👑',
    minPlayers: 4,
    maxPlayers: 8,
    description: 'Conquiste e defenda as 3 zonas estratégicas para somar pontos para sua panelinha!',
  },
});

export const ROOM_STATUS = Object.freeze({
  WAITING: 'waiting',
  IN_PROGRESS: 'in_progress',
  FINISHED: 'finished',
  ABORTED: 'aborted',
});

/**
 * Gerenciador Central de Salas e Eventos de Jogos Multiplayer de Panelinhas.
 */
export function createGameManager({
  factionRepository,
  accountRepository,
  funConfig = {},
  sendGroupMessage = async () => {},
  now = Date.now,
} = {}) {
  /** @type {Map<string, object>} */
  const rooms = new Map();
  /** @type {Map<string, Function>} Factory dos motores dos jogos */
  const engineFactories = new Map();

  function registerEngineFactory(gameType, factory) {
    engineFactories.set(gameType, factory);
  }

  // Registra os motores padrões dos jogos
  registerEngineFactory(GAME_TYPES.QUIZ_ROYALE, (room) => {
    return createQuizRoyaleEngine(room, { funConfig, now, gameManager: { finishGame, broadcast } });
  });

  registerEngineFactory(GAME_TYPES.GRID_CTF, (room) => {
    return createGridCtfEngine(room, { funConfig, now, gameManager: { finishGame, broadcast } });
  });

  registerEngineFactory(GAME_TYPES.KING_OF_THE_HILL, (room) => {
    return createKingOfTheHillEngine(room, { funConfig, now, gameManager: { finishGame, broadcast } });
  });

  function generateRoomId() {
    return randomBytes(8).toString('hex');
  }

  function getRoom(roomId) {
    return rooms.get(String(roomId || '').trim()) || null;
  }

  function getActiveRoomByScope(scopeKey) {
    const s = String(scopeKey || '').trim();
    for (const room of rooms.values()) {
      if (room.scopeKey === s && room.status !== ROOM_STATUS.FINISHED && room.status !== ROOM_STATUS.ABORTED) {
        return room;
      }
    }
    return null;
  }

  /**
   * Envia evento SSE para todos os clientes conectados na sala.
   * Mantém o heartbeat periódico (a cada 15s) para o Cloudflare Quick Tunnel.
   */
  function broadcast(room, eventName, payload) {
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

  /**
   * Heartbeat para evitar timeout de 100 segundos do Quick Tunnel da Cloudflare.
   */
  function sendHeartbeat(room) {
    const pingMessage = `: heartbeat ping\n\n`;
    for (const res of room.clients) {
      try {
        res.write(pingMessage);
      } catch {
        room.clients.delete(res);
      }
    }
  }

  /**
   * Cria uma nova sala de jogo com contagem regressiva para iniciar.
   */
  async function createRoom({
    scopeKey,
    gameType = GAME_TYPES.QUIZ_ROYALE,
    prize = 1000,
    startInMinutes = 3,
    customTitle = null,
    announce = true,
    isTest = false,
  }) {
    const meta = GAME_METADATA[gameType];
    if (!meta) {
      throw new Error(`Tipo de jogo inválido: ${gameType}`);
    }

    const currentTime = now();
    pruneExpiredRooms(currentTime);

    // Se já existir sala ativa no grupo, reaproveita ou fecha
    const existing = getActiveRoomByScope(scopeKey);
    if (existing) {
      // Em modo de teste (isTest) ou se a sala anterior era de teste, substitui limpando a antiga
      if (isTest || existing.isTest) {
        cleanupRoom(existing);
        rooms.delete(existing.id);
      } else {
        return { ok: false, reason: 'room_already_active', room: publicRoomState(existing) };
      }
    }

    const roomId = generateRoomId();
    const startsAt = currentTime + Math.max(1, startInMinutes) * 60_000;

    const room = {
      id: roomId,
      scopeKey,
      gameType,
      title: customTitle || meta.name,
      emoji: meta.emoji,
      description: meta.description,
      minPlayers: meta.minPlayers,
      maxPlayers: meta.maxPlayers,
      prize: Math.max(100, Math.floor(Number(prize) || 1000)),
      status: ROOM_STATUS.WAITING,
      announce: Boolean(announce && !isTest),
      isTest: Boolean(isTest),
      createdAt: currentTime,
      startsAt,
      finishedAt: null,
      winnerFaction: null,
      /** @type {Map<string, { userJid: string, username: string, faction: object, score: number, joinedAt: number, isReady: boolean }>} */
      players: new Map(),
      /** @type {Map<string, { id: string, name: string, emoji: string, score: number, members: string[] }>} */
      factions: new Map(),
      /** @type {Set<object>} SSE response streams */
      clients: new Set(),
      engine: null,
      timerInterval: null,
      heartbeatInterval: null,
      gameManager: null,
    };

    room.gameManager = {
      finishGame,
      broadcast,
      publicRoomState,
    };

    // Inicializa o motor específico do jogo caso registrado
    const factory = engineFactories.get(gameType);
    if (factory) {
      room.engine = factory(room);
    }

    // Timer de heartbeat a cada 15s (vital para Cloudflare Quick Tunnel)
    room.heartbeatInterval = setInterval(() => {
      sendHeartbeat(room);
    }, 15_000);

    // Timer de contagem regressiva até o início da partida
    room.timerInterval = setInterval(async () => {
      const remainingMs = room.startsAt - now();
      if (room.status === ROOM_STATUS.WAITING) {
        if (remainingMs <= 0) {
          clearInterval(room.timerInterval);
          room.timerInterval = null;
          await startGame(roomId);
        } else {
          broadcast(room, 'countdown', {
            remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
            playersCount: room.players.size,
          });
        }
      }
    }, 1000);

    rooms.set(roomId, room);

    // Anúncio automático no WhatsApp do grupo
    const publicUrl = getPublicBaseUrl(funConfig);
    const gameLink = `${publicUrl}/jogos/${roomId}`;

    const announcementText = [
      `🎮 *EVENTO DIÁRIO DAS PANELINHAS: ${meta.name.toUpperCase()}!* ${meta.emoji}`,
      '',
      `🏆 *Prêmio no cofre da panelinha:* 💰 +${room.prize} moedas`,
      `⏳ *Início em:* ${startInMinutes} minutos`,
      `👥 *Vagas:* de ${meta.minPlayers} até ${meta.maxPlayers} jogadores`,
      '',
      `📝 *Como participar:*`,
      `1️⃣ Clique no link para entrar na sala:`,
      `👉 ${gameLink}`,
      `2️⃣ Faça login com seu *usuário e senha*.`,
      `_(Caso ainda não tenha conta, envie \`/cadastrar\` no privado do bot para criar na hora!)_`,
      '',
      `⚠️ *Apenas jogadores que possuem panelinha neste grupo podem competir!*`,
      `_Se você não tem panelinha, crie ou entre em uma com \`/panelinha\` antes da partida iniciar._`,
    ].join('\n');

    if (room.announce && !room.isTest) {
      try {
        await sendGroupMessage(scopeKey, announcementText);
      } catch (err) {
        console.error('[gameManager] Erro ao enviar anúncio no grupo:', err?.message || err);
      }
    }

    return {
      ok: true,
      room: publicRoomState(room),
      gameLink,
      announcementText,
    };
  }

  /**
   * Adiciona um jogador autenticado à sala.
   */
  function joinRoom(roomId, playerSession) {
    const room = getRoom(roomId);
    if (!room) return { ok: false, error: 'room_not_found', message: 'Sala não encontrada.' };

    const resolvedPlayer = playerSession?.player || playerSession || {};
    const userJid = resolvedPlayer.userJid;
    const username = resolvedPlayer.username || 'Jogador';
    const faction = resolvedPlayer.faction || null;

    if (!userJid) {
      return { ok: false, error: 'invalid_player', message: 'Dados do jogador inválidos.' };
    }

    if (room.status !== ROOM_STATUS.WAITING) {
      // Se a partida já começou e o jogador já estava nela, permite reconexão
      if (room.players.has(userJid)) {
        return { ok: true, room: publicRoomState(room), reconnected: true };
      }
      return { ok: false, error: 'game_already_started', message: 'Esta partida já foi iniciada ou encerrada.' };
    }

    if (room.players.size >= room.maxPlayers && !room.players.has(userJid)) {
      return { ok: false, error: 'room_full', message: 'A sala atingiu a capacidade máxima de jogadores!' };
    }

    // Registra / atualiza jogador
    const existingPlayer = room.players.get(userJid);
    const playerData = {
      userJid,
      username,
      faction,
      score: existingPlayer?.score || 0,
      joinedAt: existingPlayer?.joinedAt || now(),
      isReady: true,
    };
    room.players.set(userJid, playerData);

    // Registra / atualiza panelinha
    if (faction?.id) {
      if (!room.factions.has(faction.id)) {
        room.factions.set(faction.id, {
          id: faction.id,
          name: faction.name,
          emoji: faction.emoji || '🏴‍☠️',
          score: 0,
          members: [userJid],
        });
      } else {
        const fac = room.factions.get(faction.id);
        if (!fac.members.includes(userJid)) {
          fac.members.push(userJid);
        }
      }
    }

    // Notifica o motor do jogo caso possua hook
    if (room.engine?.onPlayerJoin) {
      room.engine.onPlayerJoin(playerData);
    }

    broadcast(room, 'player_joined', {
      player: {
        username: playerData.username,
        faction: playerData.faction,
      },
      totalPlayers: room.players.size,
      factionsCount: room.factions.size,
    });

    return {
      ok: true,
      room: publicRoomState(room),
      player: playerData,
    };
  }

  /**
   * Inicia a partida e notifica todos os clientes.
   */
  async function startGame(roomId) {
    const room = getRoom(roomId);
    if (!room || room.status !== ROOM_STATUS.WAITING) return false;

    // Checa se há pelo menos o mínimo de jogadores ou pelo menos 2 panelinhas para competir
    if (room.players.size < room.minPlayers && room.players.size < 2) {
      room.status = ROOM_STATUS.ABORTED;
      room.finishedAt = now();
      broadcast(room, 'game_aborted', {
        reason: 'insufficient_players',
        message: 'A partida foi cancelada por falta de jogadores suficientes.',
      });
      cleanupRoom(room);
      return false;
    }

    room.status = ROOM_STATUS.IN_PROGRESS;

    broadcast(room, 'game_started', {
      message: 'A partida começou!',
      startsAt: now(),
      room: publicRoomState(room),
    });

    if (room.engine?.start) {
      await room.engine.start();
    }

    return true;
  }

  /**
   * Finaliza a partida, premia a panelinha vencedora e envia relatório no WhatsApp.
   */
  async function finishGame(roomId, winnerFactionId = null, extraStats = {}) {
    const room = getRoom(roomId);
    if (!room || room.status === ROOM_STATUS.FINISHED) return false;

    room.status = ROOM_STATUS.FINISHED;
    room.finishedAt = now();

    // Determina a panelinha vencedora
    let winningFaction = null;
    if (winnerFactionId && room.factions.has(winnerFactionId)) {
      winningFaction = room.factions.get(winnerFactionId);
    } else {
      // Pega a com maior pontuação
      let highestScore = -Infinity;
      for (const fac of room.factions.values()) {
        if (fac.score > highestScore) {
          highestScore = fac.score;
          winningFaction = fac;
        }
      }
    }

    room.winnerFaction = winningFaction;

    // Premiação no cofre da panelinha
    if (winningFaction && room.prize > 0 && factionRepository) {
      try {
        if (typeof factionRepository.depositToVault === 'function') {
          factionRepository.depositToVault({
            factionId: winningFaction.id,
            amount: room.prize,
            now: now(),
          });
        } else {
          const db = factionRepository.getDatabase ? factionRepository.getDatabase() : null;
          if (db) {
            db.prepare(
              `UPDATE analytics.fun_factions
               SET vault_coins = vault_coins + ?, updated_at = ?
               WHERE id = ?`
            ).run(room.prize, now(), winningFaction.id);
          } else {
            factionRepository.donateToVault?.({
              scopeKey: room.scopeKey,
              userJid: winningFaction.members[0] || '',
              amount: room.prize,
              now: now(),
            });
          }
        }
      } catch (err) {
        console.error('[gameManager] Erro ao creditar prêmio no cofre da panelinha:', err?.message || err);
      }
    }

    broadcast(room, 'game_finished', {
      winnerFaction: winningFaction,
      factions: Array.from(room.factions.values()),
      players: Array.from(room.players.values()).map(p => ({
        username: p.username,
        faction: p.faction,
        score: p.score,
      })),
      extraStats,
      prize: room.prize,
    });

    // Envia anúncio de vitória no grupo do WhatsApp
    const winMsg = [
      `🏁 *FIM DE JOGO: ${room.title.toUpperCase()}!*`,
      '',
      winningFaction
        ? `🏆 *A panelinha campeã foi:* ${winningFaction.emoji} *${winningFaction.name}*!`
        : `🤝 *A partida terminou em empate!*`,
      winningFaction
        ? `💰 *Premiação de ${room.prize} moedas depositada diretamente no cofre da panelinha!*`
        : '',
      '',
      '📊 *Placar Final das Panelinhas:*',
      ...Array.from(room.factions.values())
        .sort((a, b) => b.score - a.score)
        .map((f, i) => `${i + 1}º ${f.emoji} *${f.name}*: ${f.score} pts (${f.members.length} jogadores)`),
      '',
      '_Parabéns a todos os participantes!_',
    ].filter(Boolean).join('\n');

    if (room.announce && !room.isTest) {
      try {
        await sendGroupMessage(room.scopeKey, winMsg);
      } catch (err) {
        console.error('[gameManager] Erro ao enviar resultado no grupo:', err?.message || err);
      }
    }

    cleanupRoom(room);
    return true;
  }

  function pruneExpiredRooms(currentTime = now()) {
    const MAX_FINISHED_ROOM_AGE_MS = 30 * 60 * 1000; // 30 minutos
    for (const [id, room] of rooms.entries()) {
      if (
        (room.status === ROOM_STATUS.FINISHED || room.status === ROOM_STATUS.ABORTED) &&
        room.finishedAt &&
        currentTime - room.finishedAt > MAX_FINISHED_ROOM_AGE_MS
      ) {
        cleanupRoom(room);
        rooms.delete(id);
      }
    }
  }

  function cleanupRoom(room) {
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }
    if (room.heartbeatInterval) {
      clearInterval(room.heartbeatInterval);
      room.heartbeatInterval = null;
    }
    if (room.clients && room.clients.size > 0) {
      for (const res of room.clients) {
        try {
          res.end();
        } catch {}
      }
      room.clients.clear();
    }
    if (room.engine?.cleanup) {
      try {
        room.engine.cleanup();
      } catch (err) {
        console.error('[gameManager] Erro ao limpar engine da sala:', err?.message || err);
      }
    }
  }

  function cleanup() {
    for (const room of rooms.values()) {
      cleanupRoom(room);
    }
    rooms.clear();
  }

  /**
   * Processa uma ação recebida de um jogador.
   */
  async function handlePlayerAction(roomId, playerSession, actionData) {
    const room = getRoom(roomId);
    if (!room) return { ok: false, error: 'room_not_found' };
    if (room.status !== ROOM_STATUS.IN_PROGRESS) {
      return { ok: false, error: 'game_not_in_progress' };
    }

    if (!room.engine?.handleAction) {
      return { ok: false, error: 'no_action_handler' };
    }

    return await room.engine.handleAction(playerSession, actionData);
  }

  /**
   * Representação pública e segura do estado da sala.
   */
  function publicRoomState(room) {
    if (!room) return null;
    return {
      id: room.id,
      scopeKey: room.scopeKey,
      gameType: room.gameType,
      title: room.title,
      emoji: room.emoji,
      description: room.description,
      minPlayers: room.minPlayers,
      maxPlayers: room.maxPlayers,
      prize: room.prize,
      status: room.status,
      announce: Boolean(room.announce),
      isTest: Boolean(room.isTest),
      createdAt: room.createdAt,
      startsAt: room.startsAt,
      finishedAt: room.finishedAt,
      winnerFaction: room.winnerFaction,
      players: Array.from(room.players.values()).map(p => ({
        username: p.username,
        faction: p.faction,
        score: p.score,
        isReady: p.isReady,
      })),
      factions: Array.from(room.factions.values()).map(f => ({
        id: f.id,
        name: f.name,
        emoji: f.emoji,
        score: f.score,
        playerCount: f.members.length,
      })),
      engineState: room.engine?.getPublicState ? room.engine.getPublicState() : null,
    };
  }

  return {
    createRoom,
    getRoom,
    getActiveRoomByScope,
    joinRoom,
    startGame,
    finishGame,
    handlePlayerAction,
    broadcast,
    registerEngineFactory,
    publicRoomState,
    cleanup,
  };
}
