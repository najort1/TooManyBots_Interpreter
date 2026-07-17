/**
 * Cards PNG do Fun — skia-canvas + visual vivo por comando + datas festivas BR.
 *
 * Comandos: xp · coins · messages · casino · profile · bolsa · carteira
 * Festas: carnaval · são joão · natal · ano novo
 */

import { Canvas } from 'skia-canvas';
import { progressInLevel } from '../services/levelCurve.js';
import {
  resolveCardTheme,
  LEADERBOARD_THEMES,
  resolveFestiveSeason,
  FESTIVE_PALETTES,
  COMMAND_BASE,
} from './festivePalette.js';

export { LEADERBOARD_THEMES, resolveFestiveSeason, FESTIVE_PALETTES, COMMAND_BASE, resolveCardTheme };

const FONT =
  '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
const FONT_MONO =
  '"Cascadia Code", "Segoe UI Mono", ui-monospace, Consolas, monospace';

/* Marquise dourada estilo cassino/game show — usada nas lâmpadas da borda e medalhas */
const MARQUEE_GOLD = '#ffd76b';

function hexToRgba(hex, alpha = 1) {
  const h = String(hex || '#ffffff').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return `rgba(255,255,255,${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function fmtNum(n) {
  const v = Math.floor(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

function shortName(name, userJid, maxLen = 22) {
  let n = String(name || '').trim();
  if (n.startsWith('@')) n = n.slice(1);
  n = n.replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\s]+/u, '').trim();
  if (!n) {
    const local = String(userJid || '').split('@')[0] || 'user';
    n = local.length > 10 ? `${local.slice(0, 4)}…${local.slice(-3)}` : local;
  }
  if (n.length > maxLen) n = `${n.slice(0, maxLen - 1)}…`;
  return n;
}

function toPngBuffer(canvas) {
  if (typeof canvas.toBufferSync === 'function') {
    return canvas.toBufferSync('png');
  }
  throw new Error('skia-canvas toBufferSync unavailable');
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, fill) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function strokeRoundRect(ctx, x, y, w, h, r, stroke, lineWidth = 1) {
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/* ── Atmosfera cassino / game show (permanente, não só em datas festivas) ─── */

/** Escurece levemente os cantos do painel, dando profundidade de "palco". */
function drawVignette(ctx, width, height) {
  const g = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.22,
    width / 2, height / 2, Math.max(width, height) * 0.75
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/** Dois feixes de holofote cruzando do topo, tipo palco de game show. */
function drawSpotlights(ctx, width, height, theme) {
  const beamColor = theme.accent2 || theme.accent || '#ffffff';
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  [
    { x: width * 0.14, tilt: 0.3 },
    { x: width * 0.86, tilt: -0.3 },
  ].forEach(({ x, tilt }) => {
    ctx.save();
    ctx.translate(x, -20);
    ctx.rotate(tilt);
    const beamW = width * 0.34;
    const beamH = height * 1.1;
    const g = ctx.createLinearGradient(0, 0, 0, beamH);
    g.addColorStop(0, hexToRgba(beamColor, 0.14));
    g.addColorStop(1, hexToRgba(beamColor, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-beamW * 0.05, 0);
    ctx.lineTo(beamW * 0.05, 0);
    ctx.lineTo(beamW * 0.5, beamH);
    ctx.lineTo(-beamW * 0.5, beamH);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

/** Lâmpadas de marquise ao redor da moldura, alternando acesa/apagada. */
function drawMarqueeLights(ctx, width, height, theme, m) {
  const track = m;
  const bulbR = 3.4;
  const spacing = 22;
  const rect = { x: track, y: track, w: width - track * 2, h: height - track * 2 };
  const points = [];
  for (let x = rect.x + 16; x <= rect.x + rect.w - 16; x += spacing) points.push([x, rect.y]);
  for (let x = rect.x + 16; x <= rect.x + rect.w - 16; x += spacing) points.push([x, rect.y + rect.h]);
  for (let y = rect.y + 16; y <= rect.y + rect.h - 16; y += spacing) points.push([rect.x, y]);
  for (let y = rect.y + 16; y <= rect.y + rect.h - 16; y += spacing) points.push([rect.x + rect.w, y]);

  points.forEach(([x, y], i) => {
    const lit = i % 2 === 0;
    if (lit) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, bulbR * 3.2);
      glow.addColorStop(0, hexToRgba(MARQUEE_GOLD, 0.55));
      glow.addColorStop(1, hexToRgba(MARQUEE_GOLD, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, bulbR * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, bulbR, 0, Math.PI * 2);
    ctx.fillStyle = lit ? MARQUEE_GOLD : hexToRgba(theme.accent2 || theme.accent || MARQUEE_GOLD, 0.35);
    ctx.fill();
  });
}

/** Brilho diagonal vidrado, usado na faixa do topo e nos cartões de KPI. */
function drawGlassShine(ctx, x, y, w, h, r = h / 2) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Reúne vinheta + holofotes + confete/neve/sparkle sazonal, recortado dentro do painel. */
function drawAtmosphere(ctx, width, height, theme, m) {
  ctx.save();
  roundRect(ctx, m, m, width - m * 2, height - m * 2, 14);
  ctx.clip();
  drawVignette(ctx, width, height);
  drawSpotlights(ctx, width, height, theme);
  drawFestiveDecor(ctx, width, height, theme.festive);
  ctx.restore();
}

/** Preenchimento "glossy" para linhas de tabela — mesma base + realce de vidro por cima. */
function fillGlossyRow(ctx, x, y, w, h, r, baseColor) {
  fillRoundRect(ctx, x, y, w, h, r, baseColor);
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  g.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Divisória estilo "canhoto de ingresso" — perfuração picotada em vez de linha reta. */
function drawTicketDivider(ctx, x, y, w, theme) {
  ctx.save();
  ctx.fillStyle = theme.border;
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = theme.raise;
  const step = 16;
  for (let cx = x + step / 2; cx < x + w; cx += step) {
    ctx.beginPath();
    ctx.arc(cx, y + 1, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Medalha metálica com fitas — substitui a estrela simples do top 3. */
function drawMedallion(ctx, cx, cy, r, theme, rank) {
  const base =
    rank === 1 ? (theme.medal1 || MARQUEE_GOLD)
    : rank === 2 ? (theme.medal2 || '#e2e8f0')
    : (theme.medal3 || theme.accent2 || MARQUEE_GOLD);

  ctx.save();
  ctx.fillStyle = hexToRgba(base, 0.9);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.5, cy + r * 0.3);
  ctx.lineTo(cx - r * 1.1, cy + r * 2.1);
  ctx.lineTo(cx - r * 0.15, cy + r * 1.3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.5, cy + r * 0.3);
  ctx.lineTo(cx + r * 1.1, cy + r * 2.1);
  ctx.lineTo(cx + r * 0.15, cy + r * 1.3);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#fff7dc');
  g.addColorStop(0.35, base);
  g.addColorStop(1, hexToRgba(base, 0.75));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.stroke();

  drawStar(ctx, cx, cy, r * 0.46, '#ffffff');
}

function createSurface(width, height, bg) {
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx, width, height };
}

/* ── Decorações geométricas (vivas, sem depender de emoji) ─── */

function drawStar(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCoin(ctx, cx, cy, r, color, inner) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = inner || '#00000033';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawChatBubble(ctx, x, y, w, h, color) {
  fillRoundRect(ctx, x, y, w, h, 8, color);
  ctx.beginPath();
  ctx.moveTo(x + 14, y + h);
  ctx.lineTo(x + 10, y + h + 10);
  ctx.lineTo(x + 28, y + h);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawChip(ctx, cx, cy, r, color, edge) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = edge || '#fff';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawChartIcon(ctx, x, y, colorUp, colorDown) {
  // mini candles
  ctx.fillStyle = colorUp;
  ctx.fillRect(x, y + 8, 5, 18);
  ctx.fillRect(x + 2, y + 2, 1, 28);
  ctx.fillStyle = colorDown;
  ctx.fillRect(x + 12, y + 4, 5, 14);
  ctx.fillRect(x + 14, y, 1, 24);
  ctx.fillStyle = colorUp;
  ctx.fillRect(x + 24, y + 10, 5, 16);
  ctx.fillRect(x + 26, y + 6, 1, 24);
}

function drawWallet(ctx, x, y, color, accent) {
  fillRoundRect(ctx, x, y, 36, 26, 5, color);
  ctx.fillStyle = accent;
  ctx.fillRect(x + 22, y + 8, 14, 10);
  ctx.beginPath();
  ctx.arc(x + 28, y + 13, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawBadge(ctx, cx, cy, color, ring) {
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.strokeStyle = ring || '#ffffff88';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Confete / neve / bandeirinhas / sparkles */
function drawFestiveDecor(ctx, width, height, festive) {
  if (!festive?.decor) return;
  const colors = [festive.accent, festive.accent2, festive.accent3, festive.border].filter(Boolean);
  const seed = (width * 13 + height * 7) % 97;

  if (festive.decor === 'confetti') {
    for (let i = 0; i < 48; i += 1) {
      const x = ((seed * (i + 3) * 17) % (width - 40)) + 20;
      const y = ((seed * (i + 5) * 23) % (height - 40)) + 20;
      const c = colors[i % colors.length];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((i * 37) % 180) * (Math.PI / 180));
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.35 + (i % 5) * 0.08;
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (festive.decor === 'snow') {
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 40; i += 1) {
      const x = ((seed * (i + 2) * 19) % (width - 20)) + 10;
      const y = ((seed * (i + 7) * 29) % (height - 20)) + 10;
      const r = 1.2 + (i % 4) * 0.7;
      ctx.globalAlpha = 0.25 + (i % 4) * 0.1;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return;
  }

  if (festive.decor === 'flags') {
    // bandeirinhas no topo
    const y0 = 28;
    for (let i = 0; i < 14; i += 1) {
      const x = 40 + i * 58;
      const c = colors[i % colors.length];
      ctx.fillStyle = c;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + 22, y0);
      ctx.lineTo(x + 11, y0 + 18);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = festive.accent2 || festive.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, y0);
    ctx.lineTo(width - 30, y0);
    ctx.stroke();
    return;
  }

  if (festive.decor === 'sparkle') {
    for (let i = 0; i < 20; i += 1) {
      const x = ((seed * (i + 1) * 41) % (width - 50)) + 25;
      const y = ((seed * (i + 4) * 53) % (height - 50)) + 25;
      ctx.globalAlpha = 0.35 + (i % 3) * 0.15;
      drawStar(ctx, x, y, 4 + (i % 3), colors[i % colors.length]);
    }
    ctx.globalAlpha = 1;
  }
}

function drawCommandGlyph(ctx, symbol, x, y, theme) {
  const a = theme.accent;
  const a2 = theme.accent2 || theme.accent;

  // brilho por trás do ícone — efeito "botão de fliperama aceso"
  const glowR = 26;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR);
  glow.addColorStop(0, hexToRgba(a, 0.32));
  glow.addColorStop(1, hexToRgba(a, 0));
  ctx.save();
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (symbol === 'star') {
    drawStar(ctx, x, y, 14, a);
    return;
  }
  if (symbol === 'coins') {
    drawCoin(ctx, x - 6, y, 11, a, a2);
    drawCoin(ctx, x + 8, y + 2, 11, a2, a);
    return;
  }
  if (symbol === 'chat') {
    drawChatBubble(ctx, x - 16, y - 12, 32, 20, a);
    return;
  }
  if (symbol === 'chip') {
    drawChip(ctx, x, y, 14, a, a2);
    return;
  }
  if (symbol === 'chart') {
    drawChartIcon(ctx, x - 14, y - 14, theme.success || a, theme.danger || a2);
    return;
  }
  if (symbol === 'wallet') {
    drawWallet(ctx, x - 18, y - 12, a, a2);
    return;
  }
  if (symbol === 'badge') {
    drawBadge(ctx, x, y, a, a2);
  }
}

function drawShell(ctx, width, height, theme) {
  const m = 16;
  // glow sutil da borda
  fillRoundRect(ctx, m + 4, m + 6, width - m * 2, height - m * 2, 16, '#00000044');
  // moldura dourada externa — dá o clima de painel de marquise
  strokeRoundRect(
    ctx, m - 4, m - 4, width - (m - 4) * 2, height - (m - 4) * 2, 18,
    hexToRgba(MARQUEE_GOLD, 0.5), 1.5
  );
  fillRoundRect(ctx, m, m, width - m * 2, height - m * 2, 14, theme.raise);
  strokeRoundRect(ctx, m, m, width - m * 2, height - m * 2, 14, theme.border, 2.5);
  // lâmpadas de marquise ao redor da borda, acesas/apagadas alternando
  drawMarqueeLights(ctx, width, height, theme, m);
  // faixa colorida no topo do card
  ctx.save();
  roundRect(ctx, m, m, width - m * 2, 10, 14);
  ctx.clip();
  const grad = ctx.createLinearGradient(m, m, width - m, m);
  grad.addColorStop(0, theme.accent);
  grad.addColorStop(0.5, theme.accent2 || theme.accent);
  grad.addColorStop(1, theme.border);
  ctx.fillStyle = grad;
  ctx.fillRect(m, m, width - m * 2, 12);
  drawGlassShine(ctx, m, m, width - m * 2, 12, 6);
  ctx.restore();

  return { padX: m + 28, padTop: m + 36, contentW: width - m * 2 - 56, m };
}

function medalColor(theme, rank) {
  if (rank === 1) return theme.medal1 || theme.accent;
  if (rank === 2) return theme.medal2 || theme.muted;
  if (rank === 3) return theme.medal3 || theme.accent2;
  return theme.muted;
}

function festiveBadge(ctx, theme, padX, y) {
  if (!theme.festive) return;
  const label = theme.festive.label || '';
  ctx.font = `700 11px ${FONT}`;
  const tw = ctx.measureText(label.toUpperCase()).width;
  fillRoundRect(ctx, padX, y - 14, tw + 20, 22, 11, theme.accent);
  ctx.fillStyle = theme.canvas;
  ctx.fillText(label.toUpperCase(), padX + 10, y + 2);
}

/**
 * Placar colorido por comando + festa.
 */
export function renderLeaderboardPng({
  title,
  theme = 'xp',
  entries = [],
  yourRank = null,
  yourTotal = null,
  yourExtra = '',
  footer = '',
  nowMs = Date.now(),
} = {}) {
  const commandId =
    typeof theme === 'string'
      ? theme
      : theme?.id || 'xp';
  const t = resolveCardTheme(commandId, nowMs);
  const width = 900;
  const rowH = 50;
  const rows = Math.min(10, Math.max(entries.length, 1));
  const headerBlock = 110;
  const colHead = 34;
  const footerBlock = 56;
  const height = 32 + headerBlock + colHead + rows * rowH + footerBlock + 24;

  const { canvas, ctx } = createSurface(width, height, t.canvas);
  const { padX, padTop, contentW, m } = drawShell(ctx, width, height, t);
  drawAtmosphere(ctx, width, height, t, m);

  // glyph + título
  drawCommandGlyph(ctx, t.symbol || 'star', width - padX - 8, padTop + 18, t);

  festiveBadge(ctx, t, padX, padTop + 4);

  ctx.fillStyle = t.text;
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText(title || t.title, padX, padTop + 44);

  ctx.fillStyle = t.muted;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText('Top do grupo · diverte sem piedade', padX, padTop + 68);

  // colunas
  const yCol = padTop + headerBlock - 8;
  ctx.fillStyle = t.muted;
  ctx.font = `600 11px ${FONT}`;
  ctx.fillText('POS', padX, yCol);
  ctx.fillText('NOME', padX + 64, yCol);
  ctx.textAlign = 'right';
  if (commandId === 'coins') ctx.fillText('COINS', padX + contentW, yCol);
  else if (commandId === 'messages') ctx.fillText('MENSAGENS', padX + contentW, yCol);
  else if (commandId === 'casino') {
    ctx.fillText('JOGOS', padX + contentW, yCol);
    ctx.fillText('LUCRO', padX + contentW - 110, yCol);
  } else {
    ctx.fillText('XP', padX + contentW, yCol);
    ctx.fillText('NÍVEL', padX + contentW - 110, yCol);
  }
  ctx.textAlign = 'left';

  const bodyY0 = yCol + 18;

  if (!entries.length) {
    ctx.fillStyle = t.muted;
    ctx.font = `400 15px ${FONT}`;
    ctx.fillText('Ainda não há ninguém aqui. Manda um alô!', padX, bodyY0 + 28);
  } else {
    entries.slice(0, 10).forEach((entry, idx) => {
      const y = bodyY0 + idx * rowH;
      if (idx % 2 === 0) {
        ctx.globalAlpha = 0.55;
        fillGlossyRow(ctx, padX - 10, y, contentW + 20, rowH - 6, 10, t.raise2);
        ctx.globalAlpha = 1;
      }

      const rank = entry.rank || idx + 1;
      const midY = y + 32;
      const name = shortName(entry.displayName, entry.userJid, 26);
      let color = medalColor(t, rank);

      if (commandId === 'casino' && entry.profit != null) {
        if (entry.profit > 0) color = t.success;
        else if (entry.profit < 0) color = t.danger;
      }

      ctx.fillStyle = color;
      ctx.font = `800 15px ${FONT_MONO}`;
      ctx.fillText(`#${rank}`, padX, midY);

      // medalha viva no top 3
      if (rank <= 3) {
        drawMedallion(ctx, padX + 52, midY - 6, 8, t, rank);
      }

      ctx.fillStyle = t.text;
      ctx.font = `600 16px ${FONT}`;
      ctx.fillText(name, padX + 64, midY);

      ctx.textAlign = 'right';
      ctx.font = `600 15px ${FONT_MONO}`;
      if (commandId === 'coins') {
        ctx.fillStyle = t.accent;
        ctx.fillText(`${fmtNum(entry.coins)} coins`, padX + contentW, midY);
      } else if (commandId === 'messages') {
        ctx.fillStyle = t.accent;
        ctx.fillText(`${fmtNum(entry.messageCount)} msgs`, padX + contentW, midY);
      } else if (commandId === 'casino') {
        const profit = Number(entry.profit) || 0;
        const sign = profit >= 0 ? '+' : '';
        ctx.fillStyle = color;
        ctx.fillText(`${sign}${fmtNum(profit)}`, padX + contentW - 110, midY);
        ctx.fillStyle = t.muted;
        ctx.fillText(`${fmtNum(entry.games)} jogos`, padX + contentW, midY);
      } else {
        ctx.fillStyle = t.muted;
        ctx.fillText(`Nv ${entry.level ?? '—'}`, padX + contentW - 110, midY);
        ctx.fillStyle = t.accent;
        ctx.fillText(fmtNum(entry.xp), padX + contentW, midY);
      }
      ctx.textAlign = 'left';
    });
  }

  const footerLine =
    String(footer || '').trim() ||
    (yourRank != null
      ? `Você · #${yourRank}${yourTotal ? `/${yourTotal}` : ''}${yourExtra ? ` · ${yourExtra}` : ''}`
      : yourExtra
        ? `Você · ${yourExtra}`
        : '');

  if (footerLine) {
    drawTicketDivider(ctx, padX, height - 56, contentW, t);
    ctx.fillStyle = t.muted;
    ctx.font = `500 13px ${FONT}`;
    ctx.fillText(footerLine, padX, height - 32);
  }

  return toPngBuffer(canvas);
}

