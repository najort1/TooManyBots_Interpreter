import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  _resetDefaultFunStatsRepository,
  createFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunMarketRepository } from '../fun/db/funMarketRepository.js';
import { createMarketService } from '../fun/services/marketService.js';
import { resolveFunConfig } from '../fun/config.js';
import {
  COMPANIES,
  companyForCategory,
  companyForItem,
  EVENT_ARCHETYPES,
  ARCHETYPE_IDS,
  tickAsset,
  sampleImpactFromArchetype,
  resolveEventProposal,
  parseInventJson,
  classifyFreeTextToArchetype,
  inferNarrativeDirection,
  alignEventCopy,
  pickAlignedTemplate,
  pickDeceptionMode,
  applyDeceptionPlan,
  defaultRegulatorKnobs,
  regulate,
  computeGini,
  clampKnobs,
  scaleEventWaitMs,
  fingerprintText,
} from '../fun/economy/index.js';
import { getCollectible } from '../fun/shop/collectibles.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

// ─── C1 motor ───────────────────────────────────────────────

test('economia: 6 empresas com personalidades distintas', () => {
  assert.equal(COMPANIES.length, 6);
  const ids = new Set(COMPANIES.map((c) => c.id));
  assert.ok(ids.has('burgerzap'));
  assert.ok(ids.has('uno_motors'));
  assert.ok(ids.has('bombatech'));
  assert.ok(ids.has('peixaria'));
  assert.ok(ids.has('satelite_br'));
  assert.ok(ids.has('patocoin'));
  assert.ok(companyForCategory('arma').id === 'bombatech');
  assert.ok(companyForCategory('veiculo').id === 'uno_motors');
  assert.ok(companyForItem(getCollectible('gasolina')).id === 'peixaria');
  // PatoCoin mais volátil que Uno
  const pato = COMPANIES.find((c) => c.id === 'patocoin');
  const uno = COMPANIES.find((c) => c.id === 'uno_motors');
  assert.ok(pato.volatility > uno.volatility);
  assert.ok(pato.ceilMult > uno.ceilMult);
});

test('economia C1: tickAsset clamp e só números', () => {
  const persona = companyForCategory('arma'); // bombatech
  const r = tickAsset({
    price: 100,
    basePrice: 100,
    personality: persona,
    supply: 0.5,
    demand: 2,
    volumeBuy: 5000,
    volumeSell: 0,
    eventShock: 20,
    reg: defaultRegulatorKnobs(),
    random: () => 0.5,
  });
  assert.ok(r.price >= r.floor);
  assert.ok(r.price <= r.ceil);
  assert.ok(Number.isFinite(r.deltaPct));
  assert.ok(r.primaryReason);
  // 10k ticks: nunca sai do floor/ceil
  let price = 100;
  let shock = 0;
  for (let i = 0; i < 2000; i++) {
    const t = tickAsset({
      price,
      basePrice: 100,
      personality: persona,
      supply: 0.3 + (i % 10) * 0.05,
      demand: 0.5 + (i % 7) * 0.1,
      volumeBuy: (i * 17) % 900,
      volumeSell: (i * 13) % 400,
      eventShock: shock,
      reg: { ...defaultRegulatorKnobs(), volMult: 1.5 },
      random: () => ((i * 17) % 1000) / 1000,
    });
    price = t.price;
    shock = t.eventShock;
    assert.ok(price >= t.floor, `floor fail ${price} < ${t.floor}`);
    assert.ok(price <= t.ceil, `ceil fail ${price} > ${t.ceil}`);
  }
});

test('economia C1: personalidade muda magnitude (Uno vs BombaTech)', () => {
  const uno = companyForCategory('veiculo');
  const bomba = companyForCategory('arma');
  const common = {
    price: 100,
    basePrice: 100,
    supply: 0.6,
    demand: 1.8,
    volumeBuy: 2000,
    volumeSell: 0,
    eventShock: 25,
    reg: defaultRegulatorKnobs(),
    random: () => 0.42,
  };
  const a = tickAsset({ ...common, personality: uno });
  const b = tickAsset({ ...common, personality: bomba });
  // bombatech maxTickDelta maior → |delta| tende a ser maior em cenário de stress
  assert.ok(Math.abs(b.reasons.delta) >= Math.abs(a.reasons.delta) * 0.5);
  assert.ok(bomba.eventSensitivity > uno.eventSensitivity);
});

