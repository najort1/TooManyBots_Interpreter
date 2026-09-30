import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createKingOfTheHillEngine,
  renderProgressBar,
  DEFAULT_ZONES,
  KOTH_CONSTANTS,
} from '../fun/games/engines/kingOfTheHillEngine.js';
import { createGameManager, GAME_TYPES, ROOM_STATUS } from '../fun/games/gameManager.js';

function createMockRoom({ now = Date.now } = {}) {
  const room = {
    id: 'test_koth_room_1',
    scopeKey: '120363000000000000@g.us',
    gameType: 'king_of_the_hill',
    title: 'King of the Hill Test',
    status: 'in_progress',
    players: new Map(),
    factions: new Map(),
    clients: new Set(),
    gameManager: {
      finishGameCalls: [],
      broadcastCalls: [],
      finishGame(roomId, winnerId, stats) {
        this.finishGameCalls.push({ roomId, winnerId, stats });
      },
      broadcast(rm, eventName, payload) {
        this.broadcastCalls.push({ eventName, payload });
      },
    },
  };

  // Cadastra 2 panelinhas rivais
  room.factions.set('fac_blue', {
    id: 'fac_blue',
    name: 'Panelinha Azul',
    emoji: '🔵',
    score: 0,
    members: ['p1@s.whatsapp.net', 'p2@s.whatsapp.net'],
  });

  room.factions.set('fac_red', {
    id: 'fac_red',
    name: 'Panelinha Vermelha',
    emoji: '🔴',
    score: 0,
    members: ['p3@s.whatsapp.net', 'p4@s.whatsapp.net'],
  });

  // Cadastra 4 jogadores
  room.players.set('p1@s.whatsapp.net', {
    userJid: 'p1@s.whatsapp.net',
    username: 'GuerreiroAzul1',
    faction: { id: 'fac_blue', name: 'Panelinha Azul', emoji: '🔵' },
    score: 0,
  });
  room.players.set('p2@s.whatsapp.net', {
    userJid: 'p2@s.whatsapp.net',
    username: 'GuerreiroAzul2',
    faction: { id: 'fac_blue', name: 'Panelinha Azul', emoji: '🔵' },
    score: 0,
  });
  room.players.set('p3@s.whatsapp.net', {
    userJid: 'p3@s.whatsapp.net',
    username: 'GuerreiroVermelho1',
    faction: { id: 'fac_red', name: 'Panelinha Vermelha', emoji: '🔴' },
    score: 0,
  });
  room.players.set('p4@s.whatsapp.net', {
    userJid: 'p4@s.whatsapp.net',
    username: 'GuerreiroVermelho2',
    faction: { id: 'fac_red', name: 'Panelinha Vermelha', emoji: '🔴' },
    score: 0,
  });

  return room;
}

test('KOTH - renderProgressBar formata corretamente os blocos de progresso ASCII', () => {
  assert.equal(renderProgressBar(0), '░░░░░░░░░░ 0%');
  assert.equal(renderProgressBar(50), '█████░░░░░ 50%');
  assert.equal(renderProgressBar(82), '████████░░ 82%');
  assert.equal(renderProgressBar(100), '██████████ 100%');
  assert.equal(renderProgressBar(-10), '░░░░░░░░░░ 0%');
  assert.equal(renderProgressBar(150), '██████████ 100%');
});

test('KOTH - Inicialização contém Zonas A, B, C e estado público válido', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });

  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const state = engine.getPublicState();
  assert.equal(state.isRunning, true);
  assert.equal(state.isFinished, false);
  assert.equal(state.timeRemainingMs, KOTH_CONSTANTS.MATCH_DURATION_MS);

  // Validação das 3 zonas
  assert.ok(state.zones.A);
  assert.ok(state.zones.B);
  assert.ok(state.zones.C);
  assert.equal(state.zones.A.status, 'neutral');
  assert.equal(state.zones.B.status, 'neutral');
  assert.equal(state.zones.C.status, 'neutral');
  assert.equal(state.zones.A.radius, DEFAULT_ZONES.A.radius);

  // Jogadores sincronizados
  assert.equal(state.players.length, 4);
  const p1 = state.players.find(p => p.userJid === 'p1@s.whatsapp.net');
  assert.ok(p1);
  assert.equal(p1.isAlive, true);
  assert.equal(p1.currentZoneId, null);

  engine.cleanup();
});

