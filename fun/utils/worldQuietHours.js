/**
 * Janela de silêncio do relógio do mundo (horário real).
 * Default: 01:00–05:59 (America/Sao_Paulo) — nenhum evento aleatório.
 */

/**
 * Hora local 0–23 no fuso informado.
 * @param {number} [nowMs]
 * @param {string} [timeZone]
 */
export function getLocalHour(nowMs = Date.now(), timeZone = 'America/Sao_Paulo') {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: String(timeZone || 'America/Sao_Paulo'),
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(nowMs));
    const hourPart = parts.find((p) => p.type === 'hour');
    const h = Number(hourPart?.value);
    if (Number.isFinite(h)) return ((h % 24) + 24) % 24;
  } catch {
    /* fallback server local */
  }
  return new Date(nowMs).getHours();
}

/**
 * @param {object} [funConfig]
 * @param {number} [nowMs]
 * @returns {boolean} true = silêncio (não disparar eventos do mundo)
 */
export function isWorldQuietHours(funConfig = {}, nowMs = Date.now()) {
  if (funConfig.worldQuietHoursEnabled === false) return false;
  const start = Math.min(
    23,
    Math.max(0, Math.floor(Number(funConfig.worldQuietHourStart) || 1))
  );
  const end = Math.min(
    24,
    Math.max(0, Math.floor(Number(funConfig.worldQuietHourEnd) || 6))
  );
  if (start === end) return false;

  const tz = String(funConfig.worldTimezone || 'America/Sao_Paulo');
  const hour = getLocalHour(nowMs, tz);

  // janela normal: start < end → [start, end)
  if (start < end) {
    return hour >= start && hour < end;
  }
  // janela que cruza meia-noite: ex. 22 → 6
  return hour >= start || hour < end;
}
