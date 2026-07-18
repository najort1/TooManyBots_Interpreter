/**
 * Diagnóstico: cara/coroa enviesado?
 * node fun/scripts/probe-flip-bias.mjs
 */
import { createGameService } from '../services/gameService.js';

const repository = {
  applyGameCoinDelta: () => ({ ok: true, coinsAfter: 1000 }),
  addCoins: () => {},
  getUserStats: () => ({ coins: 1000 }),
};
const games = createGameService({
  repository,
  actionRepository: {},
  random: Math.random,
});

const N = 20_000;
function run(label, choiceFn) {
  let cara = 0;
  let coroa = 0;
  let wins = 0;
  for (let i = 0; i < N; i += 1) {
    const choice = choiceFn(i);
    const r = games.soloFlip({
      userJid: 'u',
      scopeKey: 'g',
      amount: 5,
      choice,
      funConfig: { flipMin: 1, flipMax: 100, flipCooldownMs: 0 },
    });
    if (!r.ok) throw new Error(r.reason);
    if (r.side === 'cara') cara += 1;
    else coroa += 1;
    if (r.win) wins += 1;
  }
  console.log(label, {
    cara,
    coroa,
    pctCara: ((cara / N) * 100).toFixed(2) + '%',
    pctCoroa: ((coroa / N) * 100).toFixed(2) + '%',
    winRate: ((wins / N) * 100).toFixed(2) + '%',
  });
}

console.log('=== soloFlip fairness ===');
run('pick alternado', (i) => (i % 2 ? 'cara' : 'coroa'));
run('sempre cara', () => 'cara');
run('sempre coroa', () => 'coroa');

// show source logic
console.log(`
Código (gameService.soloFlip):
  landOnPick = random() < 0.5   // amuleto: 0.65
  resultSide = landOnPick ? pick : opposite(pick)
  win = resultSide === pick

Mensagem (games.js):
  Sua aposta: pick
  Moeda: side
`);
