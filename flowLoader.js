import fs from 'fs';
import path from 'path';

const REQUIRED_BLOCK_FIELDS = ['id', 'type', 'config'];

const SUPPORTED_TYPES = new Set([
  'initial-message',
  'send-text',
  'send-list',
  'condition',
  'set-variable',
  'redirect',
  'delay',
  'end-conversation',
  'restart-flow',
]);

/**
 * Carrega e valida um arquivo de fluxo .tmb.
 * Retorna { blocks, blockMap, firstBlock }
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
        throw new Error(`Bloco missing campo "${field}": ${JSON.stringify(block)}`);
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

  return { blocks, blockMap, indexMap, version: raw.version };
}
