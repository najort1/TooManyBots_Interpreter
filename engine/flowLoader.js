/**
 * engine/flowLoader.js
 *
 * Carrega, valida e pré-processa um arquivo de fluxo .tmb.
 *
 * Otimização: Pré-calcula mapas de saltos para IF/ELSE/END-IF
 * evitando varreduras lineares O(N) durante a execução.
 * Com os mapas, findNextBranch() e findEndIf() operam em O(1).
 */

import fs from 'fs';
import path from 'path';
import { BLOCK_TYPE } from '../config/constants.js';

const REQUIRED_BLOCK_FIELDS = ['id', 'type', 'config'];

const SUPPORTED_TYPES = new Set(Object.values(BLOCK_TYPE));

function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeRuntimeConfig(runtimeConfig = {}) {
  const endBehavior = runtimeConfig.endBehavior ?? {};
  const postEnd = runtimeConfig.postEnd ?? {};
  const sessionLimits = runtimeConfig.sessionLimits ?? {};

  return {
    startPolicy: runtimeConfig.startPolicy ?? 'allow-always',
    endBehavior: {
      sendClosingMessage: endBehavior.sendClosingMessage !== false,
    },
    postEnd: {
      reentryPolicy: postEnd.reentryPolicy ?? 'allow-always',
      cooldownMinutes: toPositiveNumber(postEnd.cooldownMinutes, 0),
      blockedMessage: postEnd.blockedMessage ?? 'Este fluxo nao permite novas conversas para este usuario.',
      cooldownMessage: postEnd.cooldownMessage ?? 'Aguarde alguns minutos para iniciar uma nova conversa.',
    },
    sessionLimits: {
      maxMessagesPerSession: toPositiveNumber(sessionLimits.maxMessagesPerSession, 0),
      sessionTimeoutMinutes: toPositiveNumber(sessionLimits.sessionTimeoutMinutes, 0),
      timeoutMessage: sessionLimits.timeoutMessage ?? 'Sessao encerrada por tempo limite.',
    },
  };
}

/**
 * Carrega e valida um arquivo de fluxo .tmb.
 * Retorna { blocks, blockMap, indexMap, branchMap, endIfMap, version, runtimeConfig }
 *
 * branchMap: Map<number, number> — índice do bloco → índice do próximo branch (else-if, else, end-if)
 * endIfMap:  Map<number, number> — índice do bloco → índice do end-if correspondente
 */
export function loadFlow(flowPath) {
  const resolved = path.resolve(flowPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Arquivo de fluxo não encontrado: ${resolved}`);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (err) {
    throw new Error(`Falha ao analisar arquivo de fluxo: ${err.message}`);
  }

  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    throw new Error('Arquivo de fluxo deve conter um array "blocks" não vazio.');
  }

  // Validar cada bloco
  for (const block of raw.blocks) {
    for (const field of REQUIRED_BLOCK_FIELDS) {
      if (block[field] === undefined) {
        throw new Error(`Bloco com campo ausente "${field}": ${JSON.stringify(block)}`);
      }
    }

    if (!SUPPORTED_TYPES.has(block.type)) {
      console.warn(`[FlowLoader] Tipo de bloco desconhecido "${block.type}" — será ignorado em tempo de execução.`);
    }
  }

  // Construir mapa de busca por ID para alvos de redirecionamento / condição
  const blockMap = new Map();
  const indexMap = new Map(); // id → índice do array

  raw.blocks.forEach((block, i) => {
    if (block.active === false) return; // pular blocos desativados
    blockMap.set(block.id, block);
    indexMap.set(block.id, i);
  });

  // Apenas blocos ativos (preservar ordem)
  const blocks = raw.blocks.filter(b => b.active !== false);

  // ─── Pré-cálculo de mapas de salto O(1) ─────────────────────────────────────
  const branchMap = new Map(); // blockIndex → nextBranch index
  const endIfMap  = new Map(); // blockIndex → endIf index

  buildJumpMaps(blocks, branchMap, endIfMap);

  return {
    blocks,
    blockMap,
    indexMap,
    branchMap,
    endIfMap,
    version: raw.version,
    runtimeConfig: normalizeRuntimeConfig(raw.flowRuntimeConfig),
  };
}

/**
 * Constrói mapas de salto pré-calculados para blocos condicionais.
 *
 * Para cada if-condition/else-if/else, mapeia:
 * - branchMap: próximo branch no mesmo nível (else-if, else ou end-if)
 * - endIfMap:  o end-if correspondente
 *
 * Complexidade: O(N) na carga, O(1) em tempo de execução.
 */
function buildJumpMaps(blocks, branchMap, endIfMap) {
  for (let i = 0; i < blocks.length; i++) {
    const type = blocks[i].type;

    if (type === BLOCK_TYPE.IF_CONDITION || type === BLOCK_TYPE.ELSE_IF || type === BLOCK_TYPE.ELSE) {
      // Encontrar próximo branch (else-if, else ou end-if) no mesmo nível
      let depth = 0;
      for (let j = i + 1; j < blocks.length; j++) {
        const jType = blocks[j].type;
        if (jType === BLOCK_TYPE.IF_CONDITION) {
          depth++;
        } else if (jType === BLOCK_TYPE.END_IF) {
          if (depth === 0) {
            branchMap.set(i, j);
            break;
          }
          depth--;
        } else if ((jType === BLOCK_TYPE.ELSE_IF || jType === BLOCK_TYPE.ELSE) && depth === 0) {
          branchMap.set(i, j);
          break;
        }
      }

      // Encontrar end-if correspondente
      depth = 0;
      for (let j = i + 1; j < blocks.length; j++) {
        const jType = blocks[j].type;
        if (jType === BLOCK_TYPE.IF_CONDITION) {
          depth++;
        } else if (jType === BLOCK_TYPE.END_IF) {
          if (depth === 0) {
            endIfMap.set(i, j);
            break;
          }
          depth--;
        }
      }
    }
  }
}
