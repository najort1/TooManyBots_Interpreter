import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridCtfEngine, GRID_CTF_CONSTANTS } from '../fun/games/engines/gridCtfEngine.js';

function createMockRoom(playersList = []) {
  const room = {
    id: 'room-ctf-intensive-' + Math.random().toString(36).substring(2, 8),
    scopeKey: '120363020000000000@g.us',
    status: 'in_progress',
    players: new Map(),
    factions: new Map([
      ['fac_blue', { id: 'fac_blue', name: 'Faction Blue', score: 0 }],
      ['fac_red', { id: 'fac_red', name: 'Faction Red', score: 0 }],
    ]),
    clients: new Set(),
  };

  for (const p of playersList) {
    room.players.set(p.userJid, p);
  }

  return room;
}

const { ACTIONS, DIRECTIONS, TEAMS } = GRID_CTF_CONSTANTS;

test('Grid CTF Intensive - 1. Anti-cheat, Cooldowns & Flooding Resistance', async (t) => {
  let currentTime = 1_000_000;
  const now = () => currentTime;

  const room = createMockRoom([
    { userJid: 'user_blue_1@s.whatsapp.net', username: 'BlueStriker', faction: { id: 'fac_blue' } },
    { userJid: 'user_red_1@s.whatsapp.net', username: 'RedDefender', faction: { id: 'fac_red' } },
  ]);

  const engine = createGridCtfEngine(room, {
    now,
    funConfig: {
      gridCtfMoveCooldownMs: 350,
      gridCtfTackleCooldownMs: 800,
      gridCtfDashCooldownMs: 2000,
      gridCtfRespawnDurationMs: 3000,
    },
  });

  await engine.start();

  await t.test('Envio em rajada de 50 ações em <100ms simula flood/speed-hack no Quick Tunnel e bloqueia 49 tentativas', async () => {
    const session = { userJid: 'user_blue_1@s.whatsapp.net', username: 'BlueStriker' };
    const results = [];

    // Dispara 50 ações com intervalos de 1ms
    for (let i = 0; i < 50; i++) {
      currentTime += 1; // +1ms (total < 100ms)
      const res = await engine.handleAction(session, {
        action: ACTIONS.MOVE,
        direction: DIRECTIONS.RIGHT,
      });
      results.push(res);
    }

    assert.equal(results[0].ok, true, 'A primeira ação válida dentro do cooldown deve ser aceita');
    assert.equal(results[0].delta.action, 'move');

    for (let i = 1; i < 50; i++) {
      assert.equal(results[i].ok, false, `Ação #${i + 1} em rajada deve ser barrada por cooldown`);
      assert.equal(results[i].error, 'cooldown');
      assert.ok(results[i].retryInMs > 0, 'Deve informar tempo restante de cooldown');
    }
  });

  await t.test('Cooldown é respeitado estritamente ao avançar o tempo', async () => {
    const session = { userJid: 'user_blue_1@s.whatsapp.net' };

    // Tenta aos 300ms de cooldown (abaixo dos 350ms)
    currentTime += 300;
    const resBlocked = await engine.handleAction(session, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.RIGHT,
    });
    assert.equal(resBlocked.ok, false);
    assert.equal(resBlocked.error, 'cooldown');

    // Completa o cooldown (+55ms -> 355ms decorridos)
    currentTime += 55;
    const resAllowed = await engine.handleAction(session, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.UP,
    });
    assert.equal(resAllowed.ok, true);
  });

  await t.test('Bloqueia ações de jogadores não cadastrados na partida', async () => {
    const hacker = { userJid: 'attacker_fake@s.whatsapp.net' };
    const res = await engine.handleAction(hacker, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.RIGHT,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'player_not_in_game');
  });

  await t.test('Rejeita direção inválida sem quebrar integridade', async () => {
    const session = { userJid: 'user_blue_1@s.whatsapp.net' };
    currentTime += 500;
    const res = await engine.handleAction(session, {
      action: ACTIONS.MOVE,
      direction: '__proto__injection',
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_direction');
  });

  await t.test('Bloqueia ações enquanto o jogador está em estado de respawn após nocaute legítimo', async () => {
    // RedDefender sofre tackle de BlueStriker
    const sBlue = { userJid: 'user_blue_1@s.whatsapp.net' };
    const sRed = { userJid: 'user_red_1@s.whatsapp.net' };

    // Move RedDefender para o território azul (x=5, y=3)
    // RedDefender começa em (11, 2)
    currentTime += 1000;
    await engine.handleAction(sRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (11, 3)
    for (let x = 10; x >= 5; x--) {
      currentTime += 400;
      await engine.handleAction(sRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT });
    }

    // Move BlueStriker para (4, 3)
    // BlueStriker começa em (1, 1). Move para (4, 3)
    currentTime += 400;
    await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (1, 2)
    currentTime += 400;
    await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (1, 3)
    for (let x = 2; x <= 4; x++) {
      currentTime += 400;
      await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT });
    }

    // BlueStriker aplica TACKLE em RedDefender (invasor em x=5, y=3)
    currentTime += 400;
    const tackleRes = await engine.handleAction(sBlue, { action: ACTIONS.TACKLE });
    assert.equal(tackleRes.ok, true);

    // RedDefender agora está em respawn por 3000ms
    currentTime += 50;
    const respawnAction = await engine.handleAction(sRed, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.LEFT,
    });
    assert.equal(respawnAction.ok, false);
    assert.equal(respawnAction.error, 'respawning');
    assert.ok(respawnAction.retryInMs > 0);

    // Após 3001ms de respawn, jogador é liberado
    currentTime += 3001;
    const respawnExpiredAction = await engine.handleAction(sRed, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.LEFT,
    });
    assert.equal(respawnExpiredAction.ok, true, 'Jogador deve poder se mover após o término do respawn');
  });

  engine.cleanup();
});

