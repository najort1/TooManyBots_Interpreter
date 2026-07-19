/**
 * Chaos social: roleta russa, cancelar, fofoca, oráculo, illuminati + cascata Zen→Ollama→template.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunStatsRepository,
  _resetDefaultFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunEffectsRepository } from '../fun/db/funEffectsRepository.js';
import { createChaosService } from '../fun/services/chaosService.js';
import { createFlavorService } from '../fun/llm/flavorService.js';
import { createXpService } from '../fun/services/xpService.js';
import { parseFunCommand, resolveFunConfig } from '../fun/index.js';
import { FUN_COMMANDS } from '../fun/constants.js';
import {
  handleCancelCommand,
  handleGossipCommand,
  handleOracleCommand,
  handleIlluminatiCommand,
  handleRussianCommand,
  handlePullCommand,
} from '../fun/commands/handlers/chaos.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('parseFunCommand: aliases de caos (oraculo ≠ tarot)', () => {
  assert.equal(parseFunCommand('/roletarussa', '/').command, FUN_COMMANDS.RUSSIAN);
  assert.equal(parseFunCommand('/rr', '/').command, FUN_COMMANDS.RUSSIAN);
  assert.equal(parseFunCommand('/puxar', '/').command, FUN_COMMANDS.PULL);
  assert.equal(parseFunCommand('/cancelar', '/').command, FUN_COMMANDS.CANCEL);
  assert.equal(parseFunCommand('/fofoca', '/').command, FUN_COMMANDS.GOSSIP);
  assert.equal(parseFunCommand('/illuminati', '/').command, FUN_COMMANDS.ILLUMINATI);
  assert.equal(parseFunCommand('/conspiracao', '/').command, FUN_COMMANDS.ILLUMINATI);

  // oráculo maluco — não é mais tarô
  const o = parseFunCommand('/oraculo Vou namorar?', '/');
  assert.equal(o.command, FUN_COMMANDS.ORACLE);
  assert.deepEqual(o.args, ['Vou', 'namorar?']);

  assert.equal(parseFunCommand('/tarot oi', '/').command, FUN_COMMANDS.TAROT);
  assert.equal(parseFunCommand('/cartas', '/').command, FUN_COMMANDS.TAROT);
});

test('chaosService: templates de texto não vazios', () => {
  const svc = createChaosService({
    repository: { getLeaderboard: () => [] },
    effectsRepository: null,
    random: () => 0.5,
  });
  assert.match(svc.cancelAbsurd('Ana'), /Ana/);
  assert.match(svc.gossipFake('Beto'), /Beto/);
  assert.match(svc.oracleInsane('Vou namorar?'), /namorar/i);
  assert.match(svc.illuminatiTheory('Carla'), /Carla/);
});

test('chaosService: roleta — click depois morte + efeito xp_morto', () => {
  const scope = uniqueGroup();
  const a = uniqueJid('5591');
  const b = uniqueJid('5592');
  const effects = [];
  const effectsRepository = {
    setTimedEffect(input) {
      effects.push(input);
      return input;
    },
    getEffect() {
      return null;
    },
  };
  // 1º pull sobrevive (random alto), 2º morre (random 0)
  let pulls = 0;
  const svc = createChaosService({
    repository: { getLeaderboard: () => [{ userJid: a }, { userJid: b }] },
    effectsRepository,
    random: () => {
      pulls += 1;
      // chance = 1/remaining; remaining starts 6 → need r < 1/6 to die
      return pulls === 1 ? 0.99 : 0;
    },
  });

  const start = svc.startRussian({
    userJid: a,
    scopeKey: scope,
    funConfig: { russianChambers: 6, russianDeathMs: 15 * 60_000 },
  });
  assert.equal(start.ok, true);
  assert.equal(start.chambers, 6);

  const again = svc.startRussian({ userJid: b, scopeKey: scope, funConfig: {} });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already-running');

  const click = svc.pullTrigger({
    userJid: a,
    scopeKey: scope,
    funConfig: {},
    now: Date.now(),
  });
  assert.equal(click.ok, true);
  assert.equal(click.died, false);
  assert.equal(click.remaining, 5);

  const bang = svc.pullTrigger({
    userJid: b,
    scopeKey: scope,
    funConfig: { russianDeathMs: 15 * 60_000 },
    now: Date.now() + 2000,
  });
  assert.equal(bang.ok, true);
  assert.equal(bang.died, true);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].effectKey, 'xp_morto');
  assert.equal(effects[0].userJid, b);
  assert.equal(effects[0].durationMs, 15 * 60_000);

  const noGame = svc.pullTrigger({ userJid: a, scopeKey: scope, funConfig: {}, now: Date.now() + 5000 });
  assert.equal(noGame.ok, false);
  assert.equal(noGame.reason, 'no-game');
});

test('effectsRepository.isXpBlocked + xpService bloqueia award', () => {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const effects = createFunEffectsRepository({ getDatabase: getDb });
  const scope = uniqueGroup();
  const u = uniqueJid('5593');
  const now = Date.now();

  effects.setTimedEffect({
    userJid: u,
    scopeKey: scope,
    effectKey: 'xp_morto',
    durationMs: 15 * 60_000,
    payload: { source: 'russian' },
    now,
  });

  const blocked = effects.isXpBlocked(u, scope, now + 1000);
  assert.equal(blocked.blocked, true);

  const xp = createXpService({ repository: repo, effectsRepository: effects, random: () => 0 });
  const award = xp.awardXp({
    userJid: u,
    scopeKey: scope,
    now: now + 1000,
    cooldownMs: 0,
    amount: 20,
  });
  assert.equal(award.applied, false);
  assert.equal(award.reason, 'xp-morto');
  assert.equal(award.gained, 0);

  // após expirar
  const free = effects.isXpBlocked(u, scope, now + 20 * 60_000);
  assert.equal(free.blocked, false);
});

test('group_times: ban list não vaza ganchos de outro grupo no prompt', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    /** @type {string[]} */
    const prompts = [];
    const flavor = createFlavorService({
      getConfig: () =>
        resolveFunConfig({
          zenEnabled: true,
          ollamaEnabled: false,
          flavorRecentMax: 10,
        }),
      zenGenerate: async (opts) => {
        prompts.push(String(opts?.prompt || ''));
        return 'MANCHETE: Assalto no bairro\nECONOMIA: Fluxo de coins\nFOFOCA: Ninguém se divorciou';
      },
      generate: async () => {
        throw new Error('no-ollama');
      },
      allowLiveLlm: true,
    });

    // flavor de outro grupo (simula "vish paulo…")
    await flavor.line('flip_win', {
      scopeKey: '120363OTHER@g.us',
      user: 'Paulo',
    });
    // força push manual se flip cair em template
    // gera no grupo A
    await flavor.chaosLine('oracle_insane', {
      scopeKey: '120363OTHER@g.us',
      question: 'Paulo level cocada preta?',
    });

    prompts.length = 0;
    const text = await flavor.chaosLine('group_times', {
      scopeKey: '120363NEWS@g.us',
      events: 'assault_win amount=77\nassault_win amount=57',
      count: 2,
    });

    assert.match(text, /MANCHETE|Assalto/i);
    assert.ok(prompts.length >= 1, 'prompt capturado');
    const p = prompts[prompts.length - 1];
    assert.match(p, /assault_win amount=77/);
    assert.doesNotMatch(p, /paulo|cocada|vish/i);
    assert.doesNotMatch(p, /NÃO repita ganchos/i);
    assert.doesNotMatch(p, /__angle|deboche/i);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('flavorService.chaosLine: Zen principal', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let zen = 0;
    let ollama = 0;
    const flavor = createFlavorService({
      getConfig: () =>
        resolveFunConfig({
          zenEnabled: true,
          ollamaEnabled: true,
          chaosTimeoutMs: 8_000,
          flavorTimeoutMs: 8_000,
        }),
      zenGenerate: async () => {
        zen += 1;
        return 'Sim, porém só depois de três pombos, um Uno azul e uma senhora de milho.';
      },
      generate: async () => {
        ollama += 1;
        return 'nao-deveria';
      },
      allowLiveLlm: true,
    });

    const text = await flavor.chaosLine('oracle_insane', { question: 'Vou namorar?' });
    assert.match(text, /pombos|Uno|milho/i);
    assert.equal(flavor.lastProvider(), 'zen');
    assert.equal(zen, 1);
    assert.equal(ollama, 0);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('flavorService.chaosLine: Zen falha → Ollama', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    let zen = 0;
    let ollama = 0;
    const flavor = createFlavorService({
      getConfig: () =>
        resolveFunConfig({
          zenEnabled: true,
          ollamaEnabled: true,
          chaosTimeoutMs: 8_000,
          flavorTimeoutMs: 8_000,
        }),
      zenGenerate: async () => {
        zen += 1;
        throw new Error('zen-down');
      },
      generate: async () => {
        ollama += 1;
        return 'Fofoca mentirosa: Ana treina discurso pro daily no chuveiro e perde o fio da meada.';
      },
      allowLiveLlm: true,
    });

    const text = await flavor.chaosLine('gossip_fake', { user: 'Ana' });
    assert.match(text, /Ana|daily|chuveiro/i);
    assert.equal(flavor.lastProvider(), 'ollama');
    assert.ok(zen >= 1);
    assert.equal(ollama, 1);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('flavorService.chaosLine: Zen+Ollama falham → template', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  try {
    const flavor = createFlavorService({
      getConfig: () =>
        resolveFunConfig({
          zenEnabled: true,
          ollamaEnabled: true,
          chaosTimeoutMs: 5_000,
        }),
      zenGenerate: async () => {
        throw new Error('zen-down');
      },
      generate: async () => {
        throw new Error('ollama-down');
      },
      allowLiveLlm: true,
    });

    const text = await flavor.chaosLine('illuminati_theory', { user: 'Zé' });
    assert.ok(text.length > 10);
    assert.match(text, /Zé|pão|Wi-Fi|conspir|indícios|controla/i);
    assert.ok(
      flavor.lastProvider() === 'template' || flavor.lastProvider() === 'template-timeout'
    );
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('handlers: cancelar/fofoca/oraculo/illuminati usam IA e respondem', async () => {
  const scope = uniqueGroup();
  const me = uniqueJid('5594');
  const other = uniqueJid('5595');
  const replies = [];
  const reply = async (t) => {
    replies.push(String(t));
  };

  let scenarios = [];
  const flavorService = {
    async chaosLine(scenario, vars) {
      scenarios.push({ scenario, vars });
      if (scenario === 'cancel_absurd') return `Cancelado: ${vars.user} roubou o Wi-Fi do prédio.`;
      if (scenario === 'gossip_fake') return `Fofoca falsa: ${vars.user} namora o travesseiro.`;
      if (scenario === 'oracle_insane') return `Sobre ${vars.question}: sim, com pombos.`;
      if (scenario === 'illuminati_theory') return `${vars.user} controla o pão desde 2009.`;
      return 'ok';
    },
    lastProvider: () => 'zen',
  };

  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  // popular leaderboard pro illuminati
  repo.awardXp({ userJid: other, scopeKey: scope, amount: 50, now: Date.now(), cooldownMs: 0 });
  repo.awardXp({ userJid: me, scopeKey: scope, amount: 40, now: Date.now(), cooldownMs: 0 });

  const chaosService = createChaosService({
    repository: repo,
    effectsRepository: createFunEffectsRepository({ getDatabase: getDb }),
    random: () => 0.1,
  });

  const funConfig = resolveFunConfig({ chaosCooldownMs: 1 });

  await handleCancelCommand({
    userJid: me,
    scopeKey: scope,
    chaosService,
    funConfig,
    getContactDisplayName: (j) => (j === other ? 'Vitima' : 'Eu'),
    listContacts: () => [],
    reply,
    args: [],
    mentionedJids: [other],
    quotedParticipant: '',
    sock: null,
    identityMap: null,
    flavorService,
  });
  assert.ok(replies.some((r) => /Cancelamento|Wi-Fi/i.test(r)));
  assert.ok(scenarios.some((s) => s.scenario === 'cancel_absurd'));

  await handleGossipCommand({
    userJid: me,
    scopeKey: scope,
    chaosService,
    funConfig,
    getContactDisplayName: (j) => (j === other ? 'Vitima' : 'Eu'),
    listContacts: () => [],
    reply,
    args: [],
    mentionedJids: [other],
    quotedParticipant: '',
    sock: null,
    identityMap: null,
    flavorService,
  });
  assert.ok(replies.some((r) => /Fofoca|travesseiro/i.test(r)));

  await handleOracleCommand({
    userJid: me,
    scopeKey: scope,
    chaosService,
    funConfig,
    reply,
    args: ['Vou', 'namorar?'],
    flavorService,
  });
  assert.ok(replies.some((r) => /Oráculo|pombos/i.test(r)));
  assert.ok(scenarios.some((s) => s.scenario === 'oracle_insane'));

  await handleIlluminatiCommand({
    userJid: me,
    scopeKey: scope,
    chaosService,
    funConfig,
    getContactDisplayName: (j) => j.split('@')[0],
    reply,
    flavorService,
  });
  assert.ok(replies.some((r) => /Illuminati|pão|2009/i.test(r)));
});

test('handlers: roleta russa start + puxar com morte virtual', async () => {
  const scope = uniqueGroup();
  const me = uniqueJid('5596');
  const replies = [];
  const reply = async (t) => replies.push(String(t));

  const effectsRepo = createFunEffectsRepository({ getDatabase: getDb });
  const chaosService = createChaosService({
    repository: createFunStatsRepository({ getDatabase: getDb }),
    effectsRepository: effectsRepo,
    random: () => 0, // sempre morre no 1º puxão
  });

  const flavorService = {
    async chaosLine(scenario) {
      if (scenario === 'russian_start') return 'O tambor gira no grupo.';
      if (scenario === 'russian_dead') return 'BANG virtual com mico.';
      return 'ok';
    },
  };

  await handleRussianCommand({
    userJid: me,
    scopeKey: scope,
    isGroup: true,
    chaosService,
    funConfig: resolveFunConfig({ russianChambers: 6, russianDeathMs: 15 * 60_000 }),
    reply,
    flavorService,
  });
  assert.ok(replies.some((r) => /Roleta russa|tambor|puxar/i.test(r)));

  await handlePullCommand({
    userJid: me,
    scopeKey: scope,
    isGroup: true,
    chaosService,
    funConfig: resolveFunConfig({ russianDeathMs: 15 * 60_000 }),
    getContactDisplayName: () => 'Herói',
    reply,
    flavorService,
  });
  assert.ok(replies.some((r) => /BANG|Sem XP/i.test(r)));
  const dead = effectsRepo.isXpBlocked(me, scope, Date.now());
  assert.equal(dead.blocked, true);
});