test('KOTH - Movimentação do jogador em zonas (entered_zone e left_zone)', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1Session = { userJid: 'p1@s.whatsapp.net', username: 'GuerreiroAzul1', faction: { id: 'fac_blue' } };

  // Entra na Zona A
  const enterA = await engine.handleAction(p1Session, { action: 'entered_zone', zoneId: 'A' });
  assert.equal(enterA.ok, true);
  assert.equal(enterA.zoneId, 'A');
  assert.equal(engine.getPublicState().zones.A.playersCount, 1);

  // Muda diretamente para a Zona B (deve sair automaticamente de A)
  const enterB = await engine.handleAction(p1Session, { action: 'entered_zone', zoneId: 'B' });
  assert.equal(enterB.ok, true);
  assert.equal(engine.getPublicState().zones.A.playersCount, 0);
  assert.equal(engine.getPublicState().zones.B.playersCount, 1);

  // Sai da Zona B
  const left = await engine.handleAction(p1Session, { action: 'left_zone', zoneId: 'B' });
  assert.equal(left.ok, true);
  assert.equal(engine.getPublicState().zones.B.playersCount, 0);

  // Rejeita zona inexistente
  const invalid = await engine.handleAction(p1Session, { action: 'entered_zone', zoneId: 'Z' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error, 'invalid_zone');

  engine.cleanup();
});

test('KOTH - Habilidades táticas (shield, push, shockwave) e recargas', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_blue' } };
  const p2 = { userJid: 'p2@s.whatsapp.net', faction: { id: 'fac_blue' } };
  const p3 = { userJid: 'p3@s.whatsapp.net', faction: { id: 'fac_red' } };

  // Coloca P1 e P3 na Zona A, e P2 na Zona A
  await engine.handleAction(p1, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p2, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p3, { action: 'entered_zone', zoneId: 'A' });

  // P1 tenta empurrar P2 (mesmo time) -> Deve ser rejeitado
  const friendlyPush = await engine.handleAction(p1, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p2@s.whatsapp.net',
  });
  assert.equal(friendlyPush.ok, false);
  assert.equal(friendlyPush.error, 'same_team');

  // P3 ativa SHIELD
  const shieldRes = await engine.handleAction(p3, { action: 'use_ability', ability: 'shield' });
  assert.equal(shieldRes.ok, true);
  assert.equal(shieldRes.ability, 'shield');

  // P1 tenta empurrar P3 (com escudo ativo) -> Push é bloqueado
  const pushShielded = await engine.handleAction(p1, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p3@s.whatsapp.net',
  });
  assert.equal(pushShielded.ok, true);
  assert.equal(pushShielded.blocked, true);

  // P1 tenta usar push novamente de imediato -> Bloqueado por Cooldown
  const cooldownPush = await engine.handleAction(p1, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p3@s.whatsapp.net',
  });
  assert.equal(cooldownPush.ok, false);
  assert.equal(cooldownPush.error, 'ability_on_cooldown');

  // Avança tempo para passar o escudo de P3 e cooldown de P1 (6s)
  simulatedTime += 7000;

  // P1 empurra P3 desprotegido -> P3 é arremessado para fora da zona
  const successfulPush = await engine.handleAction(p1, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p3@s.whatsapp.net',
  });
  assert.equal(successfulPush.ok, true);
  assert.equal(successfulPush.pushedFromZone, 'A');
  const p3State = engine.getPublicState().players.find(p => p.userJid === 'p3@s.whatsapp.net');
  assert.equal(p3State.currentZoneId, null);

  // Testa Shockwave
  // P3 volta para Zona A
  await engine.handleAction(p3, { action: 'entered_zone', zoneId: 'A' });
  // P1 usa shockwave -> P3 é empurrado, P2 é colega de time e fica na zona
  simulatedTime += 16000; // Cooldown de shockwave
  const shockwaveRes = await engine.handleAction(p1, { action: 'use_ability', ability: 'shockwave' });
  assert.equal(shockwaveRes.ok, true);
  assert.equal(shockwaveRes.affectedCount, 1);

  engine.cleanup();
});

