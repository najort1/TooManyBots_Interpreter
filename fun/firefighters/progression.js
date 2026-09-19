/**
 * Curva de dificuldade progressiva e termodinâmica do chamado de incêndio.
 */

import { DIFFICULTY_PHASES, DURATION_LIMITS } from './constants.js';

/**
 * Normaliza a duração da partida dentro dos limites de segurança (1 a 5 minutos).
 * @param {number} [durationMs]
 * @returns {number}
 */
export function normalizeDurationMs(durationMs) {
  if (!Number.isFinite(durationMs)) {
    return DURATION_LIMITS.DEFAULT_MS;
  }
  return Math.min(
    DURATION_LIMITS.MAX_MS,
    Math.max(DURATION_LIMITS.MIN_MS, Math.round(durationMs))
  );
}

/**
 * Determina a fase da partida com base no tempo decorrido e duração total.
 * @param {number} elapsedMs
 * @param {number} totalDurationMs
 * @returns {{ phaseId: number, progressRatio: number, phaseConfig: object }}
 */
export function getProgressionState(elapsedMs, totalDurationMs) {
  const duration = normalizeDurationMs(totalDurationMs);
  const clampedElapsed = Math.max(0, Math.min(duration, elapsedMs || 0));
  const progressRatio = duration > 0 ? clampedElapsed / duration : 0;

  let phaseId = 1;
  if (progressRatio >= 0.66) {
    phaseId = 3;
  } else if (progressRatio >= 0.33) {
    phaseId = 2;
  }

  const phaseConfig = DIFFICULTY_PHASES[phaseId] || DIFFICULTY_PHASES[1];

  return {
    phaseId,
    progressRatio,
    phaseConfig,
  };
}

/**
 * Calcula o multiplicador dinâmico de estresse e propagação de chamas.
 * @param {number} phaseId
 * @returns {number}
 */
export function getPropagationMultiplier(phaseId) {
  switch (phaseId) {
    case 3:
      return 2.2;
    case 2:
      return 1.5;
    case 1:
    default:
      return 1.0;
  }
}
