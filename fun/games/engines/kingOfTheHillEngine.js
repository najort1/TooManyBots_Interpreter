/**
 * Motor do Jogo: 👑 Colinas (King of the Hill - Domínio das Três Colinas)
 *
 * Reformulado para rodadas táticas síncronas de alta intensidade e blefe:
 * - 6 rodadas de 15 segundos.
 * - 100% compatível com as limitações de conexão e concorrência do Cloudflare Quick Tunnel.
 * - Zero streaming de 60fps/SSE de alta frequência; ação por escolha atômica + canal tático da panelinha.
 */

import { createRoundBasedGameEngine } from './roundBasedGameEngine.js';
import { COLINAS_CONSTANTS } from './tacticalResolution.js';

export { COLINAS_CONSTANTS };

export const KOTH_CONSTANTS = Object.freeze({
  MIN_PLAYERS: 4,
  MAX_PLAYERS: 6,
  TOTAL_ROUNDS: COLINAS_CONSTANTS.TOTAL_ROUNDS,
  ROUND_DURATION_MS: COLINAS_CONSTANTS.ROUND_DURATION_MS,
  REVEAL_DURATION_MS: COLINAS_CONSTANTS.REVEAL_DURATION_MS,
  HILLS: COLINAS_CONSTANTS.HILLS,
  BASE_VALUES: COLINAS_CONSTANTS.BASE_VALUES,
});

export const DEFAULT_ZONES = Object.freeze({
  A: { id: 'alfa', name: 'Colina Alfa 🏰', baseValue: 5 },
  B: { id: 'bravo', name: 'Colina Bravo ⚔️', baseValue: 3 },
  C: { id: 'charlie', name: 'Colina Charlie 💎', baseValue: 2 },
});

export function renderProgressBar(percent, length = 10) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  const rounded = Math.round(safePercent);
  const filled = Math.max(0, Math.min(length, Math.round((rounded / 100) * length)));
  const empty = Math.max(0, length - filled);
  return `${'█'.repeat(filled)}${'░'.repeat(empty)} ${rounded}%`;
}

/**
 * Cria a instância do motor Colinas (King of the Hill).
 *
 * @param {object} room Sala gerenciada pelo GameManager
 * @param {object} options Opções de runtime
 * @returns {object} Instância do motor
 */
export function createKingOfTheHillEngine(room, options = {}) {
  return createRoundBasedGameEngine(room, {
    ...options,
    gameType: 'king_of_the_hill',
    totalRounds: COLINAS_CONSTANTS.TOTAL_ROUNDS,
    roundDurationMs: COLINAS_CONSTANTS.ROUND_DURATION_MS,
    revealDurationMs: COLINAS_CONSTANTS.REVEAL_DURATION_MS,
  });
}
