/**
 * Central de mensagens padronizadas do módulo Fun.
 *
 * Uso:
 *   import { fmt } from '../../messages/index.js';
 *   await reply(fmt.cooldown('roleta', 300_000));
 *
 * Todos os formatadores aceitam um objeto de parâmetros nomeados.
 */

import { formatCooldown, formatDuration } from './cooldown.js';
import {
  insufficientBalance,
  targetNotFound,
  itemNotFound,
  genericError,
  notAvailable,
  alreadyOwned,
  limitReached,
} from './errors.js';
import {
  purchaseComplete,
  transferComplete,
  dailyClaimed,
  collectComplete,
} from './economy.js';

export {
  formatCooldown,
  formatDuration,
  insufficientBalance,
  targetNotFound,
  itemNotFound,
  genericError,
  notAvailable,
  alreadyOwned,
  limitReached,
  purchaseComplete,
  transferComplete,
  dailyClaimed,
  collectComplete,
};

/** Atalho único para importação simplificada */
export const fmt = {
  cooldown: (cmd, time) => formatCooldown(cmd, time),
  insufficientBalance,
  targetNotFound,
  itemNotFound,
  genericError,
  notAvailable,
  alreadyOwned,
  limitReached,
  purchaseComplete,
  transferComplete,
  dailyClaimed,
  collectComplete,
};
