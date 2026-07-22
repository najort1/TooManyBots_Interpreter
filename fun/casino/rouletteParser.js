export function parseRouletteBet(args = []) {
  let amount = null;
  let choice = null;

  for (const raw of args) {
    const t = String(raw || '').trim();
    if (!t) continue;

    if (/^\d+$/.test(t) && amount === null) {
      amount = Number(t);
      continue;
    }

    const n = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    if (['vermelho', 'red', 'r', 'v'].includes(n)) {
      choice = { type: 'color', value: 'red' };
      continue;
    }
    if (['preto', 'black', 'b', 'p'].includes(n)) {
      choice = { type: 'color', value: 'black' };
      continue;
    }
    if (['verde', 'green', 'zero', '0'].includes(n)) {
      choice = { type: 'number', value: 0 };
      continue;
    }
    if (['par', 'even', 'e'].includes(n)) {
      choice = { type: 'parity', value: 'even' };
      continue;
    }
    if (['impar', 'impAR', 'odd', 'o', 'i'].includes(n)) {
      choice = { type: 'parity', value: 'odd' };
      continue;
    }
    if (['baixo', 'low', '1-18', '1a18'].includes(n)) {
      choice = { type: 'half', value: 'low' };
      continue;
    }
    if (['alto', 'high', '19-36', '19a36'].includes(n)) {
      choice = { type: 'half', value: 'high' };
      continue;
    }
    if (['d1', 'primeira', 'primeiro', '1-12', '1a12'].includes(n)) {
      choice = { type: 'dozen', value: 1 };
      continue;
    }
    if (['d2', 'segunda', 'segundo', '13-24', '13a24'].includes(n)) {
      choice = { type: 'dozen', value: 2 };
      continue;
    }
    if (['d3', 'terceira', 'terceiro', '25-36', '25a36'].includes(n)) {
      choice = { type: 'dozen', value: 3 };
      continue;
    }
    if (['col1', 'c1', 'coluna1'].includes(n)) {
      choice = { type: 'column', value: 1 };
      continue;
    }
    if (['col2', 'c2', 'coluna2'].includes(n)) {
      choice = { type: 'column', value: 2 };
      continue;
    }
    if (['col3', 'c3', 'coluna3'].includes(n)) {
      choice = { type: 'column', value: 3 };
      continue;
    }
    if (/^\d{1,2}$/.test(n)) {
      const num = Number(n);
      if (num >= 1 && num <= 36) {
        choice = { type: 'number', value: num };
      }
    }
  }

  return { amount, choice };
}

const LABELS = {
  'color-red': 'vermelho',
  'color-black': 'preto',
  'parity-even': 'par',
  'parity-odd': 'ímpar',
  'half-low': 'baixo (1-18)',
  'half-high': 'alto (19-36)',
  'dozen-1': 'D1 (1-12)',
  'dozen-2': 'D2 (13-24)',
  'dozen-3': 'D3 (25-36)',
  'column-1': 'Coluna 1',
  'column-2': 'Coluna 2',
  'column-3': 'Coluna 3',
};

export function choiceLabel(choice) {
  if (!choice) return '?';
  if (choice.type === 'number') return String(choice.value);
  return LABELS[`${choice.type}-${choice.value}`] ?? '?';
}

export const PAYOUT_MAP = {
  color: 2,
  parity: 2,
  half: 2,
  dozen: 3,
  column: 3,
  number: 36,
};

export function payoutMultiplier(choice) {
  return PAYOUT_MAP[choice?.type] ?? 0;
}

export function isEvenMoneyBet(choice) {
  return choice && ['color', 'parity', 'half'].includes(choice.type);
}
