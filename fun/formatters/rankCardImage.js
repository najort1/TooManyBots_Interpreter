/**
 * PNGs do Fun — placares, perfil, bolsa e carteira (sem deps nativas).
 * Fonte bitmap 5x7 + zlib do Node.
 */

import zlib from 'zlib';
import { progressInLevel } from '../services/levelCurve.js';

// Glyphs 5x7. Caracteres sem glifo são omitidos (não viram '?').
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 4, 4],
  ',': [0, 0, 0, 0, 4, 4, 8],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '+': [0, 4, 4, 31, 4, 4, 0],
  ':': [0, 4, 4, 0, 4, 4, 0],
  '%': [25, 26, 2, 4, 8, 11, 19],
  '#': [10, 31, 10, 31, 10, 0, 0],
  '/': [1, 1, 2, 4, 8, 16, 16],
  '(': [4, 8, 16, 16, 16, 8, 4],
  ')': [4, 2, 1, 1, 1, 2, 4],
  '[': [14, 8, 8, 8, 8, 8, 14],
  ']': [14, 2, 2, 2, 2, 2, 14],
  "'": [4, 4, 8, 0, 0, 0, 0],
  '"': [10, 10, 0, 0, 0, 0, 0],
  '!': [4, 4, 4, 4, 4, 0, 4],
  '_': [0, 0, 0, 0, 0, 0, 31],
  '=': [0, 0, 31, 0, 31, 0, 0],
  '<': [2, 4, 8, 16, 8, 4, 2],
  '>': [8, 4, 2, 1, 2, 4, 8],
  '@': [14, 17, 23, 21, 23, 16, 14],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [14, 16, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 1, 14],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [1, 1, 1, 1, 17, 17, 14],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [14, 17, 16, 14, 1, 17, 14],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '?': [14, 17, 1, 2, 4, 0, 4],
};

/** Temas de placar — cada rank com personalidade visual */
export const LEADERBOARD_THEMES = Object.freeze({
  xp: {
    id: 'xp',
    title: 'RANK XP',
    canvas: [9, 9, 11],
    header: [24, 24, 27],
    accent: [113, 113, 122],
    rowAlt: [24, 24, 27],
    text: [228, 228, 231],
    muted: [161, 161, 170],
    gold: [250, 204, 21],
    silver: [212, 212, 216],
    bronze: [251, 146, 60],
  },
  coins: {
    id: 'coins',
    title: 'RANK COINS',
    canvas: [12, 10, 6],
    header: [39, 32, 12],
    accent: [234, 179, 8],
    rowAlt: [28, 24, 12],
    text: [254, 243, 199],
    muted: [202, 138, 4],
    gold: [250, 204, 21],
    silver: [253, 224, 71],
    bronze: [245, 158, 11],
  },
  messages: {
    id: 'messages',
    title: 'TOP MSG',
    canvas: [8, 12, 18],
    header: [15, 23, 42],
    accent: [56, 189, 248],
    rowAlt: [15, 23, 42],
    text: [224, 242, 254],
    muted: [125, 211, 252],
    gold: [56, 189, 248],
    silver: [147, 197, 253],
    bronze: [96, 165, 250],
  },
  casino: {
    id: 'casino',
    title: 'RANK CASSINO',
    canvas: [12, 6, 14],
    header: [36, 12, 40],
    accent: [232, 121, 249],
    rowAlt: [30, 10, 34],
    text: [250, 232, 255],
    muted: [192, 132, 252],
    gold: [250, 204, 21],
    silver: [244, 114, 182],
    bronze: [192, 132, 252],
    up: [52, 211, 153],
    down: [248, 113, 113],
  },
});

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Texto seguro para a fonte bitmap:
 * - remove emoji / símbolos
 * - troca · • — por espaços ou traço
 * - omite o que não tem glifo (evita chuva de '?')
 */