export function renderRankCardPng(opts = {}) {
  return renderLeaderboardPng({ ...opts, theme: 'xp', title: opts.title || 'Rank XP' });
}

/**
 * Perfil — badge + nível protagonista + cores vivas.
 */
/* ── Elementos do "cartão de jogador" (perfil) ─── */

function drawBadgeIcon(ctx, kind, cx, cy, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (kind === 'briefcase') {
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - 7, cy - 3, 14, 10);
    ctx.strokeRect(cx - 3, cy - 7, 6, 4);
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy);
    ctx.lineTo(cx + 7, cy);
    ctx.stroke();
  } else if (kind === 'flag') {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 8);
    ctx.lineTo(cx - 6, cy + 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 8);
    ctx.lineTo(cx + 8, cy - 4);
    ctx.lineTo(cx - 6, cy);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'heart') {
    ctx.beginPath();
    ctx.moveTo(cx, cy + 7);
    ctx.bezierCurveTo(cx - 12, cy - 4, cx - 5, cy - 12, cx, cy - 4);
    ctx.bezierCurveTo(cx + 5, cy - 12, cx + 12, cy - 4, cx, cy + 7);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'chip') {
    drawChip(ctx, cx, cy, 9, color, 'rgba(255,255,255,0.7)');
  }
  ctx.restore();
}

