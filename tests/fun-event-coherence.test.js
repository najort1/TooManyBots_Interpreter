/**
 * Coerência notícia × ticker — regressão dos bugs de manchete.
 * Varre seeds, resolveEventFocus, resolveEventProposal e alignEventCopy
 * em combinações que o algoritmo realmente produz.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARCHETYPE_IDS,
  TEMPLATE_EVENT_SEEDS,
  getArchetype,
  resolveEventFocus,
} from '../fun/economy/archetypes.js';
import {
  categoriesForCompany,
  companyForCategory,
  listCompanies,
} from '../fun/economy/companies.js';
import {
  alignEventCopy,
  inferNarrativeCategory,
  inferNarrativeCompany,
  inferNarrativeDirection,
  isCopyCoherent,
  resolveEventProposal,
} from '../fun/economy/eventPipeline.js';
import { defaultRegulatorKnobs, clampKnobs } from '../fun/economy/regulator.js';

const CATS = ['combustivel', 'municao', 'arma', 'veiculo', 'defesa'];
const RANDS = [0, 0.15, 0.37, 0.5, 0.72, 0.99];

function directionFromShock(shockPct) {
  const n = Number(shockPct) || 0;
  if (n > 0.5) return 'up';
  if (n < -0.5) return 'down';
  return 'flat';
}

function assertCoherent(label, { title, body, direction, category, companyId }) {
  const blob = `${title}\n${body}`;
  const ok = isCopyCoherent({ title, body, direction, category, companyId });
  if (!ok) {
    const nDir = inferNarrativeDirection(blob);
    const nCat = inferNarrativeCategory(blob);
    const nCo = inferNarrativeCompany(blob);
    assert.fail(
      `${label}\n` +
        `  expected coherent with dir=${direction} cat=${category} co=${companyId}\n` +
        `  got nDir=${nDir} nCat=${nCat} nCo=${nCo}\n` +
        `  title=${title}\n  body=${String(body).slice(0, 200)}…`
    );
  }
}

test('coerência: todo TEMPLATE_EVENT_SEED é internamente coerente', () => {
  for (const s of TEMPLATE_EVENT_SEEDS) {
    const focus = resolveEventFocus(
      s.archetype,
      { category: s.category, companyId: s.companyId },
      () => 0.2
    );
    // seed company deve ser aceita no focus (ou ser pure-stock)
    const seedCats = categoriesForCompany(s.companyId);
    if (seedCats.length) {
      assert.ok(
        seedCats.includes(s.category),
        `seed "${s.title}": company ${s.companyId} não tem cat ${s.category}`
      );
    }
    assert.equal(
      focus.category,
      s.category,
      `seed "${s.title}": focus.category divergiu`
    );
    // pure stock pode manter company; senão company do seed se casa com cat
    if (seedCats.includes(s.category) || seedCats.length === 0) {
      assert.equal(
        focus.companyId,
        s.companyId,
        `seed "${s.title}": focus.companyId=${focus.companyId} seed=${s.companyId}`
      );
    }
    const bias = getArchetype(s.archetype)?.bias || 'flat';
    const dir = bias === 'up' || bias === 'down' ? bias : 'flat';
    assertCoherent(`seed:${s.title}`, {
      title: s.title,
      body: s.body,
      direction: dir,
      category: focus.category,
      companyId: focus.companyId,
    });
  }
});

test('coerência: resolveEventFocus nunca devolve empresa fora da categoria (exceto pure-stock)', () => {
  const companies = listCompanies().map((c) => c.id);
  for (const arch of ARCHETYPE_IDS) {
    for (const cat of CATS) {
      for (const co of ['', ...companies]) {
        for (const r of RANDS) {
          const focus = resolveEventFocus(
            arch,
            { category: cat, companyId: co },
            () => r
          );
          const cats = categoriesForCompany(focus.companyId);
          if (cats.length) {
            assert.ok(
              cats.includes(focus.category),
              `focus inválido arch=${arch} cat=${cat} co=${co} → ${focus.companyId}/${focus.category}`
            );
          }
          const fromCat = companyForCategory(focus.category);
          // se não é pure-stock, ou é a empresa da cat ou proposta válida
          if (cats.length) {
            assert.ok(fromCat?.id === focus.companyId || cats.includes(focus.category));
          }
        }
      }
    }
  }
});

test('coerência: resolveEventProposal + alignEventCopy em todas as seeds × heats', () => {
  const heats = [0, 0.2, 0.5, 0.9, 1.4];
  for (const s of TEMPLATE_EVENT_SEEDS) {
    for (const heat of heats) {
      for (const r of [0.1, 0.4, 0.8]) {
        const reg = clampKnobs({
          ...defaultRegulatorKnobs(),
          marketOverheat: heat,
          eventImpactMult: 1,
          recentArchetypes: [],
        });
        const resolved = resolveEventProposal(
          { ...s, source: 'template' },
          { reg, random: () => r, overheat: heat }
        );
        const dir = directionFromShock(resolved.impact?.shockPct);
        const aligned = alignEventCopy({
          title: resolved.title,
          body: resolved.body,
          direction: dir,
          archetype: resolved.archetype,
          category: resolved.category,
          companyId: resolved.companyId,
          random: () => r,
        });
        assertCoherent(
          `seed="${s.title}" heat=${heat} r=${r} arch=${resolved.archetype}`,
          {
            title: aligned.title,
            body: aligned.body,
            direction: dir,
            category: resolved.category,
            companyId: resolved.companyId,
          }
        );
      }
    }
  }
});

test('coerência: combinações AI-like (archetype × category × company) passam no align', () => {
  const companies = listCompanies().map((c) => c.id);
  const badProposals = [
    {
      name: 'pato+arma',
      title: 'PatoCoin viraliza no grupo',
      body: 'Sticker de pato e FOMO.\nPeixeira como ativo.',
      archetype: 'meme_spike',
      category: 'arma',
      companyId: 'patocoin',
    },
    {
      name: 'gasolina+defesa',
      title: 'Gasolina mais cara no posto',
      body: 'Fila no posto e galão sumindo.\nEscassez de combustível.',
      archetype: 'supply_shock',
      category: 'defesa',
      companyId: 'satelite_br',
    },
    {
      name: 'alta-no-texto-queda-no-ticker',
      title: 'Tudo subiu de novo',
      body: 'Preço sobe, fila e aperto no bairro.',
      archetype: 'profit_take',
      category: 'arma',
      companyId: 'bombatech',
    },
    {
      name: 'uno+arma-invalido',
      title: 'Uno Motors lança kit de rifle',
      body: 'Rifle e pistola na oficina do Uno.',
      archetype: 'demand_boom',
      category: 'arma',
      companyId: 'uno_motors',
    },
  ];

  for (const p of badProposals) {
    for (const heat of [0, 0.6, 1.2]) {
      const reg = clampKnobs({
        ...defaultRegulatorKnobs(),
        marketOverheat: heat,
        eventImpactMult: 1,
      });
      const resolved = resolveEventProposal(p, {
        reg,
        random: () => 0.25,
        overheat: heat,
      });
      const dir = directionFromShock(resolved.impact?.shockPct);
      const aligned = alignEventCopy({
        title: resolved.title,
        body: resolved.body,
        direction: dir,
        archetype: resolved.archetype,
        category: resolved.category,
        companyId: resolved.companyId,
        random: () => 0.25,
      });
      assertCoherent(`bad-proposal:${p.name} heat=${heat}`, {
        title: aligned.title,
        body: aligned.body,
        direction: dir,
        category: resolved.category,
        companyId: resolved.companyId,
      });
    }
  }

  // grade: cada arquétipo × cada categoria do arch × empresa da cat
  for (const archId of ARCHETYPE_IDS) {
    const arch = getArchetype(archId);
    const cats = arch.goodForCategories?.length ? arch.goodForCategories : CATS;
    for (const cat of cats) {
      const co = companyForCategory(cat)?.id;
      const resolved = resolveEventProposal(
        {
          archetype: archId,
          category: cat,
          companyId: co,
          title: arch.label,
          body: '', // força realign
          source: 'fuzz',
        },
        {
          reg: clampKnobs({ ...defaultRegulatorKnobs(), marketOverheat: 0 }),
          random: () => 0.33,
          overheat: 0,
        }
      );
      const dir = directionFromShock(resolved.impact?.shockPct);
      const aligned = alignEventCopy({
        title: resolved.title,
        body: resolved.body,
        direction: dir,
        archetype: resolved.archetype,
        category: resolved.category,
        companyId: resolved.companyId,
        random: () => 0.33,
      });
      assertCoherent(`grid ${archId}/${cat}`, {
        title: aligned.title,
        body: aligned.body,
        direction: dir,
        category: resolved.category,
        companyId: resolved.companyId,
      });
    }
  }

  void companies;
});

test('coerência: isCopyCoherent rejeita os clássicos bugs de manchete', () => {
  assert.equal(
    isCopyCoherent({
      title: 'PatoCoin viraliza no grupo',
      body: 'Sticker de pato.\nPeixeira como ativo.',
      direction: 'up',
      category: 'arma',
      companyId: 'bombatech',
    }),
    false
  );
  // pure-stock + peixeira no corpo = esquisito mesmo com companyId=patocoin
  assert.equal(
    isCopyCoherent({
      title: 'PatoCoin viraliza no grupo',
      body: 'Sticker de pato.\nPeixeira como ativo no bairro.',
      direction: 'up',
      category: 'arma',
      companyId: 'patocoin',
    }),
    false
  );
  assert.equal(
    isCopyCoherent({
      title: 'Gasolina sobe no posto',
      body: 'Fila e escassez de combustível.',
      direction: 'down',
      category: 'combustivel',
      companyId: 'peixaria',
    }),
    false
  );
  assert.equal(
    isCopyCoherent({
      title: 'Colete some da prateleira',
      body: 'Defesa e colete tático em falta.\nPreço sobe de leve.',
      direction: 'up',
      category: 'defesa',
      companyId: 'satelite_br',
    }),
    true
  );
});

test('coerência: "nem fila" não conta como alta', () => {
  assert.equal(
    inferNarrativeDirection('Nem fila, nem blitze, nem caminhão.\nPreço anda de lado.'),
    'flat'
  );
});

test('coerência: adversarial LLM invent (mock) nunca publica peixeira com PatoCoin', async () => {
  const { initDb } = await import('../db/index.js');
  const { createFunStatsRepository } = await import('../fun/db/funStatsRepository.js');
  const { createFunMarketRepository } = await import('../fun/db/funMarketRepository.js');
  const { createFunStockRepository } = await import('../fun/db/funStockRepository.js');
  const { createMarketService } = await import('../fun/services/marketService.js');
  const { createStockService } = await import('../fun/services/stockService.js');
  const { resolveFunConfig } = await import('../fun/config.js');

  await initDb();
  const repository = createFunStatsRepository();
  const marketRepository = createFunMarketRepository();
  const stockService = createStockService({
    repository,
    stockRepository: createFunStockRepository(),
  });
  const funConfig = resolveFunConfig({
    zenEnabled: true,
    ollamaEnabled: false,
    marketEnabled: true,
    economyEnabled: true,
  });
  const bad = {
    archetype: 'meme_spike',
    category: 'arma',
    companyId: 'patocoin',
    title: 'PatoCoin viraliza no grupo',
    body: [
      'Sticker de pato e FOMO.',
      'Peixeira como ativo no bairro.',
      'Quem comprou cedo grita.',
      'Pode ser ouro.',
      'Pode ser golpe.',
      'Onda meme curta.',
    ].join('\n'),
  };
  const marketService = createMarketService({
    repository,
    marketRepository,
    stockService,
    random: () => 0.3,
    generateZen: async () => JSON.stringify(bad),
  });
  const result = await marketService.runMarketEvent({
    scopeKey: `120363coh${Date.now()}@g.us`,
    funConfig,
    now: Date.now(),
    force: true,
  });
  assert.equal(result.ok, true);
  const e = result.event;
  const dir = e.impactPct > 0.5 ? 'up' : e.impactPct < -0.5 ? 'down' : 'flat';
  assert.ok(
    isCopyCoherent({
      title: e.title,
      body: e.description,
      direction: dir,
      category: e.category,
      companyId: e.companyId,
    })
  );
  assert.ok(!/peixeira/i.test(`${e.title}\n${e.description}`));
  const ann = marketService.formatEventAnnouncement(result, () => '');
  // pure-stock não deve ser rotulado como setor de rua no ticker
  if (e.companyId === 'patocoin') {
    assert.match(ann, /bolsa/i);
    assert.ok(!/\*arma\*/i.test(ann) || /bolsa/i.test(ann));
  }
});