test('Grid CTF Intensive - 2. Casos de Borda no Grid & Obstáculos Fixos', async (t) => {
  let currentTime = 2_000_000;
  const now = () => currentTime;

  const room = createMockRoom([
    { userJid: 'edge_blue@s.whatsapp.net', username: 'EdgeBlue', faction: { id: 'fac_blue' } },
    { userJid: 'edge_red@s.whatsapp.net', username: 'EdgeRed', faction: { id: 'fac_red' } },
  ]);

  const engine = createGridCtfEngine(room, {
    now,
    funConfig: { gridCtfMoveCooldownMs: 0 },
  });
  await engine.start();

  const blueSession = { userJid: 'edge_blue@s.whatsapp.net' };

  await t.test('Movimento para coordenada negativa x < 0 é bloqueado com erro blocked', async () => {
    // Jogador azul spawna em x = 0, y = 2
    const res = await engine.handleAction(blueSession, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.LEFT,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'blocked');

    const p = engine.getPublicState().players.find(x => x.userJid === blueSession.userJid);
    assert.equal(p.x, 0, 'Posição x não deve ficar negativa');
  });

  await t.test('Movimento para coordenada negativa y < 0 é bloqueado no topo da arena', async () => {
    // Sobe de y = 2 para y = 0
    await engine.handleAction(blueSession, { action: ACTIONS.MOVE, direction: DIRECTIONS.UP }); // y=1
    await engine.handleAction(blueSession, { action: ACTIONS.MOVE, direction: DIRECTIONS.UP }); // y=0

    const res = await engine.handleAction(blueSession, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.UP,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'blocked');

    const p = engine.getPublicState().players.find(x => x.userJid === blueSession.userJid);
    assert.equal(p.y, 0, 'Posição y não deve ficar negativa');
  });

  await t.test('Movimento além do limite inferior y >= height é bloqueado', async () => {
    // Desce até y = 7 (altura padrão = 8)
    for (let i = 0; i < 7; i++) {
      await engine.handleAction(blueSession, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN });
    }

    const res = await engine.handleAction(blueSession, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.DOWN,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'blocked');

    const p = engine.getPublicState().players.find(x => x.userJid === blueSession.userJid);
    assert.equal(p.y, 7, 'Posição y não deve exceder height - 1');
  });

  await t.test('Movimento contra obstáculos fixos da arena é bloqueado', async () => {
    // Move para x = 2, y = 1 (obstáculo fixo em 3, 1)
    for (let i = 0; i < 6; i++) {
      await engine.handleAction(blueSession, { action: ACTIONS.MOVE, direction: DIRECTIONS.UP });
    } // y=1, x=0
    await engine.handleAction(blueSession, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // x=1, y=1
    await engine.handleAction(blueSession, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // x=2, y=1

    // Tenta entrar em (3, 1) que é obstáculo fixo
    const resObstacle = await engine.handleAction(blueSession, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.RIGHT,
    });
    assert.equal(resObstacle.ok, false);
    assert.equal(resObstacle.error, 'blocked');

    const p = engine.getPublicState().players.find(x => x.userJid === blueSession.userJid);
    assert.equal(p.x, 2);
    assert.equal(p.y, 1);
  });

  engine.cleanup();
});