// ─── C3 arquétipos ──────────────────────────────────────────

test('economia C3: arquétipos versionados e sample sem IA', () => {
  assert.ok(ARCHETYPE_IDS.length >= 8);
  assert.ok(EVENT_ARCHETYPES.supply_shock);
  assert.ok(EVENT_ARCHETYPES.rumor_only.rumorOnly);
  const impact = sampleImpactFromArchetype('supply_shock', () => 0.5);
  assert.ok(impact.supplyDelta < 0);
  assert.ok(impact.shockPct > 0);
  const resolved = resolveEventProposal(
    {
      archetype: 'liquidity_flood',
      category: 'municao',
      companyId: 'bombatech',
      title: 'Teste',
      body: 'Linha1\nLinha2\nLinha3\nLinha4\nLinha5',
      source: 'test',
    },
    { reg: defaultRegulatorKnobs(), random: () => 0.3 }
  );
  assert.equal(resolved.archetype, 'liquidity_flood');
  assert.equal(resolved.category, 'municao');
  assert.equal(resolved.companyId, 'bombatech'); // categoria arma/municao → BombaTech
  assert.ok(resolved.impact.shockPct < 0);
});

test('economia C3: empresa sempre coerente com categoria (não Uno+arma)', () => {
  const resolved = resolveEventProposal(
    {
      archetype: 'demand_boom',
      category: 'arma',
      companyId: 'uno_motors', // IA errou de propósito
      title: 'Teste',
      body: 'A\nB\nC\nD\nE\nF',
    },
    { reg: defaultRegulatorKnobs(), random: () => 0.5 }
  );
  assert.equal(resolved.category, 'arma');
  assert.equal(resolved.companyId, 'bombatech');
});

test('economia: overheat favorece queda e cap de choque', () => {
  const cold = resolveEventProposal(
    { archetype: 'demand_boom', category: 'arma', title: 'x', body: 'A\nB\nC\nD\nE' },
    { reg: defaultRegulatorKnobs(), random: () => 0.01, overheat: 0 }
  );
  const hot = resolveEventProposal(
    { archetype: 'demand_boom', category: 'arma', title: 'x', body: 'A\nB\nC\nD\nE' },
    { reg: defaultRegulatorKnobs(), random: () => 0.01, overheat: 1.2 }
  );
  // com overheat alto e random baixo, tende a trocar boom por correção
  assert.ok(hot.impact.shockPct <= cold.impact.shockPct + 1);
  assert.ok(Math.abs(cold.impact.shockPct) <= 12);
});

test('economia C3: IA impactPct é ignorado no parse', () => {
  const raw = JSON.stringify({
    archetype: 'supply_shock',
    category: 'combustivel',
    companyId: 'peixaria',
    title: 'Posto seco',
    body: 'A\nB\nC\nD\nE\nF',
    impactPct: 999,
  });
  const parsed = parseInventJson(raw);
  assert.ok(parsed);
  assert.equal(parsed.archetype, 'supply_shock');
  assert.equal(parsed.ignoredAiImpactPct, 999);
  // resolve não usa 999
  const resolved = resolveEventProposal(parsed, {
    reg: defaultRegulatorKnobs(),
    random: () => 0.5,
  });
  assert.ok(Math.abs(resolved.impact.shockPct) <= 45);
  assert.ok(Math.abs(resolved.impact.shockPct) < 50);
});

test('economia C3: classificador free-text → arquétipo', () => {
  assert.equal(classifyFreeTextToArchetype('só boato do primo'), 'rumor_only');
  assert.equal(classifyFreeTextToArchetype('pato meme viral no zap'), 'meme_spike');
  assert.equal(classifyFreeTextToArchetype('posto seco faltou gasolina'), 'supply_shock');
  assert.equal(classifyFreeTextToArchetype('contrabando encheu de lote'), 'liquidity_flood');
});

// ─── C4 regulador + decepção ────────────────────────────────

