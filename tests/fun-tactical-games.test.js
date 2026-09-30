import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLINAS_CONSTANTS,
  GOLPE_CONSTANTS,
  resolveColinas,
  resolveGolpe,
} from '../fun/games/engines/tacticalResolution.js';

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

    // Time A teve 2 votos em Alfa vs 1 do Time B -> Time A leva Alfa (5 pts)
    // Time B teve 1 voto em Bravo vs 0 do Time A -> Time B leva Bravo (3 pts)
    // Charlie ficou vazia -> acumula 2 + 2 = 4 pts
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
    // Alfa tinha acumulado para 15 pts
    const state = {
      pots: { alfa: 15, bravo: 3, charlie: 2 },
      teamsCount: { A: 1, B: 2 },
      teamIds: ['A', 'B'],
    };

    const res = resolveColinas(votes, state);

    // A bomba do Time A explodiu em Alfa! Ninguém leva nada e pote volta para 5
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
      { userJid: 'p1', teamId: 'A', hill: 'alfa' }, // Time A tem 3 jogadores no total
      { userJid: 'p2', teamId: 'B', hill: 'alfa' }, // Time B tem 2 jogadores no total
    ];
    const state = {
      pots: { alfa: 5, bravo: 3, charlie: 2 },
      teamsCount: { A: 3, B: 2 },
      teamIds: ['A', 'B'],
    };

    const res = resolveColinas(votes, state);

    // Em 1v1 na colina, Time B (menor) vence pelo desempate tático
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
      // Atacantes (Time A): 2 na Ponte, 1 no Túnel
      { userJid: 'a1', teamId: 'A', route: 'ponte' },
      { userJid: 'a2', teamId: 'A', route: 'ponte' },
      { userJid: 'a3', teamId: 'A', route: 'tunel' },
      // Defensores (Time B): 1 na Ponte, 2 na Floresta
      { userJid: 'b1', teamId: 'B', route: 'ponte' },
      { userJid: 'b2', teamId: 'B', route: 'floresta' },
      { userJid: 'b3', teamId: 'B', route: 'floresta' },
    ];

    const res = resolveGolpe(votes, 'A', {
      teamsCount: { A: 3, B: 3 },
      teamIds: ['A', 'B'],
    });

    // Ponte: 2 invasores, 1 guardião -> 1 barrado, 1 passou (1 * 3 = 3 pts)
    // Túnel: 1 invasor, 0 guardiões -> 0 barrados, 1 passou (1 * 2 = 2 pts)
    // Floresta: 0 invasores, 2 guardiões -> 0 pts
    // Total = 5 pts
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

  await t.test('compensação 3v2 quando o time menor ataca', () => {
    // Time B (2 jogadores) ataca Time A (3 jogadores)
    const votes = [
      { userJid: 'b1', teamId: 'B', route: 'ponte' },
      { userJid: 'b2', teamId: 'B', route: 'floresta' },
      // Time A defendeu apenas o Túnel com 3
      { userJid: 'a1', teamId: 'A', route: 'tunel' },
      { userJid: 'a2', teamId: 'A', route: 'tunel' },
      { userJid: 'a3', teamId: 'A', route: 'tunel' },
    ];

    const res = resolveGolpe(votes, 'B', {
      teamsCount: { A: 3, B: 2 },
      teamIds: ['A', 'B'],
      smallerTeamId: 'B',
    });

    // Ponte base 3 + bônus 1 = 4 pts
    // Floresta base 1 + bônus 1 = 2 pts
    // Total = 6 pts
    assert.equal(res.totalPoints, 6);
  });
});