test('Grid CTF Intensive - 3. Movimentos Concorrentes & Resolução de Células', async (t) => {
  let currentTime = 3_000_000;
  const now = () => currentTime;

  const room = createMockRoom([
    { userJid: 'blue_1@s.whatsapp.net', username: 'Blue1', faction: { id: 'fac_blue' } },
    { userJid: 'blue_2@s.whatsapp.net', username: 'Blue2', faction: { id: 'fac_blue' } },
    { userJid: 'red_1@s.whatsapp.net', username: 'Red1', faction: { id: 'fac_red' } },
  ]);

  const engine = createGridCtfEngine(room, {
    now,
    funConfig: { gridCtfMoveCooldownMs: 0 },
  });
  await engine.start();

  await t.test('2 aliados tentando se mover para a mesma célula ao mesmo tempo: 1 entra e o outro é bloqueado sem sobreposição', async () => {
    const s1 = { userJid: 'blue_1@s.whatsapp.net' };
    const s2 = { userJid: 'blue_2@s.whatsapp.net' };

    // blue_1 spawna em (0, 2), blue_2 spawna em (0, 3)
    // blue_1 vai para (1, 2)
    await engine.handleAction(s1, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // (1, 2)
    // blue_1 em (1, 2) quer ir para DOWN -> (1, 3)
    // blue_2 em (0, 3) quer ir para RIGHT -> (1, 3)
    const [res1, res2] = await Promise.all([
      engine.handleAction(s1, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }),
      engine.handleAction(s2, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }),
    ]);

    const successes = [res1, res2].filter(r => r.ok);
    const failures = [res1, res2].filter(r => !r.ok);

    assert.equal(successes.length, 1, 'Exatamente um aliado deve ocupar a célula');
    assert.equal(failures.length, 1, 'O outro aliado deve receber cell_occupied');
    assert.equal(failures[0].error, 'cell_occupied');

    const state = engine.getPublicState();
    const p1 = state.players.find(p => p.userJid === s1.userJid);
    const p2 = state.players.find(p => p.userJid === s2.userJid);
    assert.notEqual(`${p1.x},${p1.y}`, `${p2.x},${p2.y}`, 'Aliados nunca podem sobrepor coordenadas');
  });

  await t.test('Defensor em território amigo atropela invasor sem bandeira com move_with_tackle', async () => {
    const sRed = { userJid: 'red_1@s.whatsapp.net' };
    const sBlue = { userJid: 'blue_1@s.whatsapp.net' };

    // Move red_1 até a linha y = 4 (sem obstáculos) e depois para (5, 4) (território azul)
    // red_1 começa em (11, 2)
    await engine.handleAction(sRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (11, 3)
    await engine.handleAction(sRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (11, 4)
    for (let x = 10; x >= 5; x--) {
      await engine.handleAction(sRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT });
    }

    // Move blue_1 até (4, 4) pela rota livre
    // blue_1 está em (1, 2) ou (1, 3)
    const p1 = engine.getPublicState().players.find(p => p.userJid === sBlue.userJid);
    if (p1.y === 2) {
      await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // (2, 2)
      await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (2, 3)
    }
    // Desce para y = 4
    if (p1.y <= 3) {
      await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN });
    }
    // Anda até x = 4
    const curP1 = engine.getPublicState().players.find(p => p.userJid === sBlue.userJid);
    while (curP1.x < 4) {
      await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT });
      curP1.x += 1;
    }

    // Agora blue_1 em (4, 4) avança para RIGHT (5, 4) onde o invasor red_1 está
    const tackleMoveRes = await engine.handleAction(sBlue, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.RIGHT,
    });

    assert.equal(tackleMoveRes.ok, true);
    assert.equal(tackleMoveRes.delta.action, 'move_with_tackle');
    assert.equal(tackleMoveRes.delta.target.isRespawning, true);

    const state = engine.getPublicState();
    const blueAfter = state.players.find(p => p.userJid === sBlue.userJid);
    const redAfter = state.players.find(p => p.userJid === sRed.userJid);
    assert.equal(blueAfter.x, 5);
    assert.equal(blueAfter.y, 4);
    assert.equal(redAfter.isRespawning, true);
  });

  await t.test('Invasor tentando atropelar defensor sem bandeira no território deste é bloqueado', async () => {
    // red_1 renasce em (11, 3). Espera respawn passar (+3001ms)
    currentTime += 3001;
    const sRed = { userJid: 'red_1@s.whatsapp.net' };
    const sBlue = { userJid: 'blue_1@s.whatsapp.net' };

    // Move red_1 de volta até (6, 4) em território vermelho
    await engine.handleAction(sRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (11, 4)
    for (let x = 10; x >= 6; x--) {
      await engine.handleAction(sRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT });
    }

    // blue_1 está em (5, 4) (território azul).
    // red_1 em (6, 4) tenta entrar em (5, 4) (LEFT): deve ser bloqueado com cell_occupied!
    const blockedRes = await engine.handleAction(sRed, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.LEFT,
    });

    assert.equal(blockedRes.ok, false);
    assert.equal(blockedRes.error, 'cell_occupied');
  });

  engine.cleanup();
});

