import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import { createFunQmpRepository } from '../fun/db/funQmpRepository.js';
import { createNewsService } from '../fun/services/newsService.js';
import { renderEdition } from '../fun/services/news/newsRender.js';
import { buildNewsQmpQuestion, formatNewsQmpAnnouncement } from '../fun/services/news/newsCommentatorService.js';
import { isCommandEnabledForScope } from '../fun/utils/commandGuards.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

const COMMENTATOR = {
  name: 'Fiscal do Rolo',
  title: 'auditor sênior de tretas',
  catchphrase: 'Aqui tem maracutaia, eu sinto o cheiro de longe!',
};

test('news qmp: pergunta determinística usa arquétipo e clima do dia, sem LLM', () => {  const question = buildNewsQmpQuestion(
    COMMENTATOR,
    { mood: 'zoeiro' },
    () => 0
  );
  assert.match(question, /Fiscal do Rolo|auditor sênior de tretas/i);
  assert.match(question, /zoeira de hoje/);
  assert.match(question, /\?$/);

  const fallbackQuestion = buildNewsQmpQuestion({ name: 'Desconhecido', title: 'estagiário' }, {}, () => 0);
  assert.match(fallbackQuestion, /estagiário/);
});

test('news qmp: trigger abre rodada com source=news, guarda rodada ativa e respeita flags', () => {
  const scope = uniqueGroup();
  const qmpRepository = createFunQmpRepository({ getDatabase: getDb });
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);

  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    qmpRepository,
  });

  // Flag da feature desligada
  assert.equal(
    newsService.openCommentatorQmpRound(scope, { funConfig: { groupNewsQmpEnabled: false }, now, commentator: COMMENTATOR }).reason,
    'disabled'
  );
  // QMP global desligado
  assert.equal(
    newsService.openCommentatorQmpRound(scope, { funConfig: { qmpEnabled: false }, now, commentator: COMMENTATOR }).reason,
    'qmp-disabled'
  );
  // Comando qmp desabilitado no grupo (painel)
  assert.equal(
    newsService.openCommentatorQmpRound(scope, {
      funConfig: {},
      now,
      commentator: COMMENTATOR,
      isCommandEnabled: () => false,
    }).reason,
    'qmp-command-disabled'
  );
  // Sem repositório
  const noRepoService = createNewsService({ newsRepository: createFunNewsRepository({ getDatabase: getDb }) });
  assert.equal(
    noRepoService.openCommentatorQmpRound(scope, { funConfig: {}, now, commentator: COMMENTATOR }).reason,
    'no-repository'
  );

  // Abertura normal: cria rodada marcada com source='news'
  const opened = newsService.openCommentatorQmpRound(scope, {
    funConfig: { qmpRoundDurationMs: 10 * 60_000 },
    now,
    commentator: COMMENTATOR,
    conversation: { mood: 'conversado' },
  });
  assert.equal(opened.ok, true);
  assert.match(opened.announcement, /ENQUETE DA REDAÇÃO/);
  assert.match(opened.announcement, /Fiscal do Rolo/);
  assert.equal(qmpRepository.getQuestionById(opened.question.id).source, 'news');

  // Rodada ativa: segunda tentativa no mesmo grupo é bloqueada
  const again = newsService.openCommentatorQmpRound(scope, {
    funConfig: {},
    now: now + 60_000,
    commentator: COMMENTATOR,
  });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'active-exists');
});