test('Simulação de Partidas - Colinas & Grande Golpe', async (t) => {
  // Simulação com 1.000 partidas para verificar taxa de vitória e empates
  await t.test('Grande Golpe 3v3 entre bots aleatórios: equilíbrio simétrico', () => {
    let winsA = 0;
    let winsB = 0;
    let ties = 0;
    const MATCHES = 1000;
    const routes = GOLPE_CONSTANTS.ROUTES;

    for (let m = 0; m < MATCHES; m++) {
      let scoreA = 0;
      let scoreB = 0;

      for (let round = 1; round <= GOLPE_CONSTANTS.TOTAL_ROUNDS; round++) {
        const attacking = round % 2 === 1 ? 'A' : 'B';
        const votes = [
          // 3 jogadores no Time A
          { userJid: 'a1', teamId: 'A', route: routes[Math.floor(Math.random() * 3)] },
          { userJid: 'a2', teamId: 'A', route: routes[Math.floor(Math.random() * 3)] },
          { userJid: 'a3', teamId: 'A', route: routes[Math.floor(Math.random() * 3)] },
          // 3 jogadores no Time B
          { userJid: 'b1', teamId: 'B', route: routes[Math.floor(Math.random() * 3)] },
          { userJid: 'b2', teamId: 'B', route: routes[Math.floor(Math.random() * 3)] },
          { userJid: 'b3', teamId: 'B', route: routes[Math.floor(Math.random() * 3)] },
        ];

        const roundRes = resolveGolpe(votes, attacking, { teamsCount: { A: 3, B: 3 } });
        if (attacking === 'A') scoreA += roundRes.totalPoints;
        else scoreB += roundRes.totalPoints;
      }

      if (scoreA > scoreB) winsA++;
      else if (scoreB > scoreA) winsB++;
      else ties++;
    }

    const pctA = (winsA / MATCHES) * 100;
    const pctB = (winsB / MATCHES) * 100;
    const pctTies = (ties / MATCHES) * 100;

    // Critérios de aceite definidos no plano:
    // Vantagem de quem começa atacando (Time A) entre 45% e 55%
    // Taxa de empate menos de 15%
    assert.ok(pctA >= 40 && pctA <= 60, `Vitórias A (${pctA}%) deve ficar próximo a 50%`);
    assert.ok(pctB >= 40 && pctB <= 60, `Vitórias B (${pctB}%) deve ficar próximo a 50%`);
    assert.ok(pctTies < 15, `Empates (${pctTies}%) deve ser menor que 15%`);
  });

  await t.test('Colinas 2v2 entre bots aleatórios com bombas estratégicas', () => {
    let winsA = 0;
    let winsB = 0;
    let ties = 0;
    const MATCHES = 1000;
    const hills = COLINAS_CONSTANTS.HILLS;

    for (let m = 0; m < MATCHES; m++) {
      let scoreA = 0;
      let scoreB = 0;
      let state = {
        pots: { ...COLINAS_CONSTANTS.BASE_VALUES },
        teamsCount: { A: 2, B: 2 },
        teamIds: ['A', 'B'],
      };

      const bombUsed = { a1: false, a2: false, b1: false, b2: false };

      for (let round = 1; round <= COLINAS_CONSTANTS.TOTAL_ROUNDS; round++) {
        const chooseBomb = (jid, targetHill) => {
          // Usa bomba com chance controlada se o pote for >= 5 e ainda tiver bomba
          if (!bombUsed[jid] && (state.pots[targetHill] >= 5 || round >= 5) && Math.random() < 0.25) {
            bombUsed[jid] = true;
            return true;
          }
          return false;
        };

        const hA1 = hills[Math.floor(Math.random() * 3)];
        const hA2 = hills[Math.floor(Math.random() * 3)];
        const hB1 = hills[Math.floor(Math.random() * 3)];
        const hB2 = hills[Math.floor(Math.random() * 3)];

        const votes = [
          { userJid: 'a1', teamId: 'A', hill: hA1, useBomb: chooseBomb('a1', hA1) },
          { userJid: 'a2', teamId: 'A', hill: hA2, useBomb: chooseBomb('a2', hA2) },
          { userJid: 'b1', teamId: 'B', hill: hB1, useBomb: chooseBomb('b1', hB1) },
          { userJid: 'b2', teamId: 'B', hill: hB2, useBomb: chooseBomb('b2', hB2) },
        ];

        const roundRes = resolveColinas(votes, state);
        scoreA += roundRes.roundScores.A;
        scoreB += roundRes.roundScores.B;
        state.pots = roundRes.newPots;
      }

      if (scoreA > scoreB) winsA++;
      else if (scoreB > scoreA) winsB++;
      else ties++;
    }

    const pctTies = (ties / MATCHES) * 100;
    assert.ok(pctTies < 15, `Taxa de empate em Colinas (${pctTies}%) deve ser menor que 15%`);
  });
});
