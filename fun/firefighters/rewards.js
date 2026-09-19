/**
 * Recompensas econômicas (XP, Coins e Patentes) integradas ao ecossistema TooManyBots.
 */

import { getRankForScore } from './scoring.js';

/**
 * Calcula a gratificação cívica e de honra ao mérito do bombeiro.
 * @param {object} params
 * @param {number} params.score
 * @param {object} [params.metrics]
 * @returns {{ xp: number, coins: number, rank: object, message: string }}
 */
export function calculateFirefighterRewards({ score = 0, metrics = {} } = {}) {
  const sc = Math.max(0, Number(score) || 0);
  const victimsSaved = Math.max(0, metrics.victimsSaved || 0);

  // XP: 20 base + 5 por vítima resgatada + 0.3x score
  const xp = Math.min(100, Math.round(20 + victimsSaved * 5 + sc * 0.3));

  // Coins: 25 base + 8 por vítima resgatada + 0.4x score
  const coins = Math.min(150, Math.round(25 + victimsSaved * 8 + sc * 0.4));

  const rank = getRankForScore(sc);

  const message =
    `🚒 *Ordem do Mérito do Corpo de Bombeiros*\n` +
    `Patente alcançada: ${rank.emoji} *${rank.title}*\n` +
    `Focos debelados: *${metrics.firesExtinguished || 0}* | Vítimas salvas: *${victimsSaved}*\n` +
    `Gratificação: *+${coins} coins* | Mérito: *+${xp} XP*`;

  return {
    xp,
    coins,
    rank,
    message,
  };
}

/**
 * Aplica as recompensas no repositório de estatísticas / economia do usuário.
 * Suporta repositórios síncronos (padrão SQLite) e assíncronos.
 * @param {object} params
 * @param {object} params.repository Repositório de estatísticas (ex: funStatsRepository)
 * @param {string} params.userJid JID do bombeiro
 * @param {string} params.scopeKey ScopeKey da guarnição
 * @param {object} params.rewards Resultado de calculateFirefighterRewards
 */
export function applyFirefighterRewards({ repository, userJid, scopeKey, rewards }) {
  if (!repository || !userJid || !scopeKey || !rewards) {
    return { success: false, reason: 'invalid_arguments' };
  }

  const results = { xpAwarded: 0, coinsAwarded: 0 };

  if (rewards.coins > 0 && typeof repository.addCoins === 'function') {
    try {
      repository.addCoins({
        userJid,
        scopeKey,
        amount: rewards.coins,
        reason: 'job-reward:bombeiro',
      });
      results.coinsAwarded = rewards.coins;
    } catch {
      // Falha não-bloqueante na economia
    }
  }

  if (rewards.xp > 0 && typeof repository.awardXp === 'function') {
    try {
      repository.awardXp({
        userJid,
        scopeKey,
        amount: rewards.xp,
      });
      results.xpAwarded = rewards.xp;
    } catch {
      // Falha não-bloqueante no XP
    }
  }

  return { success: true, ...results };
}
