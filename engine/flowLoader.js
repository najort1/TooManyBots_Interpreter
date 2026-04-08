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

function normalizeBlockType(type) {
  const raw = String(type ?? '').trim();
  const normalized = raw.toLowerCase();

  if (normalized === 'else-condition' || normalized === 'else_block') {
    return BLOCK_TYPE.ELSE;
  }

  if (
    normalized === 'elseif-condition' ||
    normalized === 'else-if-condition' ||
    normalized === 'elseif' ||
    normalized === 'else_if'
  ) {
    return BLOCK_TYPE.ELSE_IF;
  }

  return raw;
}

function toPositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateRedirectToHumanBlock(block, activeBlockIds = null) {
  const cfg = block?.config;
  if (!isPlainObject(cfg)) {
    throw new Error(`Bloco ${block?.id ?? 'unknown'} (${BLOCK_TYPE.REDIRECT_TO_HUMAN}) requer "config" como objeto.`);
  }

  const stringFields = ['message', 'queue', 'reason', 'onClaimBlockId', 'onFinishBlockId', 'onTimeoutBlockId'];
  for (const field of stringFields) {
    if (cfg[field] !== undefined && typeof cfg[field] !== 'string') {
      throw new Error(`Bloco ${block.id} (${BLOCK_TYPE.REDIRECT_TO_HUMAN}) requer "config.${field}" como string.`);
    }
  }

  if (cfg.captureUntilClaimed !== undefined && typeof cfg.captureUntilClaimed !== 'boolean') {
    throw new Error(`Bloco ${block.id} (${BLOCK_TYPE.REDIRECT_TO_HUMAN}) requer "config.captureUntilClaimed" como boolean.`);
  }

  if (cfg.timeoutMinutes !== undefined) {
    const timeout = Number(cfg.timeoutMinutes);
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new Error(`Bloco ${block.id} (${BLOCK_TYPE.REDIRECT_TO_HUMAN}) requer "config.timeoutMinutes" >= 0.`);
    }
    if (timeout > 0 && !String(cfg.onTimeoutBlockId ?? '').trim()) {
      throw new Error(`Bloco ${block.id} (${BLOCK_TYPE.REDIRECT_TO_HUMAN}) com timeoutMinutes > 0 requer "config.onTimeoutBlockId".`);
    }
  }

  if (!activeBlockIds) return;

  for (const field of ['onClaimBlockId', 'onFinishBlockId', 'onTimeoutBlockId']) {
    const targetId = String(cfg[field] ?? '').trim();
    if (!targetId) continue;
    if (!activeBlockIds.has(targetId)) {
      throw new Error(`Bloco ${block.id} (${BLOCK_TYPE.REDIRECT_TO_HUMAN}) referencia "${field}" invalido: ${targetId}`);
    }
  }
}

function normalizeRuntimeConfig(runtimeConfig = {}) {
  const endBehavior = runtimeConfig.endBehavior ?? {};
  const postEnd = runtimeConfig.postEnd ?? {};
  const sessionLimits = runtimeConfig.sessionLimits ?? {};

  return {
    conversationMode: runtimeConfig.conversationMode ?? 'conversation',
    interactionScope: runtimeConfig.interactionScope ?? 'all',
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

function normalizeConversationMode(mode) {
  const normalized = String(mode ?? 'conversation').trim().toLowerCase();
  return normalized === 'command' ? 'command' : 'conversation';
}

export function getFlowBotType(flowLike) {
  return normalizeConversationMode(flowLike?.runtimeConfig?.conversationMode);
}

/**
 * Carrega e valida um arquivo de fluxo .tmb.
 * Retorna { blocks, blockMap, indexMap, branchMap, endIfMap, version, runtimeConfig }
 *
 * branchMap: Map<number, number> — índice do bloco → índice do próximo branch (else-if, else ou end-if)
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

  const normalizedBlocks = raw.blocks.map(block => ({
    ...block,
    type: normalizeBlockType(block?.type),
  }));

  // Validar cada bloco
  for (const block of normalizedBlocks) {
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

  normalizedBlocks.forEach((block, i) => {
    if (block.active === false) return; // pular blocos desativados
    blockMap.set(block.id, block);
    indexMap.set(block.id, i);
  });

  // Apenas blocos ativos (preservar ordem)
  const blocks = normalizedBlocks.filter(b => b.active !== false);

  // ─── Pré-cálculo de mapas de salto O(1) ─────────────────────────────────────
  const branchMap = new Map(); // blockIndex → nextBranch index
  const endIfMap  = new Map(); // blockIndex → endIf index

  buildJumpMaps(blocks, branchMap, endIfMap);

  const activeBlockIds = new Set(blocks.map(block => String(block.id)));
  for (const block of blocks) {
    if (block.type === BLOCK_TYPE.REDIRECT_TO_HUMAN) {
      validateRedirectToHumanBlock(block, activeBlockIds);
    }
  }

  const runtimeConfig = normalizeRuntimeConfig(raw.flowRuntimeConfig);

  return {
    flowPath: resolved,
    blocks,
    blockMap,
    indexMap,
    branchMap,
    endIfMap,
    version: raw.version,
    runtimeConfig,
    botType: normalizeConversationMode(runtimeConfig.conversationMode),
  };
}

function normalizeFlowPathList(flowPaths = []) {
  if (!Array.isArray(flowPaths)) return [];
  const dedup = new Set();
  const result = [];
  for (const item of flowPaths) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    const resolved = path.resolve(value);
    if (dedup.has(resolved)) continue;
    dedup.add(resolved);
    result.push(resolved);
  }
  return result;
}

export function validateBotTypeUniqueness(flows = []) {
  const conversationFlows = flows.filter(flow => getFlowBotType(flow) === 'conversation');
  if (conversationFlows.length > 1) {
    const details = conversationFlows.map(flow => flow.flowPath).join(', ');
    throw new Error(
      `Configuracao invalida: apenas 1 fluxo de conversa pode ficar ativo. Encontrados ${conversationFlows.length}: ${details}`
    );
  }
}

export function loadFlows(flowPaths = []) {
  const normalizedPaths = normalizeFlowPathList(flowPaths);
  if (normalizedPaths.length === 0) {
    throw new Error('Nenhum fluxo foi informado para carregamento.');
  }

  const flows = normalizedPaths.map(flowPath => loadFlow(flowPath));
  validateBotTypeUniqueness(flows);

  const byPath = new Map();
  const byBotType = {
    conversation: [],
    command: [],
  };

  for (const flow of flows) {
    byPath.set(flow.flowPath, flow);
    byBotType[getFlowBotType(flow)].push(flow);
  }

  return {
    all: flows,
    byPath,
    byBotType,
    conversationFlow: byBotType.conversation[0] ?? null,
    commandFlows: byBotType.command,
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
