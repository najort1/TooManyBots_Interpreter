/**
 * Probe: invent via Zen (deepseek thinking) — raw + parse.
 * node fun/scripts/probe-zen-invent.mjs
 */
import { openaiChatComplete } from '../llm/openaiClient.js';
import { parseInventResponse, EVENT_INVENT_SYSTEM } from '../economy/eventPipeline.js';
import { resolveFunConfig } from '../config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let rawCfg = {};
try {
  rawCfg = JSON.parse(fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8'));
} catch {
  /* defaults */
}
const cfg = resolveFunConfig(rawCfg);

const inventSystem = `${EVENT_INVENT_SYSTEM}

FORMATO: responda SOMENTE um objeto JSON válido (sem markdown, sem texto antes/depois).
Campos: archetype, category, companyId, title, body.`;

const prompt = `Invente 1 evento de mercado de rua.
archetype preferido: supply_shock
Empresas: bombatech (municao/arma), peixaria (combustivel), uno_motors (veiculo).
NÃO copie as regras do system — escreva uma manchete real de bairro.`;

console.log('model', cfg.zenModel, 'timeout', cfg.zenTimeoutMs);

const raw = await openaiChatComplete({
  baseUrl: cfg.zenBaseUrl || 'http://127.0.0.1:3000',
  model: cfg.zenModel || 'deepseek-v4-flash-free',
  system: inventSystem,
  prompt,
  timeoutMs: Math.max(20000, cfg.zenTimeoutMs || 45000),
  maxTokens: Math.max(400, cfg.zenMaxTokens || 600),
  temperature: 0.85,
  apiKey: cfg.zenApiKey || '',
  jsonMode: true,
});

console.log('RAW_LEN', raw?.length ?? 0);
console.log('RAW:\n', raw);
console.log('---');
console.log('PARSED:', JSON.stringify(parseInventResponse(raw), null, 2));
