/**
 * Mini Bingo — lógica pura (sem I/O).
 * Cartela 3×3 · pool 1..poolMax · sorteio em lote (sessão curta).
 */

export const BINGO_ROOM_USER = '__bingo__';
export const BINGO_ROOM_KIND = 'bingo_room';

export const BINGO_MODES = Object.freeze({
  FAST: 'fast',
  CLASSIC: 'classic',
});

export const BINGO_DEFAULTS = Object.freeze({
  poolMax: 30,
  cardSize: 9,
  drawCount: 12,
  size: 4,
  minPlayers: 2,
  houseEdge: 0.05,
  soloLineMult: 2.5,
  soloFullMult: 8,
  mode: BINGO_MODES.FAST,
  classicIntervalMs: 1_000,
  classicEarlyEndOnFull: true,
});

/**
 * @param {unknown} raw
 * @returns {'fast'|'classic'}
 */
export function normalizeBingoMode(raw) {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (['classic', 'classico', 'classica', 'lento', 'tempo', 'realtime', 'real'].includes(t)) {
    return BINGO_MODES.CLASSIC;
  }
  if (['fast', 'rapido', 'rapida', 'quick', 'instant', 'instantaneo'].includes(t)) {
    return BINGO_MODES.FAST;
  }
  return BINGO_MODES.FAST;
}

/**
 * Embaralha e retorna `count` inteiros distintos em [1, max].
 * @param {number} count
 * @param {number} max
 * @param {() => number} random
 * @returns {number[]}
 */
export function pickDistinct(count, max, random = Math.random) {
  const n = Math.max(1, Math.floor(Number(max) || 1));
  const k = Math.min(n, Math.max(0, Math.floor(Number(count) || 0)));
  const arr = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor((typeof random === 'function' ? random() : Math.random()) * (n - i));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, k);
}

/**
 * @param {() => number} random
 * @param {{ poolMax?: number, cardSize?: number }} [opts]
 * @returns {number[]} flat 3×3 row-major
 */
export function makeBingoCard(random = Math.random, opts = {}) {
  const poolMax = Math.max(9, Math.floor(Number(opts.poolMax) || BINGO_DEFAULTS.poolMax));
  const cardSize = Math.min(poolMax, Math.max(9, Math.floor(Number(opts.cardSize) || BINGO_DEFAULTS.cardSize)));
  return pickDistinct(cardSize, poolMax, random);
}

/**
 * @param {number[]} card
 * @param {Iterable<number>} drawn
 */
export function evaluateBingoCard(card, drawn) {
  const cells = Array.isArray(card) ? card.map((n) => Math.floor(Number(n) || 0)) : [];
  const drawnSet = drawn instanceof Set ? drawn : new Set([...(drawn || [])].map((n) => Math.floor(Number(n) || 0)));
  const marked = cells.map((n) => n > 0 && drawnSet.has(n));
  const lines = [];

  if (cells.length >= 9) {
    for (let r = 0; r < 3; r += 1) {
      const i0 = r * 3;
      if (marked[i0] && marked[i0 + 1] && marked[i0 + 2]) lines.push(`r${r}`);
    }
    for (let c = 0; c < 3; c += 1) {
      if (marked[c] && marked[c + 3] && marked[c + 6]) lines.push(`c${c}`);
    }
    if (marked[0] && marked[4] && marked[8]) lines.push('d0');
    if (marked[2] && marked[4] && marked[6]) lines.push('d1');
  }

  const markedCount = marked.filter(Boolean).length;
  const full = cells.length >= 9 && marked.every(Boolean);
  return {
    lines,
    hasLine: lines.length > 0,
    full,
    markedCount,
    marked,
  };
}

/**
 * @param {number[]} card
 * @param {Iterable<number>} [drawn]
 * @returns {string}
 */
export function formatBingoCard(card, drawn = []) {
  const cells = Array.isArray(card) ? card : [];
  const drawnSet = drawn instanceof Set ? drawn : new Set([...(drawn || [])].map((n) => Math.floor(Number(n) || 0)));
  const cell = (n) => {
    const v = Math.floor(Number(n) || 0);
    if (v <= 0) return ' · ';
    if (drawnSet.has(v)) return ' ✅';
    return String(v).padStart(2, ' ');
  };
  const rows = [];
  for (let r = 0; r < 3; r += 1) {
    const i = r * 3;
    rows.push(`${cell(cells[i])} │ ${cell(cells[i + 1])} │ ${cell(cells[i + 2])}`);
  }
  return rows.join('\n');
}