/** Chip de conquista (emprego, panelinha, casamento, cassino) — ícone + rótulo + valor. */
function drawInfoChip(ctx, x, y, w, h, theme, chip) {
  fillRoundRect(ctx, x, y, w, h, h / 2, hexToRgba(chip.color, 0.14));
  strokeRoundRect(ctx, x, y, w, h, h / 2, hexToRgba(chip.color, 0.55), 1.5);
  drawBadgeIcon(ctx, chip.icon, x + 22, y + h / 2, chip.color);
  ctx.fillStyle = theme.muted;
  ctx.font = `700 10px ${FONT}`;
  ctx.fillText(chip.sub.toUpperCase(), x + 42, y + h / 2 - 4);
  ctx.fillStyle = theme.text;
  ctx.font = `700 14px ${FONT}`;
  ctx.fillText(chip.label, x + 42, y + h / 2 + 13);
}

/** Pilulazinha de posição no ranking (ex: "XP #1"). Retorna a largura usada. */
function drawRankChip(ctx, x, y, label, value, color) {
  const text = `${label} #${value ?? '—'}`;
  ctx.font = `700 12px ${FONT}`;
  const w = ctx.measureText(text).width + 22;
  fillRoundRect(ctx, x, y, w, 24, 12, hexToRgba(color, 0.16));
  strokeRoundRect(ctx, x, y, w, 24, 12, color, 1.4);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 11, y + 16);
  return w;
}

