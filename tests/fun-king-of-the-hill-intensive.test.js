import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createKingOfTheHillEngine,
  renderProgressBar,
  DEFAULT_ZONES,
  KOTH_CONSTANTS,
} from '../fun/games/engines/kingOfTheHillEngine.js';

/**
 * Cria uma sala simulada com 8 jogadores distribuídos em duas panelinhas rivais.
 * Panelinha 1: 'fac_tigres' (Tigres Dourados 🐯, 4 jogadores)
 * Panelinha 2: 'fac_dragoes' (Dragões de Fogo 🐉, 4 jogadores)
 */
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

  // Jogadores 1 a 4 (Tigres Dourados)
  for (let i = 1; i <= 4; i++) {
    const jid = `p${i}@s.whatsapp.net`;
    room.players.set(jid, {
      userJid: jid,
      username: `Tigre_${i}`,
      faction: { id: 'fac_tigres', name: 'Tigres Dourados', emoji: '🐯' },
      score: 0,
    });
  }

  // Jogadores 5 a 8 (Dragões de Fogo)
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

test('KOTH Intensivo - Concorrência de Zonas com 8 jogadores simultâneos via Promise.all', async () => {
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

  // Rodada Concorrente 1: Todos os 8 jogadores entram em zonas simultaneamente
  // p1, p2, p5 -> Zona A
  // p3, p6, p7 -> Zona B
  // p4, p8     -> Zona C
  const targetZonesRound1 = ['A', 'A', 'B', 'C', 'A', 'B', 'B', 'C'];
  const enterPromises = sessions.map((sess, idx) =>
    engine.handleAction(sess, { action: 'entered_zone', zoneId: targetZonesRound1[idx] })
  );
  const enterResults = await Promise.all(enterPromises);

  for (const res of enterResults) {
    assert.equal(res.ok, true, 'Todos os jogadores devem conseguir entrar na zona com sucesso');
  }

  let state = engine.getPublicState();
  assert.equal(state.zones.A.playersCount, 3); // p1, p2, p5
  assert.equal(state.zones.B.playersCount, 3); // p3, p6, p7
  assert.equal(state.zones.C.playersCount, 2); // p4, p8

  // Rodada Concorrente 2: Transição concorrente maciça (troca cruzada de zonas e saídas simultâneas)
  // p1 sai para fora de zona (left_zone)
  // p2 move-se de A para B
  // p5 move-se de A para C
  // p3 move-se de B para A
  // p6 sai para fora de zona (left_zone)
  // p7 permanece em B (re-entra idempotente)
  // p4 permanece em C
  // p8 move-se de C para A
  const actionsRound2 = [
    engine.handleAction(sessions[0], { action: 'left_zone', zoneId: 'A' }),
    engine.handleAction(sessions[1], { action: 'entered_zone', zoneId: 'B' }),
    engine.handleAction(sessions[4], { action: 'entered_zone', zoneId: 'C' }),
    engine.handleAction(sessions[2], { action: 'entered_zone', zoneId: 'A' }),
    engine.handleAction(sessions[5], { action: 'left_zone', zoneId: 'B' }),
    engine.handleAction(sessions[6], { action: 'entered_zone', zoneId: 'B' }),
    engine.handleAction(sessions[3], { action: 'entered_zone', zoneId: 'C' }),
    engine.handleAction(sessions[7], { action: 'entered_zone', zoneId: 'A' }),
  ];

  const resultsRound2 = await Promise.all(actionsRound2);
  for (const res of resultsRound2) {
    assert.equal(res.ok, true);
  }

  state = engine.getPublicState();
  // Invariante de Concorrência: A soma de jogadores nas zonas + fora de zonas deve ser rigorosamente 8
  const playersInA = state.zones.A.playersCount; // p3 (A), p8 (A) -> 2
  const playersInB = state.zones.B.playersCount; // p2 (B), p7 (B) -> 2
  const playersInC = state.zones.C.playersCount; // p5 (C), p4 (C) -> 2
  const outsidePlayers = state.players.filter(p => p.currentZoneId === null).length; // p1, p6 -> 2

  assert.equal(playersInA + playersInB + playersInC + outsidePlayers, 8);
  assert.equal(outsidePlayers, 2);

  // Nenhum jogador pode estar presente em mais de uma zona simultaneamente
  const zoneASet = engine._zones.get('A').playersPresent;
  const zoneBSet = engine._zones.get('B').playersPresent;
  const zoneCSet = engine._zones.get('C').playersPresent;

  for (const jid of zoneASet) {
    assert.equal(zoneBSet.has(jid), false, `Jogador ${jid} não pode estar em A e B ao mesmo tempo`);
    assert.equal(zoneCSet.has(jid), false, `Jogador ${jid} não pode estar em A e C ao mesmo tempo`);
  }
  for (const jid of zoneBSet) {
    assert.equal(zoneCSet.has(jid), false, `Jogador ${jid} não pode estar em B e C ao mesmo tempo`);
  }

  engine.cleanup();
});