/**
 * Snapshot visual de todos os jogadores com drawn atual.
 * @param {{ jid: string, card: number[] }[]} players
 * @param {number[]} drawn
 */
export function snapshotBingoPlayers(players, drawn) {
  const list = Array.isArray(players) ? players : [];
  const drawnList = Array.isArray(drawn) ? drawn : [];
  return list.map((p) => {
    const jid = String(p?.jid || '');
    const card = Array.isArray(p?.card) ? p.card : [];
    const ev = evaluateBingoCard(card, drawnList);
    return {
      jid,
      card,
      full: ev.full,
      hasLine: ev.hasLine,
      lines: ev.lines,
      markedCount: ev.markedCount,
      cardText: formatBingoCard(card, drawnList),
    };
  });
}

/**
 * Resolve vencedores de uma rodada multiplayer.
 * Prioridade: cartela cheia > linha. Sem vencedor → reembolso.
 *
 * @param {{ jid: string, card: number[] }[]} players
 * @param {number[]} drawn
 * @param {number} pot
 * @param {{ houseEdge?: number }} [opts]
 */
export function resolveBingoRound(players, drawn, pot, opts = {}) {
  const edge = Math.min(0.2, Math.max(0, Number(opts.houseEdge) ?? BINGO_DEFAULTS.houseEdge));
  const rawPot = Math.max(0, Math.floor(Number(pot) || 0));
  const netPot = Math.max(0, Math.floor(rawPot * (1 - edge)));
  const drawnList = (Array.isArray(drawn) ? drawn : []).map((n) => Math.floor(Number(n) || 0)).filter((n) => n > 0);
  const drawnSet = new Set(drawnList);

  const results = (players || []).map((p) => {
    const jid = String(p?.jid || '');
    const card = Array.isArray(p?.card) ? p.card : [];
    const ev = evaluateBingoCard(card, drawnSet);
    return {
      jid,
      card,
      lines: ev.lines,
      hasLine: ev.hasLine,
      full: ev.full,
      markedCount: ev.markedCount,
      payout: 0,
    };
  });

  const fullWinners = results.filter((r) => r.full && r.jid);
  const lineWinners = results.filter((r) => !r.full && r.hasLine && r.jid);

  let tier = 'none';
  let winners = [];
  if (fullWinners.length > 0) {
    tier = 'full';
    winners = fullWinners;
  } else if (lineWinners.length > 0) {
    tier = 'line';
    winners = lineWinners;
  }

  if (tier === 'none' || winners.length === 0 || netPot <= 0) {
    return {
      tier: 'none',
      drawn: drawnList,
      netPot,
      rawPot,
      results: results.map((r) => ({ ...r, payout: 0 })),
      winners: [],
      refund: true,
    };
  }

  const base = Math.floor(netPot / winners.length);
  let remainder = netPot - base * winners.length;
  const payoutByJid = new Map();
  for (const w of winners) {
    let pay = base;
    if (remainder > 0) {
      pay += 1;
      remainder -= 1;
    }
    payoutByJid.set(w.jid, pay);
  }

  const withPay = results.map((r) => ({
    ...r,
    payout: payoutByJid.get(r.jid) || 0,
  }));

  return {
    tier,
    drawn: drawnList,
    netPot,
    rawPot,
    results: withPay,
    winners: withPay.filter((r) => r.payout > 0),
    refund: false,
  };
}

/**
 * Payout solo (vs casa).
 * @param {{ full: boolean, hasLine: boolean }} evaluation
 * @param {number} stake
 * @param {{ lineMult?: number, fullMult?: number, happy?: number }} [opts]
 */
export function soloBingoPayout(evaluation, stake, opts = {}) {
  const s = Math.max(0, Math.floor(Number(stake) || 0));
  const happy = Number.isFinite(Number(opts.happy)) ? Math.max(1, Number(opts.happy)) : 1;
  const lineMult = Number(opts.lineMult) || BINGO_DEFAULTS.soloLineMult;
  const fullMult = Number(opts.fullMult) || BINGO_DEFAULTS.soloFullMult;
  if (evaluation?.full) {
    return Math.max(1, Math.floor(s * fullMult * happy));
  }
  if (evaluation?.hasLine) {
    return Math.max(1, Math.floor(s * lineMult * happy));
  }
  return 0;
}
