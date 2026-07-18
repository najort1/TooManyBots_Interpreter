/**
 * Live fuzz: inventa eventos com LLM real (Zen e/ou Ollama) e valida
 * coerência manchete × categoria × empresa × direção do preço.
 *
 * Uso:
 *   node fun/scripts/live-market-coherence.mjs
 *   node fun/scripts/live-market-coherence.mjs --n=20 --provider=ollama
 *   node fun/scripts/live-market-coherence.mjs --n=15 --provider=zen
 *   node fun/scripts/live-market-coherence.mjs --n=12 --provider=both
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb } from '../../db/index.js';
import { resolveFunConfig } from '../config.js';
import { createFunStatsRepository } from '../db/funStatsRepository.js';
import { createFunMarketRepository } from '../db/funMarketRepository.js';
import { createFunStockRepository } from '../db/funStockRepository.js';
import { createMarketService } from '../services/marketService.js';
import { createStockService } from '../services/stockService.js';
import {
  isCopyCoherent,
  inferNarrativeCategory,
  inferNarrativeCompany,
  inferNarrativeDirection,
} from '../economy/eventPipeline.js';
import { getCompany } from '../economy/companies.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

function arg(name, fb) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fb;
  return hit.slice(name.length + 3);
}

const N = Math.max(1, Math.min(40, Number(arg('n', '16')) || 16));
const PROVIDER = String(arg('provider', 'both')).toLowerCase(); // ollama | zen | both | template

function loadConfig() {
  let raw = {};
  try {
    raw = JSON.parse(
      fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8')
    );
  } catch {
    /* defaults */
  }
  return resolveFunConfig(raw);
}

async function probe(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}

function scoreAnnouncement(event, direction) {
  const title = event.title || '';
  const body = event.description || '';
  const ok = isCopyCoherent({
    title,
    body,
    direction,
    category: event.category,
    companyId: event.companyId,
  });
  return {
    ok,
    nDir: inferNarrativeDirection(`${title}\n${body}`),
    nCat: inferNarrativeCategory(`${title}\n${body}`),
    nCo: inferNarrativeCompany(`${title}\n${body}`),
  };
}

async function main() {
  await initDb();
  const baseCfg = loadConfig();
  const repository = createFunStatsRepository();
  const marketRepository = createFunMarketRepository();
  const stockRepository = createFunStockRepository();
  const stockService = createStockService({ repository, stockRepository });

  const ollamaUp = await probe(
    `${String(baseCfg.ollamaBaseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '')}/api/tags`
  );
  const zenUp = await probe(
    `${String(baseCfg.zenBaseUrl || 'http://127.0.0.1:3000').replace(/\/+$/, '')}/v1/models`
  );

  console.log(
    JSON.stringify(
      {
        N,
        PROVIDER,
        ollamaUp,
        zenUp,
        ollamaModel: baseCfg.ollamaModel,
        zenModel: baseCfg.zenModel,
      },
      null,
      2
    )
  );

  const providers = [];
  if (PROVIDER === 'template') providers.push('template');
  if (PROVIDER === 'ollama' || PROVIDER === 'both') {
    if (ollamaUp) providers.push('ollama');
    else console.warn('[skip] ollama offline');
  }
  if (PROVIDER === 'zen' || PROVIDER === 'both') {
    if (zenUp) providers.push('zen');
    else console.warn('[skip] zen offline');
  }
  if (!providers.length) {
    console.warn('[fallback] nenhum LLM — só template');
    providers.push('template');
  }

  const failures = [];
  const samples = [];
  let okCount = 0;
  let hardFallback = 0;
  let llmHits = 0;
  let templateHits = 0;

  for (const provider of providers) {
    for (let i = 0; i < N; i++) {
      const scope = `120363live${Date.now()}${i}${provider.slice(0, 2)}@g.us`;
      const funConfig = {
        ...baseCfg,
        marketEnabled: true,
        economyEnabled: true,
        zenEnabled: provider === 'zen',
        ollamaEnabled: provider === 'ollama',
      };
      // template-only: disable both LLMs
      if (provider === 'template') {
        funConfig.zenEnabled = false;
        funConfig.ollamaEnabled = false;
      }

      const marketService = createMarketService({
        repository,
        marketRepository,
        stockService,
        random: Math.random,
      });

      const t0 = Date.now();
      let result;
      try {
        result = await marketService.runMarketEvent({
          scopeKey: scope,
          funConfig,
          now: Date.now() + i * 1000,
          force: true,
        });
      } catch (err) {
        failures.push({
          provider,
          i,
          error: err?.message || String(err),
        });
        console.log(`✗ ${provider}#${i} throw ${err?.message || err}`);
        continue;
      }
      const ms = Date.now() - t0;

      if (!result?.ok) {
        failures.push({ provider, i, reason: result?.reason || 'not-ok' });
        console.log(`✗ ${provider}#${i} not-ok ${result?.reason}`);
        continue;
      }

      const event = result.event;
      const direction =
        event.impactPct > 0.5 ? 'up' : event.impactPct < -0.5 ? 'down' : 'flat';
      const score = scoreAnnouncement(event, direction);
      const company = event.companyId ? getCompany(event.companyId) : null;
      const src = event.source || result.source || '?';
      if (src === 'template') templateHits += 1;
      else llmHits += 1;
      if (event.truth?.copyHardFallback || result.truth?.copyHardFallback) {
        hardFallback += 1;
      }
      // truth is on event from insert - may be on event from repository
      const truth = event.truth || {};
      if (truth.copyHardFallback) hardFallback += 1;

      const line = {
        provider,
        i,
        ms,
        source: src,
        title: event.title,
        category: event.category,
        companyId: event.companyId,
        companyName: company?.name,
        impactPct: event.impactPct,
        direction,
        score,
        hardFallback: Boolean(truth.copyHardFallback),
        realigned: Boolean(truth.copyAligned),
      };
      samples.push(line);

      if (score.ok) {
        okCount += 1;
        console.log(
          `✓ ${provider}#${i} [${src}] ${event.impactPct}% ${event.category}/${event.companyId} — ${event.title} (${ms}ms)`
        );
      } else {
        failures.push(line);
        console.log(
          `✗ ${provider}#${i} INCOHERENT [${src}] dir=${direction} nDir=${score.nDir} nCat=${score.nCat} nCo=${score.nCo}`
        );
        console.log(`  title: ${event.title}`);
        console.log(`  ticker: ${company?.name || '?'} · ${event.category} · ${event.impactPct}%`);
        console.log(`  body: ${String(event.description || '').slice(0, 180)}…`);
      }
    }
  }

  const total = samples.length;
  const summary = {
    total,
    ok: okCount,
    fail: failures.length,
    llmHits,
    templateHits,
    hardFallback,
    passRate: total ? `${((okCount / total) * 100).toFixed(1)}%` : 'n/a',
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  if (failures.length) {
    console.log('\n=== FAILURES ===');
    console.log(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log('\nAll live announcements coherent.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