test('KOTH Intensivo - Casos de empate e contestação extrema (Zona A: 2v2, Zona B: 1v1, Zona C: 0v0)', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMock8PlayerRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  // Tigres: p1, p2, p3, p4
  // Dragões: p5, p6, p7, p8
  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p2 = { userJid: 'p2@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p3 = { userJid: 'p3@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p4 = { userJid: 'p4@s.whatsapp.net', faction: { id: 'fac_tigres' } };

  const p5 = { userJid: 'p5@s.whatsapp.net', faction: { id: 'fac_dragoes' } };
  const p6 = { userJid: 'p6@s.whatsapp.net', faction: { id: 'fac_dragoes' } };
  const p7 = { userJid: 'p7@s.whatsapp.net', faction: { id: 'fac_dragoes' } };
  const p8 = { userJid: 'p8@s.whatsapp.net', faction: { id: 'fac_dragoes' } };

  // Zona A: 2v2 (p1, p2 vs p5, p6) -> CONTESTADA
  await engine.handleAction(p1, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p2, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p5, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p6, { action: 'entered_zone', zoneId: 'A' });

  // Zona B: 1v1 (p3 vs p7) -> CONTESTADA
  await engine.handleAction(p3, { action: 'entered_zone', zoneId: 'B' });
  await engine.handleAction(p7, { action: 'entered_zone', zoneId: 'B' });

  // Zona C: 0v0 (vazia) -> NEUTRA
  // p4 e p8 estão fora de qualquer zona

  // Avalia 3 ticks consecutivos sob contestação extrema
  for (let tick = 1; tick <= 3; tick++) {
    simulatedTime += 2000;
    engine._evaluateZonesTick();

    const state = engine.getPublicState();
    assert.equal(state.zones.A.status, 'contested', `Tick ${tick}: Zona A deve permanecer contestada (2v2)`);
    assert.equal(state.zones.A.controllingFactionId, null);

    assert.equal(state.zones.B.status, 'contested', `Tick ${tick}: Zona B deve permanecer contestada (1v1)`);
    assert.equal(state.zones.B.controllingFactionId, null);

    assert.equal(state.zones.C.status, 'neutral', `Tick ${tick}: Zona C deve permanecer neutra (0v0)`);
    assert.equal(state.zones.C.controllingFactionId, null);

    // Ambas as panelinhas devem permanecer rigorosamente com 0% de controle
    const tigresProgress = state.factionProgress.find(f => f.id === 'fac_tigres').progress;
    const dragoesProgress = state.factionProgress.find(f => f.id === 'fac_dragoes').progress;
    assert.equal(tigresProgress, 0, `Nenhum ponto deve ser concedido sob contestação (Tick ${tick})`);
    assert.equal(dragoesProgress, 0, `Nenhum ponto deve ser concedido sob contestação (Tick ${tick})`);
  }

  // Desempate cirúrgico em tempo de execução:
  // p4 (Tigre) entra na Zona A -> Zona A torna-se 3v2 (maioria estrita para Tigres)
  await engine.handleAction(p4, { action: 'entered_zone', zoneId: 'A' });

  // p8 (Dragão) entra na Zona C -> Zona C torna-se 1v0 (maioria estrita para Dragões)
  await engine.handleAction(p8, { action: 'entered_zone', zoneId: 'C' });

  // Zona B continua 1v1 (contestado)
  simulatedTime += 2000;
  engine._evaluateZonesTick();

  const finalState = engine.getPublicState();
  assert.equal(finalState.zones.A.status, 'controlled');
  assert.equal(finalState.zones.A.controllingFactionId, 'fac_tigres');

  assert.equal(finalState.zones.B.status, 'contested');
  assert.equal(finalState.zones.B.controllingFactionId, null);

  assert.equal(finalState.zones.C.status, 'controlled');
  assert.equal(finalState.zones.C.controllingFactionId, 'fac_dragoes');

  // Cada panelinha dominou exatamente 1 zona neste tick (+2% para cada)
  assert.equal(finalState.factionProgress.find(f => f.id === 'fac_tigres').progress, 2);
  assert.equal(finalState.factionProgress.find(f => f.id === 'fac_dragoes').progress, 2);

  engine.cleanup();
});

