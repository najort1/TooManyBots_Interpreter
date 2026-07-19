/**
 * Probe live: The Group Times (copy-only LLM) SEM postar no WhatsApp.
 *
 *   node fun/scripts/probe-group-times.mjs
 *   node fun/scripts/probe-group-times.mjs --n=2
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb } from '../../db/index.js';
import { getDb } from '../../db/context.js';
import { resolveFunConfig } from '../config.js';
import { createFunNewsRepository } from '../db/funNewsRepository.js';
import { createNewsService } from '../services/newsService.js';
import { createFlavorService } from '../llm/flavorService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const N = Math.max(1, Math.min(5, Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) || 2)));

let rawCfg = {};
try {
  rawCfg = JSON.parse(fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8'));
} catch {
  /* defaults */
}
const cfg = resolveFunConfig({
  ...rawCfg,
  zenEnabled: true,
  groupNewsEnabled: true,
});

// força data/fun se existir (mesmo banco do bot)
if (!process.env.TMB_DATA_DIR) {
  const funData = path.join(root, 'data', 'fun');
  if (fs.existsSync(funData)) process.env.TMB_DATA_DIR = funData;
}

await initDb();

const newsRepository = createFunNewsRepository({ getDatabase: getDb });
const flavorService = createFlavorService({
  getConfig: () => cfg,
  allowLiveLlm: true,
});
const newsService = createNewsService({
  newsRepository,
  flavorService,
});

// Dois grupos fake isolados
const groups = Array.from({ length: N }, (_, i) => ({
  scopeKey: `120363PROBE${Date.now()}${i}@g.us`,
  label: `probe-group-${i + 1}`,
  events:
    i === 0
      ? [
          { type: 'assault_win', payload: { amount: 77 } },
          { type: 'assault_win', payload: { amount: 57 } },
        ]
      : [
          { type: 'crash_loss', payload: { amount: 120 } },
          { type: 'marry', payload: { name: 'Alice' } },
          { type: 'market_move', payload: { deltaPct: -4, name: 'BombaTech' } },
        ],
}));

// Poluição intencional: flavor de OUTRO grupo (não deve vazar no jornal)
const polluter = `120363POLLUTE${Date.now()}@g.us`;
await flavorService.line('flip_win', {
  scopeKey: polluter,
  user: 'Paulo',
});
// empurra texto no ban do poluidor
await flavorService.chaosLine('oracle_insane', {
  scopeKey: polluter,
  question: 'vish paulo level cocada preta?',
});

console.log(
  JSON.stringify(
    {
      model: cfg.zenModel,
      baseUrl: cfg.zenBaseUrl,
      N,
      polluter: polluter.slice(0, 28),
      note: 'NÃO post no WhatsApp — só composeEdition',
    },
    null,
    2
  )
);

const results = [];

for (const g of groups) {
  const now = Date.now();
  for (const e of g.events) {
    newsRepository.logEvent({
      scopeKey: g.scopeKey,
      eventType: e.type,
      payload: e.payload,
      now: now - 60_000,
    });
  }

  console.log(`\n========== ${g.label} (${g.scopeKey.slice(0, 28)}) ==========`);
  console.log('seed events:', g.events.map((e) => e.type).join(', '));

  const t0 = Date.now();
  let edition;
  try {
    edition = await newsService.composeEdition(g.scopeKey, cfg, now);
  } catch (err) {
    edition = { text: '', provider: 'error', eventCount: 0, err: err?.message || String(err) };
  }
  const ms = Date.now() - t0;

  const text = String(edition?.text || '');
  // poluição intencional de outro grupo NÃO pode aparecer
  const crossGroupLeak = /paulo|cocada preta|\bvish\b/i.test(text);
  // números/eventos do OUTRO probe não devem vazar
  const crossProbeLeak =
    (g.label === 'probe-group-1' && /Alice|BombaTech|120c|crash/i.test(text)) ||
    (g.label === 'probe-group-2' && /\b77\b|\b57\b/.test(text));

  const hasHeader = /Group Times|MANCHETE|Manchete/i.test(text);
  const provider = String(edition?.provider || '');
  const isLlm = provider === 'zen' || provider === 'ollama';
  const notEmpty = text.length > 60;
  // se LLM, deve refletir pelo menos um fato do seed
  const reflectsSeed =
    g.label === 'probe-group-1'
      ? /77|57|assalto|assault/i.test(text)
      : /120|Alice|BombaTech|crash|casamento|mercado|perda/i.test(text);

  const leak = crossGroupLeak || crossProbeLeak;
  const ok = Boolean(isLlm && notEmpty && hasHeader && !leak && reflectsSeed);

  console.log('latency_ms', ms);
  console.log('provider', provider);
  console.log('eventCount', edition?.eventCount);
  console.log('TEXT:\n', text);
  console.log({ crossGroupLeak, crossProbeLeak, reflectsSeed, ok });

  results.push({
    label: g.label,
    ms,
    provider,
    eventCount: edition?.eventCount,
    textLen: text.length,
    hasHeader,
    isLlm,
    leak,
    reflectsSeed,
    ok,
    preview: text.slice(0, 280).replace(/\n/g, ' | '),
  });

  // limpa seed
  newsRepository.pruneOlderThan(g.scopeKey, now + 1);
}

console.log('\n========== RESUMO ==========');
console.log(JSON.stringify(results, null, 2));
const pass = results.filter((r) => r.ok).length;
const llm = results.filter((r) => r.provider === 'zen' || r.provider === 'ollama').length;
console.log(`PASS ${pass}/${results.length} · LLM real ${llm}/${results.length}`);
if (llm === 0) {
  console.warn('AVISO: nenhum grupo saiu com provider zen/ollama — caiu em template.');
  process.exit(2);
}
process.exit(pass === results.length ? 0 : 1);
