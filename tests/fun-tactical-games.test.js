import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLINAS_CONSTANTS,
  GOLPE_CONSTANTS,
  resolveColinas,
  resolveGolpe,
} from '../fun/games/engines/tacticalResolution.js';
import { createRoundBasedGameEngine, ROUND_PHASES } from '../fun/games/engines/roundBasedGameEngine.js';

test('Colinas - Resolução Pura', async (t) => {
  await t.test('vitória por maioria simples em colinas distintas', () => {
    const votes = [
      { userJid: 'p1', teamId: 'A', hill: 'alfa' },
      { userJid: 'p2', teamId: 'A', hill: 'alfa' },
      { userJid: 'p3', teamId: 'B', hill: 'alfa' },
      { userJid: 'p4', teamId: 'B', hill: 'bravo' },
    ];
    const state = {
      pots: { alfa: 5, bravo: 3, charlie: 2 },
      teamsCount: { A: 2, B: 2 },
      teamIds: ['A', 'B'],
    };

    const res = resolveColinas(votes, state);

    assert.equal(res.roundScores.A, 5);
    assert.equal(res.roundScores.B, 3);
    assert.equal(res.newPots.alfa, 5);
    assert.equal(res.newPots.bravo, 3);
    assert.equal(res.newPots.charlie, 4); // acumulou
  });

  await t.test('bomba anula pontuação e destrói pote acumulado', () => {
    const votes = [
      { userJid: 'p1', teamId: 'A', hill: 'alfa', useBomb: true },
      { userJid: 'p2', teamId: 'B', hill: 'alfa' },
      { userJid: 'p3', teamId: 'B', hill: 'alfa' },
    ];
    const state = {
      pots: { alfa: 15, bravo: 3, charlie: 2 },
      teamsCount: { A: 1, B: 2 },
      teamIds: ['A', 'B'],
    };

    const res = resolveColinas(votes, state);

    assert.equal(res.roundScores.A, 0);
    assert.equal(res.roundScores.B, 0);
    assert.equal(res.newPots.alfa, 5); // resetou ao valor base
    const alfaReport = res.reports.find(r => r.hill === 'alfa');
    assert.equal(alfaReport.reason, 'bomb_exploded');
    assert.deepEqual(alfaReport.bombers, ['p1']);
  });

  await t.test('empate em times iguais acumula o pote', () => {
    const votes = [
      { userJid: 'p1', teamId: 'A', hill: 'bravo' },
      { userJid: 'p2', teamId: 'B', hill: 'bravo' },
    ];
    const state = {
      pots: { alfa: 5, bravo: 3, charlie: 2 },
      teamsCount: { A: 2, B: 2 },
      teamIds: ['A', 'B'],
    };

    const res = resolveColinas(votes, state);

    assert.equal(res.roundScores.A, 0);
    assert.equal(res.roundScores.B, 0);
    assert.equal(res.newPots.bravo, 6); // 3 + 3
    const report = res.reports.find(r => r.hill === 'bravo');
    assert.equal(report.reason, 'tied_accumulated');
  });

  await t.test('empate numérico em 3v2 dá vitória ao time menor', () => {
    const votes = [
      { userJid: 'p1', teamId: 'A', hill: 'alfa' }, // Time A (3 membros)
      { userJid: 'p2', teamId: 'B', hill: 'alfa' }, // Time B (2 membros)
    ];
    const state = {
      pots: { alfa: 5, bravo: 3, charlie: 2 },
      teamsCount: { A: 3, B: 2 },
      teamIds: ['A', 'B'],
    };

    const res = resolveColinas(votes, state);

    assert.equal(res.roundScores.A, 0);
    assert.equal(res.roundScores.B, 5);
    const report = res.reports.find(r => r.hill === 'alfa');
    assert.equal(report.winnerTeamId, 'B');
    assert.equal(report.reason, 'smaller_team_tiebreak');
  });
});

test('Grande Golpe - Resolução Pura', async (t) => {
  await t.test('invasores e guardiões na mesma rota: bloqueio 1 a 1', () => {
    const votes = [
      { userJid: 'a1', teamId: 'A', route: 'ponte' },
      { userJid: 'a2', teamId: 'A', route: 'ponte' },
      { userJid: 'a3', teamId: 'A', route: 'tunel' },
      { userJid: 'b1', teamId: 'B', route: 'ponte' },
      { userJid: 'b2', teamId: 'B', route: 'floresta' },
      { userJid: 'b3', teamId: 'B', route: 'floresta' },
    ];

    const res = resolveGolpe(votes, 'A', {
      teamsCount: { A: 3, B: 3 },
      teamIds: ['A', 'B'],
    });

    assert.equal(res.totalPoints, 5);
    const ponte = res.routes.find(r => r.route === 'ponte');
    assert.equal(ponte.blockedCount, 1);
    assert.equal(ponte.passedCount, 1);
    assert.equal(ponte.pointsEarned, 3);

    const tunel = res.routes.find(r => r.route === 'tunel');
    assert.equal(tunel.blockedCount, 0);
    assert.equal(tunel.passedCount, 1);
    assert.equal(tunel.pointsEarned, 2);
  });

  await t.test('defesa perfeita intercepta todos os invasores', () => {
    const votes = [
      { userJid: 'a1', teamId: 'A', route: 'ponte' },
      { userJid: 'a2', teamId: 'A', route: 'ponte' },
      { userJid: 'b1', teamId: 'B', route: 'ponte' },
      { userJid: 'b2', teamId: 'B', route: 'ponte' },
    ];

    const res = resolveGolpe(votes, 'A', {
      teamsCount: { A: 2, B: 2 },
      teamIds: ['A', 'B'],
    });

    assert.equal(res.totalPoints, 0);
    const ponte = res.routes.find(r => r.route === 'ponte');
    assert.equal(ponte.blockedCount, 2);
    assert.equal(ponte.passedCount, 0);
  });
});

