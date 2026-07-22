const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const COLOR_ICON = { red: '🔴', black: '⚫', green: '🟢' };

export function computeStats(history, scopeKey) {
  if (!history || !history.length) {
    return { recent: [], hot: null, cold: null, streak: null, colorPct: {} };
  }

  const freq = {};
  for (const h of history) {
    freq[h.ball] = (freq[h.ball] || 0) + 1;
  }

  const total = history.length;
  const sorted = Object.entries(freq)
    .map(([ball, count]) => ({ ball: Number(ball), count, pct: (count / total) * 100 }))
    .sort((a, b) => b.count - a.count);

  const hot = sorted[0]
    ? { ball: sorted[0].ball, count: sorted[0].count }
    : null;
  const cold = sorted[sorted.length - 1]
    ? { ball: sorted[sorted.length - 1].ball, count: sorted[sorted.length - 1].count }
    : null;

  const streak = (() => {
    if (history.length < 2) return null;
    let count = 0;
    const last = history[history.length - 1];
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].color === last.color) count++;
      else break;
    }
    return { color: last.color, count, icon: COLOR_ICON[last.color] };
  })();

  const colorCount = { red: 0, black: 0, green: 0 };
  for (const h of history) {
    if (colorCount[h.color] !== undefined) colorCount[h.color]++;
  }
  const colorPct = {};
  for (const [c, cnt] of Object.entries(colorCount)) {
    colorPct[c] = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0';
  }

  const lastTen = history.slice(-10).reverse().map(h => ({
    ball: h.ball,
    color: h.color,
    icon: COLOR_ICON[h.color],
  }));

  return { recent: lastTen, hot, cold, streak, colorPct, total };
}

export function formatStatsLine(stats) {
  const parts = [];
  if (stats.streak && stats.streak.count >= 3) {
    const label = stats.streak.color === 'red' ? 'Vermelho' : stats.streak.color === 'black' ? 'Preto' : 'Verde';
    parts.push(`${stats.streak.icon} ${label} ×${stats.streak.count}`);
  }
  if (stats.hot && stats.total >= 10) {
    parts.push(`🔥 ${stats.hot.ball} (${stats.hot.count}x)`);
  }
  if (stats.cold && stats.total >= 20 && stats.cold.count <= 1) {
    parts.push(`❄ ${stats.cold.ball} (${stats.cold.count}x)`);
  }
  if (!parts.length && stats.total > 0) {
    const r = stats.colorPct;
    parts.push(`🔴 ${r.red}% ⚫ ${r.black}% 🟢 ${r.green}%`);
  }
  return parts.join(' · ');
}

export function formatRecentLine(stats) {
  if (!stats.recent || !stats.recent.length) return '';
  const icons = stats.recent.slice(0, 16).map(h => h.icon).join(' ');
  return icons;
}
