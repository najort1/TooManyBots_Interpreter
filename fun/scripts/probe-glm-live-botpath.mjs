/**
 * Live: caminho do bot (config.user) + GLM sem sampling + anti-meta assault.
 * node fun/scripts/probe-glm-live-botpath.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveFunConfig } from '../config.js';
import { openaiChatComplete } from '../llm/openaiClient.js';
import { createFlavorService, sanitizeAssaultStory, sanitizeFlavor } from '../llm/flavorService.js';
import {
  EVENT_INVENT_SYSTEM,
  buildInventUserPrompt,
  parseInventResponse,
} from '../economy/eventPipeline.js';
import { listCompanies } from '../economy/companies.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = JSON.parse(fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8'));
const cfg = resolveFunConfig(raw);

console.log('config', {
  zenBaseUrl: cfg.zenBaseUrl,
  zenModel: cfg.zenModel,
  zenSendSamplingParams: cfg.zenSendSamplingParams,
});

// 1) invent via client like market
const inventPrompt = buildInventUserPrompt({
  recentFingerprints: [],
  recentArchetypes: [],
  narrativeSeed: 'down',
  companyMoods: listCompanies().map((c) => ({ id: c.id, mood: 'warm' })),
});
let inventOk = 0;
for (let i = 0; i < 4; i += 1) {
  const t0 = Date.now();
  const text = await openaiChatComplete({
    baseUrl: cfg.zenBaseUrl,
    model: cfg.zenModel,
    system: EVENT_INVENT_SYSTEM,
    prompt: inventPrompt + '\nSó JSON.',
    timeoutMs: cfg.zenTimeoutMs,
    jsonMode: true,
    jsonOnly: true,
    sendSamplingParams: cfg.zenSendSamplingParams === true,
  });
  const p = parseInventResponse(text);
  const ok = Boolean(p?.title && p?.body);
  if (ok) inventOk += 1;
  console.log(ok ? '✓' : '✗', 'invent', i, Date.now() - t0 + 'ms', p?.title || String(text).slice(0, 80));
}

// 2) flavor service path
const flavor = createFlavorService({ getConfig: () => cfg, allowLiveLlm: true });
for (const s of ['flip_win', 'roulette_win', 'ship']) {
  const t0 = Date.now();
  const out = await flavor.italicLine(s, { pick: 'cara', ball: 17, a: 'Edu', b: 'Lucy' });
  const bad = /aqui vai|no tom que|roteiro besteirol|which means/i.test(out);
  console.log(bad ? '✗' : '✓', 'flavor', s, flavor.lastProvider(), Date.now() - t0 + 'ms', JSON.stringify(String(out).slice(0, 100)));
}

// 3) assault meta trap via raw + sanitize
const assaultRaw = await openaiChatComplete({
  baseUrl: cfg.zenBaseUrl,
  model: cfg.zenModel,
  system:
    'Roteirista besteirol. PRIMEIRA linha = 🎬 TÍTULO:. PROIBIDO preâmbulo (aqui vai, no tom que pediu). Só o roteiro CENA 1/2/3 + EPÍLOGO.',
  prompt: 'Assalto a banco com sucesso, tom pastelão. Só o roteiro.',
  timeoutMs: 60000,
  sendSamplingParams: false,
});
const cleaned = sanitizeAssaultStory(assaultRaw, 2200);
const metaLeak = /aqui vai|pastel[aã]o que voc|como pediu/i.test(cleaned.slice(0, 120));
console.log(
  metaLeak ? '✗' : '✓',
  'assault sanitize',
  'raw0=',
  JSON.stringify(String(assaultRaw).slice(0, 80)),
  'clean0=',
  JSON.stringify(String(cleaned).slice(0, 80)),
  'len',
  cleaned.length
);

// 4) sanitize unit on known bad
const bad = sanitizeFlavor(
  'Roteiro besteirol de assalto a banco com sucesso, no tom pastelão que você pediu.'
);
console.log(bad === '' ? '✓' : '✗', 'sanitize meta phrase empty', JSON.stringify(bad));

console.log('\nDONE invent', inventOk + '/4');