test('KOTH Intensivo - Concorrência de habilidades táticas: resolução de push, shield e shockwave no mesmo instante', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMock8PlayerRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p2 = { userJid: 'p2@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p5 = { userJid: 'p5@s.whatsapp.net', faction: { id: 'fac_dragoes' } };
  const p6 = { userJid: 'p6@s.whatsapp.net', faction: { id: 'fac_dragoes' } };

  // Posiciona p1, p2, p5, p6 na Zona A
  await engine.handleAction(p1, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p2, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p5, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p6, { action: 'entered_zone', zoneId: 'A' });

  // Cenário 1: Concorrência Simultânea - p5 aciona SHIELD e p1 aciona PUSH em p5 ao mesmo tempo
  const [shieldP5Result, pushP1Result] = await Promise.all([
    engine.handleAction(p5, { action: 'use_ability', ability: 'shield' }),
    engine.handleAction(p1, { action: 'use_ability', ability: 'push', targetPlayerId: 'p5@s.whatsapp.net' }),
  ]);

  assert.equal(shieldP5Result.ok, true);
  assert.equal(pushP1Result.ok, true);
  // O push deve ter sido bloqueado pelo escudo de p5
  assert.equal(pushP1Result.blocked, true);
  assert.equal(engine._playerStates.get('p5@s.whatsapp.net').currentZoneId, 'A', 'p5 deve permanecer na Zona A com o escudo');

  // p1 acabou de gastar seu push, confirmando que está em cooldown
  const cooldownPush = await engine.handleAction(p1, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p6@s.whatsapp.net',
  });
  assert.equal(cooldownPush.ok, false);
  assert.equal(cooldownPush.error, 'ability_on_cooldown');

  // Cenário 2: Validações de Auto-Alvo e Fogo Amigo (utilizando p2, cujo push está pronto)
  const selfPush = await engine.handleAction(p2, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p2@s.whatsapp.net',
  });
  assert.equal(selfPush.ok, false);
  assert.equal(selfPush.error, 'self_target');

  const friendlyPush = await engine.handleAction(p2, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p1@s.whatsapp.net',
  });
  assert.equal(friendlyPush.ok, false);
  assert.equal(friendlyPush.error, 'same_team');

  // Cenário 3: Resolução de SHOCKWAVE com alvos múltiplos na mesma zona
  // Na Zona A estão: p1 (conjurador Tigre), p2 (colega Tigre), p5 (inimigo Dragão com escudo), p6 (inimigo Dragão desprotegido)
  // Avança o tempo para liberar o cooldown de habilidades de p1, mas mantendo o escudo de p5 ativo
  // Escudo dura 4000ms. Cooldown de shockwave começa zerado no início do jogo.
  const shockwaveResult = await engine.handleAction(p1, {
    action: 'use_ability',
    ability: 'shockwave',
  });

  assert.equal(shockwaveResult.ok, true);
  assert.equal(shockwaveResult.ability, 'shockwave');
  assert.equal(shockwaveResult.zoneId, 'A');
  // Apenas p6 deve ser afetado e expulso:
  // p2 não é afetado porque é do mesmo time (Tigres)
  // p5 não é afetado porque está com escudo protetor ativo
  // p6 é do time rival e desprotegido -> ejetado!
  assert.equal(shockwaveResult.affectedCount, 1);

  const stateAfterWave = engine.getPublicState();
  const p1Current = stateAfterWave.players.find(p => p.userJid === 'p1@s.whatsapp.net');
  const p2Current = stateAfterWave.players.find(p => p.userJid === 'p2@s.whatsapp.net');
  const p5Current = stateAfterWave.players.find(p => p.userJid === 'p5@s.whatsapp.net');
  const p6Current = stateAfterWave.players.find(p => p.userJid === 'p6@s.whatsapp.net');

  assert.equal(p1Current.currentZoneId, 'A');
  assert.equal(p2Current.currentZoneId, 'A');
  assert.equal(p5Current.currentZoneId, 'A', 'Jogador com escudo deve resistir à onda de choque');
  assert.equal(p6Current.currentZoneId, null, 'Jogador sem escudo deve ser ejetado para fora da zona');

  // Cenário 4: Shockwave disparado fora de qualquer zona
  const p4 = { userJid: 'p4@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const shockOutside = await engine.handleAction(p4, { action: 'use_ability', ability: 'shockwave' });
  assert.equal(shockOutside.ok, true);
  assert.equal(shockOutside.zoneId, null);
  assert.equal(shockOutside.affectedCount, 0);

  engine.cleanup();
});