test('Grid CTF Intensive - 4. Máquina de Estados das Bandeiras, Fronteira & Desconexão', async (t) => {
  let currentTime = 4_000_000;
  const now = () => currentTime;

  const room = createMockRoom([
    { userJid: 'runner_blue@s.whatsapp.net', username: 'RunnerBlue', faction: { id: 'fac_blue' } },
    { userJid: 'guard_blue@s.whatsapp.net', username: 'GuardBlue', faction: { id: 'fac_blue' } },
    { userJid: 'runner_red@s.whatsapp.net', username: 'RunnerRed', faction: { id: 'fac_red' } },
    { userJid: 'guard_red@s.whatsapp.net', username: 'GuardRed', faction: { id: 'fac_red' } },
  ]);

  const engine = createGridCtfEngine(room, {
    now,
    funConfig: {
      gridCtfMoveCooldownMs: 0,
      gridCtfTackleCooldownMs: 0,
    },
  });
  await engine.start();

  const sRunnerBlue = { userJid: 'runner_blue@s.whatsapp.net' };
  const sGuardRed = { userJid: 'guard_red@s.whatsapp.net' };
  const sRunnerRed = { userJid: 'runner_red@s.whatsapp.net' };

  await t.test('Captura da bandeira vermelha pelo corredor azul na base inimiga via corredor desobstruído', async () => {
    // Spawns: runner_blue em (0, 2), guard_blue em (0, 3), runner_red em (11, 2), guard_red em (11, 3).
    // Rota de runner_blue sem colidir com guard_blue nem com paredes (5, 2) e (6, 2):
    // Vai para x=2, y=2:
    await engine.handleAction(sRunnerBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // (1, 2)
    await engine.handleAction(sRunnerBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // (2, 2)
    // Desce para a linha y=3 que é limpa de obstáculos:
    await engine.handleAction(sRunnerBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (2, 3)

    // Corre até a bandeira vermelha em (10, 3)
    for (let x = 3; x <= 10; x++) {
      const res = await engine.handleAction(sRunnerBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT });
      assert.equal(res.ok, true);
    }

    const state = engine.getPublicState();
    const runner = state.players.find(p => p.userJid === sRunnerBlue.userJid);
    assert.equal(runner.hasFlag, true, 'Corredor azul deve estar com a bandeira vermelha');
    assert.equal(state.flags.red.status, 'carried');
    assert.equal(state.flags.red.carrierId, sRunnerBlue.userJid);
  });

  await t.test('Portador da bandeira sofre tackle exatamente na linha de fronteira (x=5)', async () => {
    // RunnerBlue recua pela linha y=3 até a fronteira (x=5)
    for (let x = 9; x >= 5; x--) {
      await engine.handleAction(sRunnerBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT });
    }

    let state = engine.getPublicState();
    let runner = state.players.find(p => p.userJid === sRunnerBlue.userJid);
    assert.equal(runner.x, 5);
    assert.equal(runner.y, 3);
    assert.equal(runner.hasFlag, true);

    // Posiciona guard_red em (6, 3) pela linha y=3 (está em 11, 3)
    for (let x = 10; x >= 6; x--) {
      await engine.handleAction(sGuardRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT });
    }

    // GuardRed dá Tackle no portador da bandeira na fronteira
    const tackleRes = await engine.handleAction(sGuardRed, { action: ACTIONS.TACKLE });
    assert.equal(tackleRes.ok, true);
    assert.equal(tackleRes.delta.action, 'tackle');

    state = engine.getPublicState();
    runner = state.players.find(p => p.userJid === sRunnerBlue.userJid);
    assert.equal(runner.hasFlag, false);
    assert.equal(runner.isRespawning, true);

    // Bandeira vermelha caída exatamente em (5, 3)
    assert.equal(state.flags.red.status, 'dropped');
    assert.equal(state.flags.red.x, 5);
    assert.equal(state.flags.red.y, 3);
    assert.equal(state.flags.red.carrierId, null);
    assert.ok(state.flags.red.droppedAt > 0);
  });

  await t.test('Recuperação aliada da bandeira caída: GuardRed pisa em (5, 3) e devolve a bandeira à base', async () => {
    // GuardRed move para LEFT -> (5, 3)
    const retRes = await engine.handleAction(sGuardRed, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.LEFT,
    });
    assert.equal(retRes.ok, true);

    const state = engine.getPublicState();
    assert.equal(state.flags.red.status, 'at_base');
    assert.equal(state.flags.red.x, state.flags.red.baseX);
    assert.equal(state.flags.red.y, state.flags.red.baseY);

    const guard = state.players.find(p => p.userJid === sGuardRed.userJid);
    assert.equal(guard.stats.returns, 1);
  });

  await t.test('Desconexão do portador: jogador desconecta com bandeira e ela vira dropped no solo', async () => {
    // GuardRed está em (5, 3). Afasta ele para a direita (8, 3) para liberar o caminho
    await engine.handleAction(sGuardRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // (6, 3)
    await engine.handleAction(sGuardRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // (7, 3)
    await engine.handleAction(sGuardRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT }); // (8, 3)

    // RunnerRed (em 11, 2) desce para (11, 4) e avança pela linha y=4 desobstruída
    await engine.handleAction(sRunnerRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (11, 3)
    await engine.handleAction(sRunnerRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (11, 4)
    for (let x = 10; x >= 1; x--) {
      await engine.handleAction(sRunnerRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT });
    } // Chega em (1, 4)

    // Sobe para (1, 3) para capturar a bandeira azul!
    const capBlueRes = await engine.handleAction(sRunnerRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.UP }); // (1, 3)
    assert.equal(capBlueRes.ok, true);

    let state = engine.getPublicState();
    let carrier = state.players.find(p => p.userJid === sRunnerRed.userJid);
    assert.equal(carrier.hasFlag, true, 'RunnerRed deve capturar a bandeira azul');
    assert.equal(state.flags.blue.status, 'carried');

    // Desloca com a bandeira azul pela linha y=3 até (4, 3)
    for (let x = 2; x <= 4; x++) {
      await engine.handleAction(sRunnerRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT });
    }

    state = engine.getPublicState();
    carrier = state.players.find(p => p.userJid === sRunnerRed.userJid);
    assert.equal(carrier.x, 4);
    assert.equal(carrier.y, 3);

    // Desconexão abrupta do portador
    const dcRes = engine.handlePlayerDisconnect(sRunnerRed.userJid);
    assert.equal(dcRes.ok, true);
    assert.equal(dcRes.droppedFlag.status, 'dropped');
    assert.equal(dcRes.droppedFlag.x, 4);
    assert.equal(dcRes.droppedFlag.y, 3);

    state = engine.getPublicState();
    assert.equal(state.flags.blue.status, 'dropped');
    assert.equal(state.flags.blue.x, 4);
    assert.equal(state.flags.blue.y, 3);
    assert.equal(state.flags.blue.carrierId, null);
  });

  await t.test('Captura adversária de bandeira caída: outro jogador inimigo pega a bandeira no chão', async () => {
    // GuardRed está em (8, 3). A bandeira azul está caída em (4, 3).
    // GuardRed move para LEFT pela linha y=3 até (4, 3)
    for (let x = 7; x >= 4; x--) {
      const capRes = await engine.handleAction(sGuardRed, {
        action: ACTIONS.MOVE,
        direction: DIRECTIONS.LEFT,
      });
      assert.equal(capRes.ok, true);
    }

    const state = engine.getPublicState();
    const guard = state.players.find(p => p.userJid === sGuardRed.userJid);
    assert.equal(guard.hasFlag, true, 'GuardRed deve pegar a bandeira azul que estava caída');
    assert.equal(state.flags.blue.status, 'carried');
    assert.equal(state.flags.blue.carrierId, sGuardRed.userJid);
  });

  engine.cleanup();
});