export function sanitizeCardText(s) {
  let t = String(s || '');
  // emojis e pictogramas
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '');
  // separadores fancy → ASCII
  t = t.replace(/[·•∙⋅]/g, ' ');
  t = t.replace(/[—–−]/g, '-');
  t = t.replace(/[“”„«»]/g, '"');
  t = t.replace(/[‘’]/g, "'");
  t = stripAccents(t);
  // só chars que existem na fonte
  let out = '';
  for (const ch of t) {
    if (FONT[ch] !== undefined) out += ch;
    // senão: ignora (não desenha '?')
  }
  // colapsa espaços
  return out.replace(/\s+/g, ' ').trim();
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array|Buffer} rgb - length width*height*3
 */
export function encodePngRgb(width, height, rgb) {
  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0;
    const src = y * width * 3;
    rgb.copy(raw, rowStart + 1, src, src + width * 3);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function fillRect(rgb, w, x0, y0, rw, rh, r, g, b) {
  const h = rgb.length / (w * 3);
  for (let y = y0; y < y0 + rh; y += 1) {
    if (y < 0 || y >= h) continue;
    for (let x = x0; x < x0 + rw; x += 1) {
      if (x < 0 || x >= w) continue;
      const i = (y * w + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
}

function drawChar(rgb, w, x, y, ch, r, g, b, scale = 2) {
  const glyph = FONT[ch];
  if (!glyph) return;
  for (let row = 0; row < 7; row += 1) {
    const bits = glyph[row] || 0;
    for (let col = 0; col < 5; col += 1) {
      if (bits & (1 << (4 - col))) {
        fillRect(rgb, w, x + col * scale, y + row * scale, scale, scale, r, g, b);
      }
    }
  }
}

function drawText(rgb, w, x, y, text, r, g, b, scale = 2) {
  const normalized = sanitizeCardText(text);
  let cx = x;
  for (const ch of normalized) {
    if (FONT[ch] === undefined) continue;
    drawChar(rgb, w, cx, y, ch, r, g, b, scale);
    cx += 6 * scale;
  }
  return cx;
}

function shortName(name, userJid, maxLen = 16) {
  let n = sanitizeCardText(name);
  if (n.startsWith('@')) n = n.slice(1);
  if (!n) {
    const local = sanitizeCardText(String(userJid || '').split('@')[0] || '');
    n = local.length > 8 ? `${local.slice(0, 4)}..${local.slice(-3)}` : local || 'USER';
  }
  if (n.length > maxLen) n = `${n.slice(0, maxLen - 2)}..`;
  return n;
}

function fmtNum(n) {
  const v = Math.floor(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}K`;
  return String(v);
}

function resolveTheme(themeOrId) {
  if (themeOrId && typeof themeOrId === 'object') return themeOrId;
  const id = String(themeOrId || 'xp').toLowerCase();
  return LEADERBOARD_THEMES[id] || LEADERBOARD_THEMES.xp;
}

/**
 * Placar genérico (XP / coins / msgs / cassino).
 * @returns {Buffer} PNG
 */
export function renderLeaderboardPng({
  title,
  theme = 'xp',
  entries = [],
  yourRank = null,
  yourTotal = null,
  yourExtra = '',
  footer = '',
  lineBuilder = null,
} = {}) {
  const t = resolveTheme(theme);
  const width = 720;
  const rowH = 44;
  const headerH = 78;
  const colH = 28;
  const footerH = 48;
  const pad = 24;
  const rows = Math.min(10, Math.max(entries.length, 1));
  const height = headerH + colH + rows * rowH + footerH + pad;

  const rgb = Buffer.alloc(width * height * 3);
  fillRect(rgb, width, 0, 0, width, height, ...t.canvas);
  fillRect(rgb, width, 0, 0, width, headerH, ...t.header);
  fillRect(rgb, width, 0, headerH - 2, width, 2, ...t.accent);

  drawText(rgb, width, pad, 28, title || t.title, 250, 250, 250, 3);

  // Cabeçalho de colunas (o que cada número significa)
  let colLabel = 'POS  NOME                NIVEL   XP';
  if (t.id === 'coins') colLabel = 'POS  NOME                COINS';
  else if (t.id === 'messages') colLabel = 'POS  NOME                MENSAGENS';
  else if (t.id === 'casino') colLabel = 'POS  NOME                LUCRO     JOGOS';
  drawText(rgb, width, pad, headerH + 6, colLabel, ...t.muted, 2);

  const bodyY0 = headerH + colH;
  if (!entries.length) {
    drawText(rgb, width, pad, bodyY0 + 16, 'SEM DADOS AINDA', ...t.muted, 2);
  } else {
    entries.slice(0, 10).forEach((entry, idx) => {
      const y = bodyY0 + idx * rowH + 10;
      if (idx % 2 === 0) {
        fillRect(rgb, width, pad - 4, y - 6, width - pad * 2 + 8, rowH - 6, ...t.rowAlt);
      }
      const rank = entry.rank || idx + 1;
      let color = t.text;
      if (rank === 1) color = t.gold;
      else if (rank === 2) color = t.silver;
      else if (rank === 3) color = t.bronze;

      if (t.id === 'casino' && entry.profit != null) {
        if (entry.profit > 0) color = t.up || t.gold;
        else if (entry.profit < 0) color = t.down || t.bronze;
      }

      let line;
      if (typeof lineBuilder === 'function') {
        line = lineBuilder(entry, rank);
      } else if (t.id === 'coins') {
        line = `#${rank}   ${shortName(entry.displayName, entry.userJid, 18)}   ${fmtNum(entry.coins)} COINS`;
      } else if (t.id === 'messages') {
        line = `#${rank}   ${shortName(entry.displayName, entry.userJid, 18)}   ${fmtNum(entry.messageCount)} MSGS`;
      } else if (t.id === 'casino') {
        const sign = entry.profit >= 0 ? '+' : '';
        line = `#${rank}   ${shortName(entry.displayName, entry.userJid, 16)}   ${sign}${fmtNum(entry.profit)}   ${fmtNum(entry.games)} JOGOS`;
      } else {
        line = `#${rank}   ${shortName(entry.displayName, entry.userJid, 16)}   LV${entry.level}   ${fmtNum(entry.xp)} XP`;
      }
      drawText(rgb, width, pad, y, line, ...color, 2);
    });
  }

  const footerLine =
    String(footer || '').trim() ||
    (yourRank != null
      ? `VOCE: #${yourRank}${yourTotal ? `/${yourTotal}` : ''}${yourExtra ? `  ${yourExtra}` : ''}`
      : yourExtra
        ? `VOCE: ${yourExtra}`
        : '');
  if (footerLine) {
    drawText(rgb, width, pad, height - 32, footerLine, ...t.muted, 2);
  }

  return encodePngRgb(width, height, rgb);
}

