/**
 * Temporadas festivas BR + paletas vivas para cards do Fun.
 * Fuso default: America/Sao_Paulo.
 */

/**
 * Partes de data local no fuso.
 * @returns {{ y: number, m: number, d: number, month: number, day: number }}
 */
export function getLocalYmd(nowMs = Date.now(), timeZone = 'America/Sao_Paulo') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: String(timeZone || 'America/Sao_Paulo'),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(nowMs));
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const m = Number(parts.find((p) => p.type === 'month')?.value);
    const d = Number(parts.find((p) => p.type === 'day')?.value);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      return { y, m, d, month: m, day: d };
    }
  } catch {
    /* fallthrough */
  }
  const dt = new Date(nowMs);
  return {
    y: dt.getFullYear(),
    m: dt.getMonth() + 1,
    d: dt.getDate(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
  };
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher) → Date UTC noon */
export function easterSundayUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=Mar, 4=Apr
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function ymdKey(y, m, d) {
  return y * 10000 + m * 100 + d;
}

function addDaysUtc(date, days) {
  const t = new Date(date.getTime());
  t.setUTCDate(t.getUTCDate() + days);
  return t;
}

/**
 * @returns {'carnaval'|'sao_joao'|'natal'|'ano_novo'|null}
 */
export function resolveFestiveSeason(nowMs = Date.now(), timeZone = 'America/Sao_Paulo') {
  const { y, m, d } = getLocalYmd(nowMs, timeZone);
  const key = ymdKey(y, m, d);

  // Ano novo: 27/12 → 05/01
  if ((m === 12 && d >= 27) || (m === 1 && d <= 5)) return 'ano_novo';

  // Natal: 15/12 → 26/12
  if (m === 12 && d >= 15 && d <= 26) return 'natal';

  // São João / festas juninas: 13/06 → 30/06
  if (m === 6 && d >= 13 && d <= 30) return 'sao_joao';

  // Carnaval: sexta pré-carnaval até terça (Páscoa − 51 … Páscoa − 47)
  // janela um pouco larga: Páscoa − 55 … Páscoa − 45
  const easter = easterSundayUtc(y);
  const start = addDaysUtc(easter, -55);
  const end = addDaysUtc(easter, -45);
  const startKey = ymdKey(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
  const endKey = ymdKey(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
  if (key >= startKey && key <= endKey) return 'carnaval';

  // virada de ano no carnaval de janeiro? rare — ok

  return null;
}

/** Paletas festivas (override de canvas/accent/decor) */
export const FESTIVE_PALETTES = Object.freeze({
  carnaval: Object.freeze({
    id: 'carnaval',
    label: 'Carnaval',
    canvas: '#1a0533',
    raise: '#2d0b4e',
    raise2: '#4c1d95',
    border: '#f472b6',
    accent: '#fbbf24',
    accent2: '#22c55e',
    accent3: '#ec4899',
    text: '#fdf4ff',
    muted: '#e9d5ff',
    success: '#4ade80',
    danger: '#fb7185',
    decor: 'confetti',
  }),
  sao_joao: Object.freeze({
    id: 'sao_joao',
    label: 'São João',
    canvas: '#1c1006',
    raise: '#2a1808',
    raise2: '#78350f',
    border: '#f59e0b',
    accent: '#fbbf24',
    accent2: '#38bdf8',
    accent3: '#ef4444',
    text: '#fff7ed',
    muted: '#fdba74',
    success: '#4ade80',
    danger: '#f87171',
    decor: 'flags',
  }),
  natal: Object.freeze({
    id: 'natal',
    label: 'Natal',
    canvas: '#0c1410',
    raise: '#14201a',
    raise2: '#14532d',
    border: '#dc2626',
    accent: '#ef4444',
    accent2: '#22c55e',
    accent3: '#fbbf24',
    text: '#fef2f2',
    muted: '#86efac',
    success: '#4ade80',
    danger: '#f87171',
    decor: 'snow',
  }),
  ano_novo: Object.freeze({
    id: 'ano_novo',
    label: 'Ano Novo',
    canvas: '#0a0a0c',
    raise: '#17171c',
    raise2: '#292524',
    border: '#fbbf24',
    accent: '#facc15',
    accent2: '#f5f5f4',
    accent3: '#a78bfa',
    text: '#fafaf9',
    muted: '#d6d3d1',
    success: '#4ade80',
    danger: '#f87171',
    decor: 'sparkle',
  }),
});

/**
 * Temas base por comando (vivos, fun) — depois tintados pelo festival.
 */
export const COMMAND_BASE = Object.freeze({
  xp: Object.freeze({
    id: 'xp',
    title: 'Rank XP',
    canvas: '#0b1220',
    raise: '#111827',
    raise2: '#1e3a5f',
    border: '#38bdf8',
    accent: '#38bdf8',
    accent2: '#818cf8',
    text: '#f0f9ff',
    muted: '#7dd3fc',
    medal1: '#fbbf24',
    medal2: '#e2e8f0',
    medal3: '#fb923c',
    symbol: '#4ade80',
    danger: '#f87171',
    symbol: 'star',
  }),
  coins: Object.freeze({
    id: 'coins',
    title: 'Rank coins',
    canvas: '#1a1205',
    raise: '#292010',
    raise2: '#713f12',
    border: '#fbbf24',
    accent: '#facc15',
    accent2: '#f59e0b',
    text: '#fffbeb',
    muted: '#fcd34d',
    medal1: '#fde047',
    medal2: '#fbbf24',
    medal3: '#d97706',
    success: '#4ade80',
    danger: '#f87171',
    symbol: 'coins',
  }),
  messages: Object.freeze({
    id: 'messages',
    title: 'Top mensagens',
    canvas: '#042f2e',
    raise: '#0f3d3c',
    raise2: '#115e59',
    border: '#2dd4bf',
    accent: '#2dd4bf',
    accent2: '#5eead4',
    text: '#f0fdfa',
    muted: '#5eead4',
    medal1: '#fbbf24',
    medal2: '#99f6e4',
    medal3: '#14b8a6',
    success: '#4ade80',
    danger: '#f87171',
    symbol: 'chat',
  }),
  casino: Object.freeze({
    id: 'casino',
    title: 'Rank cassino',
    canvas: '#1a0533',
    raise: '#2e1065',
    raise2: '#5b21b6',
    border: '#e879f9',
    accent: '#e879f9',
    accent2: '#c084fc',
    text: '#fdf4ff',
    muted: '#e9d5ff',
    medal1: '#fbbf24',
    medal2: '#f0abfc',
    medal3: '#a78bfa',
    success: '#4ade80',
    danger: '#fb7185',
    symbol: 'chip',
  }),
  profile: Object.freeze({
    id: 'profile',
    title: 'Perfil',
    canvas: '#0c0a1a',
    raise: '#1e1b4b',
    raise2: '#312e81',
    border: '#818cf8',
    accent: '#a5b4fc',
    accent2: '#c4b5fd',
    text: '#eef2ff',
    muted: '#a5b4fc',
    success: '#4ade80',
    danger: '#f87171',
    symbol: 'badge',
  }),
  bolsa: Object.freeze({
    id: 'bolsa',
    title: 'Corretora do Beco',
    canvas: '#022c22',
    raise: '#064e3b',
    raise2: '#065f46',
    border: '#34d399',
    accent: '#34d399',
    accent2: '#6ee7b7',
    text: '#ecfdf5',
    muted: '#6ee7b7',
    success: '#4ade80',
    danger: '#f87171',
    symbol: 'chart',
  }),
  carteira: Object.freeze({
    id: 'carteira',
    title: 'Carteira',
    canvas: '#1c1917',
    raise: '#292524',
    raise2: '#44403c',
    border: '#fbbf24',
    accent: '#fbbf24',
    accent2: '#fcd34d',
    text: '#fafaf9',
    muted: '#d6d3d1',
    success: '#4ade80',
    danger: '#f87171',
    symbol: 'wallet',
  }),
});

/**
 * Mistura tema do comando com temporada festiva (se houver).
 * @param {string} commandId
 * @param {number} [nowMs]
 * @param {string} [timeZone]
 */
export function resolveCardTheme(commandId, nowMs = Date.now(), timeZone = 'America/Sao_Paulo') {
  const base = COMMAND_BASE[commandId] || COMMAND_BASE.xp;
  const season = resolveFestiveSeason(nowMs, timeZone);
  if (!season || !FESTIVE_PALETTES[season]) {
    return { ...base, festive: null };
  }
  const f = FESTIVE_PALETTES[season];
  return {
    ...base,
    canvas: f.canvas,
    raise: f.raise,
    raise2: f.raise2,
    border: f.border,
    accent: f.accent,
    accent2: f.accent2 || base.accent2,
    accent3: f.accent3,
    text: f.text,
    muted: f.muted,
    success: f.success || base.success,
    danger: f.danger || base.danger,
    festive: f,
  };
}

/** @deprecated alias */
export const LEADERBOARD_THEMES = Object.freeze({
  xp: COMMAND_BASE.xp,
  coins: COMMAND_BASE.coins,
  messages: COMMAND_BASE.messages,
  casino: COMMAND_BASE.casino,
});