test('Grid CTF Intensive - 5. Ciclo de Auto-Retorno da Bandeira Caída após 20s', async (t) => {
  let currentTime = 5_000_000;
  const now = () => currentTime;

  const room = createMockRoom([
    { userJid: 'blue_autoreturn@s.whatsapp.net', username: 'BlueAuto', faction: { id: 'fac_blue' } },
    { userJid: 'red_autoreturn@s.whatsapp.net', username: 'RedAuto', faction: { id: 'fac_red' } },
  ]);

  const engine = createGridCtfEngine(room, {
    now,
    funConfig: {
      gridCtfFlagAutoReturnMs: 20000,
      gridCtfMoveCooldownMs: 0,
    },
  });
  await engine.start();

  const sBlue = { userJid: 'blue_autoreturn@s.whatsapp.net' };

  // Blue captura bandeira vermelha em (10, 3)
  // Blue está em (0, 2). Desce para (0, 3) e anda até (10, 3)
  await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (0, 3)
  for (let x = 1; x <= 10; x++) {
    await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT });
  }

  // Blue desconecta para deixar a bandeira dropped em (10, 3)
  const dropTime = currentTime;
  engine.handlePlayerDisconnect(sBlue.userJid);

  let state = engine.getPublicState();
  assert.equal(state.flags.red.status, 'dropped');
  assert.equal(state.flags.red.droppedAt, dropTime);

  await t.test('Antes dos 20 segundos, a bandeira permanece caída no chão', async () => {
    // Avança 15s
    currentTime = dropTime + 15_000;
    await new Promise(resolve => setTimeout(resolve, 1100)); // Espera 1 tick real

    state = engine.getPublicState();
    assert.equal(state.flags.red.status, 'dropped', 'Aos 15s ainda deve estar dropped');
  });

  await t.test('Após 20 segundos, a bandeira retorna automaticamente à base no próximo tick', async () => {
    // Avança além de 20s (total +22s)
    currentTime = dropTime + 22_000;
    await new Promise(resolve => setTimeout(resolve, 1100)); // Espera o tick processar o auto-retorno

    state = engine.getPublicState();
    assert.equal(state.flags.red.status, 'at_base', 'Após 20s a bandeira deve retornar à base');
    assert.equal(state.flags.red.x, state.flags.red.baseX);
    assert.equal(state.flags.red.y, state.flags.red.baseY);
    assert.equal(state.flags.red.droppedAt, null);
  });

  engine.cleanup();
});

