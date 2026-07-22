import { choiceLabel } from './rouletteParser.js';

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

function ballColor(ball) {
  if (ball === 0) return 'green';
  return RED_NUMBERS.has(ball) ? 'red' : 'black';
}

function rollInt(min, max, random = Math.random) {
  const a = Math.floor(Number(min) || 0);
  const b = Math.max(a, Math.floor(Number(max) || a));
  if (b === a) return a;
  return a + Math.floor(random() * (b - a + 1));
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function spinWheel(random = Math.random) {
  const ball = rollInt(0, 36, random);
  return { ball, color: ballColor(ball) };
}

export function determineWin(ball, choice) {
  const color = ballColor(ball);
  switch (choice.type) {
    case 'color':
      return { win: color === choice.value, payoutMult: 2 };
    case 'number':
      return { win: ball === choice.value, payoutMult: 36 };
    case 'parity': {
      if (ball === 0) return { win: false, payoutMult: 2 };
      const isEven = ball % 2 === 0;
      return { win: choice.value === 'even' ? isEven : !isEven, payoutMult: 2 };
    }
    case 'half': {
      if (ball === 0) return { win: false, payoutMult: 2 };
      const isLow = ball >= 1 && ball <= 18;
      return { win: choice.value === 'low' ? isLow : !isLow, payoutMult: 2 };
    }
    case 'dozen': {
      if (ball === 0) return { win: false, payoutMult: 3 };
      const d = Math.ceil(ball / 12);
      return { win: d === choice.value, payoutMult: 3 };
    }
    case 'column': {
      if (ball === 0) return { win: false, payoutMult: 3 };
      const c = ((ball - 1) % 3) + 1;
      return { win: c === choice.value, payoutMult: 3 };
    }
    default:
      return { win: false, payoutMult: 0 };
  }
}

export function applyLaPartage(ball, choice, stake) {
  if (ball !== 0) return { applied: false, refund: 0 };
  if (!choice || !['color', 'parity', 'half'].includes(choice.type)) {
    return { applied: false, refund: 0 };
  }
  return { applied: true, refund: Math.floor(stake / 2) };
}

export function calculatePayout(stake, win, payoutMult, happy = 1, funConfig = {}, choice = null) {
  if (!win) return 0;
  let payout = Math.floor(stake * payoutMult * happy);
  const edge = Math.min(0.1, Math.max(0, numOr(funConfig.casinoHouseEdge, 0.03)));
  if (choice?.type === 'number' && edge > 0) {
    payout = Math.max(stake, Math.floor(payout * (1 - edge * 0.25)));
  }
  return payout;
}

export function applyCharmBoost(charm, choice, random = Math.random) {
  if (!charm || charm.charges <= 0) return { boost: false, used: false };
  if (choice.type !== 'color') return { boost: false, used: false };
  return { boost: true, used: true };
}
