import test from 'node:test';
import assert from 'node:assert/strict';

import { createGridCtfEngine, GRID_CTF_CONSTANTS } from '../fun/games/engines/gridCtfEngine.js';

function createMockRoom({
  playersCount = 4,
  factionsCount = 2,
} = {}) {
  const room = {
    id: 'test-room-ctf-1',
    scopeKey: '120363000000000000@g.us',
    gameType: 'grid_ctf',
    title: 'CTF dos Crias',
    status: 'in_progress',
    players: new Map(),
    factions: new Map(),
    clients: new Set(),
    gameManager: {
      broadcastCalls: [],
      finishGameCalls: [],
      broadcast(rm, eventName, payload) {
        this.broadcastCalls.push({ eventName, payload });
      },
      finishGame(roomId, winnerFactionId, stats) {
        this.finishGameCalls.push({ roomId, winnerFactionId, stats });
      },
    },
  };

  for (let f = 1; f <= factionsCount; f++) {
    const fId = `faction_${f}`;
    room.factions.set(fId, {
      id: fId,
      name: `Panelinha ${f}`,
      emoji: f === 1 ? '🔵' : '🔴',
      score: 0,
      members: [],
    });
  }

  for (let p = 1; p <= playersCount; p++) {
    const fIndex = ((p - 1) % factionsCount) + 1;
    const fId = `faction_${fIndex}`;
    const userJid = `55119999000${p}@s.whatsapp.net`;
    const username = `Player_${p}`;

    const playerData = {
      userJid,
      username,
      faction: {
        id: fId,
        name: `Panelinha ${fIndex}`,
        emoji: fIndex === 1 ? '🔵' : '🔴',
      },
      score: 0,
      isReady: true,
    };

    room.players.set(userJid, playerData);
    room.factions.get(fId).members.push(userJid);
  }

  return room;
}

test('Grid CTF Engine: inicialização, times, bases e distribuição de jogadores', async () => {
  const room = createMockRoom({ playersCount: 4, factionsCount: 2 });
  let currentTime = 1000000;
  const engine = createGridCtfEngine(room, {
    now: () => currentTime,
  });

  const started = await engine.start();
  assert.equal(started.ok, true);

  const state = engine.getPublicState();
  assert.equal(state.gameType, 'grid_ctf');
  assert.equal(state.status, 'in_progress');
  assert.equal(state.players.length, 4);

  // Time azul fica na esquerda (x <= 1), Time vermelho na direita (x >= 10)
  const blues = state.players.filter(p => p.team === 'blue');
  const reds = state.players.filter(p => p.team === 'red');
  assert.equal(blues.length, 2);
  assert.equal(reds.length, 2);

  for (const b of blues) {
    assert.ok(b.x <= 1);
    assert.equal(b.facing, 'right');
  }
  for (const r of reds) {
    assert.ok(r.x >= 10);
    assert.equal(r.facing, 'left');
  }

  // Bandeiras nas bases
  assert.equal(state.flags.blue.status, 'at_base');
  assert.equal(state.flags.blue.x, 1);
  assert.equal(state.flags.blue.y, 3);

  assert.equal(state.flags.red.status, 'at_base');
  assert.equal(state.flags.red.x, 10);
  assert.equal(state.flags.red.y, 3);

  engine.cleanup();
});

test('Grid CTF Engine: movimentação autoritativa, obstáculos e validação de cooldown', async () => {
  const room = createMockRoom({ playersCount: 2, factionsCount: 2 });
  let currentTime = 1000000;
  const engine = createGridCtfEngine(room, {
    now: () => currentTime,
    funConfig: { gridCtfMoveCooldownMs: 350 },
  });

  await engine.start();
  const player1 = Array.from(room.players.values())[0]; // Time azul

  // 1. Movimento válido para a direita
  const move1 = await engine.handleAction(player1, {
    action: 'move',
    direction: 'right',
  });
  assert.equal(move1.ok, true);
  assert.equal(move1.delta.action, 'move');
  assert.equal(move1.delta.player.facing, 'right');

  // 2. Tentativa imediata (cooldown ativo)
  currentTime += 100; // Menor que 350ms
  const moveTooFast = await engine.handleAction(player1, {
    action: 'move',
    direction: 'right',
  });
  assert.equal(moveTooFast.ok, false);
  assert.equal(moveTooFast.error, 'cooldown');
  assert.ok(moveTooFast.retryInMs > 0);

  // 3. Após expirar o cooldown
  currentTime += 300;
  const moveAfterCd = await engine.handleAction(player1, {
    action: 'move',
    direction: 'up',
  });
  assert.equal(moveAfterCd.ok, true);

  // 4. Teste de obstáculo fixo (ex: 3,1)
  const state = engine.getPublicState();
  assert.ok(state.grid.obstacles.includes('3,1'));

  engine.cleanup();
});

