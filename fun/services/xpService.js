/**
 * Regras de award de XP (cooldown, range aleatório, level-up).
 */

export function createXpService({ repository, random = Math.random } = {}) {
  if (!repository) throw new Error('[fun/xpService] repository required');

  function rollXpAmount(xpMin, xpMax) {
    const min = Math.max(0, Math.floor(Number(xpMin) || 0));
    const max = Math.max(min, Math.floor(Number(xpMax) || min));
    if (max === min) return min;
    return min + Math.floor(random() * (max - min + 1));
  }

  /**
   * @param {{ userJid: string, scopeKey: string, now?: number, cooldownMs?: number, xpMin?: number, xpMax?: number, amount?: number }} input
   */
  function awardXp(input = {}) {
    const {
      userJid,
      scopeKey,
      now = Date.now(),
      cooldownMs = 60_000,
      xpMin = 15,
      xpMax = 25,
      amount,
    } = input;

    const gained =
      amount != null && Number.isFinite(Number(amount))
        ? Math.max(0, Math.floor(Number(amount)))
        : rollXpAmount(xpMin, xpMax);

    return repository.awardXp({
      userJid,
      scopeKey,
      amount: gained,
      now,
      cooldownMs,
    });
  }

  return {
    rollXpAmount,
    awardXp,
  };
}
