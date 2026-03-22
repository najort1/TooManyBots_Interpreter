/**
 * engine/resolvers/keywordResolver.js
 *
 * Resolve respostas de usuário quando o engine está aguardando keywords.
 * Isolado do flowEngine para facilitar testes unitários.
 */

import { safeParseJSON } from '../utils.js';
import { INTERNAL_VAR } from '../../config/constants.js';

/**
 * Resolve uma resposta de keyword, processando matching e atualizando variáveis.
 *
 * @param {object} sock    - Socket Baileys
 * @param {string} jid     - JID do remetente
 * @param {string} message - Texto da mensagem
 * @param {object} session - Sessão atual
 * @param {object} flow    - { blocks, blockMap, indexMap }
 * @returns {object|null}  - Novo patch de sessão, ou null se inválido
 */
export function resolveKeyword(sock, jid, message, session, flow) {
  const rawKeywords = session.variables[INTERNAL_VAR.KEYWORDS];
  const nextIndex = parseInt(session.variables[INTERNAL_VAR.NEXT_BLOCK_ON_KEYWORD] ?? '0', 10);
  const captureVar = session.variables[INTERNAL_VAR.CAPTURE_VARIABLE];

  let matchedResponse = null;

  if (rawKeywords && rawKeywords !== '[]') {
    const keywordDefs = safeParseJSON(rawKeywords, []);
    const normalizedMsg = message.toLowerCase().trim();

    for (const def of keywordDefs) {
      if (!def.keyword) continue;
      const keywords = String(def.keyword)
        .split(',')
        .map(k => k.trim().toLowerCase());

      const isMatch = keywords.some(k => normalizedMsg === k || normalizedMsg.includes(k));

      if (isMatch) {
        matchedResponse = def.response || null;
        break;
      }
    }
  }

  const variables = {
    ...session.variables,
    [INTERNAL_VAR.LAST_MESSAGE]: message,
    [INTERNAL_VAR.KEYWORDS]: undefined,
    [INTERNAL_VAR.NEXT_BLOCK_ON_KEYWORD]: undefined,
    [INTERNAL_VAR.CAPTURE_VARIABLE]: undefined,
  };

  if (captureVar) {
    variables[captureVar] = message;
  }

  return {
    patch: {
      blockIndex: nextIndex,
      waitingFor: null,
      variables,
    },
    matchedResponse,
  };
}