/** Medalhão de nível com anel de progresso circular — o "herói" do cartão de jogador. */
function drawLevelRing(ctx, cx, cy, rOuter, ratio, theme, level) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.lineWidth = 8;
  ctx.strokeStyle = hexToRgba(theme.muted || '#ffffff', 0.18);
  ctx.stroke();

  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * Math.max(0.02, Math.min(1, ratio));
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, start, end);
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.strokeStyle = theme.accent2 || theme.accent;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.stroke();
  ctx.restore();

  const r = rOuter - 16;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#fff7dc');
  g.addColorStop(0.4, theme.accent);
  g.addColorStop(1, hexToRgba(theme.accent, 0.8));
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = theme.canvas;
  ctx.font = `800 ${Math.round(r * 0.85)}px ${FONT}`;
  ctx.fillText(String(level), cx, cy + r * 0.3);
  ctx.font = `800 11px ${FONT}`;
  ctx.fillStyle = hexToRgba(theme.canvas, 0.75);
  ctx.fillText('NÍVEL', cx, cy + r * 0.3 + 17);
  ctx.textAlign = 'left';
}

export function renderProfileCardPng({
  displayName = '',
  userJid = '',
  stats = {},
  rank = null,
  coinsRank = null,
  messagesRank = null,
  partnerName = '',
  factionLabel = '',
  casino = null,
  employment = null,
  isSelf = true,
  nowMs = Date.now(),
} = {}) {
  const t = resolveCardTheme('profile', nowMs);
  const name = shortName(displayName, userJid, 26);
  const title = String(stats.title || '').trim();
  const xp = Number(stats.xp) || 0;
  const progress = progressInLevel(xp);
  const level = Number(stats.level) || progress.level;
  const coins = Number(stats.coins) || 0;
  const streak = Number(stats.dailyStreak) || 0;
  const messages = Number(stats.messageCount) || 0;
  const ratio =
    progress.xpForNext > 0
      ? Math.min(1, Math.max(0, progress.xpIntoLevel / progress.xpForNext))
      : 0;

  // chips de conquista — monta a lista antes pra saber quantas linhas vão ocupar
  const chips = [];
  if (employment?.job) {
    chips.push({
      icon: 'briefcase',
      sub: 'Emprego',
      label: `${employment.job.name || employment.job.id} · ~${fmtNum(employment.salary)}/dia`,
      color: t.muted,
    });
  }
  if (factionLabel) {
    chips.push({
      icon: 'flag',
      sub: 'Panelinha',
      label: shortName(factionLabel, '', 26),
      color: t.accent2 || t.accent,
    });
  }
  if (partnerName) {
    chips.push({
      icon: 'heart',
      sub: 'Casado(a) com',
      label: shortName(partnerName, '', 22),
      color: '#f9a8d4',
    });
  }
  const casinoActive = casino && (casino.games > 0 || casino.wagered > 0);
  if (casinoActive) {
    const profit = Number(casino.profit) || 0;
    const sign = profit >= 0 ? '+' : '';
    chips.push({
      icon: 'chip',
      sub: `Cassino · ${fmtNum(casino.games)} jogos`,
      label: `${sign}${fmtNum(profit)} coins`,
      color: profit >= 0 ? t.success : t.danger,
    });
  }
  const chipRows = Math.ceil(chips.length / 2);

  // geometria vertical — calculada antes pra dimensionar o canvas certinho
  const width = 900;
  const heroTop = 52 + 40; // padTop (m=16 => 52) + respiro sob a tag "SEU PERFIL"
  const ringR = 62;
  const kpiLabelY = heroTop + ringR * 2 + 34;
  const kpiBoxY = kpiLabelY + 14;
  const kpiBoxH = 78;
  const chipsLabelY = kpiBoxY + kpiBoxH + 34;
  const chipsStartY = chipsLabelY + 18;
  const chipRowH = 46;
  const height = chips.length
    ? chipsStartY + chipRows * chipRowH + 26
    : kpiBoxY + kpiBoxH + 34;

  const { canvas, ctx } = createSurface(width, height, t.canvas);
  const { padX, padTop, contentW, m } = drawShell(ctx, width, height, t);
  drawAtmosphere(ctx, width, height, t, m);

  festiveBadge(ctx, t, padX, padTop + 2);
  drawCommandGlyph(ctx, 'badge', width - padX - 12, padTop + 28, t);

  ctx.fillStyle = t.muted;
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(isSelf ? 'SEU PERFIL' : 'PERFIL', padX, padTop + 28);

  // ── Hero: anel de nível à esquerda, identidade à direita ──
  const ringCx = padX + ringR;
  const ringCy = heroTop + ringR;

  const heroGlow = ctx.createRadialGradient(ringCx, ringCy, 4, ringCx, ringCy, ringR + 40);
  heroGlow.addColorStop(0, hexToRgba(t.accent, 0.3));
  heroGlow.addColorStop(1, hexToRgba(t.accent, 0));
  ctx.save();
  roundRect(ctx, m, m, width - m * 2, height - m * 2, 14);
  ctx.clip();
  ctx.fillStyle = heroGlow;
  ctx.beginPath();
  ctx.arc(ringCx, ringCy, ringR + 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawLevelRing(ctx, ringCx, ringCy, ringR, ratio, t, level);

  const infoX = padX + ringR * 2 + 28;
  ctx.fillStyle = t.text;
  ctx.font = `800 30px ${FONT}`;
  ctx.fillText(name, infoX, ringCy - 30);

  if (title) {
    ctx.font = `700 13px ${FONT}`;
    const tw = Math.min(260, ctx.measureText(title).width + 24);
    fillRoundRect(ctx, infoX, ringCy - 16, tw, 26, 13, t.accent);
    ctx.beginPath();
    ctx.moveTo(infoX, ringCy - 3);
    ctx.lineTo(infoX - 7, ringCy + 3);
    ctx.lineTo(infoX, ringCy + 10);
    ctx.closePath();
    ctx.fillStyle = t.accent;
    ctx.fill();
    ctx.fillStyle = t.canvas;
    ctx.fillText(title.slice(0, 28), infoX + 12, ringCy + 2);
  }

  ctx.fillStyle = t.muted;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText(`${fmtNum(xp)} XP total  ·  ${progress.xpIntoLevel}/${progress.xpForNext} p/ o próximo nível`, infoX, ringCy + 34);

  let rankX = infoX;
  const rankY = ringCy + 48;
  rankX += drawRankChip(ctx, rankX, rankY, 'XP', rank, t.accent) + 8;
  rankX += drawRankChip(ctx, rankX, rankY, 'Coins', coinsRank, t.accent2 || t.border) + 8;
  drawRankChip(ctx, rankX, rankY, 'Msgs', messagesRank, t.success || t.accent);

  // ── KPI boxes (recursos) ──
  ctx.fillStyle = t.muted;
  ctx.font = `700 11px ${FONT}`;
  ctx.fillText('RECURSOS', padX, kpiLabelY);

  const kpis = [
    { label: 'Coins', value: fmtNum(coins), color: t.accent },
    { label: 'Mensagens', value: fmtNum(messages), color: t.accent2 || t.border },
    { label: 'Streak', value: String(streak), color: t.success || t.accent },
  ];
  const gap = 14;
  const boxW = (contentW - gap * 2) / 3;
  kpis.forEach((k, i) => {
    const x = padX + i * (boxW + gap);
    const y = kpiBoxY;
    fillRoundRect(ctx, x, y, boxW, kpiBoxH, 12, t.canvas);
    ctx.save();
    roundRect(ctx, x, y, boxW, kpiBoxH, 12);
    ctx.clip();
    const hi = ctx.createLinearGradient(x, y, x, y + kpiBoxH);
    hi.addColorStop(0, hexToRgba(k.color, 0.18));
    hi.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(x, y, boxW, kpiBoxH);
    ctx.restore();
    strokeRoundRect(ctx, x, y, boxW, kpiBoxH, 12, k.color, 2);
    ctx.fillStyle = t.muted;
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(k.label, x + 16, y + 28);
    ctx.fillStyle = k.color;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(k.value, x + 16, y + 58);
  });

  // ── Chips de conquista (emprego / panelinha / casamento / cassino) ──
  if (chips.length) {
    ctx.fillStyle = t.muted;
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText('CONQUISTAS', padX, chipsLabelY);

    const colGap = 16;
    const colW = (contentW - colGap) / 2;
    const rowH2 = 36;
    const rowGap = 10;
    chips.forEach((chip, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = padX + col * (colW + colGap);
      const y = chipsStartY + row * (rowH2 + rowGap);
      drawInfoChip(ctx, x, y, colW, rowH2, t, chip);
    });
  }

  return toPngBuffer(canvas);
}

export function renderBolsaBoardPng({ quotes = [], nowMs = Date.now() } = {}) {
  const t = resolveCardTheme('bolsa', nowMs);
  const width = 920;
  const rowH = 48;
  const n = Math.max(quotes.length, 1);
  const height = 32 + 120 + 32 + n * rowH + 56;

  const { canvas, ctx } = createSurface(width, height, t.canvas);
  const { padX, padTop, contentW, m } = drawShell(ctx, width, height, t);
  drawAtmosphere(ctx, width, height, t, m);

  festiveBadge(ctx, t, padX, padTop + 2);
  drawCommandGlyph(ctx, 'chart', width - padX - 8, padTop + 28, t);

  ctx.fillStyle = t.text;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText('Corretora do Beco', padX, padTop + 44);
  ctx.fillStyle = t.muted;
  ctx.font = `500 13px ${FONT}`;
  ctx.fillText('Cotações ao vivo · preços em coins', padX, padTop + 68);

  const colY = padTop + 100;
  const xEmp = padX;
  const xPreco = padX + 300;
  const xVar = padX + 470;
  const xDiv = padX + 660;

  ctx.fillStyle = t.muted;
  ctx.font = `700 11px ${FONT}`;
  ctx.fillText('EMPRESA', xEmp, colY);
  ctx.fillText('PREÇO', xPreco, colY);
  ctx.fillText('VARIAÇÃO', xVar, colY);
  ctx.fillText('DIVIDENDO', xDiv, colY);

  const bodyY0 = colY + 18;
  if (!quotes.length) {
    ctx.fillStyle = t.muted;
    ctx.font = `400 15px ${FONT}`;
    ctx.fillText('Sem cotações.', padX, bodyY0 + 28);
  } else {
    quotes.forEach((q, idx) => {
      const y = bodyY0 + idx * rowH;
      if (idx % 2 === 0) {
        fillGlossyRow(ctx, padX - 10, y, contentW + 20, rowH - 6, 10, t.raise2);
      }
      const midY = y + 30;
      const name = shortName(q.name || q.id, '', 18);
      const delta = Number(q.deltaPct) || 0;
      const sign = delta > 0 ? '+' : '';
      const trend =
        q.trend === 'up' ? '▲ sobe' : q.trend === 'down' ? '▼ cai' : '● estável';
      const col = delta > 0 ? t.success : delta < 0 ? t.danger : t.muted;
      let divStr = '—';
      if (Number(q.dividendYield) > 0) {
        divStr = `${(Number(q.dividendYield) * 100).toFixed(1)}%`;
      } else if (q.dividendRare) {
        divStr = 'raro ✨';
      }

      ctx.fillStyle = t.text;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText(name, xEmp, midY);
      ctx.fillStyle = col;
      ctx.font = `700 14px ${FONT_MONO}`;
      ctx.fillText(`${fmtNum(q.price)} coins`, xPreco, midY);
      ctx.fillText(`${trend} ${sign}${delta}%`, xVar, midY);
      ctx.fillStyle = t.muted;
      ctx.fillText(divStr, xDiv, midY);
    });
  }

  ctx.fillStyle = t.muted;
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText(
    'Variação desde o último tick  ·  /bolsa comprar  ·  /carteira',
    padX,
    height - 36
  );

  return toPngBuffer(canvas);
}

export function renderCarteiraCardPng({
  positions = [],
  totalValue = 0,
  unrealized = 0,
  dividendTotal = 0,
  nowMs = Date.now(),
} = {}) {
  const t = resolveCardTheme('carteira', nowMs);
  const width = 920;
  const rowH = 48;
  const n = Math.max(positions.length, 1);
  const height = 32 + 120 + 32 + n * rowH + 56;

  const { canvas, ctx } = createSurface(width, height, t.canvas);
  const { padX, padTop, contentW, m } = drawShell(ctx, width, height, t);
  drawAtmosphere(ctx, width, height, t, m);

  festiveBadge(ctx, t, padX, padTop + 2);
  drawCommandGlyph(ctx, 'wallet', width - padX - 8, padTop + 28, t);

  ctx.fillStyle = t.text;
  ctx.font = `800 26px ${FONT}`;
  ctx.fillText('Sua carteira', padX, padTop + 44);

  const uSign = unrealized >= 0 ? '+' : '';
  const uCol = unrealized > 0 ? t.success : unrealized < 0 ? t.danger : t.muted;
  ctx.fillStyle = t.accent;
  ctx.font = `700 16px ${FONT}`;
  ctx.fillText(`Valor total  ${fmtNum(totalValue)} coins`, padX, padTop + 72);
  ctx.fillStyle = uCol;
  ctx.fillText(`Lucro no papel  ${uSign}${fmtNum(unrealized)}`, padX + 320, padTop + 72);

  const colY = padTop + 104;
  const xEmp = padX;
  const xQty = padX + 320;
  const xPreco = padX + 430;
  const xPnl = padX + 620;

  ctx.fillStyle = t.muted;
  ctx.font = `700 11px ${FONT}`;
  ctx.fillText('EMPRESA', xEmp, colY);
  ctx.fillText('QTD', xQty, colY);
  ctx.fillText('PREÇO', xPreco, colY);
  ctx.fillText('LUCRO / PREJUÍZO', xPnl, colY);

  const bodyY0 = colY + 18;
  if (!positions.length) {
    ctx.fillStyle = t.muted;
    ctx.font = `400 15px ${FONT}`;
    ctx.fillText('Vazio. Compre em /bolsa — o beco te espera!', padX, bodyY0 + 28);
  } else {
    positions.slice(0, 12).forEach((p, idx) => {
      const y = bodyY0 + idx * rowH;
      if (idx % 2 === 0) {
        fillGlossyRow(ctx, padX - 10, y, contentW + 20, rowH - 6, 10, t.raise2);
      }
      const midY = y + 30;
      const c = p.company || {};
      const name = shortName(c.name || c.id || p.companyId, '', 18);
      const un = Number(p.unrealized) || 0;
      const sign = un >= 0 ? '+' : '';
      const col = un > 0 ? t.success : un < 0 ? t.danger : t.muted;

      ctx.fillStyle = t.text;
      ctx.font = `700 15px ${FONT}`;
      ctx.fillText(name, xEmp, midY);
      ctx.fillStyle = t.muted;
      ctx.font = `600 14px ${FONT_MONO}`;
      ctx.fillText(String(p.qty), xQty, midY);
      ctx.fillText(`${fmtNum(p.price)} coins`, xPreco, midY);
      ctx.fillStyle = col;
      ctx.fillText(`${sign}${fmtNum(un)}`, xPnl, midY);
    });
  }

  ctx.font = `600 12px ${FONT}`;
  if (dividendTotal > 0) {
    ctx.fillStyle = t.success;
    ctx.fillText(`Dividendos agora · +${fmtNum(dividendTotal)} coins`, padX, height - 36);
  } else {
    ctx.fillStyle = t.muted;
    ctx.fillText('/bolsa vender ticker qtd', padX, height - 36);
  }

  return toPngBuffer(canvas);
}

/** @deprecated */
export function encodePngRgb() {
  throw new Error('encodePngRgb removido — use skia-canvas renderers');
}

export function sanitizeCardText(s) {
  return String(s || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}