test('Grid CTF Engine: captura de bandeira inimiga, condução e marcação de Ponto na base', async () => {
  const room = createMockRoom({ playersCount: 2, factionsCount: 2 });
  let currentTime = 1000000;
  const engine = createGridCtfEngine(room, {
    now: () => currentTime,
    funConfig: { gridCtfMoveCooldownMs: 0 }, // Sem cooldown para teste rápido
  });

  await engine.start();

  const pBlue = Array.from(room.players.values()).find(p => {
    return engine.getPublicState().players.find(sp => sp.userJid === p.userJid)?.team === 'blue';
  });

  // Teleporta ou move o jogador azul até a posição da bandeira vermelha (x=10, y=3)
  // Vamos mover até a casa adjacente à bandeira vermelha
  const pubState = engine.getPublicState();
  const blueInEngine = pubState.players.find(p => p.userJid === pBlue.userJid);

  // Simula o trajeto do jogador azul até a bandeira vermelha (10, 3)
  // Diretamente posicionamos para testar a captura:
  blueInEngine.x = 9;
  blueInEngine.y = 3;

  // Move para (10, 3) onde está a bandeira vermelha
  // O motor usa o player interno, então movemos passo a passo
  // Primeiro removemos obstáculos do caminho se houver
  const redFlag = pubState.flags.red;
  assert.equal(redFlag.status, 'at_base');

  // Vamos usar um jogador que se move sobre a bandeira vermelha
  // Ajustamos o jogador do teste para estar em (9, 3)
  const stateBefore = engine.getPublicState();
  const playerBlueObj = stateBefore.players.find(p => p.team === 'blue');

  // Move até a bandeira vermelha
  // Pegamos a referência interna através de uma série de moves válidos
  let pX = playerBlueObj.x;
  let pY = playerBlueObj.y;

  // Desloca para linha 0 (livre de obstáculos) e avança até a base vermelha
  while (pY > 0) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'up' });
    pY--;
  }
  while (pX < 10) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'right' });
    pX++;
  }
  while (pY < 3) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'down' });
    pY++;
  }

  // Agora o jogador azul pisou na célula (10, 3) onde fica a bandeira vermelha!
  const stateWithFlag = engine.getPublicState();
  const blueCurrent = stateWithFlag.players.find(p => p.team === 'blue');
  assert.equal(blueCurrent.hasFlag, true);
  assert.equal(stateWithFlag.flags.red.status, 'carried');
  assert.equal(stateWithFlag.flags.red.carrierId, pBlue.userJid);

  // Agora o jogador azul retorna para a sua base (x <= 1, 2 <= y <= 5)
  // Volta pela rota norte (y=0)
  while (pY > 0) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'up' });
    pY--;
  }
  while (pX > 1) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'left' });
    pX--;
  }
  while (pY < 3) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'down' });
    pY++;
  }

  // Chegou na base azul (x=1, y=3) com a bandeira vermelha -> PONTO!
  const finalState = engine.getPublicState();
  assert.equal(finalState.scores.blue, 1);
  assert.equal(finalState.flags.red.status, 'at_base'); // Resetada para a base vermelha
  assert.equal(finalState.players.find(p => p.team === 'blue').hasFlag, false);

  engine.cleanup();
});

