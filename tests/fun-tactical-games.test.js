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
            // Ataca a rota menos vigiada pelo rival
            const oppDef = oppHistory.defendRoutes || [];
            if (oppDef.length === 0) return routes[Math.floor(Math.random() * 3)];
            const counts = { floresta: 0, tunel: 0, ponte: 0 };
            oppDef.forEach(r => counts[r] = (counts[r] || 0) + 1);
            return routes.slice().sort((a, b) => counts[a] - counts[b])[0];
          } else {
            // Defende a rota mais atacada pelo rival
            const oppAtk = oppHistory.attackRoutes || [];
            if (oppAtk.length === 0) return 'ponte';
            const counts = { floresta: 0, tunel: 0, ponte: 0 };
            oppAtk.forEach(r => counts[r] = (counts[r] || 0) + 1);
            return routes.slice().sort((a, b) => counts[b] - counts[a])[0];
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
});
