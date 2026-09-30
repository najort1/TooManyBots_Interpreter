import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGridCtfEngine,
  GOLPE_CONSTANTS,
} from '../fun/games/engines/gridCtfEngine.js';

function createMockRoom() {
  const room = {
    id: 'test_golpe_room_1',
    scopeKey: '120363000000000000@g.us',
    gameType: 'grid_ctf',
    title: 'Grande Golpe Test',
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

  room.players.set('p1@s.whatsapp.net', {
    userJid: 'p1@s.whatsapp.net',
    username: 'InvasorAzul1',
    faction: { id: 'fac_blue', name: 'Panelinha Azul', emoji: '🔵' },
    score: 0,
  });
  room.players.set('p2@s.whatsapp.net', {
    userJid: 'p2@s.whatsapp.net',
    username: 'InvasorAzul2',
    faction: { id: 'fac_blue', name: 'Panelinha Azul', emoji: '🔵' },
    score: 0,
  });
  room.players.set('p3@s.whatsapp.net', {
    userJid: 'p3@s.whatsapp.net',
    username: 'GuardaVermelho1',
    faction: { id: 'fac_red', name: 'Panelinha Vermelha', emoji: '🔴' },
    score: 0,
  });
  room.players.set('p4@s.whatsapp.net', {
    userJid: 'p4@s.whatsapp.net',
    username: 'GuardaVermelho2',
    faction: { id: 'fac_red', name: 'Panelinha Vermelha', emoji: '🔴' },
    score: 0,
  });

  return room;
}

test('Grande Golpe - Inicialização e papéis de Ataque/Defesa', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom();

  const engine = createGridCtfEngine(room, { now });
  await engine.start();

  const p1Session = { userJid: 'p1@s.whatsapp.net' };
  const p3Session = { userJid: 'p3@s.whatsapp.net' };

  // Rodada 1: Time Azul ataca, Time Vermelho defende
  const stateP1 = engine.getPublicState(p1Session);
  assert.equal(stateP1.gameType, 'grid_ctf');
  assert.equal(stateP1.phase, 'round');
  assert.equal(stateP1.currentRound, 0);
  assert.equal(stateP1.attackingTeamId, 'fac_blue');
  assert.equal(stateP1.defendingTeamId, 'fac_red');

  // Votação nas rotas
  const v1 = await engine.handleAction(p1Session, { action: 'vote_route', route: 'ponte' });
  assert.equal(v1.ok, true);
  assert.equal(v1.choice, 'ponte');

  const v3 = await engine.handleAction(p3Session, { action: 'vote_route', route: 'ponte' });
  assert.equal(v3.ok, true);
  assert.equal(v3.choice, 'ponte');

  // Isolamento entre equipes
  const stateAfterP1 = engine.getPublicState(p1Session);
  assert.equal(stateAfterP1.myTeamSuggestions.ponte, 1);

  const stateAfterP3 = engine.getPublicState(p3Session);
  assert.equal(stateAfterP3.myTeamSuggestions.ponte, 1);

  engine.cleanup();
});
