/**
 * Gera PNG simples do ranking (sem deps nativas).
 * Fonte bitmap 5x7 + zlib do Node.
 */

import zlib from 'zlib';

// Glyphs 5x7 para ASCII imprimível (subset). Caracteres fora → '?'.
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 4, 4],
  '-': [0, 0, 0, 31, 0, 0, 0],
  ':': [0, 4, 4, 0, 4, 4, 0],
  '#': [10, 31, 10, 31, 10, 0, 0],
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

function stripAccents(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
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
    raw[rowStart] = 0; // filter none
    const src = y * width * 3;
    rgb.copy(raw, rowStart + 1, src, src + width * 3);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
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
  for (let y = y0; y < y0 + rh; y += 1) {
    if (y < 0 || y >= rgb.length / (w * 3)) continue;
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
  const glyph = FONT[ch] || FONT['?'];
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
  const normalized = stripAccents(text);
  let cx = x;
  for (const ch of normalized) {
    drawChar(rgb, w, cx, y, ch, r, g, b, scale);
    cx += 6 * scale;
  }
  return cx;
}

function shortName(name, userJid, maxLen = 16) {
  let n = String(name || '').trim();
  if (!n) {
    const local = String(userJid || '').split('@')[0] || '?';
    n = local.length > 8 ? `${local.slice(0, 4)}..${local.slice(-3)}` : local;
  }
  if (n.length > maxLen) n = `${n.slice(0, maxLen - 2)}..`;
  return n;
}

/**
 * @returns {Buffer} PNG
 */
export function renderRankCardPng({
  title = 'RANKING',
  entries = [],
  yourRank = null,
  yourTotal = null,
} = {}) {
  const width = 520;
  const rowH = 36;
  const headerH = 64;
  const footerH = 40;
  const pad = 20;
  const rows = Math.min(10, Math.max(entries.length, 1));
  const height = headerH + rows * rowH + footerH + pad;

  const rgb = Buffer.alloc(width * height * 3);
  // canvas zinc-950
  fillRect(rgb, width, 0, 0, width, height, 9, 9, 11);
  // header bar
  fillRect(rgb, width, 0, 0, width, headerH, 24, 24, 27);
  // accent line
  fillRect(rgb, width, 0, headerH - 2, width, 2, 113, 113, 122);

  drawText(rgb, width, pad, 22, title, 250, 250, 250, 3);

  if (!entries.length) {
    drawText(rgb, width, pad, headerH + 16, 'SEM DADOS AINDA', 161, 161, 170, 2);
  } else {
    entries.slice(0, 10).forEach((entry, idx) => {
      const y = headerH + idx * rowH + 8;
      if (idx % 2 === 0) {
        fillRect(rgb, width, pad - 4, y - 4, width - pad * 2 + 8, rowH - 4, 24, 24, 27);
      }
      const rank = entry.rank || idx + 1;
      let rr = 212;
      let rg = 212;
      let rb = 216;
      if (rank === 1) {
        rr = 250;
        rg = 204;
        rb = 21;
      } else if (rank === 2) {
        rr = 212;
        rg = 212;
        rb = 216;
      } else if (rank === 3) {
        rr = 251;
        rg = 146;
        rb = 60;
      }

      const label = shortName(entry.displayName, entry.userJid);
      const line = `#${rank}  ${label}  LV${entry.level}  ${entry.xp}XP`;
      drawText(rgb, width, pad, y, line, rr, rg, rb, 2);
    });
  }

  if (yourRank != null) {
    const footer = `VOCE: #${yourRank}${yourTotal ? `/${yourTotal}` : ''}`;
    drawText(rgb, width, pad, height - 28, footer, 161, 161, 170, 2);
  }

  return encodePngRgb(width, height, rgb);
}