test('KOTH - Eliminação de jogador e temporizador de respawn', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p3 = { userJid: 'p3@s.whatsapp.net', faction: { id: 'fac_red' } };
  await engine.handleAction(p3, { action: 'entered_zone', zoneId: 'C' });

  // P3 é eliminado por P1
  const elim = await engine.handleAction(p3, {
    action: 'eliminated',
    zoneId: 'C',
    byPlayerId: 'p1@s.whatsapp.net',
  });
  assert.equal(elim.ok, true);
  assert.equal(elim.eliminated, true);

  const p3State = engine.getPublicState().players.find(p => p.userJid === 'p3@s.whatsapp.net');
  assert.equal(p3State.isAlive, false);
  assert.equal(p3State.currentZoneId, null);
  assert.equal(p3State.deaths, 1);

  const p1State = engine.getPublicState().players.find(p => p.userJid === 'p1@s.whatsapp.net');
  assert.equal(p1State.kills, 1);

  // Jogador morto não pode entrar em zonas
  const enterDead = await engine.handleAction(p3, { action: 'entered_zone', zoneId: 'A' });
  assert.equal(enterDead.ok, false);
  assert.equal(enterDead.error, 'player_dead');

  engine.cleanup();
});

test('KOTH - Avaliação periódica do Servidor: Maioria, Contestado e +2% por zona dominada', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_blue' } };
  const p2 = { userJid: 'p2@s.whatsapp.net', faction: { id: 'fac_blue' } };
  const p3 = { userJid: 'p3@s.whatsapp.net', faction: { id: 'fac_red' } };
  const p4 = { userJid: 'p4@s.whatsapp.net', faction: { id: 'fac_red' } };

  // Zona A: P1 e P2 (Azul) vs P3 (Vermelho) -> Azul tem maioria (2 vs 1)
  await engine.handleAction(p1, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p2, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p3, { action: 'entered_zone', zoneId: 'A' });

  // Zona B: Vazia -> Neutra
  // Zona C: P4 (Vermelho) sozinho -> Vermelho tem maioria (1 vs 0)
  await engine.handleAction(p4, { action: 'entered_zone', zoneId: 'C' });

  // Executa avaliação de 1 tick (2 segundos)
  engine._evaluateZonesTick();

  let state = engine.getPublicState();
  assert.equal(state.zones.A.status, 'controlled');
  assert.equal(state.zones.A.controllingFactionId, 'fac_blue');

  assert.equal(state.zones.B.status, 'neutral');

  assert.equal(state.zones.C.status, 'controlled');
  assert.equal(state.zones.C.controllingFactionId, 'fac_red');

  // Cada uma dominou 1 zona -> +2% para Azul e +2% para Vermelho
  const blueProgress1 = state.factionProgress.find(f => f.id === 'fac_blue');
  const redProgress1 = state.factionProgress.find(f => f.id === 'fac_red');
  assert.equal(blueProgress1.progress, 2);
  assert.equal(redProgress1.progress, 2);

  // Agora P1 se move para a Zona C
  // Zona C fica: P4 (Vermelho) e P1 (Azul) -> 1 vs 1 -> CONTESTADA!
  await engine.handleAction(p1, { action: 'entered_zone', zoneId: 'C' });

  // Executa segundo tick
  engine._evaluateZonesTick();
  state = engine.getPublicState();

  // Zona A agora só tem P2 (Azul) vs P3 (Vermelho) -> 1 vs 1 -> CONTESTADA!
  assert.equal(state.zones.A.status, 'contested');
  // Zona C tem 1 vs 1 -> CONTESTADA!
  assert.equal(state.zones.C.status, 'contested');

  // Ninguém pontua nesse tick porque ambas estão contestadas!
  const blueProgress2 = state.factionProgress.find(f => f.id === 'fac_blue');
  const redProgress2 = state.factionProgress.find(f => f.id === 'fac_red');
  assert.equal(blueProgress2.progress, 2);
  assert.equal(redProgress2.progress, 2);

  engine.cleanup();
});

