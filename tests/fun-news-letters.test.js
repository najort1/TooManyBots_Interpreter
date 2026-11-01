import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import { createFunSnapshotRepository } from '../fun/db/funSnapshotRepository.js';
import { createFunNewsLettersRepository } from '../fun/db/funNewsLettersRepository.js';
import { createNewsService } from '../fun/services/newsService.js';
import { renderEdition } from '../fun/services/news/newsRender.js';
import { handleCartaCommand } from '../fun/commands/handlers/letter.js';
import { parseFunCommand } from '../fun/commands/router.js';
import { FUN_COMMANDS, FUN_COMMAND_ALIASES } from '../fun/constants.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

function createNewsHarness({ lettersRepository = createFunNewsLettersRepository({ getDatabase: getDb }) } = {}) {
  return createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    lettersRepository,
    getContactDisplayName: (jid) =>
      ({ ana: 'Ana Souza', bia: 'Bia Souza' })[String(jid).split('@')[0]] || jid,
  });
}

async function sendCarta(newsService, scope, args, { now = Date.now(), funConfig = { worldTimezone: 'UTC' } } = {}) {
  const replies = [];
  const result = await handleCartaCommand({
    scopeKey: scope,
    isGroup: scope.endsWith('@g.us'),
    userJid: 'ana@s.whatsapp.net',
    args,
    reply: async (text) => replies.push(text),
    newsService,
    funConfig,
    msgTimeMs: now,
  });
  return { replies, result };
}

test('carta: /carta é o comando do correio (alias registrado nos 4 pontos)', () => {
  assert.equal(FUN_COMMANDS.CARTA, 'carta');
  assert.equal(FUN_COMMAND_ALIASES.carta, FUN_COMMANDS.CARTA);
  const parsed = parseFunCommand('/carta o editorial de ontem foi covardia', '/');
  assert.equal(parsed.command, FUN_COMMANDS.CARTA);
  assert.deepEqual(parsed.args, ['o', 'editorial', 'de', 'ontem', 'foi', 'covardia']);
  // A forma completa das cartas colecionáveis continua intacta
  assert.equal(parseFunCommand('/cartas', '/').command, FUN_COMMANDS.CARTAS);
});

test('carta: valida grupo, texto vazio, teto de 300 chars e filtro sensível', async () => {
  const newsService = createNewsHarness();
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 2, 15, 0, 0);

  // DM não aceita carta
  const dm = await sendCarta(newsService, 'ana@s.whatsapp.net', ['oi'], { now });
  assert.equal(dm.result.reason, 'not-group');

  // Texto vazio pede uso
  const empty = await sendCarta(newsService, scope, [], { now });
  assert.equal(empty.result.reason, 'empty-text');
  assert.match(empty.replies[0], /Escreve a carta/);

  // Acima de 300 chars é recusado com deboche
  const long = await sendCarta(newsService, scope, ['a'.repeat(301)], { now });
  assert.equal(long.result.reason, 'too-long');
  assert.match(long.replies[0], /romance/);

  // Exatamente 300 chars passa
  const exact = await sendCarta(newsService, scope, ['b'.repeat(300)], { now });
  assert.ok(exact.result.letterId, 'carta no teto deveria ser aceita');
  assert.match(exact.replies[0], /Sua carta foi enviada/);

  // Dado sensível (CPF) é retido pelo filtro do jornal
  const later = now + 11 * 60 * 1000;
  const sensitive = await sendCarta(newsService, scope, ['meu CPF é 123.456.789-00 confia'], { now: later });
  assert.equal(sensitive.result.reason, 'sensitive');
  assert.match(sensitive.replies[0], /segurança/);
});