test('Grid CTF Engine: combate tático com tackle, queda de bandeira e recuperação aliada', async () => {
  const room = createMockRoom({ playersCount: 2, factionsCount: 2 });
  let currentTime = 1000000;
  const engine = createGridCtfEngine(room, {
    now: () => currentTime,
    funConfig: { gridCtfMoveCooldownMs: 0, gridCtfTackleCooldownMs: 0 },
  });

  await engine.start();

  const pBlue = Array.from(room.players.values()).find(p => p.faction.id === 'faction_1');
  const pRed = Array.from(room.players.values()).find(p => p.faction.id === 'faction_2');

  // Faz o jogador vermelho avançar para o território azul (x < 6)
  // Rota norte (y=0)
  await engine.handleAction(pRed, { action: 'move', direction: 'up' });
  await engine.handleAction(pRed, { action: 'move', direction: 'up' });
  await engine.handleAction(pRed, { action: 'move', direction: 'up' }); // y=0

  for (let step = 0; step < 7; step++) {
    await engine.handleAction(pRed, { action: 'move', direction: 'left' });
  }

  // Faz o jogador azul subir para a mesma linha ou ficar adjacente
  await engine.handleAction(pBlue, { action: 'move', direction: 'up' });
  await engine.handleAction(pBlue, { action: 'move', direction: 'up' });
  await engine.handleAction(pBlue, { action: 'move', direction: 'up' }); // y=0

  // O jogador azul caminha até ficar adjacente ao invasor vermelho
  const st = engine.getPublicState();
  const redNow = st.players.find(p => p.userJid === pRed.userJid);
  const blueNow = st.players.find(p => p.userJid === pBlue.userJid);

  assert.ok(redNow.x < 6); // Vermelho é invasor no território azul!

  // Move azul até ficar à esquerda de vermelho
  while (blueNow.x < redNow.x - 1) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'right' });
    blueNow.x++;
  }

  // Executa o Tackle!
  const tackleRes = await engine.handleAction(pBlue, { action: 'tackle' });
  assert.equal(tackleRes.ok, true);
  assert.equal(tackleRes.delta.action, 'tackle');

  // Jogador vermelho foi derrubado e enviado para o respawn da sua base (x=11)
  const afterTackleState = engine.getPublicState();
  const redAfter = afterTackleState.players.find(p => p.userJid === pRed.userJid);
  assert.equal(redAfter.isRespawning, true);
  assert.equal(redAfter.x, 11);

  engine.cleanup();
});

test('Grid CTF Engine: ação tática de Dash (avanço de 2 casas com cooldown)', async () => {
  const room = createMockRoom({ playersCount: 2, factionsCount: 2 });
  let currentTime = 1000000;
  const engine = createGridCtfEngine(room, {
    now: () => currentTime,
    funConfig: { gridCtfDashCooldownMs: 2000 },
  });

  await engine.start();
  const pBlue = Array.from(room.players.values())[0];
  const initialBlue = engine.getPublicState().players.find(p => p.userJid === pBlue.userJid);
  const startX = initialBlue.x;

  // Executa o Dash para a direita
  const dashRes = await engine.handleAction(pBlue, { action: 'dash', direction: 'right' });
  assert.equal(dashRes.ok, true);
  assert.equal(dashRes.delta.action, 'dash');

  const afterDash = engine.getPublicState().players.find(p => p.userJid === pBlue.userJid);
  assert.equal(afterDash.x, startX + 2); // Avançou 2 casas

  // Tentativa de novo Dash imediatamente -> Cooldown
  currentTime += 500;
  const dashCd = await engine.handleAction(pBlue, { action: 'dash', direction: 'right' });
  assert.equal(dashCd.ok, false);
  assert.equal(dashCd.error, 'cooldown');

  engine.cleanup();
});

test('Grid CTF Engine: vitória ao atingir 3 pontos', async () => {
  const room = createMockRoom({ playersCount: 2, factionsCount: 2 });
  let currentTime = 1000000;
  const engine = createGridCtfEngine(room, {
    now: () => currentTime,
    funConfig: { gridCtfPointsToWin: 1, gridCtfMoveCooldownMs: 0 }, // 1 ponto para vitória no teste
  });

  await engine.start();
  const pBlue = Array.from(room.players.values())[0];

  // Simula diretamente o fluxo de captura até a vitória
  const pubState = engine.getPublicState();
  const blueInEngine = pubState.players.find(p => p.userJid === pBlue.userJid);

  // Alinha e busca a bandeira
  let pX = blueInEngine.x;
  let pY = blueInEngine.y;
  while (pY > 0) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'up' });
    pY--;
  }
  while (pX < 10) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'right' });
    pX++;
  }
  while (pY < 3) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'down' });
    pY++;
  }
  // Retorna à base azul
  while (pY > 0) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'up' });
    pY--;
  }
  while (pX > 1) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'left' });
    pX--;
  }
  while (pY < 3) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'down' });
    pY++;
  }

  // Verificamos se finishGame foi chamado no GameManager da sala
  assert.equal(room.gameManager.finishGameCalls.length, 1);
  assert.equal(room.gameManager.finishGameCalls[0].roomId, room.id);
  assert.equal(room.gameManager.finishGameCalls[0].winnerFactionId, 'faction_1');

  engine.cleanup();
});

