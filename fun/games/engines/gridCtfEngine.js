/**
 * Motor do Jogo: 🚩 Grande Golpe (Capture a Bandeira / Assalto ao Cofre)
 *
 * Reformulado para rodadas táticas síncronas de invasão e defesa por rotas:
 * - 6 rodadas de 15 segundos (ataque e defesa alternados).
 * - 100% compatível com as limitações de conexão e concorrência do Cloudflare Quick Tunnel.
 * - Zero streaming de 60fps/SSE de alta frequência; ação por escolha atômica + canal tático da panelinha.
 */

import { createRoundBasedGameEngine } from './roundBasedGameEngine.js';
import { GOLPE_CONSTANTS } from './tacticalResolution.js';

export { GOLPE_CONSTANTS };

export const GRID_CTF_CONSTANTS = Object.freeze({
  MIN_PLAYERS: 4,
  MAX_PLAYERS: 6,
  TOTAL_ROUNDS: GOLPE_CONSTANTS.TOTAL_ROUNDS,
  ROUND_DURATION_MS: GOLPE_CONSTANTS.ROUND_DURATION_MS,
  REVEAL_DURATION_MS: GOLPE_CONSTANTS.REVEAL_DURATION_MS,
  ROUTES: GOLPE_CONSTANTS.ROUTES,
  ROUTE_VALUES: GOLPE_CONSTANTS.ROUTE_VALUES,
  TEAMS: {
    BLUE: 'blue',
    RED: 'red',
  },
});

/**
 * Cria a instância do motor Grande Golpe (Capture a Bandeira Tático).
 *
 * @param {object} room Sala gerenciada pelo GameManager
 * @param {object} options Opções de runtime
 * @returns {object} Instância do motor
 */
export function createGridCtfEngine(room, options = {}) {
  return createRoundBasedGameEngine(room, {
    ...options,
    gameType: 'grid_ctf',
    totalRounds: GOLPE_CONSTANTS.TOTAL_ROUNDS,
    roundDurationMs: GOLPE_CONSTANTS.ROUND_DURATION_MS,
    revealDurationMs: GOLPE_CONSTANTS.REVEAL_DURATION_MS,
  });
}