test('news qmp: render da linha de veredito e omissão quando não há rodada', () => {
  const conversation = {
    mood: 'conversado',
    timeline: [{ hour: '15:00', messageCount: 5, participants: ['Ana'], sample: [] }],
    quotes: [],
  };

  const withResult = renderEdition(conversation, null, {
    dayLabel: '2026-09-03 · quinta-feira',
    qmpResult: { prompt: 'Quem é mais provável de virar meme?', winner: 'Ana', votes: 3 },
  });
  assert.match(withResult, /📊 \*Enquete da redação\*: Quem é mais provável de virar meme\? — veredito: Ana \(3 votos\)/);

  const oneVote = renderEdition(conversation, null, {
    dayLabel: '2026-09-03 · quinta-feira',
    qmpResult: { prompt: 'Quem dormiu no call?', winner: 'Bia', votes: 1 },
  });
  assert.match(oneVote, /veredito: Bia \(1 voto\)/);

  // Sem resultado → linha omitida
  const withoutResult = renderEdition(conversation, null, { dayLabel: '2026-09-03 · quinta-feira' });
  assert.doesNotMatch(withoutResult, /Enquete da redação/);

  // Prompt longo é truncado
  const truncated = renderEdition(conversation, null, {
    dayLabel: '2026-09-03 · quinta-feira',
    qmpResult: { prompt: 'Q'.repeat(200), winner: 'Ana', votes: 2 },
  });
  assert.ok(truncated.includes('📊'));
  assert.match(truncated, /…/);
});

test('news qmp: resolveNewsQmpResult devolve a última rodada do jornal resolvida em ~36h', async () => {
  const scope = uniqueGroup();
  const qmpRepository = createFunQmpRepository({ getDatabase: getDb });
  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    qmpRepository,
    getContactDisplayName: (jid) => (jid === 'ana@s.whatsapp.net' ? 'Ana' : jid),
  });
  const now = Date.UTC(2026, 8, 3, 23, 59, 30);

  // Sem rodadas → null
  assert.equal(newsService.resolveNewsQmpResult(scope, now), null);

  // Rodada do jornal com votos: criada 23h antes e fechada
  const question = qmpRepository.createQuestion({
    scopeKey: scope,
    prompt: 'Quem é mais provável de virar meme?',
    source: 'news',
    tone: 'normal',
    createdBy: '',
    expiresAt: now - 23 * 60 * 60_000 + 10 * 60_000,
    now: now - 23 * 60 * 60_000,
  });
  qmpRepository.registerVote({
    questionId: question.id,
    scopeKey: scope,
    voterJid: 'bia@s.whatsapp.net',
    targetJid: 'ana@s.whatsapp.net',
    now: now - 23 * 60 * 60_000 + 60_000,
  });
  qmpRepository.closeQuestion(question.id, now - 22 * 60 * 60_000);

  const result = newsService.resolveNewsQmpResult(scope, now);
  assert.ok(result, 'Deveria encontrar a rodada do jornal');
  assert.equal(result.prompt, 'Quem é mais provável de virar meme?');
  assert.equal(result.winner, 'Ana');
  assert.equal(result.votes, 1);

  // Rodada de usuário (source custom) não conta como enquete do jornal
  const userScope = uniqueGroup();
  const userQuestion = qmpRepository.createQuestion({
    scopeKey: userScope,
    prompt: 'Rodada de usuário',
    source: 'custom',
    tone: 'normal',
    createdBy: 'bia@s.whatsapp.net',
    expiresAt: now - 60 * 60_000 + 10 * 60_000,
    now: now - 60 * 60_000,
  });
  qmpRepository.closeQuestion(userQuestion.id, now - 59 * 60 * 60_000);
  qmpRepository.registerVote({
    questionId: userQuestion.id,
    scopeKey: userScope,
    voterJid: 'ana@s.whatsapp.net',
    targetJid: 'bia@s.whatsapp.net',
    now: now - 59 * 60 * 60_000 + 1000,
  });
  assert.equal(newsService.resolveNewsQmpResult(userScope, now), null);

  // Fora da janela de 36h → null
  assert.equal(newsService.resolveNewsQmpResult(scope, now + 40 * 60 * 60_000), null);
});