test('KOTH - Vitória automática ao atingir 100% de controle', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_blue' } };
  const p2 = { userJid: 'p2@s.whatsapp.net', faction: { id: 'fac_blue' } };

  // Azul domina Zonas A e B
  await engine.handleAction(p1, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p2, { action: 'entered_zone', zoneId: 'B' });

  // Simula progresso prévio em 98%
  engine._factionProgress.set('fac_blue', 98);

  // Executa tick que dá +4% para Azul (atinge 100%)
  engine._evaluateZonesTick();

  assert.equal(room.gameManager.finishGameCalls.length, 1);
  const finishCall = room.gameManager.finishGameCalls[0];
  assert.equal(finishCall.roomId, room.id);
  assert.equal(finishCall.winnerId, 'fac_blue');
  assert.equal(finishCall.stats.reason, 'target_control_reached');

  engine.cleanup();
});

test('KOTH - Vitória por término de tempo (3 minutos) vence a maior porcentagem', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  // Define pontuações acumuladas
  engine._factionProgress.set('fac_blue', 45);
  engine._factionProgress.set('fac_red', 60);

  // Simula expiração do tempo
  engine._endMatch(null, 'time_expired');

  assert.equal(room.gameManager.finishGameCalls.length, 1);
  const finishCall = room.gameManager.finishGameCalls[0];
  assert.equal(finishCall.winnerId, 'fac_red');
  assert.equal(finishCall.stats.reason, 'time_expired');

  engine.cleanup();
});

test('KOTH - Integração completa com createGameManager', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const sentMessages = [];

  const gameManager = createGameManager({
    sendGroupMessage: async (group, msg) => {
      sentMessages.push({ group, msg });
    },
    now,
  });

  const created = await gameManager.createRoom({
    scopeKey: '120363000000000000@g.us',
    gameType: GAME_TYPES.KING_OF_THE_HILL,
    startInMinutes: 1,
  });

  assert.equal(created.ok, true);
  const roomId = created.room.id;

  // Junta 4 jogadores de 2 panelinhas
  const join1 = gameManager.joinRoom(roomId, {
    userJid: 'p1@s.whatsapp.net',
    username: 'P1',
    faction: { id: 'fac_1', name: 'Alpha', emoji: '🐺' },
  });
  assert.equal(join1.ok, true);

  gameManager.joinRoom(roomId, {
    userJid: 'p2@s.whatsapp.net',
    username: 'P2',
    faction: { id: 'fac_1', name: 'Alpha', emoji: '🐺' },
  });
  gameManager.joinRoom(roomId, {
    userJid: 'p3@s.whatsapp.net',
    username: 'P3',
    faction: { id: 'fac_2', name: 'Beta', emoji: '🦁' },
  });
  gameManager.joinRoom(roomId, {
    userJid: 'p4@s.whatsapp.net',
    username: 'P4',
    faction: { id: 'fac_2', name: 'Beta', emoji: '🦁' },
  });

  // Inicia partida
  const started = await gameManager.startGame(roomId);
  assert.equal(started, true);

  const room = gameManager.getRoom(roomId);
  assert.equal(room.status, ROOM_STATUS.IN_PROGRESS);
  assert.ok(room.engine);

  // Executa ação de jogador pelo gameManager
  const actionRes = await gameManager.handlePlayerAction(roomId, {
    userJid: 'p1@s.whatsapp.net',
  }, {
    action: 'entered_zone',
    zoneId: 'A',
  });
  assert.equal(actionRes.ok, true);
  assert.equal(actionRes.zoneId, 'A');

  // Consulta estado público da sala
  const publicState = gameManager.publicRoomState(room);
  assert.ok(publicState.engineState);
  assert.equal(publicState.engineState.zones.A.playersCount, 1);

  // Finaliza a sala
  await gameManager.finishGame(roomId, 'fac_1');
  assert.equal(room.status, ROOM_STATUS.FINISHED);
  assert.equal(room.winnerFaction.id, 'fac_1');
});