/** Compat: rank XP (tema zinc). */
export function renderRankCardPng({
  title = 'RANKING',
  entries = [],
  yourRank = null,
  yourTotal = null,
} = {}) {
  return renderLeaderboardPng({
    title,
    theme: 'xp',
    entries,
    yourRank,
    yourTotal,
  });
}

/**
 * Cartão de identidade — perfil.
 */
export function renderProfileCardPng({
  displayName = '',
  userJid = '',
  stats = {},
  rank = null,
  total = 0,
  coinsRank = null,
  messagesRank = null,
  partnerName = '',
  factionLabel = '',
  casino = null,
  employment = null,
  isSelf = true,
} = {}) {
  const width = 720;
  const height = 480;
  const pad = 28;
  const rgb = Buffer.alloc(width * height * 3);

  fillRect(rgb, width, 0, 0, width, height, 15, 15, 18);
  fillRect(rgb, width, 0, 0, 10, height, 63, 63, 70);
  fillRect(rgb, width, 0, 0, width, 88, 24, 24, 27);
  fillRect(rgb, width, 0, 86, width, 2, 161, 161, 170);

  const name = shortName(displayName, userJid, 22);
  const title = String(stats.title || '').trim();
  const xp = Number(stats.xp) || 0;
  const progress = progressInLevel(xp);
  const level = Number(stats.level) || progress.level;
  const coins = Number(stats.coins) || 0;
  const streak = Number(stats.dailyStreak) || 0;
  const messages = Number(stats.messageCount) || 0;

  drawText(rgb, width, pad, 22, isSelf ? 'SEU PERFIL' : 'PERFIL', 161, 161, 170, 2);
  drawText(rgb, width, pad, 48, name, 250, 250, 250, 3);
  if (title) {
    drawText(rgb, width, pad + 280, 52, shortName(title, '', 14), 212, 212, 216, 2);
  }

  drawText(rgb, width, pad, 112, `NIVEL ${level}`, 250, 250, 250, 4);
  drawText(rgb, width, pad + 220, 128, `${fmtNum(xp)} XP TOTAL`, 161, 161, 170, 2);

  const barX = pad;
  const barY = 168;
  const barW = width - pad * 2;
  const barH = 18;
  fillRect(rgb, width, barX, barY, barW, barH, 39, 39, 42);
  const ratio =
    progress.xpForNext > 0
      ? Math.min(1, Math.max(0, progress.xpIntoLevel / progress.xpForNext))
      : 0;
  fillRect(rgb, width, barX, barY, Math.max(2, Math.floor(barW * ratio)), barH, 228, 228, 231);
  drawText(
    rgb,
    width,
    pad,
    198,
    `PROGRESSO ${progress.xpIntoLevel}/${progress.xpForNext} XP  -  RANK XP #${rank || '-'}`,
    161,
    161,
    170,
    2
  );

  // Bloco de recursos
  const y0 = 240;
  drawText(rgb, width, pad, y0, 'RECURSOS', 113, 113, 122, 2);
  drawText(rgb, width, pad, y0 + 28, `COINS: ${fmtNum(coins)}`, 250, 204, 21, 2);
  drawText(rgb, width, pad + 280, y0 + 28, `MENSAGENS: ${fmtNum(messages)}`, 56, 189, 248, 2);
  drawText(rgb, width, pad, y0 + 56, `STREAK DAILY: ${streak}`, 52, 211, 153, 2);

  // Ranks com nome por extenso
  drawText(rgb, width, pad, y0 + 96, 'RANKINGS NO GRUPO', 113, 113, 122, 2);
  drawText(
    rgb,
    width,
    pad,
    y0 + 124,
    `RANK XP: #${rank || '-'}   RANK COINS: #${coinsRank || '-'}   RANK MSGS: #${messagesRank || '-'}`,
    212,
    212,
    216,
    2
  );

  let y = y0 + 164;
  if (employment?.job) {
    drawText(
      rgb,
      width,
      pad,
      y,
      `EMPREGO: ${shortName(employment.job.name || employment.job.id, '', 16)}  ~${fmtNum(employment.salary)} COINS/DIA`,
      212,
      212,
      216,
      2
    );
    y += 28;
  }
  if (factionLabel) {
    drawText(
      rgb,
      width,
      pad,
      y,
      `FACCAO: ${shortName(factionLabel, '', 24)}`,
      212,
      212,
      216,
      2
    );
    y += 28;
  }
  if (partnerName) {
    drawText(
      rgb,
      width,
      pad,
      y,
      `CASADO COM: ${shortName(partnerName, '', 20)}`,
      244,
      114,
      182,
      2
    );
    y += 28;
  }
  if (casino && (casino.games > 0 || casino.wagered > 0)) {
    const profit = Number(casino.profit) || 0;
    const sign = profit >= 0 ? '+' : '';
    const col = profit >= 0 ? [52, 211, 153] : [248, 113, 113];
    drawText(rgb, width, pad, y, 'CASSINO - LUCRO / PREJUIZO', 113, 113, 122, 2);
    y += 26;
    drawText(
      rgb,
      width,
      pad,
      y,
      `LUCRO: ${sign}${fmtNum(profit)}   JOGOS: ${fmtNum(casino.games)}   APOSTADO: ${fmtNum(casino.wagered)}`,
      ...col,
      2
    );
  }

  return encodePngRgb(width, height, rgb);
}