test('news qmp: integração — composeEdition injeta a linha de enquete na edição publicada', async () => {
  const scope = uniqueGroup();
  const qmpRepository = createFunQmpRepository({ getDatabase: getDb });
  const now = Date.UTC(2026, 8, 3, 23, 59, 30);

  const question = qmpRepository.createQuestion({
    scopeKey: scope,
    prompt: 'Quem é mais provável de sumir do rolê?',
    source: 'news',
    tone: 'normal',
    createdBy: '',
    expiresAt: now - 20 * 60 * 60_000 + 10 * 60_000,
    now: now - 20 * 60 * 60_000,
  });
  qmpRepository.registerVote({
    questionId: question.id,
    scopeKey: scope,
    voterJid: 'bia@s.whatsapp.net',
    targetJid: 'carlos@s.whatsapp.net',
    now: now - 20 * 60 * 60_000 + 60_000,
  });
  qmpRepository.closeQuestion(question.id, now - 19 * 60 * 60_000);

  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    journalMessageRepository: createFunJournalMessageRepository({ getDatabase: getDb }),
    qmpRepository,
    getContactDisplayName: (jid) => ({ carlos: 'Carlos' })[String(jid).split('@')[0]] || jid,
    flavorService: {
      async line() {
        return [
          'CAPA: Enquete domina a redação',
          'INTRO: O grupo discutiu a enquete o dia inteiro.',
          'DETALHES: Ninguém mudou de assunto.',
          'FORESHADOW: Amanhã tem mais.',
        ].join('\n');
      },
      lastProvider: () => 'zen',
    },
  });

  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'q1',
    authorJid: 'carlos@s.whatsapp.net',
    text: 'A enquete de ontem rendeu mais assunto do que o esperado aqui.',
    now: now - 8_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'q2',
    authorJid: 'bia@s.whatsapp.net',
    text: 'Eu voto de novo, só pra ver o Carlos perder a compostura hoje.',
    now: now - 6_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'q3',
    authorJid: 'carlos@s.whatsapp.net',
    text: 'O veredito foi comprado, todo mundo aqui sabe disso muito bem.',
    now: now - 4_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'q4',
    authorJid: 'bia@s.whatsapp.net',
    text: 'Reclamar do resultado da enquete é a tradição mais antiga do grupo.',
    now: now - 2_000,
  });

  const edition = await newsService.composeEdition(scope, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsMaxChars: 2500,
  }, now);

  assert.ok(edition?.text);
  assert.match(edition.text, /Enquete da redação/);
  assert.match(edition.text, /veredito: Carlos \(1 voto\)/);
});

test('news qmp: guarda do comando usa as taxas efetivas (mesma fonte do router)', () => {
  const scope = uniqueGroup();

  // QMP desabilitado GLOBALMENTE via funConfig.disabledCommands (sem repo)
  assert.equal(isCommandEnabledForScope('qmp', null, scope, { disabledCommands: ['qmp'] }), false);

  // Override por grupo via resolveEffectiveRates vence a config global
  assert.equal(
    isCommandEnabledForScope('qmp', { resolveEffectiveRates: () => ({ disabledCommands: ['qmp'] }) }, scope, {}),
    false
  );
  assert.equal(
    isCommandEnabledForScope('qmp', { resolveEffectiveRates: () => ({ disabledCommands: ['qmp'] }) }, scope, { disabledCommands: [] }),
    false
  );

  // Grupo liberado → comando ligado
  assert.equal(
    isCommandEnabledForScope('qmp', { resolveEffectiveRates: () => ({ disabledCommands: [] }) }, scope, { disabledCommands: ['qmp'] }),
    true
  );
  // Sem repo e sem config → ligado
  assert.equal(isCommandEnabledForScope('qmp', null, scope, {}), true);
  // resolveEffectiveRates lançando: cai no fallback da config sem derrubar o trigger
  assert.equal(
    isCommandEnabledForScope('qmp', { resolveEffectiveRates: () => { throw new Error('db down'); } }, scope, { disabledCommands: ['qmp'] }),
    false
  );

  // Integração: com o comando globalmente desabilitado, a rodada do jornal não abre
  const qmpRepository = createFunQmpRepository({ getDatabase: getDb });
  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    qmpRepository,
  });
  const result = newsService.openCommentatorQmpRound(scope, {
    funConfig: {},
    now: Date.UTC(2026, 8, 2, 23, 59, 30),
    commentator: COMMENTATOR,
    isCommandEnabled: () => isCommandEnabledForScope('qmp', null, scope, { disabledCommands: ['qmp'] }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'qmp-command-disabled');
  assert.equal(qmpRepository.listRecentRounds(scope, 10).length, 0, 'nenhuma rodada criada com comando desabilitado');
});