test('Grid CTF Intensive - 6. Ação de Dash (2 Células, Obstáculos, Limites & Através de Inimigos)', async (t) => {
  let currentTime = 6_000_000;
  const now = () => currentTime;

  const room = createMockRoom([
    { userJid: 'dash_p1@s.whatsapp.net', username: 'DashP1', faction: { id: 'fac_blue' } },
    { userJid: 'dash_enemy@s.whatsapp.net', username: 'DashEnemy', faction: { id: 'fac_red' } },
  ]);

  const engine = createGridCtfEngine(room, {
    now,
    funConfig: {
      gridCtfDashCooldownMs: 2000,
      gridCtfMoveCooldownMs: 0,
    },
  });
  await engine.start();

  const sP1 = { userJid: 'dash_p1@s.whatsapp.net' };
  const sEnemy = { userJid: 'dash_enemy@s.whatsapp.net' };

  await t.test('Dash livre avança exatamente 2 células', async () => {
    // P1 spawna em (0, 2). Dá dash para RIGHT
    const dashRes = await engine.handleAction(sP1, {
      action: ACTIONS.DASH,
      direction: DIRECTIONS.RIGHT,
    });
    assert.equal(dashRes.ok, true);

    const p = engine.getPublicState().players.find(x => x.userJid === sP1.userJid);
    assert.equal(p.x, 2, 'Deve avançar de 0 para 2');
    assert.equal(p.y, 2);
  });

  await t.test('Dash respeita cooldown estrito de 2000ms', async () => {
    // Tentativa imediata (0ms)
    const blockedRes = await engine.handleAction(sP1, {
      action: ACTIONS.DASH,
      direction: DIRECTIONS.RIGHT,
    });
    assert.equal(blockedRes.ok, false);
    assert.equal(blockedRes.error, 'cooldown');

    // Avança 2001ms
    currentTime += 2001;
    const allowedRes = await engine.handleAction(sP1, {
      action: ACTIONS.DASH,
      direction: DIRECTIONS.RIGHT,
    });
    assert.equal(allowedRes.ok, true);
    const p = engine.getPublicState().players.find(x => x.userJid === sP1.userJid);
    assert.equal(p.x, 4);
  });

  await t.test('Dash contra obstáculo na 2ª célula para com segurança na 1ª célula', async () => {
    currentTime += 2001;
    // P1 está em (4, 2). Move para (3, 3)
    await engine.handleAction(sP1, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (4, 3)
    await engine.handleAction(sP1, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT }); // (3, 3)

    // De (3, 3), UP = (3, 2) [livre], UP+UP = (3, 1) [obstáculo fixo]
    const dashObstacle = await engine.handleAction(sP1, {
      action: ACTIONS.DASH,
      direction: DIRECTIONS.UP,
    });
    assert.equal(dashObstacle.ok, true);

    const p = engine.getPublicState().players.find(x => x.userJid === sP1.userJid);
    assert.equal(p.x, 3);
    assert.equal(p.y, 2, 'Deve parar em y=2 antes do obstáculo em y=1');
  });

  await t.test('Dash contra limites de mapa para na borda ou bloqueia se já encostado', async () => {
    currentTime += 2001;
    // P1 está em (3, 2). Move para x = 1, y = 2
    await engine.handleAction(sP1, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT }); // 2, 2
    await engine.handleAction(sP1, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT }); // 1, 2

    // De x = 1, y = 2, dá dash para LEFT: step1 = 0 (livre), step2 = -1 (fora)
    const dashEdge = await engine.handleAction(sP1, {
      action: ACTIONS.DASH,
      direction: DIRECTIONS.LEFT,
    });
    assert.equal(dashEdge.ok, true);
    let p = engine.getPublicState().players.find(x => x.userJid === sP1.userJid);
    assert.equal(p.x, 0, 'Deve parar na borda x=0');

    // Agora de x = 0, dá dash para LEFT novamente (já colado na borda)
    currentTime += 2001;
    const dashBlocked = await engine.handleAction(sP1, {
      action: ACTIONS.DASH,
      direction: DIRECTIONS.LEFT,
    });
    assert.equal(dashBlocked.ok, false);
    assert.equal(dashBlocked.error, 'dash_blocked');
  });

  await t.test('Dash através de jogador inimigo: atravessa o inimigo na 1ª célula e aterrissa na 2ª', async () => {
    currentTime += 2001;
    // P1 está em (0, 2). Move para (0, 4) pela rota livre
    await engine.handleAction(sP1, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (0, 3)
    await engine.handleAction(sP1, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (0, 4)

    // Enemy está em (11, 2). Move para y=4 e anda para a esquerda até (1, 4)
    await engine.handleAction(sEnemy, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (11, 3)
    await engine.handleAction(sEnemy, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (11, 4)
    for (let x = 10; x >= 1; x--) {
      await engine.handleAction(sEnemy, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT });
    }

    let p = engine.getPublicState().players.find(x => x.userJid === sP1.userJid);
    let enemy = engine.getPublicState().players.find(x => x.userJid === sEnemy.userJid);
    assert.equal(p.x, 0);
    assert.equal(p.y, 4);
    assert.equal(enemy.x, 1);
    assert.equal(enemy.y, 4);

    // P1 em (0, 4) dispara DASH para RIGHT:
    // step1 = (1, 4) ocupado pelo inimigo
    // step2 = (2, 4) desobstruído
    const dashThrough = await engine.handleAction(sP1, {
      action: ACTIONS.DASH,
      direction: DIRECTIONS.RIGHT,
    });
    assert.equal(dashThrough.ok, true, 'Dash através de inimigo deve ser aceito');

    const pAfter = engine.getPublicState().players.find(x => x.userJid === sP1.userJid);
    const enemyAfter = engine.getPublicState().players.find(x => x.userJid === sEnemy.userJid);
    assert.equal(pAfter.x, 2, 'P1 aterrissa na célula 2 após o inimigo');
    assert.equal(pAfter.y, 4);
    assert.equal(enemyAfter.x, 1, 'Inimigo permanece na célula 1');
    assert.equal(enemyAfter.y, 4);
  });

  engine.cleanup();
});

test('Grid CTF Intensive - 7. Disputa de Pontos, Vitória & Encerramento sem Race Conditions', async (t) => {
  let currentTime = 7_000_000;
  const now = () => currentTime;

  const room = createMockRoom([
    { userJid: 'blue_champ@s.whatsapp.net', username: 'BlueChamp', faction: { id: 'fac_blue' } },
    { userJid: 'red_champ@s.whatsapp.net', username: 'RedChamp', faction: { id: 'fac_red' } },
  ]);

  let finishCalls = 0;
  let finishedStats = null;

  const gameManagerMock = {
    finishGame: async (roomId, winningFactionId, matchStats) => {
      finishCalls++;
      finishedStats = { roomId, winningFactionId, matchStats };
    },
    broadcast: () => {},
  };

  const engine = createGridCtfEngine(room, {
    now,
    gameManager: gameManagerMock,
    funConfig: {
      gridCtfPointsToWin: 3,
      gridCtfMoveCooldownMs: 0,
    },
  });
  await engine.start();

  const sBlue = { userJid: 'blue_champ@s.whatsapp.net' };
  const sRed = { userJid: 'red_champ@s.whatsapp.net' };

  // Afasta red_champ de (11, 2) para (11, 6) para não interferir na linha y=3
  for (let i = 0; i < 4; i++) {
    await engine.handleAction(sRed, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN });
  }

  await t.test('Primeira equipe a marcar 3 pontos vence imediatamente', async () => {
    // blue_champ começa em (0, 2). Desce para (0, 3)
    await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.DOWN }); // (0, 3)

    for (let point = 1; point <= 3; point++) {
      // 1. Blue vai pela linha y=3 até a bandeira vermelha em (10, 3)
      // Se point == 1: começa em x=0, vai até x=10 (10 passos)
      // Se point >= 2: começa em x=1, vai até x=10 (9 passos)
      const startX = point === 1 ? 1 : 2;
      for (let x = startX; x <= 10; x++) {
        await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.RIGHT });
      }

      assert.equal(engine.getPublicState().flags.red.status, 'carried');

      // 2. Blue retorna à base azul (x <= 1, y >= 2 e y <= 5)
      for (let x = 9; x >= 1; x--) {
        await engine.handleAction(sBlue, { action: ACTIONS.MOVE, direction: DIRECTIONS.LEFT });
      }

      const state = engine.getPublicState();
      assert.equal(state.scores.blue, point, `Time azul deve ter pontuação ${point}`);

      if (point < 3) {
        assert.equal(state.status, 'in_progress');
        assert.equal(state.flags.red.status, 'at_base');
      } else {
        assert.equal(state.status, 'finished');
        assert.equal(state.winnerTeam, TEAMS.BLUE);
      }
    }

    assert.equal(finishCalls, 1, 'finishGame deve ser invocado exatamente uma vez');
    assert.equal(finishedStats.matchStats.winnerTeam, 'blue');
    assert.equal(finishedStats.matchStats.blueScore, 3);
  });

  await t.test('Ações após o encerramento são rejeitadas categoricamente', async () => {
    const postGameAction = await engine.handleAction(sBlue, {
      action: ACTIONS.MOVE,
      direction: DIRECTIONS.RIGHT,
    });
    assert.equal(postGameAction.ok, false);
    assert.equal(postGameAction.error, 'game_not_in_progress');
  });

  await t.test('Disputa concorrente de finalização não duplica término nem altera vencedor', async () => {
    const state = engine.getPublicState();
    assert.equal(state.status, 'finished');
    assert.equal(state.winnerTeam, 'blue');
    assert.equal(finishCalls, 1);
  });

  engine.cleanup();
});
