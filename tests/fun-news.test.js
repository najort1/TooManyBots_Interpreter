import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import { createFunSnapshotRepository } from '../fun/db/funSnapshotRepository.js';
import { createNewsService, isGroupNewsWindow } from '../fun/services/newsService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('news: isGroupNewsWindow 23:59 e 00:02', () => {
  const cfg = { worldTimezone: 'America/Sao_Paulo', groupNewsHour: 23, groupNewsMinute: 59 };
  assert.equal(typeof isGroupNewsWindow(Date.now(), cfg), 'boolean');
});

test('news: publica conversa do grupo, não placar de eventos, e deduplica', async () => {
  const scope = uniqueGroup();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  const snapshotRepository = createFunSnapshotRepository({ getDatabase: getDb });
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);

  journalMessageRepository.recordMessage({ scopeKey: scope, messageId: 'one', authorJid: 'ana@s.whatsapp.net', text: 'A fofoca do churrasco começou cedo.', now: now - 10_000 });
  journalMessageRepository.recordMessage({ scopeKey: scope, messageId: 'two', authorJid: 'bia@s.whatsapp.net', text: 'Eu avisei que isso ia render.', now: now - 5_000 });
  journalMessageRepository.recordMessage({ scopeKey: scope, messageId: 'three', authorJid: 'ana@s.whatsapp.net', text: 'A pauta continuou e ninguém conseguiu mudar de assunto.', now: now - 2_000 });
  journalMessageRepository.recordMessage({ scopeKey: scope, messageId: 'four', authorJid: 'bia@s.whatsapp.net', text: 'A churrasqueira segue oficialmente sob investigação.', now: now - 1_000 });

  const newsService = createNewsService({
    newsRepository,
    journalMessageRepository,
    snapshotRepository,
    flavorService: {
      async line() {
        return [
          'CAPA: Churrasco rende temporada extra',
          'MANCHETES: A pauta do churrasco dominou a tarde.',
          'DETALHES: Ana abriu os trabalhos e Bia confirmou que a história ainda tinha capítulos.',
          'CITACOES: Bia: “Eu avisei que isso ia render.”',
          'FECHO: A churrasqueira segue sob investigação.',
        ].join('\n');
      },
      lastProvider: () => 'zen',
    },
    getContactDisplayName: (jid) => ({ 'ana@s.whatsapp.net': 'Ana', 'bia@s.whatsapp.net': 'Bia' })[jid],
  });

  const published = await newsService.tryPublish(scope, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
  }, now);

  assert.equal(published.ok, true);
  assert.equal(published.provider, 'llm-enhanced');
  assert.equal(published.messageCount, 4);
  assert.match(published.text, /Churrasco rende temporada extra/);
  assert.match(published.text, /A churrasqueira segue oficialmente sob investigação/);
  assert.doesNotMatch(published.text, /RANKINGS|coins|cassino|ECONOMIA/i);
  assert.deepEqual(Object.keys(snapshotRepository.getSnapshot(scope, published.newsDay).payload).sort(), ['mood', 'participantCount', 'timeline', 'totalMessageCount']);

  const again = await newsService.tryPublish(scope, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
  }, now + 15_000);
  assert.equal(again.reason, 'already-today');
});

test('news: parseConversationEdition tolera Markdown em rotulos e strip de nomes nao quebra com safeLines', async () => {
  const { parseConversationEdition } = await import('../fun/services/news/newsLlm.js');

  const conversation = {
    messages: [
      { name: 'Lucas', authorJid: 'lucas@s.whatsapp.net' },
      { name: 'Eduardo', authorJid: 'eduardo@s.whatsapp.net' },
    ],
    quotes: [
      { name: 'Lucas', text: 'Você consegue automodificar seus arquivos?' },
    ],
  };

  // Texto com **CAPA:**, **MANCHETES:**, etc. e com atribuição de nome não suportado (ex: "Desconhecido disse...")
  const rawLlmText = [
    '**CAPA:** O grupo discutiu autoconsciência de bots',
    '**MANCHETES:**',
    '• Lucas levantou a questão sobre IA autoconsciente.',
    '• Desconhecido disse que a resposta era complicada.',
    '**DETALHES:**',
    'Eduardo falou que o bot estava estranho.',
    'Alguemfalou respondeu no final.',
    '**CITAÇÕES:**',
    'Lucas: “Você consegue automodificar seus arquivos?”',
    '**FECHO:**',
    'Amanhã saberemos se o bot aprendeu a pensar.',
  ].join('\n');

  const edition = parseConversationEdition(rawLlmText, conversation);
  assert.ok(edition, 'Deveria fazer o parse com sucesso mesmo com Markdown nos rótulos e atribuições não suportadas');
  assert.match(edition.capa, /O grupo discutiu autoconsciência de bots/);
  assert.match(edition.manchetes, /Lucas levantou a questão/);
  // Garante que stripUnsupportedParticipantAttributions rodou sem lançar ReferenceError
  assert.doesNotMatch(edition.manchetes, /Desconhecido disse/);
});

test('news: extrai mencoes das citacoes e do texto corretamente (incluindo LIDs)', async () => {
  const { extractEditionMentions } = await import('../fun/services/newsService.js');

  const text = [
    '📰 *THE GROUP TIMES*',
    '2026-09-03 · quinta-feira',
    '',
    '*Grupo discute carinha de punheteiro e emprego bugado de bombeiro*',
    '',
    '*FRASES PARA O ARQUIVO*',
    '• Eduardo: “@174994885714120 mo carinha de punheteiro né?”',
    '• Lucas: “@5511999998888 blablabla”',
  ].join('\n');

  const quotes = [
    {
      name: 'Eduardo',
      text: '@174994885714120 mo carinha de punheteiro né?',
      mentionedJids: ['174994885714120@lid'],
    },
  ];

  const mentions = extractEditionMentions(text, quotes);
  assert.ok(Array.isArray(mentions));
  assert.ok(mentions.includes('174994885714120@lid'), 'Deveria conter o LID mencionado');
  assert.ok(mentions.includes('5511999998888@s.whatsapp.net'), 'Deveria conter o PN mencionado');
});

test('news: fora da janela não publica', async () => {
  const newsService = createNewsService({ newsRepository: createFunNewsRepository({ getDatabase: getDb }) });
  const result = await newsService.tryPublish(uniqueGroup(), {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
  }, Date.UTC(2026, 8, 2, 12, 0, 0));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-window');
});
