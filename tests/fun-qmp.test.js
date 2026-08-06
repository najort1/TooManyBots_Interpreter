/**
 * Quem é Mais Provável? (QMP) — geração, votação, ranking semanal, auto-trigger.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunStatsRepository,
  _resetDefaultFunStatsRepository,
} from '../fun/db/funStatsRepository.js';
import { createFunQmpRepository } from '../fun/db/funQmpRepository.js';
import {
  createQmpService,
  sanitizeQmpPrompt,
  buildCustomPrompt,
  parseQmpSubcommand,
  QMP_FALLBACK_PROMPTS,
  QMP_HEAVY_FALLBACK_PROMPTS,
  isQmpEcho,
  qmpOverlapScore,
  resolveQmpTone,
  extractQmpHooks,
  isMonotoneExTheme,
} from '../fun/services/qmpService.js';
import { parseFunCommand, resolveFunConfig } from '../fun/index.js';
import { FUN_COMMANDS, DEFAULT_FUN_CONFIG } from '../fun/constants.js';
import { handleQmpCommand, tryPassiveQmpVote } from '../fun/commands/handlers/qmp.js';
import { formatQmpWeeklyLeaderboard } from '../fun/formatters/rankCard.js';
import { getWeekKey } from '../fun/db/funSocialRepository.js';

await initDb();
_resetDefaultFunStatsRepository();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 90 + 10)}@s.whatsapp.net`;
}

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function makeService({ random = () => 0.99, generateZen, generateOllama, profileService } = {}) {
  const repo = createFunStatsRepository({ getDatabase: getDb });
  repo.ensureFunSchema();
  const qmpRepository = createFunQmpRepository({ getDatabase: getDb });
  const qmpService = createQmpService({
    qmpRepository,
    profileService,
    random,
    generateZen:
      generateZen ||
      (async () => {
        throw new Error('zen-off');
      }),
    generateOllama:
      generateOllama ||
      (async () => {
        throw new Error('ollama-off');
      }),
  });
  return { qmpRepository, qmpService };
}

test('parseFunCommand: aliases QMP', () => {
  assert.equal(parseFunCommand('/qmp', '/').command, FUN_COMMANDS.QMP);
  assert.equal(parseFunCommand('/maisprovavel', '/').command, FUN_COMMANDS.QMP);
  assert.equal(parseFunCommand('/mostlikely', '/').command, FUN_COMMANDS.QMP);
  const p = parseFunCommand('/qmp pular aula', '/');
  assert.equal(p.command, FUN_COMMANDS.QMP);
  assert.deepEqual(p.args, ['pular', 'aula']);
  const r = parseFunCommand('/qmp rank', '/');
  assert.deepEqual(r.args, ['rank']);
});

test('parseQmpSubcommand: rank / close / history / heavy / custom', () => {
  assert.equal(parseQmpSubcommand([]).kind, 'random');
  assert.equal(parseQmpSubcommand(['rank']).kind, 'rank');
  assert.equal(parseQmpSubcommand(['ranking']).kind, 'rank');
  assert.equal(parseQmpSubcommand(['fechar']).kind, 'close');
  assert.equal(parseQmpSubcommand(['historico']).kind, 'history');
  assert.equal(parseQmpSubcommand(['history']).kind, 'history');
  assert.equal(parseQmpSubcommand(['hist']).kind, 'history');
  assert.equal(parseQmpSubcommand(['pesada']).kind, 'heavy');
  assert.equal(parseQmpSubcommand(['heavy']).kind, 'heavy');
  assert.equal(parseQmpSubcommand(['leve']).kind, 'light');
  assert.equal(parseQmpSubcommand(['pular', 'aula']).kind, 'custom');
  assert.deepEqual(parseQmpSubcommand(['pular', 'aula']).rest, ['pular', 'aula']);
});

test('anti-eco e rotação pesada', () => {
  assert.ok(qmpOverlapScore('tô chegando no chuveiro', 'tô chegando na cama') > 0.2);
  assert.ok(
    isQmpEcho('Quem é mais provável de mandar tô chegando no chuveiro?', [
      'Quem é mais provável de falar tô chegando ainda na cama?',
    ])
  );
  assert.ok(extractQmpHooks('pedir o WiFi da casa').includes('wifi'));

  // 4 normais + 1 pesada → every=5; índices 1..4 normal, 5 heavy
  assert.equal(resolveQmpTone(0, 5), 'normal');
  assert.equal(resolveQmpTone(3, 5), 'normal');
  assert.equal(resolveQmpTone(4, 5), 'heavy');
  assert.equal(resolveQmpTone(9, 5), 'heavy');
  assert.equal(resolveQmpTone(2, 5, 'heavy'), 'heavy');
  assert.equal(resolveQmpTone(4, 5, 'normal'), 'normal');

  assert.ok(QMP_HEAVY_FALLBACK_PROMPTS.length >= 8);
  assert.equal(isMonotoneExTheme('Quem é mais provável de curtir story do ex às 3h?'), true);
  assert.equal(isMonotoneExTheme('Quem é mais provável de lavar o prato dos outros pra parecer gente boa?'), false);
});

test('sanitizeQmpPrompt e buildCustomPrompt', () => {
  assert.match(sanitizeQmpPrompt('Quem é mais provável de sumir?'), /sumir/);
  assert.match(buildCustomPrompt('pular aula'), /pular aula/i);
  assert.match(buildCustomPrompt('pular aula'), /\?$/);
  assert.match(buildCustomPrompt('Quem é mais provável de mentir'), /mentir/);
  assert.equal(buildCustomPrompt(''), '');
  assert.ok(sanitizeQmpPrompt('x').length === 0 || sanitizeQmpPrompt('x') === '');
});

test('QMP fallback list não vazia', () => {
  assert.ok(QMP_FALLBACK_PROMPTS.length >= 10);
  for (const p of QMP_FALLBACK_PROMPTS) {
    assert.ok(p.length >= 20);
    assert.match(p, /provável|provavel|Quem/i);
  }
});

test('config: qmpAutoTriggerChance default e env QMP_AUTO_TRIGGER_CHANCE', () => {
  const base = resolveFunConfig({});
  assert.equal(base.qmpEnabled, true);
  assert.ok(base.qmpAutoTriggerChance >= 0 && base.qmpAutoTriggerChance <= 1);
  assert.equal(DEFAULT_FUN_CONFIG.qmpAutoTriggerChance, 0.02);

  const prev = process.env.QMP_AUTO_TRIGGER_CHANCE;
  process.env.QMP_AUTO_TRIGGER_CHANCE = '0.05';
  try {
    const cfg = resolveFunConfig({ qmpAutoTriggerChance: 0.01 });
    assert.equal(cfg.qmpAutoTriggerChance, 0.05);
  } finally {
    if (prev == null) delete process.env.QMP_AUTO_TRIGGER_CHANCE;
    else process.env.QMP_AUTO_TRIGGER_CHANCE = prev;
  }
});

test('qmpService: injeta elenco ativo e perfil de task no prompt Zen', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;
  let opts;
  const { qmpService } = makeService({
    profileService: {
      displayName: (jid) => ({
        'ana@s.whatsapp.net': 'Ana',
        'bia@s.whatsapp.net': 'Bia',
      })[jid] || jid,
    },
    generateZen: async (input) => {
      opts = input;
      return 'Quem é mais provável de guardar pote de sorvete com feijão?';
    },
  });

  try {
    const result = await qmpService.inventPrompt({
      zenEnabled: true,
      zenQmpTemperature: 0.73,
      zenQmpMaxTokens: 432,
      zenQmpTimeoutMs: 22_000,
    }, {
      scopeKey: 'grupo@g.us',
      participantJids: ['ana@s.whatsapp.net', 'bia@s.whatsapp.net'],
    });
    assert.equal(result.provider, 'zen');
    assert.match(opts.prompt, /<cast>/);
    assert.match(opts.prompt, /Ana, Bia/);
    assert.match(opts.prompt, /não cite nomes/i);
    assert.equal(opts.temperature, 0.73);
    assert.equal(opts.maxTokens, 432);
    assert.equal(opts.timeoutMs, 22_000);
  } finally {
    if (prev == null) delete process.env.FUN_DISABLE_LIVE_LLM;
    else process.env.FUN_DISABLE_LIVE_LLM = prev;
  }
});

test('qmpService: inventa via Zen mock e fallback template', async () => {
  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  let zenCalls = 0;
  const { qmpService } = makeService({
    generateZen: async () => {
      zenCalls += 1;
      return 'Quem é mais provável de roubar o carregador do amigo?';
    },
  });

  const cfg = resolveFunConfig({ zenEnabled: true, ollamaEnabled: false });
  const inv = await qmpService.inventPrompt(cfg);
  assert.equal(inv.provider, 'zen');
  assert.match(inv.prompt, /carregador/i);
  assert.equal(zenCalls, 1);

  const { qmpService: offline } = makeService({
    generateZen: async () => {
      throw new Error('offline');
    },
    generateOllama: async () => {
      throw new Error('offline');
    },
  });
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  try {
    const fb = await offline.inventPrompt(cfg);
    assert.equal(fb.provider, 'template');
    assert.ok(fb.prompt.length > 10);
  } finally {
    if (prev == null) delete process.env.FUN_DISABLE_LIVE_LLM;
    else process.env.FUN_DISABLE_LIVE_LLM = prev;
  }
});

test('qmpService: anti-eco regenera e tom heavy na 5ª rodada', async () => {
  delete process.env.FUN_DISABLE_LIVE_LLM;
  let n = 0;
  const answers = [
    'Quem é mais provável de mandar tô chegando ainda no chuveiro?',
    'Quem é mais provável de roubar o molho da feijoada do amigo?',
  ];
  const { qmpRepository, qmpService } = makeService({
    generateZen: async () => {
      const a = answers[Math.min(n, answers.length - 1)];
      n += 1;
      return a;
    },
  });
  const scope = uniqueGroup();
  const cfg = resolveFunConfig({
    zenEnabled: true,
    ollamaEnabled: false,
    qmpHeavyEvery: 5,
    qmpInventRetries: 2,
    qmpCooldownMs: 0,
  });

  // invent com eco recente de "tô chegando"
  const inv = await qmpService.inventPrompt(cfg, {
    scopeKey: scope,
    tone: 'normal',
    recentPrompts: [
      'Quem é mais provável de falar tô chegando enquanto ainda tá no chuveiro?',
    ],
  });
  assert.equal(inv.provider, 'zen');
  assert.match(inv.prompt, /feijoada|molho/i);
  assert.ok(n >= 2);

  // 4 normais + 5ª pesada
  for (let i = 0; i < 4; i += 1) {
    const r = await qmpService.startRound({
      scopeKey: scope,
      userJid: uniqueJid('5510'),
      customText: `cena normal ${i} unica ${Date.now()}${i}`,
      funConfig: cfg,
    });
    assert.equal(r.ok, true);
    assert.equal(r.tone, 'normal');
    qmpService.closeRound({ scopeKey: scope, funConfig: cfg });
  }
  const heavy = await qmpService.startRound({
    scopeKey: scope,
    userJid: uniqueJid('5510'),
    customText: '',
    funConfig: { ...cfg, ollamaEnabled: false },
    forceTone: null,
  });
  // se LLM mock ainda roda, tom deve ser heavy pela contagem
  assert.equal(heavy.ok, true);
  assert.equal(heavy.tone, 'heavy');
  assert.equal(qmpRepository.countQuestions(scope), 5);

  const forced = await qmpService.startRound({
    scopeKey: scope,
    force: true,
    userJid: uniqueJid('5510'),
    customText: 'beijos no ex do colega',
    funConfig: cfg,
    forceTone: 'heavy',
  });
  assert.equal(forced.tone, 'heavy');
});

test('qmpService: rodada + voto + ranking semanal', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const { qmpRepository, qmpService } = makeService({ random: () => 0.1 });
  const scope = uniqueGroup();
  const a = uniqueJid('5591');
  const b = uniqueJid('5592');
  const c = uniqueJid('5593');
  const cfg = resolveFunConfig({
    qmpEnabled: true,
    qmpCooldownMs: 0,
    qmpRoundDurationMs: 10 * 60_000,
  });

  const started = await qmpService.startRound({
    scopeKey: scope,
    userJid: a,
    customText: 'chegar atrasado',
    source: 'custom',
    funConfig: cfg,
  });
  assert.equal(started.ok, true);
  assert.match(started.question.prompt, /atrasado/i);
  assert.equal(started.question.status, 'active');

  // segunda rodada bloqueada
  const blocked = await qmpService.startRound({
    scopeKey: scope,
    userJid: b,
    customText: 'outra',
    funConfig: cfg,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'active-exists');

  const v1 = qmpService.castVote({
    scopeKey: scope,
    voterJid: a,
    targetJid: b,
    funConfig: cfg,
  });
  assert.equal(v1.ok, true);
  assert.equal(v1.voteCount, 1);

  const vDup = qmpService.castVote({
    scopeKey: scope,
    voterJid: a,
    targetJid: c,
    funConfig: cfg,
  });
  assert.equal(vDup.ok, false);
  assert.equal(vDup.reason, 'already-voted');

  const vSelf = qmpService.castVote({
    scopeKey: scope,
    voterJid: b,
    targetJid: b,
    funConfig: cfg,
  });
  assert.equal(vSelf.ok, false);
  assert.equal(vSelf.reason, 'self-vote');

  qmpService.castVote({
    scopeKey: scope,
    voterJid: c,
    targetJid: b,
    funConfig: cfg,
  });
  qmpService.castVote({
    scopeKey: scope,
    voterJid: b,
    targetJid: a,
    funConfig: cfg,
  });

  const closed = qmpService.closeRound({ scopeKey: scope, funConfig: cfg });
  assert.equal(closed.ok, true);
  assert.ok(closed.tally.length >= 1);
  assert.equal(closed.tally[0].userJid, b);
  assert.equal(closed.tally[0].votes, 2);

  const week = getWeekKey();
  const board = qmpRepository.weeklyLeaderboard(scope, week, 10);
  assert.ok(board.length >= 1);
  assert.equal(board[0].userJid, b);
  assert.equal(board[0].votes, 2);

  const rank = qmpService.getWeeklyRank({
    scopeKey: scope,
    userJid: b,
    funConfig: cfg,
  });
  assert.equal(rank.position.rank, 1);
  assert.equal(rank.position.votes, 2);

  const text = formatQmpWeeklyLeaderboard({
    entries: rank.entries.map((e) => ({ ...e, displayName: 'X' })),
    yourRank: rank.position.rank,
    yourTotal: rank.position.total,
    yourVotes: rank.position.votes,
    weekKey: rank.weekKey,
    limit: rank.limit,
  });
  assert.match(text, /Mais Provável/i);
  assert.match(text, /voto/i);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('qmpService: tryAutoTrigger respeita chance e cooldown', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  let roll = 0.99; // miss
  const { qmpService } = makeService({ random: () => roll });
  const scope = uniqueGroup();
  const cfg = resolveFunConfig({
    qmpEnabled: true,
    qmpAutoTriggerChance: 0.02,
    qmpAutoTriggerCooldownMs: 60_000,
    qmpRoundDurationMs: 5 * 60_000,
  });

  const miss = await qmpService.tryAutoTrigger({ scopeKey: scope, funConfig: cfg });
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'no-roll');

  roll = 0.001; // hit
  const hit = await qmpService.tryAutoTrigger({ scopeKey: scope, funConfig: cfg });
  assert.equal(hit.ok, true);
  assert.ok(hit.question?.prompt);

  // cooldown / active
  const again = await qmpService.tryAutoTrigger({ scopeKey: scope, funConfig: cfg });
  assert.equal(again.ok, false);
  assert.ok(['active-exists', 'auto-cooldown'].includes(again.reason));

  // chance zero
  const zero = await qmpService.tryAutoTrigger({
    scopeKey: uniqueGroup(),
    funConfig: { ...cfg, qmpAutoTriggerChance: 0 },
  });
  assert.equal(zero.ok, false);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('handler /qmp: custom + rank + fechar', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const { qmpService } = makeService({ random: () => 0.5 });
  const scope = uniqueGroup();
  const user = uniqueJid('5588');
  const target = uniqueJid('5589');
  const replies = [];
  const cfg = resolveFunConfig({ qmpEnabled: true, qmpCooldownMs: 0, rankCardImage: false });

  const base = {
    userJid: user,
    scopeKey: scope,
    isGroup: true,
    funConfig: cfg,
    qmpService,
    getContactDisplayName: (jid) => String(jid).split('@')[0],
    listContacts: () => [],
    reply: async (t) => {
      replies.push(String(t));
    },
    replyImage: null,
    args: ['chegar', 'atrasado'],
    mentionedJids: [],
    sock: null,
    identityMap: null,
  };

  const r1 = await handleQmpCommand(base);
  assert.equal(r1.handled, true);
  assert.match(replies.at(-1), /Mais Provável|provável|atrasado/i);

  // voto via menção
  replies.length = 0;
  const r2 = await handleQmpCommand({
    ...base,
    args: [],
    mentionedJids: [target],
  });
  assert.equal(r2.handled, true);
  assert.equal(r2.voted, true);
  assert.match(replies.at(-1), /votou/i);

  // rank
  replies.length = 0;
  const r3 = await handleQmpCommand({
    ...base,
    args: ['rank'],
    mentionedJids: [],
  });
  assert.equal(r3.sub, 'rank');
  assert.match(replies.at(-1), /semana|Provável|voto/i);

  // fechar
  replies.length = 0;
  const r4 = await handleQmpCommand({
    ...base,
    args: ['fechar'],
    mentionedJids: [],
  });
  assert.equal(r4.closed, true);
  assert.match(replies.at(-1), /encerrada|Rodada/i);

  // só grupo
  replies.length = 0;
  await handleQmpCommand({ ...base, isGroup: false, args: [] });
  assert.match(replies.at(-1), /grupo/i);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('qmpService: historico com pergunta + ganhador', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const { qmpService } = makeService({ random: () => 0.2 });
  const scope = uniqueGroup();
  const a = uniqueJid('5561');
  const b = uniqueJid('5562');
  const c = uniqueJid('5563');
  const cfg = {
    qmpEnabled: true,
    qmpCooldownMs: 0,
    qmpRoundDurationMs: 60_000,
    qmpHistoryLimit: 5,
    zenEnabled: false,
    ollamaEnabled: false,
  };

  const empty = qmpService.getHistory({ scopeKey: scope, funConfig: cfg });
  assert.equal(empty.ok, true);
  assert.equal(empty.rounds.length, 0);
  assert.match(
    qmpService.formatHistory({ rounds: [], limit: 5, nameOf: (j) => j }),
    /sem rodadas/i
  );

  // rodada 1: B vence
  await qmpService.startRound({
    scopeKey: scope,
    userJid: a,
    customText: 'sumir no final de semana',
    funConfig: cfg,
  });
  qmpService.castVote({ scopeKey: scope, voterJid: a, targetJid: b, funConfig: cfg });
  qmpService.castVote({ scopeKey: scope, voterJid: c, targetJid: b, funConfig: cfg });
  qmpService.closeRound({ scopeKey: scope, funConfig: cfg });

  // rodada 2: sem votos
  await qmpService.startRound({
    scopeKey: scope,
    userJid: a,
    customText: 'inventar desculpa criativa',
    funConfig: cfg,
  });
  qmpService.closeRound({ scopeKey: scope, funConfig: cfg });

  const hist = qmpService.getHistory({ scopeKey: scope, funConfig: cfg });
  assert.equal(hist.rounds.length, 2);
  // mais recente primeiro
  assert.match(hist.rounds[0].question.prompt, /desculpa/i);
  assert.equal(hist.rounds[0].totalVotes, 0);
  assert.equal(hist.rounds[0].winnerJid, '');

  assert.match(hist.rounds[1].question.prompt, /sumir/i);
  assert.equal(hist.rounds[1].winnerJid, b);
  assert.equal(hist.rounds[1].winnerVotes, 2);
  assert.equal(hist.rounds[1].totalVotes, 2);

  const text = qmpService.formatHistory({
    rounds: hist.rounds,
    limit: hist.limit,
    nameOf: (jid) => (jid === b ? 'Beto' : jid.split('@')[0]),
  });
  assert.match(text, /Histórico QMP/i);
  assert.match(text, /desculpa/i);
  assert.match(text, /sumir/i);
  assert.match(text, /Beto/);
  assert.match(text, /sem votos/i);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('handler /qmp historico', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const { qmpService } = makeService({ random: () => 0.5 });
  const scope = uniqueGroup();
  const user = uniqueJid('5564');
  const target = uniqueJid('5565');
  const replies = [];
  const cfg = resolveFunConfig({
    qmpEnabled: true,
    qmpCooldownMs: 0,
    rankCardImage: false,
    qmpHistoryLimit: 8,
  });

  await qmpService.startRound({
    scopeKey: scope,
    userJid: user,
    customText: 'gastar tudo em 24h',
    funConfig: cfg,
  });
  qmpService.castVote({
    scopeKey: scope,
    voterJid: user,
    targetJid: target,
    funConfig: cfg,
  });
  qmpService.closeRound({ scopeKey: scope, funConfig: cfg });

  const r = await handleQmpCommand({
    userJid: user,
    scopeKey: scope,
    isGroup: true,
    funConfig: cfg,
    qmpService,
    getContactDisplayName: (jid) => String(jid).split('@')[0],
    listContacts: () => [],
    reply: async (t) => {
      replies.push(String(t));
    },
    args: ['historico'],
    mentionedJids: [],
  });
  assert.equal(r.sub, 'history');
  assert.equal(r.count, 1);
  assert.match(replies.at(-1), /Histórico|gastar/i);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('qmp: expira rodada e bloqueia voto', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const { qmpService } = makeService();
  const scope = uniqueGroup();
  const a = uniqueJid('5570');
  const b = uniqueJid('5571');
  const now = Date.now();
  // service/config: mínimo 60s de rodada
  const cfg = {
    qmpEnabled: true,
    qmpRoundDurationMs: 60_000,
    qmpCooldownMs: 0,
    zenEnabled: false,
    ollamaEnabled: false,
  };

  const started = await qmpService.startRound({
    scopeKey: scope,
    userJid: a,
    customText: 'testar timeout',
    funConfig: cfg,
    now,
  });
  assert.equal(started.ok, true);
  assert.ok(started.expiresAt <= now + 60_000);

  const stillOpen = qmpService.castVote({
    scopeKey: scope,
    voterJid: a,
    targetJid: b,
    funConfig: cfg,
    now: now + 30_000,
  });
  assert.equal(stillOpen.ok, true);

  const expired = qmpService.castVote({
    scopeKey: scope,
    voterJid: b,
    targetJid: a,
    funConfig: cfg,
    now: now + 120_000,
  });
  assert.equal(expired.ok, false);
  assert.ok(['question-expired', 'no-active'].includes(expired.reason));

  delete process.env.FUN_DISABLE_LIVE_LLM;
});

test('tryPassiveQmpVote: só conta se a mensagem começar com /qmp', async () => {
  process.env.FUN_DISABLE_LIVE_LLM = '1';
  const { qmpService } = makeService({ random: () => 0.99 });
  const scope = uniqueGroup();
  const voter = uniqueJid('5570');
  const target = uniqueJid('5571');
  const cfg = resolveFunConfig({
    qmpEnabled: true,
    qmpCooldownMs: 0,
    qmpRoundDurationMs: 60_000,
  });

  // abre rodada manualmente
  qmpService.startRound({
    scopeKey: scope,
    userJid: voter,
    customText: 'roubar o carregador do amigo',
    source: 'custom',
    funConfig: cfg,
  });

  const replies = [];
  const base = {
    userJid: voter,
    scopeKey: scope,
    isGroup: true,
    funConfig: cfg,
    qmpService,
    getContactDisplayName: (jid) => String(jid).split('@')[0],
    listContacts: () => [],
    reply: async (t) => {
      replies.push(String(t));
    },
    sock: null,
    identityMap: null,
    mentionedJids: [target],
  };

  // 1. Mensagem normal com menção (sem /qmp) — NÃO pode virar voto
  const rNoCmd = await tryPassiveQmpVote({
    ...base,
    text: '@Paulinho leva o Zelda pra dar pra graci',
  });
  assert.equal(rNoCmd.voted, undefined);
  assert.equal(rNoCmd.handled, false);
  assert.equal(replies.length, 0);

  // 2. Mensagem com /qmp + menção — VOTA normalmente
  const rCmd = await tryPassiveQmpVote({
    ...base,
    text: '/qmp @Paulinho',
  });
  assert.equal(rCmd.voted, true);
  assert.equal(rCmd.handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies.at(-1), /votou/i);

  // 3. Alias /maisprovavel + menção — VOTA
  const rAlias = await tryPassiveQmpVote({
    ...base,
    userJid: uniqueJid('5572'),
    text: '/maisprovavel @Paulinho',
  });
  assert.equal(rAlias.voted, true);

  delete process.env.FUN_DISABLE_LIVE_LLM;
});