test('KOTH Intensivo - Jogador eliminado tentando enviar eventos de zona ou habilidades antes de concluir o respawn de 5 segundos', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMock8PlayerRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p5 = { userJid: 'p5@s.whatsapp.net', faction: { id: 'fac_dragoes' } };
  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p6 = { userJid: 'p6@s.whatsapp.net', faction: { id: 'fac_dragoes' } };

  await engine.handleAction(p5, { action: 'entered_zone', zoneId: 'B' });

  // 1. Elimina p5 por p1 (Tigre)
  const elimRes = await engine.handleAction(p5, {
    action: 'eliminated',
    zoneId: 'B',
    byPlayerId: 'p1@s.whatsapp.net',
  });
  assert.equal(elimRes.ok, true);
  assert.equal(elimRes.respawnDurationMs, 5000);

  // Verifica que p1 computou a kill e p5 computou a morte
  const stateElim = engine.getPublicState();
  const p1State = stateElim.players.find(p => p.userJid === 'p1@s.whatsapp.net');
  const p5State = stateElim.players.find(p => p.userJid === 'p5@s.whatsapp.net');
  assert.equal(p1State.kills, 1);
  assert.equal(p5State.deaths, 1);
  assert.equal(p5State.isAlive, false);
  assert.equal(p5State.currentZoneId, null);

  // 2. Tenta enviar evento de zona antes dos 5s decorridos (ex: aos 2000ms de respawn)
  simulatedTime += 2000;
  const deadEnterZone = await engine.handleAction(p5, { action: 'entered_zone', zoneId: 'B' });
  assert.equal(deadEnterZone.ok, false);
  assert.equal(deadEnterZone.error, 'player_dead');

  // 3. Tenta usar habilidades antes de reviver
  const deadUsePush = await engine.handleAction(p5, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p1@s.whatsapp.net',
  });
  assert.equal(deadUsePush.ok, false);
  assert.equal(deadUsePush.error, 'player_dead');

  const deadUseShield = await engine.handleAction(p5, { action: 'use_ability', ability: 'shield' });
  assert.equal(deadUseShield.ok, false);
  assert.equal(deadUseShield.error, 'player_dead');

  const deadUseWave = await engine.handleAction(p5, { action: 'use_ability', ability: 'shockwave' });
  assert.equal(deadUseWave.ok, false);
  assert.equal(deadUseWave.error, 'player_dead');

  // 4. Outro jogador tenta empurrar o jogador eliminado
  const pushDeadTarget = await engine.handleAction(p1, {
    action: 'use_ability',
    ability: 'push',
    targetPlayerId: 'p5@s.whatsapp.net',
  });
  assert.equal(pushDeadTarget.ok, false);
  assert.equal(pushDeadTarget.error, 'target_not_available');

  // 5. Tenta sofrer eliminação duplicada enquanto já está morto
  const doubleElim = await engine.handleAction(p5, { action: 'eliminated' });
  assert.equal(doubleElim.ok, false);
  assert.equal(doubleElim.error, 'already_eliminated');

  // 6. Teste de fogo amigo: p6 (Dragão) tenta "eliminar" seu colega de equipe p7 (Dragão)
  const p7 = { userJid: 'p7@s.whatsapp.net', faction: { id: 'fac_dragoes' } };
  await engine.handleAction(p7, {
    action: 'eliminated',
    byPlayerId: 'p6@s.whatsapp.net',
  });
  const p6AfterFriendly = engine.getPublicState().players.find(p => p.userJid === 'p6@s.whatsapp.net');
  assert.equal(p6AfterFriendly.kills, 0, 'Fogo amigo não deve conceder kills à equipe');

  // 7. Avança o tempo para completar os 5 segundos de respawn (total de 5001ms desde a morte de p5)
  simulatedTime += 3001; // 2000 + 3001 = 5001ms

  // Ao enviar ação agora, o respawn deve ser autoritativamente resolvido e a ação aceita
  const respawnedEnter = await engine.handleAction(p5, { action: 'entered_zone', zoneId: 'B' });
  assert.equal(respawnedEnter.ok, true, 'Jogador revivido deve conseguir entrar na zona normalmente');
  assert.equal(respawnedEnter.zoneId, 'B');

  const p5Revived = engine.getPublicState().players.find(p => p.userJid === 'p5@s.whatsapp.net');
  assert.equal(p5Revived.isAlive, true);
  assert.equal(p5Revived.currentZoneId, 'B');

  engine.cleanup();
});