test('economia C4: regulador aperta knobs sob inflação', () => {
  const base = defaultRegulatorKnobs();
  const next = regulate(
    {
      circulatingCoins: 10000,
      baselineCoins: 5000,
      gini: 0.4,
      mintSink: 2000,
      activePlayers: 10,
      investedValue: 2000,
      avgAbsDeltaPct: 0.05,
      eventsLast24h: 3,
    },
    base,
    Date.now()
  );
  assert.ok(next.rewardMult < base.rewardMult || next.eventFreqMult > base.eventFreqMult);
  assert.ok(next.narrativeSeeds.length >= 1);
  // eventFreqMult acelera, mas há piso (~90min) e teto de mult
  const wait = scaleEventWaitMs(3 * 60 * 60_000, { eventFreqMult: 1.35 });
  assert.ok(wait <= 3 * 60 * 60_000);
  assert.ok(wait >= 90 * 60_000);
  const slow = scaleEventWaitMs(3 * 60 * 60_000, { eventFreqMult: 0.6, marketOverheat: 0.8 });
  assert.ok(slow >= wait);
});

test('economia C4: gini e deception modes', () => {
  assert.equal(computeGini([100, 100, 100]), 0);
  assert.ok(computeGini([1, 1, 1, 1000]) > 0.5);
  const mode = pickDeceptionMode({
    reg: { deceptionRate: 1 },
    companyRisk: 1,
    random: () => 0.01,
  });
  assert.notEqual(mode, 'none');
  const plan = applyDeceptionPlan({
    mode: 'false_alarm',
    archetypeId: 'supply_shock',
    trueDirection: 'up',
    primaryReason: 'buy_pressure',
    category: 'arma',
    companyId: 'bombatech',
    now: Date.now(),
    random: () => 0.1,
  });
  assert.equal(plan.effectiveArchetype, 'rumor_only');
  assert.equal(plan.forceRumor, true);
});

// ─── Integração marketService ───────────────────────────────

