/**
 * Probe live: invent copy-only (código trava foco; IA só title/body).
 *
 *   node fun/scripts/probe-zen-invent.mjs
 *   node fun/scripts/probe-zen-invent.mjs --n=3
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { openaiChatComplete } from '../llm/openaiClient.js';
import {
  EVENT_INVENT_SYSTEM,
  buildInventUserPrompt,
  parseInventResponse,
  planEventSkeleton,
  shouldKeepAiCopy,
} from '../economy/eventPipeline.js';
import { defaultRegulatorKnobs } from '../economy/regulator.js';
import { getArchetype } from '../economy/archetypes.js';
import { resolveFunConfig } from '../config.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let rawCfg = {};
try {
  rawCfg = JSON.parse(fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8'));
} catch {
  /* defaults */
}
const cfg = resolveFunConfig(rawCfg);
const task = resolveZenTaskParams('invent', cfg);
const N = Math.max(1, Math.min(8, Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) || 3)));

const timeoutMs = Math.max(
  90_000,
  task.timeoutMs || 0,
  cfg.zenInventTimeoutMs || 0,
  cfg.zenTimeoutMs || 0
);

console.log(
  JSON.stringify(
    {
      model: cfg.zenModel,
      baseUrl: cfg.zenBaseUrl,
      timeoutMs,
      maxTokens: task.maxTokens,
      N,
      contract: 'copy-only (locked skeleton)',
    },
    null,
    2
  )
);

const results = [];

for (let i = 0; i < N; i += 1) {
  const skeleton = planEventSkeleton({
    reg: defaultRegulatorKnobs(),
    random: Math.random,
    overheat: i === 2 ? 0.6 : 0,
  });
  const archMeta = getArchetype(skeleton.archetype);
  const facts = {
    archetype: skeleton.archetype,
    label: archMeta?.label || skeleton.archetype,
    category: skeleton.category,
    companyId: skeleton.companyId,
    companyName: skeleton.company?.name || skeleton.companyId,
    direction: skeleton.directionHint,
    tone:
      skeleton.directionHint === 'up'
        ? 'alta / escassez / fila / procura'
        : skeleton.directionHint === 'down'
          ? 'queda / sobra / desconto'
          : 'lateral / sem drama',
  };
  const prompt = buildInventUserPrompt({ facts, recentFingerprints: [] });

  console.log(`\n========== RUN ${i + 1}/${N} ==========`);
  console.log('SKELETON (código):', JSON.stringify(skeleton, null, 0));
  console.log('FACTS → IA:', JSON.stringify(facts));

  const t0 = Date.now();
  let raw = '';
  let err = null;
  try {
    raw = await openaiChatComplete({
      baseUrl: cfg.zenBaseUrl || 'http://127.0.0.1:3300',
      model: cfg.zenModel || 'glm_5_2',
      system: EVENT_INVENT_SYSTEM,
      prompt,
      timeoutMs,
      maxTokens: task.maxTokens,
      temperature: task.temperature,
      apiKey: cfg.zenApiKey || '',
      jsonMode: true,
      jsonOnly: true,
      sendSamplingParams: cfg.zenSendSamplingParams === true,
    });
  } catch (e) {
    err = e?.message || String(e);
  }
  const ms = Date.now() - t0;

  console.log('latency_ms', ms, err ? `ERR ${err}` : 'ok');
  console.log('RAW_LEN', raw?.length ?? 0);
  console.log('RAW:\n', raw || '(vazio)');

  const parsed = raw ? parseInventResponse(raw, skeleton) : null;
  const keep = parsed
    ? shouldKeepAiCopy({
        title: parsed.title,
        body: parsed.body,
        direction: skeleton.directionHint,
      })
    : false;

  console.log('PARSED:', JSON.stringify(parsed, null, 2));
  console.log('shouldKeepAiCopy:', keep);
  console.log(
    'foco travado?',
    parsed
      ? parsed.archetype === skeleton.archetype &&
          parsed.category === skeleton.category &&
          parsed.companyId === skeleton.companyId
      : false
  );

  results.push({
    i: i + 1,
    ms,
    err,
    skeleton: {
      archetype: skeleton.archetype,
      category: skeleton.category,
      companyId: skeleton.companyId,
      direction: skeleton.directionHint,
    },
    title: parsed?.title || null,
    bodyPreview: parsed?.body ? String(parsed.body).slice(0, 160) : null,
    keep,
    lockedOk: parsed
      ? parsed.archetype === skeleton.archetype &&
        parsed.category === skeleton.category &&
        parsed.companyId === skeleton.companyId
      : false,
  });
}

console.log('\n========== RESUMO ==========');
console.log(JSON.stringify(results, null, 2));
const ok = results.filter((r) => r.keep && r.lockedOk && !r.err).length;
console.log(`PASS ${ok}/${results.length} (parse + keep + foco travado, sem erro)`);
process.exit(ok === results.length ? 0 : 1);