/**
 * Terminal de corretora — cotações.
 * Colunas: EMPRESA | PRECO | VARIACAO | DIVIDENDO
 */
export function renderBolsaBoardPng({ quotes = [] } = {}) {
  const width = 720;
  const rowH = 42;
  const headerH = 72;
  const colH = 30;
  const pad = 20;
  const n = Math.max(quotes.length, 1);
  const height = headerH + colH + n * rowH + 40;

  const rgb = Buffer.alloc(width * height * 3);
  fillRect(rgb, width, 0, 0, width, height, 6, 12, 10);
  fillRect(rgb, width, 0, 0, width, headerH, 10, 22, 18);
  fillRect(rgb, width, 0, headerH - 2, width, 2, 16, 185, 129);

  drawText(rgb, width, pad, 22, 'CORRETORA DO BECO', 167, 243, 208, 3);
  drawText(rgb, width, pad, 48, 'COTACOES AO VIVO', 52, 211, 153, 2);

  // Colunas fixas (em px) para leitura clara
  const xEmp = pad;
  const xPreco = 280;
  const xVar = 400;
  const xDiv = 520;

  drawText(rgb, width, xEmp, headerH + 8, 'EMPRESA', 110, 231, 183, 2);
  drawText(rgb, width, xPreco, headerH + 8, 'PRECO', 110, 231, 183, 2);
  drawText(rgb, width, xVar, headerH + 8, 'VARIACAO', 110, 231, 183, 2);
  drawText(rgb, width, xDiv, headerH + 8, 'DIVIDENDO', 110, 231, 183, 2);

  const bodyY0 = headerH + colH;
  if (!quotes.length) {
    drawText(rgb, width, pad, bodyY0 + 12, 'SEM TICKERS', 110, 231, 183, 2);
  } else {
    quotes.forEach((q, idx) => {
      const y = bodyY0 + idx * rowH + 10;
      if (idx % 2 === 0) {
        fillRect(rgb, width, pad - 4, y - 6, width - pad * 2 + 8, rowH - 8, 10, 22, 18);
      }
      const name = shortName(q.name || q.id, '', 14);
      const price = `${fmtNum(q.price)}C`;
      const delta = Number(q.deltaPct) || 0;
      const sign = delta > 0 ? '+' : '';
      const trend =
        q.trend === 'up' ? 'SOBE' : q.trend === 'down' ? 'CAI' : 'ESTAVEL';
      const varStr = `${trend} ${sign}${delta}%`;
      let divStr = '-';
      if (Number(q.dividendYield) > 0) {
        divStr = `${(Number(q.dividendYield) * 100).toFixed(1)}%`;
      } else if (q.dividendRare) {
        divStr = 'RARO';
      }
      const col =
        delta > 0 ? [52, 211, 153] : delta < 0 ? [248, 113, 113] : [167, 243, 208];

      drawText(rgb, width, xEmp, y, name, 226, 252, 239, 2);
      drawText(rgb, width, xPreco, y, price, ...col, 2);
      drawText(rgb, width, xVar, y, varStr, ...col, 2);
      drawText(rgb, width, xDiv, y, divStr, 167, 243, 208, 2);
    });
  }

  drawText(
    rgb,
    width,
    pad,
    height - 24,
    'PRECO EM COINS  ·  VARIACAO DESDE ULTIMO TICK  ·  /BOLSA COMPRAR',
    110,
    231,
    183,
    2
  );
  return encodePngRgb(width, height, rgb);
}