test('KOTH Intensivo - Simulação de drift de tick do servidor com múltiplos ticks de 2s e vitória cravada aos 100%', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMock8PlayerRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p2 = { userJid: 'p2@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p5 = { userJid: 'p5@s.whatsapp.net', faction: { id: 'fac_dragoes' } };

  // Tigres controlam Zona A e Zona B (+4% por tick)
  // Dragões controlam Zona C (+2% por tick)
  await engine.handleAction(p1, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p2, { action: 'entered_zone', zoneId: 'B' });
  await engine.handleAction(p5, { action: 'entered_zone', zoneId: 'C' });

  // Simula 25 ticks consecutivos de 2000ms com pequenas variações de drift (ex: 2010ms, 1995ms)
  // Tigres ganham +4% por tick. Aos 25 ticks: 25 * 4 = 100%!
  let finishedAtTick = null;

  for (let tick = 1; tick <= 26; tick++) {
    const driftMs = 2000 + (tick % 2 === 0 ? 15 : -10);
    simulatedTime += driftMs;

    engine._evaluateZonesTick();

    const state = engine.getPublicState();
    const tigresScore = state.factionProgress.find(f => f.id === 'fac_tigres').progress;
    const dragoesScore = state.factionProgress.find(f => f.id === 'fac_dragoes').progress;

    if (tick < 25) {
      assert.equal(tigresScore, tick * 4, `Tick ${tick}: Tigres deve ter exatamente ${tick * 4}%`);
      assert.equal(dragoesScore, tick * 2, `Tick ${tick}: Dragões deve ter exatamente ${tick * 2}%`);
      assert.equal(state.isRunning, true);
    } else if (tick === 25) {
      assert.equal(tigresScore, 100, 'Tick 25: Tigres atinge exatamente 100% de controle');
      assert.equal(dragoesScore, 50);
      assert.equal(state.isRunning, false, 'A partida deve parar imediatamente ao atingir 100%');
      assert.equal(state.isFinished, true);
      finishedAtTick = tick;
      break;
    }
  }

  assert.equal(finishedAtTick, 25);
  assert.equal(room.gameManager.finishGameCalls.length, 1);
  const finish = room.gameManager.finishGameCalls[0];
  assert.equal(finish.winnerId, 'fac_tigres');
  assert.equal(finish.stats.reason, 'target_control_reached');

  engine.cleanup();
});

test('KOTH Intensivo - Resolução de empate simultâneo em 100% no mesmo tick através de desempate por kills', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMock8PlayerRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_tigres' } };
  const p5 = { userJid: 'p5@s.whatsapp.net', faction: { id: 'fac_dragoes' } };

  // p1 controla Zona A (+2% no tick)
  // p5 controla Zona B (+2% no tick)
  await engine.handleAction(p1, { action: 'entered_zone', zoneId: 'A' });
  await engine.handleAction(p5, { action: 'entered_zone', zoneId: 'B' });

  // Ambos iniciam este tick em 98%
  engine._factionProgress.set('fac_tigres', 98);
  engine._factionProgress.set('fac_dragoes', 98);

  // Computa mais kills para Dragões (2 kills) do que Tigres (1 kill)
  engine._playerStates.get('p1@s.whatsapp.net').kills = 1;
  engine._playerStates.get('p5@s.whatsapp.net').kills = 2;

  // Executa o tick decisivo onde ambas as panelinhas batem 100% no mesmo instante
  engine._evaluateZonesTick();

  assert.equal(room.gameManager.finishGameCalls.length, 1);
  const finish = room.gameManager.finishGameCalls[0];
  // Deve ter desempatado a favor de fac_dragoes pelos abates superiores (2 vs 1)
  assert.equal(finish.winnerId, 'fac_dragoes');
  assert.equal(finish.stats.reason, 'target_control_reached');

  engine.cleanup();
});