test('carta: rate-limit — intervalo mínimo de ~10 min e máximo de 3 cartas/dia', async () => {
  const newsService = createNewsHarness();
  const scope = uniqueGroup();
  const base = Date.UTC(2026, 8, 2, 12, 0, 0);

  const first = await sendCarta(newsService, scope, ['primeira carta da manhã, sem pressa alguma'], { now: base });
  assert.ok(first.result.letterId, 'primeira carta deveria entrar');

  // 5 minutos depois: cooldown
  const tooSoon = await sendCarta(newsService, scope, ['segunda carta antes da hora'], { now: base + 5 * 60 * 1000 });
  assert.equal(tooSoon.result.reason, 'cooldown');
  assert.match(tooSoon.replies[0], /10 minutos/);

  // 11 minutos depois: entra (2/3)
  const second = await sendCarta(newsService, scope, ['segunda carta agora dentro do prazo'], { now: base + 11 * 60 * 1000 });
  assert.ok(second.result.letterId, 'segunda carta (após cooldown) deveria entrar');

  // terceira carta do dia: entra (3/3)
  const third = await sendCarta(newsService, scope, ['terceira carta pra esgotar a cota diária'], {
    now: base + 22 * 60 * 1000,
  });
  assert.ok(third.result.letterId, 'terceira carta deveria entrar');

  // quarta carta do dia: cota esgotada mesmo fora do cooldown
  const fourth = await sendCarta(newsService, scope, ['quarta carta que não deveria passar de jeito nenhum'], {
    now: base + 33 * 60 * 1000,
  });
  assert.equal(fourth.result.reason, 'daily-limit');
  assert.match(fourth.replies[0], /Cota diária/);

  // Outro autor não é afetado pela cota do primeiro
  const otherReplies = [];
  const other = await handleCartaCommand({
    scopeKey: scope,
    isGroup: true,
    userJid: 'bia@s.whatsapp.net',
    args: ['carta de outro leitor, tranquila'],
    reply: async (text) => otherReplies.push(text),
    newsService,
    funConfig: { worldTimezone: 'UTC' },
    msgTimeMs: base + 33 * 60 * 1000,
  });
  assert.ok(other.letterId, 'outro autor não deve ser afetado pela cota do primeiro');
});

test('carta: render da seção CARTAS DOS LEITORES — presente, truncada, máximo de 3 e omissão', () => {
  const conversation = {
    mood: 'conversado',
    timeline: [{ hour: '15:00', messageCount: 5, participants: ['Ana'], sample: [] }],
    quotes: [],
  };
  const options = { dayLabel: '2026-09-02 · quarta-feira' };

  // Sem cartas → seção omitida
  const without = renderEdition(conversation, null, options);
  assert.doesNotMatch(without, /CARTAS DOS LEITORES/);

  // Com cartas → seção determinística com nome + texto
  const withLetters = renderEdition(conversation, null, {
    ...options,
    letters: [
      { name: 'Ana Souza', text: 'O editorial de ontem foi uma covardia com o Carlão.' },
      { name: 'Bia Souza', text: 'Quero reivindicar minha vaga no quadro de frases.' },
    ],
  });
  assert.match(withLetters, /\*📬 CARTAS DOS LEITORES\*/);
  assert.match(withLetters, /“O editorial de ontem foi uma covardia com o Carlão\.” — Ana Souza/);
  assert.match(withLetters, /— Bia Souza/);

  // Texto longo é truncado em ~140 chars
  const truncated = renderEdition(conversation, null, {
    ...options,
    letters: [{ name: 'Ana', text: 'x'.repeat(200) }],
  });
  assert.match(truncated, /…/);
  assert.ok(truncated.includes(`“${'x'.repeat(139)}…”`));

  // Máximo de 3 cartas por edição
  const capped = renderEdition(conversation, null, {
    ...options,
    letters: [1, 2, 3, 4].map((n) => ({ name: `Leitor ${n}`, text: `carta número ${n} da fila` })),
  });
  assert.ok(!capped.includes('carta número 4'));
  assert.match(capped, /carta número 3 da fila/);

  // Cartas vazias são ignoradas
  const allEmpty = renderEdition(conversation, null, {
    ...options,
    letters: [{ name: 'Ana', text: '   ' }],
  });
  assert.doesNotMatch(allEmpty, /CARTAS DOS LEITORES/);
});

test('carta: cascata de budget — cartas e enquete não furam o teto da edição', () => {
  const conversation = {
    mood: 'conversado',
    timeline: [{ hour: '15:00', messageCount: 5, participants: ['Ana'], sample: [] }],
    quotes: [],
  };
  const llmBits = {
    capa: 'Editorial curto',
    intro: 'Intro enxuta de duas linhas no máximo.',
    detalhes: 'Detalhes curtos que não dão margem pra corte.',
    foreshadow: 'Fecho curto.',
  };
  const letters = [1, 2, 3].map((n) => ({
    name: `Leitor ${n}`,
    text: `Carta número ${n} com um textinho razoavelmente comprido pra somar bytes no budget da edição de hoje mesmo.`.repeat(2),
  }));
  const qmpResult = { prompt: 'Quem é mais provável de virar meme amanhã depois do tumulto?', winner: 'Ana', votes: 4 };

  const maxChars = 700;
  const text = renderEdition(conversation, llmBits, {
    dayLabel: '2026-09-02 · quarta-feira',
    maxChars,
    letters,
    qmpResult,
  });

  assert.ok(text.length <= maxChars, `edição deve respeitar o teto: ${text.length} > ${maxChars}`);
  // Detalhes curtos não dão margem: a cascata solta cartas (da última pra
  // primeira) até caber, preservando a enquete e a seção com o que couber.
  assert.match(text, /Enquete da redação/, 'enquete deve sobreviver ao corte de cartas');
  assert.ok(!text.includes('Leitor 3'), 'última carta é a primeira a ceder');
  assert.match(text, /Leitor 1/, 'seção permanece com as cartas que couberam');
  assert.match(text, /Editorial curto/, 'miolo da edição permanece');
});