/**
 * Extrato de carteira — holdings + PnL.
 * Colunas: EMPRESA | QTD | PRECO | LUCRO/PREJUIZO
 */
export function renderCarteiraCardPng({
  positions = [],
  totalValue = 0,
  unrealized = 0,
  dividendTotal = 0,
} = {}) {
  const width = 720;
  const rowH = 40;
  const headerH = 88;
  const colH = 28;
  const pad = 20;
  const n = Math.max(positions.length, 1);
  const height = headerH + colH + n * rowH + 52;

  const rgb = Buffer.alloc(width * height * 3);
  fillRect(rgb, width, 0, 0, width, height, 12, 12, 14);
  fillRect(rgb, width, 0, 0, width, headerH, 24, 24, 27);
  fillRect(rgb, width, 0, headerH - 2, width, 2, 234, 179, 8);

  drawText(rgb, width, pad, 20, 'CARTEIRA DO BECO', 250, 250, 250, 3);
  const uSign = unrealized >= 0 ? '+' : '';
  const uCol = unrealized >= 0 ? [52, 211, 153] : [248, 113, 113];
  drawText(rgb, width, pad, 52, `VALOR TOTAL: ${fmtNum(totalValue)} COINS`, 250, 204, 21, 2);
  drawText(
    rgb,
    width,
    pad + 340,
    52,
    `LUCRO NO PAPEL: ${uSign}${fmtNum(unrealized)}`,
    ...uCol,
    2
  );

  const xEmp = pad;
  const xQty = 280;
  const xPreco = 380;
  const xPnl = 500;
  drawText(rgb, width, xEmp, headerH + 6, 'EMPRESA', 161, 161, 170, 2);
  drawText(rgb, width, xQty, headerH + 6, 'QTD', 161, 161, 170, 2);
  drawText(rgb, width, xPreco, headerH + 6, 'PRECO', 161, 161, 170, 2);
  drawText(rgb, width, xPnl, headerH + 6, 'LUCRO/PREJUIZO', 161, 161, 170, 2);

  const bodyY0 = headerH + colH;
  if (!positions.length) {
    drawText(rgb, width, pad, bodyY0 + 12, 'VAZIO - USE /BOLSA COMPRAR', 161, 161, 170, 2);
  } else {
    positions.slice(0, 12).forEach((p, idx) => {
      const y = bodyY0 + idx * rowH + 8;
      if (idx % 2 === 0) {
        fillRect(rgb, width, pad - 4, y - 4, width - pad * 2 + 8, rowH - 6, 24, 24, 27);
      }
      const c = p.company || {};
      const name = shortName(c.name || c.id || p.companyId, '', 14);
      const un = Number(p.unrealized) || 0;
      const sign = un >= 0 ? '+' : '';
      const col = un >= 0 ? [52, 211, 153] : [248, 113, 113];
      drawText(rgb, width, xEmp, y, name, 250, 250, 250, 2);
      drawText(rgb, width, xQty, y, String(p.qty), 212, 212, 216, 2);
      drawText(rgb, width, xPreco, y, `${fmtNum(p.price)}C`, 212, 212, 216, 2);
      drawText(rgb, width, xPnl, y, `${sign}${fmtNum(un)}`, ...col, 2);
    });
  }

  if (dividendTotal > 0) {
    drawText(
      rgb,
      width,
      pad,
      height - 30,
      `DIVIDENDOS RECEBIDOS AGORA: +${fmtNum(dividendTotal)} COINS`,
      52,
      211,
      153,
      2
    );
  } else {
    drawText(rgb, width, pad, height - 30, '/BOLSA VENDER TICKER QTD', 113, 113, 122, 2);
  }

  return encodePngRgb(width, height, rgb);
}