test('KOTH Intensivo - Regras de desempate por tempo limite (3 minutos) com pontuações próximas ou idênticas', async () => {
  // Caso A: Empate em 0% (partida 100% travada sem ninguém dominar zonas)
  {
    let simulatedTime = 1_000_000;
    const now = () => simulatedTime;
    const room = createMock8PlayerRoom({ now });
    const engine = createKingOfTheHillEngine(room, { now });
    await engine.start();

    // 0% para ambas as equipes
    engine._factionProgress.set('fac_tigres', 0);
    engine._factionProgress.set('fac_dragoes', 0);

    // Tigres tem 3 kills no total; Dragões tem 1 kill
    engine._playerStates.get('p1@s.whatsapp.net').kills = 2;
    engine._playerStates.get('p2@s.whatsapp.net').kills = 1;
    engine._playerStates.get('p5@s.whatsapp.net').kills = 1;

    // Tempo esgotado (3 minutos)
    engine._endMatch(null, 'time_expired');

    assert.equal(room.gameManager.finishGameCalls.length, 1);
    assert.equal(room.gameManager.finishGameCalls[0].winnerId, 'fac_tigres');
    assert.equal(room.gameManager.finishGameCalls[0].stats.reason, 'time_expired');
    engine.cleanup();
  }

  // Caso B: Pontuações idênticas em 44% vs 44% com desempate por abates
  {
    let simulatedTime = 1_000_000;
    const now = () => simulatedTime;
    const room = createMock8PlayerRoom({ now });
    const engine = createKingOfTheHillEngine(room, { now });
    await engine.start();

    engine._factionProgress.set('fac_tigres', 44);
    engine._factionProgress.set('fac_dragoes', 44);

    // Dragões tem 5 kills; Tigres tem 2 kills
    engine._playerStates.get('p5@s.whatsapp.net').kills = 3;
    engine._playerStates.get('p6@s.whatsapp.net').kills = 2;
    engine._playerStates.get('p1@s.whatsapp.net').kills = 2;

    engine._endMatch(null, 'time_expired');

    assert.equal(room.gameManager.finishGameCalls.length, 1);
    assert.equal(room.gameManager.finishGameCalls[0].winnerId, 'fac_dragoes');
    engine.cleanup();
  }

  // Caso C: Empate em pontos (60% vs 60%) e empate em abates (4 vs 4) -> Desempate por menor número de mortes (deaths)
  {
    let simulatedTime = 1_000_000;
    const now = () => simulatedTime;
    const room = createMock8PlayerRoom({ now });
    const engine = createKingOfTheHillEngine(room, { now });
    await engine.start();

    engine._factionProgress.set('fac_tigres', 60);
    engine._factionProgress.set('fac_dragoes', 60);

    // Tigres: 4 kills, 2 deaths
    engine._playerStates.get('p1@s.whatsapp.net').kills = 4;
    engine._playerStates.get('p1@s.whatsapp.net').deaths = 2;

    // Dragões: 4 kills, 5 deaths
    engine._playerStates.get('p5@s.whatsapp.net').kills = 4;
    engine._playerStates.get('p5@s.whatsapp.net').deaths = 5;

    engine._endMatch(null, 'time_expired');

    assert.equal(room.gameManager.finishGameCalls.length, 1);
    // Tigres morrem menos (2 vs 5) -> Vencem pelo critério de sobrevivência
    assert.equal(room.gameManager.finishGameCalls[0].winnerId, 'fac_tigres');
    engine.cleanup();
  }
});

test('KOTH Intensivo - Resiliência, idempotência e ausência de memory leaks sob flood de requisições', async () => {
  let simulatedTime = 1_000_000;
  const now = () => simulatedTime;
  const room = createMock8PlayerRoom({ now });
  const engine = createKingOfTheHillEngine(room, { now });
  await engine.start();

  const p1 = { userJid: 'p1@s.whatsapp.net', faction: { id: 'fac_tigres' } };

  // Dispara 50 requisições consecutivas de entered_zone para a mesma zona
  const floodPromises = Array.from({ length: 50 }, () =>
    engine.handleAction(p1, { action: 'entered_zone', zoneId: 'A' })
  );

  const floodResults = await Promise.all(floodPromises);
  assert.equal(floodResults.length, 50);
  for (const r of floodResults) {
    assert.equal(r.ok, true);
  }

  // A contagem de jogadores na Zona A deve ser rigorosamente 1
  const state = engine.getPublicState();
  assert.equal(state.zones.A.playersCount, 1);

  // Limpeza de recursos
  engine.cleanup();
  assert.equal(engine.getPublicState().isRunning, false);
  assert.equal(engine.getPublicState().isFinished, true);
});