test('carta: teto DURO — todas as seções cheias nos tetos do parser respeitam groupNewsMaxChars', () => {
  const conversation = {
    mood: 'conversado',
    timeline: [{ hour: '15:00', messageCount: 5, participants: ['Ana'], sample: [] }],
    quotes: [],
  };
  // Tetos reais do parseConversationEdition: capa 160, intro 650,
  // comentarista 500, detalhes 800, fecho 250 — mais 3 quotes de 220,
  // 3 cartas e a enquete. Nada de mock curto: é isso que mascarava o estouro.
  const fill = (char, len) => char.repeat(len);
  const llmBits = {
    capa: fill('a', 160),
    intro: fill('b', 650),
    comentarista: fill('c', 500),
    detalhes: fill('d', 800),
    foreshadow: fill('e', 250),
    citacoes: [
      `Leitor 1: “${fill('f', 220)}”`,
      `Leitor 2: “${fill('g', 220)}”`,
      `Leitor 3: “${fill('h', 220)}”`,
    ].join('\n'),
  };
  const letters = [1, 2, 3].map((n) => ({
    name: `Leitor de cartas ${n}`,
    text: fill('x', 140),
  }));
  const qmpResult = {
    prompt: fill('q', 140),
    winner: 'Ana Souza',
    votes: 7,
  };

  const maxChars = 2500;
  const text = renderEdition(conversation, llmBits, {
    dayLabel: '2026-09-02 · quarta-feira',
    maxChars,
    letters,
    qmpResult,
  });

  assert.ok(text.length <= maxChars, `teto duro violado: ${text.length} > ${maxChars}`);
  assert.ok(text.length > 2000, 'edição truncada ainda carrega o conteúdo principal');
  assert.match(text, /…$/, 'corte elegante fecha com reticências quando trunca');
  assert.match(text, /THE GROUP TIMES/, 'cabeçalho da edição permanece');
});

test('carta: edição silenciosa (quiet) também publica as cartas dos leitores', () => {
  const conversation = { mood: 'silencioso', quiet: true, timeline: [], quotes: [] };
  const withLetters = renderEdition(conversation, null, {
    dayLabel: '2026-09-02 · quarta-feira',
    maxChars: 2500,
    letters: [{ name: 'Ana Souza', text: 'Até no silêncio eu mando minha carta pra redação.' }],
  });
  assert.match(withLetters, /Plantão do Silêncio/);
  assert.match(withLetters, /\*📬 CARTAS DOS LEITORES\*/);
  assert.match(withLetters, /Até no silêncio eu mando minha carta pra redação\./);

  // Sem cartas, a edição silenciosa segue como antes
  const without = renderEdition(conversation, null, { dayLabel: '2026-09-02 · quarta-feira', maxChars: 2500 });
  assert.doesNotMatch(without, /CARTAS DOS LEITORES/);

  // Budget apertado: cartas entram só enquanto couberem
  const tight = renderEdition(conversation, null, {
    dayLabel: '2026-09-02 · quarta-feira',
    maxChars: 560,
    letters: [1, 2, 3].map((n) => ({ name: `Leitor ${n}`, text: `Carta ${n} um pouco maior que o espaço que sobrou no Plantão do Silêncio de hoje.` })),
  });
  assert.ok(tight.length <= 560, `edição silenciosa deve respeitar o teto: ${tight.length} > 560`);
  assert.match(tight, /CARTAS DOS LEITORES/);

  // Teto DURO vale também no caminho quiet (sondagem do revisor: 400 → 453)
  const hardQuiet = renderEdition(conversation, null, {
    dayLabel: '2026-09-02 · quarta-feira',
    maxChars: 400,
    letters: [{ name: 'Ana Souza', text: 'Até no silêncio eu mando minha carta pra redação.' }],
  });
  assert.ok(hardQuiet.length <= 400, `quiet deve respeitar o teto duro: ${hardQuiet.length} > 400`);
});

