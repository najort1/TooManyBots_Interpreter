/**
 * Knobs Zen por tarefa · métricas · flavor anti-placar / anti-eco.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveZenTaskParams,
  ZEN_TASK_DEFAULTS,
  pickFlavorAngle,
  fingerprintLine,
  overlapsRecent,
} from '../fun/llm/zenTaskParams.js';
import {
  recordLlmHit,
  getLlmMetrics,
  resetLlmMetrics,
  inventTemplateAlert,
} from '../fun/llm/llmMetrics.js';
import {
  createFlavorService,
  looksLikeScoreboardEcho,
  sanitizeFlavor,
} from '../fun/llm/flavorService.js';
import { resolveFunConfig } from '../fun/config.js';
import { DEFAULT_FUN_CONFIG } from '../fun/constants.js';

test('resolveZenTaskParams: invent vs extract vs flavor', () => {
  const invent = resolveZenTaskParams('invent', {});
  const extract = resolveZenTaskParams('extract', {});
  const flavor = resolveZenTaskParams('flavor', {});
  assert.equal(invent.jsonOnly, true);
  assert.equal(extract.jsonOnly, true);
  assert.equal(flavor.jsonOnly, false);
  assert.ok(invent.maxTokens >= 1000);
  assert.ok(extract.temperature <= 0.45);
  assert.ok(flavor.temperature >= 0.85);
  // invent longo: default ≥90s (antes 45s abortava com gen pronta no proxy)
  assert.ok(invent.timeoutMs >= 90_000, `invent timeout ${invent.timeoutMs}`);
  assert.deepEqual(
    Object.keys(ZEN_TASK_DEFAULTS).sort(),
    ['assault', 'chaos', 'extract', 'flavor', 'invent', 'journalist', 'persona', 'tarot'].sort()
  );
});

test('resolveZenTaskParams: invent timeout não é esmagado pelo zenTimeoutMs global curto', () => {
  const cfg = resolveFunConfig({
    zenTimeoutMs: 45_000,
    zenInventTimeoutMs: 120_000,
  });
  const invent = resolveZenTaskParams('invent', cfg);
  assert.equal(invent.timeoutMs, 120_000);
  // override flat
  const longer = resolveZenTaskParams('invent', {
    ...cfg,
    zenInventTimeoutMs: 180_000,
  });
  assert.equal(longer.timeoutMs, 180_000);
  // global curto NÃO vence o default da tarefa invent
  const onlyGlobal = resolveZenTaskParams('invent', { zenTimeoutMs: 20_000 });
  assert.ok(onlyGlobal.timeoutMs >= 90_000, `got ${onlyGlobal.timeoutMs}`);
});

test('resolveZenTaskParams: override flat config', () => {
  const p = resolveZenTaskParams('flavor', {
    zenFlavorTemperature: 0.5,
    zenFlavorMaxTokens: 100,
  });
  assert.equal(p.temperature, 0.5);
  assert.equal(p.maxTokens, 100);
});

test('resolveZenTaskParams: nested zenTasks', () => {
  const p = resolveZenTaskParams('chaos', {
    zenTasks: { chaos: { temperature: 0.2, maxTokens: 99 } },
  });
  assert.equal(p.temperature, 0.2);
  assert.equal(p.maxTokens, 99);
});

test('fingerprint + overlapsRecent', () => {
  const a = fingerprintLine('A moeda te escolheu hoje de novo');
  const b = fingerprintLine('A moeda te escolheu hoje de novo!!');
  assert.ok(a.length > 0);
  assert.equal(overlapsRecent(b, [a]), true);
  assert.equal(overlapsRecent('totalmente outra frase de bairro', [a]), false);
});

test('looksLikeScoreboardEcho', () => {
  assert.equal(looksLikeScoreboardEcho('Ganhou 500 coins no slot'), true);
  assert.equal(looksLikeScoreboardEcho('A moeda te escolheu hoje.'), false);
  // placar sozinho é rejeitado; frase mista com coins também
  assert.equal(looksLikeScoreboardEcho('Saldo agora: 999 coins'), true);
  assert.equal(sanitizeFlavor('Você ganhou 999 coins no slot.'), '');
});

test('sanitizeFlavor rejeita inglês e fragmento incompleto', () => {
  assert.equal(sanitizeFlavor('which means the WhatsApp team or fans cheering for the result'), '');
  assert.equal(sanitizeFlavor('luck disguised as skill'), '');
  assert.equal(sanitizeFlavor('e ganhou, já que é um'), '');
  assert.equal(
    sanitizeFlavor('Respond in 1 to 3 sentences in Brazilian Portuguese (pt-BR), with a WhatsApp group banter tone'),
    ''
  );
  assert.equal(sanitizeFlavor('então talvez esteja relacionado a escolhas, mas não posso usar'), '');
  assert.equal(sanitizeFlavor('. Also, avoid any mention of'), '');
  assert.equal(
    sanitizeFlavor('Roteiro besteirol de assalto a banco com sucesso, no tom pastelão que você pediu.'),
    ''
  );
  assert.equal(sanitizeFlavor('Aqui vai uma frase legal sobre o jogo.'), '');
  assert.match(
    sanitizeFlavor('A moeda te escolheu hoje. Aproveita antes dela te trair.'),
    /moeda/i
  );
});

test('sanitizeAssaultStory remove preâmbulo e mantém cenas', async () => {
  const { sanitizeAssaultStory } = await import('../fun/llm/flavorService.js');
  const raw = `Aqui vai um roteiro curto de assalto no tom pastelão que você pediu.

🎬 TÍTULO: O BANCO DO ZÉ
CENA 1 — PREPARAÇÃO
O plano era simples e burro.
CENA 2 — AÇÃO
Entrou gritando com a pistola de brinquedo.
CENA 3 — FUGA / CONSEQUÊNCIA
Correu pro Uno sem roda.
EPÍLOGO
O grupo ainda ri no zap.

***
Quer que eu escreva uma variação mais malandra?`;
  const clean = sanitizeAssaultStory(raw, 2200);
  assert.match(clean, /T[IÍ]TULO|BANCO DO ZÉ/i);
  assert.ok(!/aqui vai|pastel[aã]o que voc/i.test(clean));
  assert.ok(!/quer que eu escreva|varia[cç][aã]o mais/i.test(clean));
  assert.match(clean, /CENA 1/i);
});

test('assault prompt exige nome do attacker e bloqueia JID', async () => {
  const { createFlavorService } = await import('../fun/llm/flavorService.js');
  let seenPrompt = '';
  const flavor = createFlavorService({
    getConfig: () => ({
      zenEnabled: true,
      ollamaEnabled: false,
      flavorTimeoutMs: 5_000,
      assaultStoryTimeoutMs: 5_000,
    }),
    allowLiveLlm: true,
    zenGenerate: async (opts) => {
      seenPrompt = `${opts.system || ''}\n${opts.prompt || ''}`;
      return `🎬 TÍTULO: TESTE
CENA 1 — PREPARAÇÃO
Eduardo segura a pistola.
CENA 2 — AÇÃO
Eduardo entra na lojinha.
CENA 3 — FUGA / CONSEQUÊNCIA
Eduardo foge.
EPÍLOGO
Fim.`;
    },
    generate: async () => {
      throw new Error('no-ollama');
    },
  });
  const text = await flavor.assaultStory('assault_shop_win', {
    attacker: 'Eduardo',
    target: 'Lojinha da esquina',
    weapon: 'Pistola 9mm',
    mode: 'shop',
    success: 'sim',
  });
  assert.match(seenPrompt, /Eduardo/);
  assert.match(seenPrompt, /Assaltante\/protagonista/i);
  assert.match(seenPrompt, /N[AÃ]O invente outro/i);
  assert.match(text, /Eduardo/);
  assert.ok(!/@\d{8,}/.test(seenPrompt), 'prompt não deve carregar JID como elenco');
});

test('llmMetrics invent rates + alert', () => {
  resetLlmMetrics();
  for (let i = 0; i < 3; i += 1) recordLlmHit('invent', 'zen');
  for (let i = 0; i < 3; i += 1) recordLlmHit('invent', 'template');
  const m = getLlmMetrics();
  assert.equal(m.invent.total, 6);
  assert.ok(m.invent.templateRate >= 0.4);
  const alert = inventTemplateAlert(0.4, 5);
  assert.ok(alert);
  assert.match(alert.message, /templateRate/);
  resetLlmMetrics();
  assert.equal(getLlmMetrics().invent.total, 0);
});

test('config expose knobs e defaults', () => {
  const cfg = resolveFunConfig({});
  assert.equal(cfg.zenInventTemperature, DEFAULT_FUN_CONFIG.zenInventTemperature);
  assert.equal(cfg.flavorAlways, true);
  assert.equal(cfg.marketJournalistEnabled, false);
  assert.ok(cfg.flavorRecentMax >= 1);
});

test('flavorService: Zen scoreboard echo → template; anti-repeat', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let calls = 0;
    const flavor = createFlavorService({
      getConfig: () =>
        resolveFunConfig({
          zenEnabled: true,
          ollamaEnabled: false,
          flavorRecentMax: 8,
          flavorTimeoutMs: 8_000,
        }),
      allowLiveLlm: true,
      zenGenerate: async () => {
        calls += 1;
        if (calls === 1) return 'Você ganhou 120 coins no flip, parabéns!';
        return 'A moeda te escolheu com cara de quem leu o futuro no zap.';
      },
      generate: async () => {
        throw new Error('no-ollama');
      },
    });

    const first = await flavor.line('flip_win', { pick: 'cara' });
    assert.ok(first.length > 10);
    // scoreboard foi rejeitado → template ou segunda frase limpa
    assert.ok(!/120\s*coins/i.test(first));

    // força eco do mesmo texto limpo
    const flavor2 = createFlavorService({
      getConfig: () =>
        resolveFunConfig({
          zenEnabled: true,
          ollamaEnabled: false,
          flavorRecentMax: 8,
          flavorTimeoutMs: 8_000,
        }),
      allowLiveLlm: true,
      random: () => 0,
      zenGenerate: async () => 'A moeda te escolheu com cara de quem leu o futuro no zap.',
      generate: async () => {
        throw new Error('no-ollama');
      },
    });
    const a = await flavor2.line('flip_win', {});
    const b = await flavor2.line('flip_win', {});
    // segunda chamada: se Zen devolve o mesmo, overlaps → template (ainda ok, mas diferente path)
    assert.ok(a.length > 8);
    assert.ok(b.length > 8);
    assert.ok(['zen', 'template', 'template-timeout'].includes(flavor2.lastProvider()));
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('pickFlavorAngle retorna string do catálogo', () => {
  const a = pickFlavorAngle(() => 0);
  assert.ok(typeof a === 'string' && a.length > 3);
});