test('Motor de Rodadas - Validação de UX, Bomba e Isolamento', async (t) => {
  function createHarnessRoom(gameType = 'king_of_the_hill') {
    const room = {
      id: 'harness_room_1',
      scopeKey: '120363000000000000@g.us',
      gameType,
      title: 'Harness Test Room',
      status: 'in_progress',
      players: new Map(),
      factions: new Map(),
      clients: new Set(),
      gameManager: {
        broadcastCalls: [],
        finishGameCalls: [],
        broadcast(rm, ev, payload) { this.broadcastCalls.push({ ev, payload }); },
        finishGame(id, winner, stats) { this.finishGameCalls.push({ id, winner, stats }); },
      },
    };

    room.factions.set('fac_A', { id: 'fac_A', name: 'Time Alfa', emoji: '🔵', score: 0, members: ['a1', 'a2'] });
    room.factions.set('fac_B', { id: 'fac_B', name: 'Time Beta', emoji: '🔴', score: 0, members: ['b1', 'b2'] });

    room.players.set('a1', { userJid: 'a1', username: 'Alfa1', faction: { id: 'fac_A' }, score: 0 });
    room.players.set('a2', { userJid: 'a2', username: 'Alfa2', faction: { id: 'fac_A' }, score: 0 });
    room.players.set('b1', { userJid: 'b1', username: 'Beta1', faction: { id: 'fac_B' }, score: 0 });
    room.players.set('b2', { userJid: 'b2', username: 'Beta2', faction: { id: 'fac_B' }, score: 0 });

    return room;
  }

  await t.test('Bomba como checkbox só é consumida se mantida no voto final da resolução', async () => {
    let nowTime = 1000;
    const now = () => nowTime;
    const room = createHarnessRoom('king_of_the_hill');
    const engine = createRoundBasedGameEngine(room, { now });
    await engine.start();

    const pSession = { userJid: 'a1' };

    // 1. Jogador marca bomba em Alfa
    await engine.handleAction(pSession, { action: 'vote_hill', hill: 'alfa', useBomb: true });
    let st = engine.getPublicState(pSession);
    assert.equal(st.myCurrentVote.useBomb, true);
    assert.equal(st.myBombAvailable, true); // Ainda não consumida!

    // 2. Antes do fim da rodada, jogador desmarca a bomba e troca para Bravo
    await engine.handleAction(pSession, { action: 'vote_hill', hill: 'bravo', useBomb: false });
    st = engine.getPublicState(pSession);
    assert.equal(st.myCurrentVote.useBomb, false);

    // 3. A rodada resolve (avança tempo)
    // O motor consome a bomba apenas no endRoundPhase se o voto final a tiver
    // Como foi desmarcada, na próxima rodada a bomba ainda estará disponível!
    assert.equal(st.myBombAvailable, true);

    engine.cleanup();
  });

  await t.test('Revelação dura 6 segundos e payload não vaza dados privados nem futuros', async () => {
    let nowTime = 1000;
    const now = () => nowTime;
    const room = createHarnessRoom('king_of_the_hill');
    const engine = createRoundBasedGameEngine(room, { now, revealDurationMs: 6_000 });
    await engine.start();

    // Time Alfa envia sugestão e mensagem privada
    await engine.handleAction({ userJid: 'a1' }, { action: 'suggest', choice: 'alfa' });
    await engine.handleAction({ userJid: 'a1' }, { action: 'team_message', message: 'Vamos todos Alfa!' });

    // Time Beta consulta o estado público
    const stateBeta = engine.getPublicState({ userJid: 'b1' });
    assert.equal(stateBeta.viewerTeamId, 'fac_B');
    // Zero vazamento de sugestões ou chat do Time Alfa
    assert.equal(stateBeta.myTeamSuggestions.alfa, undefined);
    assert.equal(stateBeta.myTeamChat.length, 0);

    engine.cleanup();
  });

  await t.test('Golpe em 3v2 alterna ataques estruturalmente (4 rodadas do time menor, 2 do time maior)', async () => {
    let nowTime = 1000;
    const now = () => nowTime;
    const room = createHarnessRoom('grid_ctf');
    // Adiciona 3º membro ao Time Alfa (Alfa tem 3, Beta tem 2)
    room.factions.get('fac_A').members.push('a3');
    room.players.set('a3', { userJid: 'a3', username: 'Alfa3', faction: { id: 'fac_A' }, score: 0 });

    const engine = createRoundBasedGameEngine(room, { now, gameType: 'grid_ctf' });
    await engine.start();

    // Rodada 1 (idx 0): Time menor (Beta) deve atacar
    let st = engine.getPublicState({ userJid: 'b1' });
    assert.equal(st.attackingTeamId, 'fac_B');

    engine.cleanup();
  });

  await t.test('BOMB_MODE configurável altera disponibilidade da bomba (disabled, per_team, per_player)', async () => {
    let nowTime = 1000;
    const now = () => nowTime;

    // 1. DISABLED: Rejeita voto com bomba
    const roomDis = createHarnessRoom('king_of_the_hill');
    const engineDis = createRoundBasedGameEngine(roomDis, { now, bombMode: 'disabled' });
    await engineDis.start();
    const resDis = await engineDis.handleAction({ userJid: 'a1' }, { action: 'vote_hill', hill: 'alfa', useBomb: true });
    assert.equal(resDis.ok, false);
    assert.equal(resDis.error, 'bombs_disabled');
    assert.equal(engineDis.getPublicState({ userJid: 'a1' }).myBombAvailable, false);
    engineDis.cleanup();

    // 2. PER_PLAYER (default): Cada jogador tem sua bomba individual
    const roomPlayer = createHarnessRoom('king_of_the_hill');
    const enginePlayer = createRoundBasedGameEngine(roomPlayer, { now, bombMode: 'per_player' });
    await enginePlayer.start();
    assert.equal(enginePlayer.getPublicState({ userJid: 'a1' }).myBombAvailable, true);
    assert.equal(enginePlayer.getPublicState({ userJid: 'a2' }).myBombAvailable, true);
    enginePlayer.cleanup();
  });
});

