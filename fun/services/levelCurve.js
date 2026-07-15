/**
 * Curva de level pura e testável.
 *
 * xpToNext(level) = 100 + (level - 1) * 50
 * totalXpForLevel(L) = sum_{i=1}^{L-1} xpToNext(i) = 25 * (L-1) * (L+2)
 */

export function xpToNext(level) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  return 100 + (lvl - 1) * 50;
}

/**
 * XP total acumulado necessário para *estar* no level L (nível começa em 1).
 */
export function totalXpForLevel(level) {
  const L = Math.max(1, Math.floor(Number(level) || 1));
  if (L <= 1) return 0;
  return 25 * (L - 1) * (L + 2);
}

/**
 * Converte XP total acumulado em level.
 */
export function levelFromTotalXp(totalXp) {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  // Bounded loop: level 1000 requires huge XP; practical cap prevents runaway
  while (level < 10_000 && totalXpForLevel(level + 1) <= xp) {
    level += 1;
  }
  return level;
}

/**
 * Progresso dentro do level atual.
 * @returns {{ level: number, xp: number, xpIntoLevel: number, xpForNext: number, xpRemaining: number, progress: number }}
 */
export function progressInLevel(totalXp) {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  const level = levelFromTotalXp(xp);
  const floorXp = totalXpForLevel(level);
  const nextFloor = totalXpForLevel(level + 1);
  const xpForNext = Math.max(1, nextFloor - floorXp);
  const xpIntoLevel = Math.max(0, xp - floorXp);
  const xpRemaining = Math.max(0, nextFloor - xp);
  const progress = Math.min(1, xpIntoLevel / xpForNext);

  return {
    level,
    xp,
    xpIntoLevel,
    xpForNext,
    xpRemaining,
    progress,
  };
}
