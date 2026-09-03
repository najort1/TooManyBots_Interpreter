import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import {
  collectDayConversation,
  conversationToSnapshotPayload,
} from '../fun/services/news/newsFacts.js';
import { parseConversationEdition } from '../fun/services/news/newsLlm.js';
import { renderEdition } from '../fun/services/news/newsRender.js';

await initDb();

function scope(suffix) {
  return `120363journal${suffix}@g.us`;
}

const base = Date.UTC(2026, 8, 2, 12, 0, 0);

test('journal messages: persiste, ordena, isola grupo e deduplica message id', () => {
  const repository = createFunJournalMessageRepository({ getDatabase: getDb });
  const one = scope('one');
  const two = scope('two');

  assert.equal(repository.recordMessage({ scopeKey: one, messageId: 'b', authorJid: 'bia@s.whatsapp.net', text: 'A fofoca começou antes do almoço.', now: base + 2_000 }).ok, true);
  assert.equal(repository.recordMessage({ scopeKey: one, messageId: 'a', authorJid: 'ana@s.whatsapp.net', text: 'Eu não vim aqui para ser julgada.', now: base + 1_000 }).ok, true);
  assert.equal(repository.recordMessage({ scopeKey: one, messageId: 'a', authorJid: 'ana@s.whatsapp.net', text: 'duplicada', now: base + 3_000 }).reason, 'duplicate');
  assert.equal(repository.recordMessage({ scopeKey: two, messageId: 'a', authorJid: 'caio@s.whatsapp.net', text: 'Esse grupo não pode aparecer no outro jornal.', now: base }).ok, true);

  const rows = repository.listBetween(one, { since: base - 1, until: base + 10_000 });
  assert.deepEqual(rows.map((row) => row.messageId), ['a', 'b']);
  assert.equal(rows.some((row) => row.scopeKey === two), false);
});

test('journal messages: rejeita comando e dados sensíveis', () => {
  const repository = createFunJournalMessageRepository({ getDatabase: getDb });
  const group = scope('filter');

  assert.equal(repository.recordMessage({ scopeKey: group, messageId: 'cmd', authorJid: 'ana@s.whatsapp.net', text: '/saldo', now: base }).reason, 'command');
  assert.equal(repository.recordMessage({ scopeKey: group, messageId: 'cpf', authorJid: 'ana@s.whatsapp.net', text: 'Meu CPF é 123.456.789-10', now: base }).reason, 'sensitive');
  assert.equal(repository.recordMessage({ scopeKey: group, messageId: 'token', authorJid: 'ana@s.whatsapp.net', text: 'api_key: segredo', now: base }).reason, 'sensitive');
  assert.equal(repository.listBetween(group, { since: 0 }).length, 0);
});

test('journal conversation: cobre início e fim do dia sem incluir outro grupo', () => {
  const repository = createFunJournalMessageRepository({ getDatabase: getDb });
  const group = scope('coverage');
  const other = scope('coverage-other');
  for (let index = 0; index < 100; index += 1) {
    repository.recordMessage({
      scopeKey: group,
      messageId: `m-${index}`,
      authorJid: `user${index % 4}@s.whatsapp.net`,
      text: index === 0 ? 'Começou a discussão sobre o churrasco.' : index === 99 ? 'No fim, decidiram que o churrasco continua em aberto.' : `mensagem ${index} com contexto suficiente`,
      now: base + index * 60_000,
    });
  }
  repository.recordMessage({ scopeKey: other, messageId: 'other', authorJid: 'other@s.whatsapp.net', text: 'vazamento proibido', now: base });

  const conversation = collectDayConversation({
    scopeKey: group,
    now: base + 6 * 60 * 60_000,
    timeZone: 'UTC',
    deps: { journalMessageRepository: repository },
    readLimit: 120,
    conversationMaxChars: 50_000,
    getContactDisplayName: (jid) => ({ 'user0@s.whatsapp.net': 'Ana', 'user1@s.whatsapp.net': 'Bia', 'user2@s.whatsapp.net': 'Caio', 'user3@s.whatsapp.net': 'Duda' })[jid] || 'Outro',
  });

  assert.equal(conversation.totalMessageCount, 100);
  assert.match(conversation.conversation, /Começou a discussão/);
  assert.match(conversation.conversation, /No fim, decidiram/);
  assert.doesNotMatch(conversation.conversation, /vazamento proibido/);
  assert.deepEqual(Object.keys(conversationToSnapshotPayload(conversation)).sort(), ['mood', 'participantCount', 'timeline', 'totalMessageCount']);
});

test('journal edition: só aceita citações literais autorizadas e fallback não mostra métricas do bot', () => {
  const conversation = {
    quiet: false,
    mood: 'conversado',
    totalMessageCount: 8,
    participantCount: 2,
    messages: [{ name: 'Ana' }, { name: 'Bia' }],
    quotes: [{ name: 'Ana', text: 'Eu avisei que isso ia render.', messageId: '1' }],
    timeline: [{ hour: '12:00–13:00', messageCount: 8, participants: ['Ana', 'Bia'], sample: [{ name: 'Ana', text: 'Eu avisei que isso ia render.' }] }],
  };
  const parsed = parseConversationEdition([
    'CAPA: A pauta pegou fogo',
    'MANCHETES: O churrasco ganhou mais uma temporada.',
    'DETALHES: Ana voltou ao assunto e a conversa andou.',
    'CITACOES: Ana: “Eu avisei que isso ia render.”\nBia: “fala inventada”',
    'FECHO: A redação vai dormir de olho aberto.',
  ].join('\n'), conversation);

  assert.match(parsed.citacoes, /Eu avisei/);
  assert.doesNotMatch(parsed.citacoes, /inventada/);
  const output = renderEdition(conversation, null, { dayLabel: '2026-09-02' });
  assert.match(output, /MANCHETES/);
  assert.match(output, /FRASES PARA O ARQUIVO/);
  assert.doesNotMatch(output, /RANKINGS|coins|cassino|ECONOMIA/i);
});

test('journal edition: dia quieto publica edição mínima honesta', () => {
  const output = renderEdition({ quiet: true }, null, { dayLabel: '2026-09-02' });
  assert.match(output, /Plantão do silêncio/);
  assert.match(output, /ninguém tinha fofoca suficiente/i);
});
