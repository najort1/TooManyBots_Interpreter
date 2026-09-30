import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createKingOfTheHillEngine,
  COLINAS_CONSTANTS,
} from '../fun/games/engines/kingOfTheHillEngine.js';

function createMock8PlayerRoom({ now = Date.now } = {}) {
  const room = {
    id: 'koth_intensive_room_8p',
    scopeKey: '120363000000000000@g.us',
    gameType: 'king_of_the_hill',
    title: 'King of the Hill - Bateria Intensiva 8 Jogadores',
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

  room.factions.set('fac_tigres', {
    id: 'fac_tigres',
    name: 'Tigres Dourados',
    emoji: '🐯',
    score: 0,
    members: ['p1@s.whatsapp.net', 'p2@s.whatsapp.net', 'p3@s.whatsapp.net', 'p4@s.whatsapp.net'],
  });

  room.factions.set('fac_dragoes', {
    id: 'fac_dragoes',
    name: 'Dragões de Fogo',
    emoji: '🐉',
    score: 0,
    members: ['p5@s.whatsapp.net', 'p6@s.whatsapp.net', 'p7@s.whatsapp.net', 'p8@s.whatsapp.net'],
  });

  for (let i = 1; i <= 4; i++) {
    const jid = `p${i}@s.whatsapp.net`;
    room.players.set(jid, {
      userJid: jid,
      username: `Tigre_${i}`,
      faction: { id: 'fac_tigres', name: 'Tigres Dourados', emoji: '🐯' },
      score: 0,
    });
  }

  for (let i = 5; i <= 8; i++) {
    const jid = `p${i}@s.whatsapp.net`;
    room.players.set(jid, {
      userJid: jid,
      username: `Dragao_${i}`,
      faction: { id: 'fac_dragoes', name: 'Dragões de Fogo', emoji: '🐉' },
      score: 0,
    });
  }

  return room;
}

test('KOTH Intensivo - Concorrência de Votos com 8 jogadores simultâneos via Promise.all', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMock8PlayerRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const sessions = Array.from({ length: 8 }, (_, idx) => {
    const id = idx + 1;
    return {
      userJid: `p${id}@s.whatsapp.net`,
      username: id <= 4 ? `Tigre_${id}` : `Dragao_${id}`,
      faction: { id: id <= 4 ? 'fac_tigres' : 'fac_dragoes' },
    };
  });

  // Votação Concorrente 1: Todos os 8 jogadores votam simultaneamente
  const targetHills = ['alfa', 'alfa', 'bravo', 'charlie', 'alfa', 'bravo', 'bravo', 'charlie'];
  const votePromises = sessions.map((sess, idx) =>
    engine.handleAction(sess, {
      action: 'vote_hill',
      hill: targetHills[idx],
      useBomb: idx === 0, // Apenas p1 usa bomba
    })
  );
  const voteResults = await Promise.all(votePromises);

  for (const res of voteResults) {
    assert.equal(res.ok, true, 'Todos os jogadores devem conseguir votar concorrentemente');
  }

  // Verifica sugestões visíveis para Tigres (jogadores 1 a 4)
  const stateTigres = engine.getPublicState(sessions[0]);
  assert.equal(stateTigres.viewerTeamId, 'fac_tigres');
  // p1 e p2 em Alfa, p3 em Bravo, p4 em Charlie
  assert.equal(stateTigres.myTeamSuggestions.alfa, 2);
  assert.equal(stateTigres.myTeamSuggestions.bravo, 1);
  assert.equal(stateTigres.myTeamSuggestions.charlie, 1);

  // Verifica sugestões visíveis para Dragões (jogadores 5 a 8)
  const stateDragoes = engine.getPublicState(sessions[4]);
  assert.equal(stateDragoes.viewerTeamId, 'fac_dragoes');
  // p5 em Alfa, p6 e p7 em Bravo, p8 em Charlie
  assert.equal(stateDragoes.myTeamSuggestions.alfa, 1);
  assert.equal(stateDragoes.myTeamSuggestions.bravo, 2);
  assert.equal(stateDragoes.myTeamSuggestions.charlie, 1);

  // Votação Concorrente 2: Troca massiva de votos simultânea (idempotência)
  const reVotePromises = sessions.map((sess, idx) =>
    engine.handleAction(sess, {
      action: 'vote_hill',
      hill: idx % 2 === 0 ? 'charlie' : 'alfa',
    })
  );
  const reVoteResults = await Promise.all(reVotePromises);
  for (const res of reVoteResults) {
    assert.equal(res.ok, true);
  }

  engine.cleanup();
});
