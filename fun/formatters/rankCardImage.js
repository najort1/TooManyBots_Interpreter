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
  fillRoundRect(ctx, m, m, width - m * 2, height - m * 2, 14, theme.raise);
  strokeRoundRect(ctx, m, m, width - m * 2, height - m * 2, 14, theme.border, 2.5);
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
  drawFestiveDecor(ctx, width, height, t.festive);
  const { padX, padTop, contentW } = drawShell(ctx, width, height, t);

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
        fillRoundRect(ctx, padX - 10, y, contentW + 20, rowH - 6, 10, t.raise2);
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
        drawStar(ctx, padX + 48, midY - 6, 6, color);
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
    ctx.fillStyle = t.border;
    ctx.fillRect(padX, height - 56, contentW, 2);
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
  const width = 900;
  const height = 640;
  const { canvas, ctx } = createSurface(width, height, t.canvas);
  drawFestiveDecor(ctx, width, height, t.festive);
  const { padX, padTop, contentW } = drawShell(ctx, width, height, t);

  const name = shortName(displayName, userJid, 28);
  const title = String(stats.title || '').trim();
  const xp = Number(stats.xp) || 0;
  const progress = progressInLevel(xp);
  const level = Number(stats.level) || progress.level;
  const coins = Number(stats.coins) || 0;
  const streak = Number(stats.dailyStreak) || 0;
  const messages = Number(stats.messageCount) || 0;

  festiveBadge(ctx, t, padX, padTop + 2);
  drawCommandGlyph(ctx, 'badge', width - padX - 12, padTop + 28, t);

  ctx.fillStyle = t.muted;
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText(isSelf ? 'SEU PERFIL' : 'PERFIL', padX, padTop + 28);

  ctx.fillStyle = t.text;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(name, padX, padTop + 68);

  if (title) {
    fillRoundRect(ctx, padX, padTop + 80, Math.min(280, title.length * 10 + 24), 26, 13, t.accent);
    ctx.fillStyle = t.canvas;
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(title.slice(0, 28), padX + 12, padTop + 98);
  }

  // nível herói
  const levelY = padTop + 160;
  fillRoundRect(ctx, padX, levelY - 48, 120, 100, 16, t.raise2);
  strokeRoundRect(ctx, padX, levelY - 48, 120, 100, 16, t.border, 2);
  ctx.fillStyle = t.accent;
  ctx.font = `800 48px ${FONT}`;
  ctx.fillText(String(level), padX + 28, levelY + 12);
  ctx.fillStyle = t.muted;
  ctx.font = `600 12px ${FONT}`;
  ctx.fillText('NÍVEL', padX + 36, levelY + 36);

  ctx.fillStyle = t.text;
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(`${fmtNum(xp)} XP total`, padX + 144, levelY - 8);
  ctx.fillStyle = t.muted;
  ctx.font = `500 14px ${FONT}`;
  ctx.fillText(`Rank XP #${rank || '—'}`, padX + 144, levelY + 18);

  const barY = levelY + 48;
  const barW = contentW;
  fillRoundRect(ctx, padX, barY, barW, 12, 6, t.canvas);
  const ratio =
    progress.xpForNext > 0
      ? Math.min(1, Math.max(0, progress.xpIntoLevel / progress.xpForNext))
      : 0;
  const g = ctx.createLinearGradient(padX, 0, padX + barW, 0);
  g.addColorStop(0, t.accent);
  g.addColorStop(1, t.accent2 || t.border);
  fillRoundRect(ctx, padX, barY, Math.max(10, Math.floor(barW * ratio)), 12, 6, g);
  // fillRoundRect with gradient object - need to set fillStyle manually
  roundRect(ctx, padX, barY, Math.max(10, Math.floor(barW * ratio)), 12, 6);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.fillStyle = t.muted;
  ctx.font = `400 12px ${FONT}`;
  ctx.fillText(
    `Progresso ${progress.xpIntoLevel}/${progress.xpForNext} neste nível`,
    padX,
    barY + 32
  );

  // KPI boxes
  const kpiY = barY + 56;
  ctx.fillStyle = t.muted;
  ctx.font = `700 11px ${FONT}`;
  ctx.fillText('RECURSOS', padX, kpiY);

  const kpis = [
    { label: 'Coins', value: fmtNum(coins), color: t.accent },
    { label: 'Mensagens', value: fmtNum(messages), color: t.accent2 || t.border },
    { label: 'Streak', value: String(streak), color: t.success || t.accent },
  ];
  const gap = 14;
  const boxW = (contentW - gap * 2) / 3;
  kpis.forEach((k, i) => {
    const x = padX + i * (boxW + gap);
    const y = kpiY + 14;
    fillRoundRect(ctx, x, y, boxW, 78, 12, t.canvas);
    strokeRoundRect(ctx, x, y, boxW, 78, 12, k.color, 2);
    ctx.fillStyle = t.muted;
    ctx.font = `600 12px ${FONT}`;
    ctx.fillText(k.label, x + 16, y + 28);
    ctx.fillStyle = k.color;
    ctx.font = `800 26px ${FONT}`;
    ctx.fillText(k.value, x + 16, y + 58);
  });

  let y = kpiY + 120;
  ctx.fillStyle = t.muted;
  ctx.font = `700 11px ${FONT}`;
  ctx.fillText('RANKINGS NO GRUPO', padX, y);
  y += 26;
  ctx.fillStyle = t.text;
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText(
    `XP #${rank || '—'}    Coins #${coinsRank || '—'}    Mensagens #${messagesRank || '—'}`,
    padX,
    y
  );
  y += 36;

  ctx.font = `500 14px ${FONT}`;
  if (employment?.job) {
    ctx.fillStyle = t.muted;
    ctx.fillText(
      `Emprego · ${employment.job.name || employment.job.id} · ~${fmtNum(employment.salary)} coins/dia`,
      padX,
      y
    );
    y += 26;
  }
  if (factionLabel) {
    ctx.fillStyle = t.accent2 || t.accent;
    ctx.fillText(`Facção · ${shortName(factionLabel, '', 36)}`, padX, y);
    y += 26;
  }
  if (partnerName) {
    ctx.fillStyle = '#f9a8d4';
    ctx.fillText(`Casado(a) com · ${shortName(partnerName, '', 28)}`, padX, y);
    y += 26;
  }
  if (casino && (casino.games > 0 || casino.wagered > 0)) {
    const profit = Number(casino.profit) || 0;
    const sign = profit >= 0 ? '+' : '';
    ctx.fillStyle = t.muted;
    ctx.font = `700 11px ${FONT}`;
    ctx.fillText('CASSINO · LUCRO / PREJUÍZO', padX, y);
    y += 24;
    ctx.fillStyle = profit >= 0 ? t.success : t.danger;
    ctx.font = `700 16px ${FONT}`;
    ctx.fillText(
      `Lucro ${sign}${fmtNum(profit)}  ·  ${fmtNum(casino.games)} jogos  ·  ${fmtNum(casino.wagered)} apostados`,
      padX,
      y
    );
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
  drawFestiveDecor(ctx, width, height, t.festive);
  const { padX, padTop, contentW } = drawShell(ctx, width, height, t);

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
        fillRoundRect(ctx, padX - 10, y, contentW + 20, rowH - 6, 10, t.raise2);
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
  drawFestiveDecor(ctx, width, height, t.festive);
  const { padX, padTop, contentW } = drawShell(ctx, width, height, t);

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
        fillRoundRect(ctx, padX - 10, y, contentW + 20, rowH - 6, 10, t.raise2);
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