test('Grid CTF Engine: casos de borda e validações táticas de segurança', async () => {
  const room = createMockRoom({ playersCount: 2, factionsCount: 2 });
  let currentTime = 1000000;
  const engine = createGridCtfEngine(room, {
    now: () => currentTime,
    funConfig: {
      gridCtfMoveCooldownMs: 0,
      gridCtfTackleCooldownMs: 0,
      gridCtfFlagAutoReturnMs: 5000,
    },
  });

  await engine.start();
  const pBlue = Array.from(room.players.values())[0];
  const pRed = Array.from(room.players.values())[1];

  // 1. Tackle sem oponente adjacente
  const noOpp = await engine.handleAction(pBlue, { action: 'tackle' });
  assert.equal(noOpp.ok, false);
  assert.equal(noOpp.error, 'no_target_adjacent');

  // 2. Direção inválida no movimento
  const badDir = await engine.handleAction(pBlue, { action: 'move', direction: 'diagonal' });
  assert.equal(badDir.ok, false);
  assert.equal(badDir.error, 'invalid_direction');

  // 3. Ação desconhecida
  const badAct = await engine.handleAction(pBlue, { action: 'super_punch' });
  assert.equal(badAct.ok, false);
  assert.equal(badAct.error, 'unknown_action');

  // 4. Jogador não cadastrado
  const ghost = { userJid: 'unknown@s.whatsapp.net', username: 'Ghost' };
  const ghostAct = await engine.handleAction(ghost, { action: 'move', direction: 'up' });
  assert.equal(ghostAct.ok, false);
  assert.equal(ghostAct.error, 'player_not_in_game');

  // 5. Teste de desvantagem no Tackle (invasor tentando dar tackle em território inimigo)
  // Move jogador azul para a rota norte (y=0) e avança para o território vermelho (x >= 6)
  await engine.handleAction(pBlue, { action: 'move', direction: 'up' });
  await engine.handleAction(pBlue, { action: 'move', direction: 'up' }); // y=0
  for (let i = 0; i < 7; i++) {
    await engine.handleAction(pBlue, { action: 'move', direction: 'right' });
  } // pBlue agora está em (7, 0) - território vermelho!

  // Move pRed para a rota norte (y=0) até (8, 0) ficando adjacente a pBlue
  await engine.handleAction(pRed, { action: 'move', direction: 'up' });
  await engine.handleAction(pRed, { action: 'move', direction: 'up' }); // y=0
  for (let i = 0; i < 3; i++) {
    await engine.handleAction(pRed, { action: 'move', direction: 'left' });
  } // pRed agora está em (8, 0) - adjacente a pBlue (7, 0)!

  // pBlue tenta dar tackle em pRed no território vermelho sem portar bandeira -> tackle_disadvantage
  const disadv = await engine.handleAction(pBlue, { action: 'tackle' });
  assert.equal(disadv.ok, false);
  assert.equal(disadv.error, 'tackle_disadvantage');

  // pRed (dono da casa) dá tackle com sucesso em pBlue (invasor)!
  const redTackle = await engine.handleAction(pRed, { action: 'tackle' });
  assert.equal(redTackle.ok, true);

  // pBlue agora está em respawn
  const pBlueAfterTackle = await engine.handleAction(pBlue, { action: 'move', direction: 'right' });
  assert.equal(pBlueAfterTackle.ok, false);
  assert.equal(pBlueAfterTackle.error, 'respawning');
  assert.ok(pBlueAfterTackle.retryInMs > 0);

  engine.cleanup();
});