test('carta: caminho de despedidas também respeita o teto duro do render', () => {
  const farewellConversation = {
    mood: 'conversado',
    timeline: [],
    quotes: [],
    society: {
      despedidas: 5,
      topFarewellUsers: [{ jid: '5511999990001@s.whatsapp.net' }],
    },
  };

  const normal = renderEdition(farewellConversation, null, { dayLabel: '2026-09-02 · quarta-feira' });
  assert.match(normal, /Cerimônia de Despedidas/);

  // Teto duro no retorno antecipado das despedidas (sondagem do revisor: 100 → 299)
  const capped = renderEdition(farewellConversation, null, { dayLabel: '2026-09-02 · quarta-feira', maxChars: 100 });
  assert.ok(capped.length <= 100, `despedidas deve respeitar o teto duro: ${capped.length} > 100`);
  assert.match(capped, /…$/, 'corte elegante fecha com reticências quando trunca');
});

test('carta: integração — composeEdition imprime as cartas do dia e commitEdition faz o prune (pós-post)', async () => {
  const scope = uniqueGroup();
  const lettersRepository = createFunNewsLettersRepository({ getDatabase: getDb });
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  const snapshotRepository = createFunSnapshotRepository({ getDatabase: getDb });
  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    journalMessageRepository,
    snapshotRepository,
    lettersRepository,
    getContactDisplayName: (jid) => ({ ana: 'Ana', bia: 'Bia' })[String(jid).split('@')[0]] || jid,
  });
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);

  // Cartas registradas durante o dia do jornal (dia 2026-09-02 em UTC)
  const l1 = newsService.recordLetter(scope, {
    authorJid: 'ana@s.whatsapp.net',
    text: 'O editorial de ontem foi covardia, quero retratação hoje.',
    now: now - 8 * 60 * 60_000,
    funConfig: { worldTimezone: 'UTC' },
  });
  const l2 = newsService.recordLetter(scope, {
    authorJid: 'bia@s.whatsapp.net',
    text: 'Sugiro pauta sobre o sumiço do bolo da festa.',
    now: now - 6 * 60 * 60_000,
    funConfig: { worldTimezone: 'UTC' },
  });
  assert.equal(l1.ok, true);
  assert.equal(l2.ok, true);

  // Carta de 5 dias atrás: deve sumir no prune do publish
  lettersRepository.recordLetter({
    scopeKey: scope,
    authorJid: 'ana@s.whatsapp.net',
    text: 'Carta arqueológica que deve ser podada.',
    dayKey: '2026-08-28',
    now: now - 5 * 24 * 60 * 60_000,
  });

  // Conversa mínima pro jornal não cair no modo silencioso (quiet exige < 4 mensagens)
  const chat = [
    { id: 'm1', author: 'ana@s.whatsapp.net', text: 'A redação deveria publicar as cartas dos leitores de verdade.' },
    { id: 'm2', author: 'bia@s.whatsapp.net', text: 'Apoiado, minha carta já está na fila faz tempo aqui!' },
    { id: 'm3', author: 'ana@s.whatsapp.net', text: 'O bolo sumiu e ninguém assumiu até agora, tudo ver.' },
    { id: 'm4', author: 'bia@s.whatsapp.net', text: 'Se o jornal publicar minha carta eu prometo assinar a próxima edição.' },
  ];
  chat.forEach((m, i) => {
    journalMessageRepository.recordMessage({
      scopeKey: scope,
      messageId: m.id,
      authorJid: m.author,
      text: m.text,
      now: now - (5 - i) * 1000,
    });
  });

  const published = await newsService.tryPublish(scope, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
    groupNewsMaxChars: 2500,
  }, now);
  assert.equal(published.ok, true);
  assert.match(published.text, /\*📬 CARTAS DOS LEITORES\*/);
  assert.match(published.text, /— Ana/);
  assert.match(published.text, /Sugiro pauta sobre o sumiço do bolo da festa\./);

  // Prune/snapshot são efeitos de commit (pós-post)
  const commitResult = newsService.commitEdition(scope, published, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
    groupNewsMaxChars: 2500,
  });
  assert.equal(commitResult.ok, true);

  // Texto da carta NUNCA entra no snapshot (política do jornal)
  const snap = snapshotRepository.getSnapshot(scope, published.newsDay);
  assert.ok(!JSON.stringify(snap.payload).includes('retratação'));

  // Prune: carta de 5 dias atrás foi removida; as do dia ficam
  assert.equal(lettersRepository.listLettersForDay(scope, { dayKey: '2026-08-28' }).length, 0);
  assert.equal(lettersRepository.listLettersForDay(scope, { dayKey: published.newsDay }).length, 2);

  // Facade de listagem respeita o limite da seção (3)
  assert.equal(newsService.listLettersForDay(scope, { dayKey: published.newsDay, limit: 3 }).length, 2);
});
