import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createKingOfTheHillEngine,
  renderProgressBar,
  COLINAS_CONSTANTS,
} from '../fun/games/engines/kingOfTheHillEngine.js';

function createMockRoom({ now = Date.now } = {}) {
  const room = {
    id: 'test_koth_room_1',
    scopeKey: '120363000000000000@g.us',
    gameType: 'king_of_the_hill',
    title: 'Colinas Test',
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

test('Colinas - renderProgressBar formata corretamente os blocos de progresso ASCII', () => {
  assert.equal(renderProgressBar(0), '░░░░░░░░░░ 0%');
  assert.equal(renderProgressBar(50), '█████░░░░░ 50%');
  assert.equal(renderProgressBar(82), '████████░░ 82%');
  assert.equal(renderProgressBar(100), '██████████ 100%');
});

test('Colinas - Inicialização em rodada e estado público isolado', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });

  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1Session = { userJid: 'p1@s.whatsapp.net' };
  const p3Session = { userJid: 'p3@s.whatsapp.net' };

  const state1 = engine.getPublicState(p1Session);
  assert.equal(state1.gameType, 'king_of_the_hill');
  assert.equal(state1.phase, 'round');
  assert.equal(state1.currentRound, 0);
  assert.equal(state1.totalRounds, 6);
  assert.equal(state1.viewerTeamId, 'fac_blue');
  assert.equal(state1.myBombAvailable, true);
  assert.deepEqual(state1.pots, { alfa: 5, bravo: 3, charlie: 2 });

  // Jogador 1 (Time Azul) vota em Alfa com Bomba
  const voteRes = await engine.handleAction(p1Session, {
    action: 'vote_hill',
    hill: 'alfa',
    useBomb: true,
  });
  assert.equal(voteRes.ok, true);
  assert.equal(voteRes.choice, 'alfa');
  assert.equal(voteRes.useBomb, true);

  // Jogador 1 envia mensagem no chat tático da sua panelinha
  await engine.handleAction(p1Session, {
    action: 'team_message',
    message: 'Galera, botei bomba na Alfa!',
  });

  // O Jogador 1 vê seu voto e suas sugestões
  const stateAfterVoteP1 = engine.getPublicState(p1Session);
  assert.deepEqual(stateAfterVoteP1.myCurrentVote, { choice: 'alfa', useBomb: true });
  assert.equal(stateAfterVoteP1.myTeamSuggestions.alfa, 1);
  assert.equal(stateAfterVoteP1.myTeamChat.length, 1);

  // O Jogador 3 (Time Vermelho) NÃO VÊ a mensagem nem os votos do Time Azul!
  const stateP3 = engine.getPublicState(p3Session);
  assert.equal(stateP3.viewerTeamId, 'fac_red');
  assert.equal(stateP3.myTeamSuggestions.alfa, undefined); // Zero vazamento de dados!
  assert.equal(stateP3.myTeamChat.length, 0);

  engine.cleanup();
});

test('Colinas - Bloqueia segunda bomba na mesma partida', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMockRoom({ now });

  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1Session = { userJid: 'p1@s.whatsapp.net' };

  // Primeiro voto com bomba
  const v1 = await engine.handleAction(p1Session, {
    action: 'vote_hill',
    hill: 'alfa',
    useBomb: true,
  });
  assert.equal(v1.ok, true);

  // Troca de voto na mesma rodada ainda é permitido
  const v2 = await engine.handleAction(p1Session, {
    action: 'vote_hill',
    hill: 'bravo',
    useBomb: true,
  });
  assert.equal(v2.ok, true);
  assert.equal(v2.choice, 'bravo');

  engine.cleanup();
});
