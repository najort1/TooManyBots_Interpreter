/**
 * Sistema de pontuação, cálculo de patentes e validação de tentativas de bombeiro.
 */

import { RANKS } from './constants.js';

/**
 * Calcula a pontuação final determinística baseada nas métricas táticas da partida.
 * @param {object} metrics
 * @returns {number} Pontuação inteira entre 0 e 100
 */
export function calculateFirefighterScore(metrics = {}) {
  const fires = Math.max(0, metrics.firesExtinguished || 0);
  const victimsSaved = Math.max(0, metrics.victimsSaved || 0);
  const victimsLost = Math.max(0, metrics.victimsLost || 0);
  const buildingsSaved = Math.max(0, metrics.buildingsSaved || 0);
  const collapsed = Math.max(0, metrics.buildingsCollapsed ?? metrics.lostHouses ?? 0);
  const maxCombo = Math.max(0, metrics.maxCombo || 0);

  let raw =
    fires * 6 +
    victimsSaved * 8 +
    buildingsSaved * 4 +
    Math.min(15, maxCombo * 2) -
    collapsed * 10 -
    victimsLost * 5;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Retorna o título e emoji da patente correspondente à pontuação obtida.
 * @param {number} score
 * @returns {{ minScore: number, title: string, emoji: string }}
 */
export function getRankForScore(score) {
  const num = Number(score) || 0;
  for (const rank of RANKS) {
    if (num >= rank.minScore) {
      return rank;
    }
  }
  return RANKS[RANKS.length - 1];
}

/**
 * Valida o resultado de uma partida de bombeiro submetida ao jobService.
 * @param {object} params
 * @param {number} params.score
 * @param {number} [params.durationMs]
 * @param {object} [params.metrics]
 * @param {object} [params.config]
 * @returns {{ passed: boolean, reason?: string }}
 */
export function validateFirefighterAttempt({ score, durationMs, metrics = {}, config = {} }) {
  const sc = Number(score) || 0;
  const targetScore = config.targetScore || 20;
  const maxLost = config.maxLostHouses ?? 3;
  const lostHouses = Number(metrics.lostHouses ?? metrics.buildingsCollapsed ?? 0);

  // Invariante 1: não pode ter perdido mais casas do que o limite tolerado
  if (lostHouses > maxLost) {
    return {
      passed: false,
      reason: `Desabamentos excessivos: ${lostHouses} edifícios foram destruídos (máximo permitido: ${maxLost}).`,
    };
  }

  // Invariante 2: pontuação mínima exigida pelo contrato
  if (sc < targetScore) {
    return {
      passed: false,
      reason: `Pontuação insuficiente: obteve ${sc} pontos (mínimo exigido: ${targetScore}).`,
    };
  }

  // Invariante 3: se buildingsCollapsed e lostHouses ambos vierem, devem ser consistentes
  if (
    typeof metrics.buildingsCollapsed === 'number' &&
    typeof metrics.lostHouses === 'number' &&
    metrics.buildingsCollapsed !== metrics.lostHouses
  ) {
    return {
      passed: false,
      reason: 'Inconsistência entre edifícios colapsados e casas perdidas.',
    };
  }

  return { passed: true };
}