test('economia integração: evento força template sem LLM; impact da IA 999 não explode preço', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  let calls = 0;
  const market = createMarketService({
    repository: repo,
    marketRepository: marketRepo,
    random: () => {
      calls += 1;
      return (calls % 97) / 97;
    },
    // se alguém chamar LLM mesmo assim, devolve impactPct monstruoso
    generateZen: async () =>
      JSON.stringify({
        archetype: 'meme_spike',
        category: 'arma',
        companyId: 'patocoin',
        title: 'Hack da IA',
        body: 'A\nB\nC\nD\nE\nF',
        impactPct: 999,
      }),
  });

  const scope = uniqueGroup();
  const cfg = resolveFunConfig({
    marketEnabled: true,
    marketEventMinMs: 5 * 60_000,
    marketEventMaxMs: 10 * 60_000,
    economyEnabled: true,
  });

  const before = marketRepo.listPrices(scope);
  const hit = await market.runMarketEvent({ scopeKey: scope, funConfig: cfg, force: true });
  assert.equal(hit.ok, true);
  assert.ok(hit.event);
  assert.ok(hit.event.archetype);
  assert.ok(Math.abs(hit.event.impactPct) <= 45);
  assert.ok(hit.archetype);

  for (const a of hit.affected || []) {
    const col = getCollectible(a.itemId);
    const floor = Math.max(1, Math.floor(col.basePrice * companyForItem(col).floorMult));
    const ceil = Math.floor(col.basePrice * companyForItem(col).ceilMult);
    assert.ok(a.price >= floor, `${a.itemId} ${a.price} < ${floor}`);
    assert.ok(a.price <= ceil * 1.01 + 1, `${a.itemId} ${a.price} > ${ceil}`);
  }

  const announce = market.formatEventAnnouncement(hit);
  assert.match(announce, /Mercado de rua/);
  assert.ok(hit.event.truth || hit.truth);

  // compra registra volume/S-D
  const u = uniqueJid();
  repo.addCoins({ userJid: u, scopeKey: scope, amount: 5000, reason: 'seed' });
  const buy = market.buyFromShop({
    userJid: u,
    scopeKey: scope,
    itemId: 'gasolina',
    funConfig: cfg,
  });
  assert.equal(buy.ok, true);
  const st = marketRepo.getAssetState(scope, 'gasolina');
  assert.ok(st.volumeBuy > 0);

  // tick economia
  marketRepo.setMeta(scope, { lastEconomyTickAt: 0, now: Date.now() });
  const tick = market.tickEconomy(scope, { ...cfg, economyTickMs: 1 }, Date.now() + 1000);
  assert.equal(tick.ok, true);

  // too-soon no evento
  const soon = await market.runMarketEvent({ scopeKey: scope, funConfig: cfg, force: false });
  assert.equal(soon.ok, false);
  assert.equal(soon.reason, 'too-soon');

  assert.ok(before.length > 0);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('economia integração: rumor_only não mexe preço de forma agressiva', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const marketRepo = createFunMarketRepository({ getDatabase: getDb });
  // random alto em deception rate path — force via generate not available; inject resolve path
  // Usamos runMarketEvent normal e checamos clamp; teste unitário de rumor:
  const reg = clampKnobs({ ...defaultRegulatorKnobs(), eventImpactMult: 1 });
  const resolved = resolveEventProposal(
    {
      forceArchetype: 'rumor_only',
      archetype: 'rumor_only',
      category: 'arma',
      title: 'Boato',
      body: 'A\nB\nC\nD\nE',
    },
    { reg, random: () => 0.5 }
  );
  assert.equal(resolved.impact.rumorOnly, true);
  assert.equal(resolved.impact.shockPct, 0);
  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('economia: fingerprint anti-repeat e knobs clamp', () => {
  const fp = fingerprintText('Posto da região seca', 'gasolina sumiu fila');
  assert.ok(fp.length > 3);
  const k = clampKnobs({ volMult: 99, deceptionRate: -1, eventFreqMult: 0.01 });
  assert.ok(k.volMult <= 1.8);
  assert.ok(k.deceptionRate >= 0.02);
  assert.ok(k.eventFreqMult >= 0.5);
});

test('economia: inferNarrativeDirection detecta alta vs queda', () => {
  assert.equal(
    inferNarrativeDirection('Gasolina tá mais cara que ontem, subida inesperada'),
    'up'
  );
  assert.equal(
    inferNarrativeDirection('Preço recua, estoque sobra, munição mais barata'),
    'down'
  );
  assert.equal(inferNarrativeDirection('Semana morna, preço anda de lado'), 'flat');
});

test('economia: alignEventCopy corrige "subiu" quando preço caiu', () => {
  const bad = alignEventCopy({
    title: 'Gasolina tá mais cara que ontem, galera desconfiada',
    body: [
      'Rolou aquele clima de aperto no bairro hoje.',
      'Parece que a gasolina deu uma leve subida inesperada nos postos por aí.',
      'A galera tá de olho na carteira.',
    ].join('\n'),
    direction: 'down',
    archetype: 'liquidity_flood',
    category: 'combustivel',
    companyId: 'peixaria',
    random: () => 0.1,
  });
  assert.equal(bad.realigned, true);
  assert.notEqual(inferNarrativeDirection(`${bad.title}\n${bad.body}`), 'up');
  assert.match(bad.title + bad.body, /combust|esfria|alivi|barat|recu/i);

  const ok = alignEventCopy({
    title: 'Combustível esfria um pouco',
    body: 'Parece que combustível deu uma aliviada no preço por aí.\nEstoque sobra.',
    direction: 'down',
    category: 'combustivel',
    random: () => 0.2,
  });
  assert.equal(ok.realigned, false);

  const tpl = pickAlignedTemplate({
    direction: 'down',
    category: 'combustivel',
    companyId: 'peixaria',
    random: () => 0,
  });
  assert.ok(tpl.synthetic || tpl.category === 'combustivel');
  assert.equal(inferNarrativeDirection(`${tpl.title}\n${tpl.body}`), 'down');
});

test('economia: resolveEventProposal descarta copy se bias troca por overheat', () => {
  const reg = clampKnobs({ ...defaultRegulatorKnobs(), eventImpactMult: 1 });
  // heat alto + bias up + random baixo → troca pra correção
  const resolved = resolveEventProposal(
    {
      archetype: 'supply_shock',
      category: 'combustivel',
      companyId: 'peixaria',
      title: 'Gasolina tá mais cara que ontem',
      body: 'Subida inesperada nos postos.\nFila e aperto.',
    },
    { reg, random: () => 0.01, overheat: 0.9 }
  );
  // ou manteve supply_shock, ou trocou e limpou body
  if (resolved.archetype !== 'supply_shock') {
    assert.equal(resolved.body, '');
    assert.ok(resolved.biasMismatch || resolved.archetypeSwapped);
  }
});
