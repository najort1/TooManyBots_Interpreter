/**
 * engine/resolvers/listResolver.js
 *
 * Resolve respostas de usuário quando o engine está aguardando seleção de lista.
 * Isolado do flowEngine para facilitar testes unitários.
 */

import { safeParseJSON } from '../utils.js';
import { INTERNAL_VAR } from '../../config/constants.js';

/**
 * Resolve uma resposta de lista, processando matching por ID, número ou texto.
 *
 * @param {string} message - Texto da mensagem
 * @param {string} listId  - ID de seleção nativa da lista (se disponível)
 * @param {object} session - Sessão atual
 * @param {object} flow    - { blocks, blockMap, indexMap }
 * @returns {{ patch: object, match: object|null }} - Patch e match encontrado
 */
export function resolveList(message, listId, session, flow) {
  const nextIndex = parseInt(session.variables[INTERNAL_VAR.NEXT_BLOCK_ON_LIST] ?? '0', 10);
  const rawItems = session.variables[INTERNAL_VAR.LIST_ITEMS];

  let match = null;

  if (rawItems) {
    const items = safeParseJSON(rawItems, []);

    // 1. Tentar match por ID (se vier de lista nativa)
    match = items.find(item => item.id === listId);

    // 2. Tentar match por número (ex: "1", "2", "3")
    if (!match && /^\d+$/.test(message.trim())) {
      const index = parseInt(message.trim(), 10) - 1;
      if (index >= 0 && index < items.length) {
        match = items[index];
      }
    }

    // 3. Tentar match por texto (case insensitive, partial match)
    if (!match) {
      const normalizedMsg = message.toLowerCase().trim();
      match = items.find(item =>
        String(item.title).toLowerCase().includes(normalizedMsg) ||
        String(item.id).toLowerCase() === normalizedMsg
      );
    }
  }

  if (!match) {
    return { patch: null, match: null };
  }

  console.log(`✅ Match encontrado: "${message}" -> ${match.id} (${match.title})`);

  const variables = {
    ...session.variables,
    [INTERNAL_VAR.LAST_LIST_SELECTION]: match.title,
    [INTERNAL_VAR.LAST_LIST_SELECTION_ID]: match.id,
    [INTERNAL_VAR.LIST_ITEMS]: undefined,
    [INTERNAL_VAR.NEXT_BLOCK_ON_LIST]: undefined,
  };

  // Salvar variável se configurado
  if (match.saveVariable && match.variableName) {
    variables[match.variableName] = match.variableValue;
  }

  let targetIndex = nextIndex;
  if (match.redirectBlockId) {
    const redirectedIndex = flow.indexMap.get(match.redirectBlockId);
    if (redirectedIndex !== undefined) {
      targetIndex = redirectedIndex;
    }
  }

  return {
    patch: {
      blockIndex: targetIndex,
      waitingFor: null,
      variables,
    },
    match,
  };
}