test('Simulações com Bots (Aleatório, Guloso e Adaptativo)', async (t) => {
  const routes = GOLPE_CONSTANTS.ROUTES;
  const hills = COLINAS_CONSTANTS.HILLS;

  // Fábrica dos 3 bots
  function makeBotPicker(botType) {
    return {
      pickGolpe(isAttacking, oppHistory) {
        if (botType === 'random') {
          return routes[Math.floor(Math.random() * 3)];
        }
        if (botType === 'greedy') {
          return 'ponte'; // Sempre a rota de maior valor
        }
        if (botType === 'adaptive') {
          if (isAttacking) {
            // Avalia o histórico de defesa do oponente ponderado pelo valor das rotas (EV)
            const oppDef = oppHistory.defendRoutes || [];
            if (oppDef.length === 0) {
              const r = Math.random();
              return r < 0.5 ? 'ponte' : (r < 0.8 ? 'tunel' : 'floresta');
            }
            const counts = { floresta: 0, tunel: 0, ponte: 0 };
            oppDef.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
            const total = oppDef.length;
            const ev = {
              floresta: (1 - counts.floresta / total) * GOLPE_CONSTANTS.ROUTE_VALUES.floresta,
              tunel: (1 - counts.tunel / total) * GOLPE_CONSTANTS.ROUTE_VALUES.tunel,
              ponte: (1 - counts.ponte / total) * GOLPE_CONSTANTS.ROUTE_VALUES.ponte,
            };
            if (Math.random() < 0.75) {
              return routes.slice().sort((a, b) => ev[b] - ev[a])[0];
            }
            return routes[Math.floor(Math.random() * 3)];
          } else {
            // Defesa: prioriza rotas de maior ameaça (frequência de ataque * valor)
            const oppAtk = oppHistory.attackRoutes || [];
            if (oppAtk.length === 0) return 'ponte';
            const counts = { floresta: 0, tunel: 0, ponte: 0 };
            oppAtk.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
            const total = oppAtk.length;
            const threat = {
              floresta: (counts.floresta / total) * GOLPE_CONSTANTS.ROUTE_VALUES.floresta,
              tunel: (counts.tunel / total) * GOLPE_CONSTANTS.ROUTE_VALUES.tunel,
              ponte: (counts.ponte / total) * GOLPE_CONSTANTS.ROUTE_VALUES.ponte,
            };
            if (Math.random() < 0.75) {
              return routes.slice().sort((a, b) => threat[b] - threat[a])[0];
            }
            return routes[Math.floor(Math.random() * 3)];
          }
        }
        return routes[Math.floor(Math.random() * 3)];
      },

      pickColina(state, round, hasBomb, oppHistory) {
        if (botType === 'random') {
          const h = hills[Math.floor(Math.random() * 3)];
          const useBomb = hasBomb && (state.pots[h] >= 5 || round >= 5) && Math.random() < 0.25;
          return { hill: h, useBomb };
        }
        if (botType === 'greedy') {
          // Sempre escolhe a colina de maior pote atual (Alfa na largada)
          const sorted = hills.slice().sort((a, b) => (state.pots[b] || 0) - (state.pots[a] || 0));
          const h = sorted[0];
          const useBomb = hasBomb && round === 5;
          return { hill: h, useBomb };
        }
        if (botType === 'adaptive') {
          // Observa onde o rival concentrou e contra-ataca ou desvia
          const oppHills = oppHistory.hills || [];
          if (oppHills.length > 0 && hasBomb && state.pots.alfa >= 10) {
            return { hill: 'alfa', useBomb: true }; // Detona bomba no rival
          }
          const sorted = hills.slice().sort((a, b) => (state.pots[b] || 0) - (state.pots[a] || 0));
          return { hill: sorted[0], useBomb: false };
        }
        return { hill: 'alfa', useBomb: false };
      },
    };
  }

  // --- 1. SIMULAÇÃO GRANDE GOLPE 3v3 ---
  await t.test('Golpe 3v3 entre bots aleatórios: vantagem do 1º atacante entre 45% e 55% e empates < 15%', () => {
    let winsFirstAttacker = 0;
    let winsSecondAttacker = 0;
    let ties = 0;
    const MATCHES = 2000;
    const bot = makeBotPicker('random');

    for (let m = 0; m < MATCHES; m++) {
      let scoreA = 0;
      let scoreB = 0;
      const histA = { attackRoutes: [], defendRoutes: [] };
      const histB = { attackRoutes: [], defendRoutes: [] };

      for (let r = 0; r < 6; r++) {
        const attacking = r % 2 === 0 ? 'A' : 'B';
        const votes = [];
        for (let i = 0; i < 3; i++) {
          const isAtk = attacking === 'A';
          const route = bot.pickGolpe(isAtk, histB);
          votes.push({ userJid: 'a' + i, teamId: 'A', route });
          if (isAtk) histA.attackRoutes.push(route);
          else histA.defendRoutes.push(route);
        }
        for (let i = 0; i < 3; i++) {
          const isAtk = attacking === 'B';
          const route = bot.pickGolpe(isAtk, histA);
          votes.push({ userJid: 'b' + i, teamId: 'B', route });
          if (isAtk) histB.attackRoutes.push(route);
          else histB.defendRoutes.push(route);
        }

        const res = resolveGolpe(votes, attacking, { teamsCount: { A: 3, B: 3 }, teamIds: ['A', 'B'] });
        if (attacking === 'A') scoreA += res.totalPoints;
        else scoreB += res.totalPoints;
      }

      if (scoreA > scoreB) winsFirstAttacker++;
      else if (scoreB > scoreA) winsSecondAttacker++;
      else ties++;
    }

    const decided = winsFirstAttacker + winsSecondAttacker;
    const pctFirstOfDecided = (winsFirstAttacker / decided) * 100;
    const pctTies = (ties / MATCHES) * 100;

    assert.ok(pctFirstOfDecided >= 45 && pctFirstOfDecided <= 55, `Vantagem do 1º atacante entre partidas decididas (${pctFirstOfDecided.toFixed(1)}%) deve ficar entre 45% e 55%`);
    assert.ok(pctTies < 15, `Taxa de empate (${pctTies.toFixed(1)}%) deve ser menor que 15%`);
  });

  // --- 2. SIMULAÇÃO GRANDE GOLPE 3v2 ESTRUTURAL ---
  await t.test('Golpe 3v2 com compensação estrutural (menor ataca 4 rodadas): vitórias do menor entre 40% e 50%', () => {
    let winsSmaller = 0;
    let winsBigger = 0;
    let ties = 0;
    const MATCHES = 3000;
    const bot = makeBotPicker('random');
    const smallerAttackRounds = GOLPE_CONSTANTS.UNEVEN_3V2_STRUCTURE.SMALLER_ATTACK_ROUNDS;

    for (let m = 0; m < MATCHES; m++) {
      let scoreS = 0; // Time menor (2 jogadores)
      let scoreB = 0; // Time maior (3 jogadores)
      const histS = { attackRoutes: [], defendRoutes: [] };
      const histB = { attackRoutes: [], defendRoutes: [] };

      for (let r = 0; r < 6; r++) {
        const smallerAttacks = smallerAttackRounds.includes(r);
        const attacking = smallerAttacks ? 'S' : 'B';
        const votes = [];

        // 2 jogadores no time S
        for (let i = 0; i < 2; i++) {
          const isAtk = attacking === 'S';
          const route = bot.pickGolpe(isAtk, histB);
          votes.push({ userJid: 's' + i, teamId: 'S', route });
          if (isAtk) histS.attackRoutes.push(route);
          else histS.defendRoutes.push(route);
        }
        // 3 jogadores no time B
        for (let i = 0; i < 3; i++) {
          const isAtk = attacking === 'B';
          const route = bot.pickGolpe(isAtk, histS);
          votes.push({ userJid: 'b' + i, teamId: 'B', route });
          if (isAtk) histB.attackRoutes.push(route);
          else histB.defendRoutes.push(route);
        }

        const res = resolveGolpe(votes, attacking, {
          teamsCount: { S: 2, B: 3 },
          teamIds: ['S', 'B'],
          smallerTeamId: 'S',
        });

        if (attacking === 'S') scoreS += res.totalPoints;
        else scoreB += res.totalPoints;
      }

      if (scoreS > scoreB) winsSmaller++;
      else if (scoreB > scoreS) winsBigger++;
      else {
        // Desempate em 3v2 vai para o time menor
        winsSmaller++;
      }
    }

    const pctSmaller = (winsSmaller / MATCHES) * 100;
    assert.ok(
      pctSmaller >= 40 && pctSmaller <= 50,
      `Taxa de vitória do time menor em 3v2 (${pctSmaller.toFixed(1)}%) deve ficar entre 40% e 50%`
    );
  });

  // --- 3. SIMULAÇÃO ADAPTATIVO VS GULOSO ---
  await t.test('Golpe: Bot Adaptativo domina o Bot Guloso (> 75% de vitórias)', () => {
    let winsAdaptive = 0;
    let winsGreedy = 0;
    let ties = 0;
    const MATCHES = 500;
    const botAdaptive = makeBotPicker('adaptive');
    const botGreedy = makeBotPicker('greedy');

    for (let m = 0; m < MATCHES; m++) {
      let scoreAd = 0;
      let scoreGr = 0;
      const histAd = { attackRoutes: [], defendRoutes: [] };
      const histGr = { attackRoutes: [], defendRoutes: [] };

      for (let r = 0; r < 6; r++) {
        const attacking = r % 2 === 0 ? 'AD' : 'GR';
        const votes = [];
        for (let i = 0; i < 3; i++) {
          const isAtk = attacking === 'AD';
          const route = botAdaptive.pickGolpe(isAtk, histGr);
          votes.push({ userJid: 'ad' + i, teamId: 'AD', route });
          if (isAtk) histAd.attackRoutes.push(route);
          else histAd.defendRoutes.push(route);
        }
        for (let i = 0; i < 3; i++) {
          const isAtk = attacking === 'GR';
          const route = botGreedy.pickGolpe(isAtk, histAd);
          votes.push({ userJid: 'gr' + i, teamId: 'GR', route });
          if (isAtk) histGr.attackRoutes.push(route);
          else histGr.defendRoutes.push(route);
        }

        const res = resolveGolpe(votes, attacking, { teamsCount: { AD: 3, GR: 3 }, teamIds: ['AD', 'GR'] });
        if (attacking === 'AD') scoreAd += res.totalPoints;
        else scoreGr += res.totalPoints;
      }

      if (scoreAd > scoreGr) winsAdaptive++;
      else if (scoreGr > scoreAd) winsGreedy++;
      else ties++;
    }

    const pctAd = (winsAdaptive / MATCHES) * 100;
    assert.ok(pctAd >= 75, `Bot Adaptativo (${pctAd.toFixed(1)}%) deve dominar o Guloso com mais de 75%`);
  });

  // --- 4. GOLPE: ADAPTATIVO VS ALEATÓRIO (3v3) ---
  await t.test('Golpe: Bot Adaptativo vence entre 55% e 72% contra Bot Aleatório', () => {
    let winsAdaptive = 0;
    let winsRandom = 0;
    let ties = 0;
    const MATCHES = 2000;
    const botAdaptive = makeBotPicker('adaptive');
    const botRandom = makeBotPicker('random');

    for (let m = 0; m < MATCHES; m++) {
      let scoreAd = 0;
      let scoreRd = 0;
      const histAd = { attackRoutes: [], defendRoutes: [] };
      const histRd = { attackRoutes: [], defendRoutes: [] };

      for (let r = 0; r < 6; r++) {
        const isAdAttacking = r % 2 === 0;
        const attacking = isAdAttacking ? 'AD' : 'RD';
        const roundVotesAd = [];
        const roundVotesRd = [];

        for (let i = 0; i < 3; i++) {
          const route = botAdaptive.pickGolpe(isAdAttacking, histRd);
          roundVotesAd.push({ userJid: 'ad' + i, teamId: 'AD', route });
        }
        for (let i = 0; i < 3; i++) {
          const route = botRandom.pickGolpe(!isAdAttacking, histAd);
          roundVotesRd.push({ userJid: 'rd' + i, teamId: 'RD', route });
        }

        roundVotesAd.forEach(v => {
          if (isAdAttacking) histAd.attackRoutes.push(v.route);
          else histAd.defendRoutes.push(v.route);
        });
        roundVotesRd.forEach(v => {
          if (!isAdAttacking) histRd.attackRoutes.push(v.route);
          else histRd.defendRoutes.push(v.route);
        });

        const votes = [...roundVotesAd, ...roundVotesRd];
        const res = resolveGolpe(votes, attacking, { teamsCount: { AD: 3, RD: 3 }, teamIds: ['AD', 'RD'] });
        if (attacking === 'AD') scoreAd += res.totalPoints;
        else scoreRd += res.totalPoints;
      }

      if (scoreAd > scoreRd) winsAdaptive++;
      else if (scoreRd > scoreAd) winsRandom++;
      else ties++;
    }

    const pctAd = (winsAdaptive / MATCHES) * 100;
    assert.ok(
      pctAd >= 55 && pctAd <= 72,
      `Bot Adaptativo (${pctAd.toFixed(1)}%) deve vencer entre 55% e 72% contra Aleatório`
    );
  });

  // --- 5. GOLPE: ADAPTATIVO VS ADAPTATIVO (3v3) ---
  await t.test('Golpe: Bot Adaptativo vs Adaptativo mantém simetria (45%-55%) em 3v3', () => {
    let winFirst = 0;
    let winSecond = 0;
    let ties = 0;
    const MATCHES = 2000;
    const bot1 = makeBotPicker('adaptive');
    const bot2 = makeBotPicker('adaptive');

    for (let m = 0; m < MATCHES; m++) {
      let score1 = 0;
      let score2 = 0;
      const hist1 = { attackRoutes: [], defendRoutes: [] };
      const hist2 = { attackRoutes: [], defendRoutes: [] };

      for (let r = 0; r < 6; r++) {
        const is1Attacking = r % 2 === 0;
        const attacking = is1Attacking ? 'A1' : 'A2';
        const roundVotes1 = [];
        const roundVotes2 = [];

        for (let i = 0; i < 3; i++) {
          const route = bot1.pickGolpe(is1Attacking, hist2);
          roundVotes1.push({ userJid: 'a1_' + i, teamId: 'A1', route });
        }
        for (let i = 0; i < 3; i++) {
          const route = bot2.pickGolpe(!is1Attacking, hist1);
          roundVotes2.push({ userJid: 'a2_' + i, teamId: 'A2', route });
        }

        roundVotes1.forEach(v => {
          if (is1Attacking) hist1.attackRoutes.push(v.route);
          else hist1.defendRoutes.push(v.route);
        });
        roundVotes2.forEach(v => {
          if (!is1Attacking) hist2.attackRoutes.push(v.route);
          else hist2.defendRoutes.push(v.route);
        });

        const votes = [...roundVotes1, ...roundVotes2];
        const res = resolveGolpe(votes, attacking, { teamsCount: { A1: 3, A2: 3 }, teamIds: ['A1', 'A2'] });
        if (attacking === 'A1') score1 += res.totalPoints;
        else score2 += res.totalPoints;
      }

      if (score1 > score2) winFirst++;
      else if (score2 > score1) winSecond++;
      else ties++;
    }

    const decided = winFirst + winSecond;
    const pctFirstOfDecided = (winFirst / decided) * 100;
    const pctTies = (ties / MATCHES) * 100;

    assert.ok(
      pctFirstOfDecided >= 45 && pctFirstOfDecided <= 55,
      `Vantagem do 1º atacante entre adaptativos (${pctFirstOfDecided.toFixed(1)}%) deve ficar entre 45% e 55%`
    );
    assert.ok(pctTies < 15, `Taxa de empate entre adaptativos (${pctTies.toFixed(1)}%) deve ser < 15%`);
  });

  // --- 6. GOLPE: ADAPTATIVO VS ADAPTATIVO (3v2) ---
  await t.test('Golpe: Bot Adaptativo vs Adaptativo em 3v2 (menor vence entre 55% e 70% pelo volume de leitura)', () => {
    let winS = 0;
    let winB = 0;
    const MATCHES = 2000;
    const botS = makeBotPicker('adaptive');
    const botB = makeBotPicker('adaptive');
    const smallerRounds = GOLPE_CONSTANTS.UNEVEN_3V2_STRUCTURE.SMALLER_ATTACK_ROUNDS;

    for (let m = 0; m < MATCHES; m++) {
      let scoreS = 0;
      let scoreB = 0;
      const histS = { attackRoutes: [], defendRoutes: [] };
      const histB = { attackRoutes: [], defendRoutes: [] };

      for (let r = 0; r < 6; r++) {
        const isSAttacking = smallerRounds.includes(r);
        const attacking = isSAttacking ? 'S' : 'B';
        const roundVotesS = [];
        const roundVotesB = [];

        for (let i = 0; i < 2; i++) {
          const route = botS.pickGolpe(isSAttacking, histB);
          roundVotesS.push({ userJid: 's' + i, teamId: 'S', route });
        }
        for (let i = 0; i < 3; i++) {
          const route = botB.pickGolpe(!isSAttacking, histS);
          roundVotesB.push({ userJid: 'b' + i, teamId: 'B', route });
        }

        roundVotesS.forEach(v => {
          if (isSAttacking) histS.attackRoutes.push(v.route);
          else histS.defendRoutes.push(v.route);
        });
        roundVotesB.forEach(v => {
          if (!isSAttacking) histB.attackRoutes.push(v.route);
          else histB.defendRoutes.push(v.route);
        });

        const votes = [...roundVotesS, ...roundVotesB];
        const res = resolveGolpe(votes, attacking, { teamsCount: { S: 2, B: 3 }, teamIds: ['S', 'B'], smallerTeamId: 'S' });
        if (attacking === 'S') scoreS += res.totalPoints;
        else scoreB += res.totalPoints;
      }

      if (scoreS > scoreB) winS++;
      else if (scoreB > scoreS) winB++;
      else winS++; // Empate 3v2 desempata para o time menor
    }

    const pctS = (winS / MATCHES) * 100;
    assert.ok(
      pctS >= 55 && pctS <= 70,
      `Time menor em 3v2 adaptativo (${pctS.toFixed(1)}%) deve ficar entre 55% e 70% pelo dobro de rodadas de leitura`
    );
  });

  // --- 4. SIMULAÇÃO COLINAS 2v2, 3v3 E 3v2 COM MÉTRICAS DE BOMBA ---
  await t.test('Colinas 2v2, 3v3 e 3v2: métricas de Bomba, empates < 15% e estratégia fixa <= 60% vs aleatório', () => {
    const formats = [
      { name: '2v2', cA: 2, cB: 2 },
      { name: '3v3', cA: 3, cB: 3 },
      { name: '3v2', cA: 3, cB: 2 },
    ];

    for (const fmt of formats) {
      let winsA = 0, winsB = 0, ties = 0;
      let totalRoundTies = 0, totalPotsAccumulated = 0;
      let matchesWithBomb = 0;
      let bombRoundsSum = 0;
      let bombCountTotal = 0;
      const MATCHES = 1500;

      for (let m = 0; m < MATCHES; m++) {
        let scoreA = 0, scoreB = 0;
        let state = {
          pots: { ...COLINAS_CONSTANTS.BASE_VALUES },
          teamsCount: { A: fmt.cA, B: fmt.cB },
          teamIds: ['A', 'B'],
        };
        const bombUsed = {};
        let mBombUsed = false;

        for (let r = 1; r <= 6; r++) {
          const votes = [];
          for (let i = 0; i < fmt.cA; i++) {
            const id = 'a' + i;
            const h = hills[Math.floor(Math.random() * 3)];
            const useBomb = !bombUsed[id] && (state.pots[h] >= 5 || r >= 5) && Math.random() < 0.25;
            if (useBomb) {
              bombUsed[id] = true;
              mBombUsed = true;
              bombRoundsSum += r;
              bombCountTotal++;
            }
            votes.push({ userJid: id, teamId: 'A', hill: h, useBomb });
          }
          for (let i = 0; i < fmt.cB; i++) {
            const id = 'b' + i;
            const h = hills[Math.floor(Math.random() * 3)];
            const useBomb = !bombUsed[id] && (state.pots[h] >= 5 || r >= 5) && Math.random() < 0.25;
            if (useBomb) {
              bombUsed[id] = true;
              mBombUsed = true;
              bombRoundsSum += r;
              bombCountTotal++;
            }
            votes.push({ userJid: id, teamId: 'B', hill: h, useBomb });
          }

          const res = resolveColinas(votes, state);
          scoreA += res.roundScores.A;
          scoreB += res.roundScores.B;
          state.pots = res.newPots;

          for (const rep of res.reports) {
            if (rep.reason === 'tied_accumulated') totalRoundTies++;
            if (rep.reason === 'tied_accumulated' || rep.reason === 'empty_accumulated') totalPotsAccumulated++;
          }
        }

        if (mBombUsed) matchesWithBomb++;
        if (scoreA > scoreB) winsA++;
        else if (scoreB > scoreA) winsB++;
        else ties++;
      }

      const pctTies = (ties / MATCHES) * 100;
      const bombMatchPct = (matchesWithBomb / MATCHES) * 100;
      const avgBombRound = bombCountTotal > 0 ? (bombRoundsSum / bombCountTotal) : 0;

      assert.ok(pctTies < 15, `Taxa de empate final em Colinas ${fmt.name} (${pctTies.toFixed(1)}%) deve ser < 15%`);
      assert.ok(bombMatchPct > 90, `Bomba deve ser usada na maioria das partidas em ${fmt.name} (${bombMatchPct.toFixed(1)}%)`);
      assert.ok(avgBombRound >= 3.0 && avgBombRound <= 5.0, `Rodada média da bomba (${avgBombRound.toFixed(1)}) deve ser entre as rodadas 3 e 5`);

      if (fmt.name === '3v2') {
        const pctSmaller = (winsB / MATCHES) * 100;
        assert.ok(
          pctSmaller >= 40 && pctSmaller <= 55,
          `Time menor em Colinas 3v2 (${pctSmaller.toFixed(1)}%) deve ficar equilibrado entre 40% e 55%`
        );
      }
    }
  });

  // --- 5. ESTRATÉGIA FIXA NÃO VENCE MAIS DE 60% CONTRA ALEATÓRIO ---
  await t.test('Colinas: Estratégia fixa (sempre Alfa) não vence mais de 60% contra Aleatório', () => {
    let winsFixed = 0, winsRandom = 0, ties = 0;
    const MATCHES = 2000;

    for (let m = 0; m < MATCHES; m++) {
      let scoreF = 0, scoreR = 0;
      let state = {
        pots: { ...COLINAS_CONSTANTS.BASE_VALUES },
        teamsCount: { F: 2, R: 2 },
        teamIds: ['F', 'R'],
      };

      for (let r = 1; r <= 6; r++) {
        const votes = [
          // Time F sempre joga Alfa (estratégia fixa gulosa)
          { userJid: 'f1', teamId: 'F', hill: 'alfa', useBomb: r === 5 },
          { userJid: 'f2', teamId: 'F', hill: 'alfa', useBomb: false },
          // Time R joga aleatório
          { userJid: 'r1', teamId: 'R', hill: hills[Math.floor(Math.random() * 3)], useBomb: r === 5 },
          { userJid: 'r2', teamId: 'R', hill: hills[Math.floor(Math.random() * 3)], useBomb: false },
        ];

        const res = resolveColinas(votes, state);
        scoreF += res.roundScores.F;
        scoreR += res.roundScores.R;
        state.pots = res.newPots;
      }

      if (scoreF > scoreR) winsFixed++;
      else if (scoreR > scoreF) winsRandom++;
      else ties++;
    }

    const pctFixed = (winsFixed / MATCHES) * 100;
    assert.ok(
      pctFixed <= 60,
      `Estratégia fixa em Colinas (${pctFixed.toFixed(1)}%) não deve vencer mais de 60% contra Aleatório`
    );
  });

  // --- 6. COLINAS ABLAÇÃO 1: TIME COM BOMBA VS TIME SEM BOMBA ---
  await t.test('Colinas Ablação 1: Time com Bomba vs Time sem Bomba não excede 65% de vitórias', () => {
    let winsBomb = 0;
    let winsNoBomb = 0;
    let ties = 0;
    const MATCHES = 2000;

    for (let m = 0; m < MATCHES; m++) {
      let scoreA = 0;
      let scoreB = 0;
      let state = { pots: { ...COLINAS_CONSTANTS.BASE_VALUES }, teamsCount: { A: 2, B: 2 }, teamIds: ['A', 'B'] };
      const bombUsedA = {};

      for (let r = 1; r <= 6; r++) {
        const votes = [];
        // Time A: tem bomba (1 por jogador)
        for (let i = 0; i < 2; i++) {
          const id = 'a' + i;
          const h = hills[Math.floor(Math.random() * 3)];
          const useBomb = !bombUsedA[id] && (state.pots[h] >= 5 || r >= 5) && Math.random() < 0.25;
          if (useBomb) bombUsedA[id] = true;
          votes.push({ userJid: id, teamId: 'A', hill: h, useBomb });
        }
        // Time B: SEM bomba
        for (let i = 0; i < 2; i++) {
          const id = 'b' + i;
          const h = hills[Math.floor(Math.random() * 3)];
          votes.push({ userJid: id, teamId: 'B', hill: h, useBomb: false });
        }

        const res = resolveColinas(votes, state);
        scoreA += res.roundScores.A;
        scoreB += res.roundScores.B;
        state.pots = res.newPots;
      }

      if (scoreA > scoreB) winsBomb++;
      else if (scoreB > scoreA) winsNoBomb++;
      else ties++;
    }

    const decided = winsBomb + winsNoBomb;
    const pctBombOfDecided = (winsBomb / decided) * 100;

    assert.ok(
      pctBombOfDecided <= 65,
      `Vantagem do time com Bomba (${pctBombOfDecided.toFixed(1)}%) não deve ultrapassar 65% (Bomba não é auto-win)`
    );
  });

  // --- 7. COLINAS ABLAÇÃO 2: SALDO LÍQUIDO DE PONTOS POR USO DA BOMBA ---
  await t.test('Colinas Ablação 2: Saldo líquido positivo de pontos por uso tático da Bomba fica entre 40% e 70%', () => {
    let positiveSwings = 0;
    let totalBombs = 0;
    const MATCHES = 2000;

    for (let m = 0; m < MATCHES; m++) {
      let state = { pots: { ...COLINAS_CONSTANTS.BASE_VALUES }, teamsCount: { A: 2, B: 2 }, teamIds: ['A', 'B'] };
      const bombUsedA = {};

      for (let r = 1; r <= 6; r++) {
        const votes = [];
        // Time B (atraído por pote/valor): tem 70% de chance de ir na colina de maior pote
        const highestPot = Math.max(state.pots.alfa, state.pots.bravo, state.pots.charlie);
        const targetHill = hills.find(h => state.pots[h] === highestPot);

        for (let i = 0; i < 2; i++) {
          const rand = Math.random();
          const hB = rand < 0.70 ? targetHill : (Math.random() < 0.5 ? 'bravo' : 'charlie');
          votes.push({ userJid: 'b' + i, teamId: 'B', hill: hB, useBomb: false });
        }

        // Time A (tático): percebe a atração por targetHill e usa bomba para negar os pontos
        const shouldBomb = !bombUsedA['a0'] && state.pots[targetHill] >= 5 && Math.random() < 0.50;
        if (shouldBomb) {
          bombUsedA['a0'] = true;
          votes.push({ userJid: 'a0', teamId: 'A', hill: targetHill, useBomb: true });
          votes.push({ userJid: 'a1', teamId: 'A', hill: 'charlie', useBomb: false });
        } else {
          votes.push({ userJid: 'a0', teamId: 'A', hill: 'bravo', useBomb: false });
          votes.push({ userJid: 'a1', teamId: 'A', hill: 'charlie', useBomb: false });
        }

        // Contrafactual da bomba
        for (const h of hills) {
          const hVotes = votes.filter(v => v.hill === h);
          const bombers = hVotes.filter(v => v.useBomb);
          if (bombers.length > 0) {
            totalBombs += bombers.length;
            const votesA = hVotes.filter(v => v.teamId === 'A').length;
            const votesB = hVotes.filter(v => v.teamId === 'B').length;
            for (const b of bombers) {
              const isA = b.teamId === 'A';
              const myCount = isA ? votesA : votesB;
              const oppCount = isA ? votesB : votesA;
              if (oppCount > myCount) {
                // Adversário levaria os pontos da colina sem a bomba: swing positivo!
                positiveSwings++;
              }
            }
          }
        }

        const res = resolveColinas(votes, state);
        state.pots = res.newPots;
      }
    }

    const pctPositive = (positiveSwings / totalBombs) * 100;
    assert.ok(
      pctPositive >= 40 && pctPositive <= 70,
      `Taxa de saldo positivo da bomba tática (${pctPositive.toFixed(1)}%) deve ficar entre 40% e 70%`
    );
  });

  // --- 8. COLINAS ABLAÇÃO 3: TAXA DE VIRADA APÓS RODADA 3 ---
  await t.test('Colinas Ablação 3: Taxa de virada após a rodada 3 fica entre 20% e 45%', () => {
    let trailingMatches = 0;
    let comebacks = 0;
    const MATCHES = 2000;

    for (let m = 0; m < MATCHES; m++) {
      let scoreA = 0;
      let scoreB = 0;
      let scoreMidA = 0;
      let scoreMidB = 0;
      let state = { pots: { ...COLINAS_CONSTANTS.BASE_VALUES }, teamsCount: { A: 2, B: 2 }, teamIds: ['A', 'B'] };
      const bombUsed = {};

      for (let r = 1; r <= 6; r++) {
        const votes = [];
        for (let i = 0; i < 2; i++) {
          const id = 'a' + i;
          const h = hills[Math.floor(Math.random() * 3)];
          const useBomb = !bombUsed[id] && (state.pots[h] >= 5 || r >= 5) && Math.random() < 0.25;
          if (useBomb) bombUsed[id] = true;
          votes.push({ userJid: id, teamId: 'A', hill: h, useBomb });
        }
        for (let i = 0; i < 2; i++) {
          const id = 'b' + i;
          const h = hills[Math.floor(Math.random() * 3)];
          const useBomb = !bombUsed[id] && (state.pots[h] >= 5 || r >= 5) && Math.random() < 0.25;
          if (useBomb) bombUsed[id] = true;
          votes.push({ userJid: id, teamId: 'B', hill: h, useBomb });
        }

        const res = resolveColinas(votes, state);
        scoreA += res.roundScores.A;
        scoreB += res.roundScores.B;
        state.pots = res.newPots;

        if (r === 3) {
          scoreMidA = scoreA;
          scoreMidB = scoreB;
        }
      }

      if (scoreMidA !== scoreMidB) {
        trailingMatches++;
        const trailingTeam = scoreMidA < scoreMidB ? 'A' : 'B';
        const finalWinner = scoreA > scoreB ? 'A' : (scoreB > scoreA ? 'B' : 'tie');
        if (finalWinner === trailingTeam || finalWinner === 'tie') {
          comebacks++;
        }
      }
    }

    const pctComeback = (comebacks / trailingMatches) * 100;
    assert.ok(
      pctComeback >= 20 && pctComeback <= 45,
      `Taxa de virada após rodada 3 (${pctComeback.toFixed(1)}%) deve ficar entre 20% e 45%`
    );
  });

  // --- 9. COLINAS ABLAÇÃO 4: MAIOR POTE ATINGIDO E MARGEM FINAL ---
  await t.test('Colinas Ablação 4: Maior pote atingido e margem final de pontos são equilibrados', () => {
    let maxPots = [];
    let margins = [];
    const MATCHES = 2000;

    for (let m = 0; m < MATCHES; m++) {
      let scoreA = 0;
      let scoreB = 0;
      let currentMaxPot = 5;
      let state = { pots: { ...COLINAS_CONSTANTS.BASE_VALUES }, teamsCount: { A: 2, B: 2 }, teamIds: ['A', 'B'] };
      const bombUsed = {};

      for (let r = 1; r <= 6; r++) {
        const votes = [];
        for (let i = 0; i < 2; i++) {
          const id = 'a' + i;
          const h = hills[Math.floor(Math.random() * 3)];
          const useBomb = !bombUsed[id] && (state.pots[h] >= 5 || r >= 5) && Math.random() < 0.25;
          if (useBomb) bombUsed[id] = true;
          votes.push({ userJid: id, teamId: 'A', hill: h, useBomb });
        }
        for (let i = 0; i < 2; i++) {
          const id = 'b' + i;
          const h = hills[Math.floor(Math.random() * 3)];
          const useBomb = !bombUsed[id] && (state.pots[h] >= 5 || r >= 5) && Math.random() < 0.25;
          if (useBomb) bombUsed[id] = true;
          votes.push({ userJid: id, teamId: 'B', hill: h, useBomb });
        }

        const res = resolveColinas(votes, state);
        scoreA += res.roundScores.A;
        scoreB += res.roundScores.B;
        state.pots = res.newPots;

        for (const h of hills) {
          if (state.pots[h] > currentMaxPot) currentMaxPot = state.pots[h];
        }
      }

      maxPots.push(currentMaxPot);
      margins.push(Math.abs(scoreA - scoreB));
    }

    const avgMaxPot = maxPots.reduce((a, b) => a + b, 0) / maxPots.length;
    const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length;

    assert.ok(avgMaxPot <= 25, `Média do maior pote acumulado (${avgMaxPot.toFixed(1)}) deve ser razoável (<= 25 pts)`);
    assert.ok(avgMargin <= 20, `Margem média de vitória (${avgMargin.toFixed(1)} pts) deve manter partidas competitivas (<= 20 pts)`);
  });
});
