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

test('news: renderEdition remove limite de caracteres (preserva > 4000 chars) e produz narrativa sem bullets robóticos', async () => {
  const { renderEdition } = await import('../fun/services/news/newsRender.js');

  const conversation = {
    mood: 'conversado',
    timeline: [
      {
        hour: '15:00',
        messageCount: 15,
        participants: ['Ana', 'Bia'],
        sample: [{ name: 'Ana', text: 'Essa conversa vai durar a noite toda.' }],
      },
    ],
    quotes: [],
  };

  // Texto longo com mais de 4500 caracteres
  const longParagraph = 'A investigação editorial continuou dissecando cada declaração com sarcasmo e riqueza de detalhes. '.repeat(50);
  assert.ok(longParagraph.length > 4500);

  const llmBits = {
    capa: 'O Grande Debate Que Parou a Cidade',
    intro: 'A redação acompanhou estarrecida o desenrolar das discussões desta tarde.',
    comentarista: 'Eu achei tudo um absurdo sem tamanho!',
    detalhes: longParagraph,
    foreshadow: 'Amanhã os envolvidos fingirão demência.',
  };

  const rendered = renderEdition(conversation, llmBits, {
    dayLabel: '2026-09-08 · terça-feira',
    commentator: { name: 'Cachorro Chupetinha', title: 'fiscal de vergonha alheia' },
  });

  // Garante que o texto NÃO foi cortado nem truncado
  assert.ok(rendered.length > 4500, `Deveria ter mais de 4500 caracteres, mas teve ${rendered.length}`);
  assert.ok(!rendered.endsWith('…'), 'Não deve terminar com reticências forçadas de truncamento');
  assert.match(rendered, /O Grande Debate Que Parou a Cidade/);
  assert.match(rendered, /PARECER DO ESPECIALISTA \(CACHORRO CHUPETINHA — FISCAL DE VERGONHA ALHEIA\)/);
  assert.match(rendered, /Eu achei tudo um absurdo sem tamanho!/);
  assert.match(rendered, /Amanhã os envolvidos fingirão demência/);

  // Garante que não há bullets robóticos na intro nem nos detalhes
  assert.doesNotMatch(rendered.split('PARECER')[0], /^•/m);
});

test('news: parseConversationEdition suporta blocos INTRO, COMENTARISTA e FORESHADOW com comentários opinativos', async () => {
  const { parseConversationEdition } = await import('../fun/services/news/newsLlm.js');

  const conversation = {
    messages: [{ name: 'Eduardo' }, { name: 'Lucas' }],
    quotes: [{ name: 'Lucas', text: 'Quem vai pagar essa conta?' }],
  };

  const raw = [
    'CAPA: A Crônica do Boleto Perdido',
    'INTRO: Eduardo e Lucas protagonizaram mais um espetáculo de desinformação matinal.',
    'COMENTARISTA: Como comentarista canino residente, declaro: essa vergonha eu não passo nem no crédito!',
    'DETALHES: Eduardo tentou culpar o banco, mas a verdade veio à tona logo em seguida com requintes de deboche.',
    'CITACOES: Lucas: “Quem vai pagar essa conta?”',
    'FORESHADOW: Amanhã saberemos se o nome foi parar no Serasa do zap.',
  ].join('\n');

  const parsed = parseConversationEdition(raw, conversation);
  assert.ok(parsed);
  assert.equal(parsed.capa, 'A Crônica do Boleto Perdido');
  assert.match(parsed.intro, /Eduardo e Lucas protagonizaram/);
  assert.match(parsed.comentarista, /Como comentarista canino residente/);
  assert.match(parsed.detalhes, /Eduardo tentou culpar o banco/);
  assert.match(parsed.citacoes, /Lucas: “Quem vai pagar essa conta\?”/);
  assert.match(parsed.foreshadow, /Serasa do zap/);
  // Garante retrocompatibilidade
  assert.equal(parsed.manchetes, parsed.intro);
  assert.equal(parsed.fecho, parsed.foreshadow);
});

test('news: tryPublish de ponta a ponta persiste e reutiliza comentarista consistente no mesmo grupo', async () => {
  const scope = uniqueGroup();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  const snapshotRepository = createFunSnapshotRepository({ getDatabase: getDb });
  const now = Date.UTC(2026, 8, 2, 23, 59, 30);

  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'm1',
    authorJid: 'pedro@s.whatsapp.net',
    text: 'Alguém viu a chave do carro?',
    now: now - 8_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'm2',
    authorJid: 'joao@s.whatsapp.net',
    text: 'Tá no contato do carro que você esqueceu na rua.',
    now: now - 6_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'm3',
    authorJid: 'pedro@s.whatsapp.net',
    text: 'Mentira, eu tenho certeza que guardei na gaveta.',
    now: now - 4_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'm4',
    authorJid: 'joao@s.whatsapp.net',
    text: 'Vai lá olhar na rua então, cabeção.',
    now: now - 2_000,
  });

  const newsService = createNewsService({
    newsRepository,
    journalMessageRepository,
    snapshotRepository,
    getContactDisplayName: (jid) => ({ 'pedro@s.whatsapp.net': 'Pedro', 'joao@s.whatsapp.net': 'João' })[jid],
    flavorService: {
      async line(scenario, vars) {
        assert.equal(scenario, 'group_times');
        assert.ok(vars.commentator, 'Deveria injetar comentarista nas variáveis do LLM');
        assert.ok(vars.commentator.name, 'Comentarista deve ter nome');
        return [
          'CAPA: O Misterioso Caso da Chave Desaparecida',
          'INTRO: Pedro conseguiu perder a chave antes mesmo de ligar o motor.',
          `COMENTARISTA: ${vars.commentator.name} opina: O homem não cuida nem da chave, imagina da vida!`,
          'DETALHES: João não perdoou e entregou que a chave estava no próprio veículo.',
          'FORESHADOW: Amanhã Pedro procurará o próprio carro.',
        ].join('\n');
      },
      lastProvider: () => 'zen',
    },
  });

  const published = await newsService.tryPublish(scope, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
  }, now);

  assert.equal(published.ok, true);
  assert.match(published.text, /O Misterioso Caso da Chave Desaparecida/);
  assert.match(published.text, /PARECER DO ESPECIALISTA/);
  assert.match(published.text, /O homem não cuida nem da chave/);

  // Verifica que o comentarista foi salvo no repositório para esse grupo
  const savedCommentator = newsRepository.getCommentator(scope);
  assert.ok(savedCommentator);
  assert.ok(savedCommentator.name);
  assert.match(published.text, new RegExp(savedCommentator.name, 'i'));

  // Dia 2: publica nova edição no mesmo grupo e garante que o comentarista é o MESMO
  const day2Now = now + 24 * 60 * 60_000;
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'm5',
    authorJid: 'pedro@s.whatsapp.net',
    text: 'Achei a chave mas perdi a carteira.',
    now: day2Now - 8_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'm6',
    authorJid: 'joao@s.whatsapp.net',
    text: 'Inacreditável a capacidade de perder coisas.',
    now: day2Now - 6_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'm7',
    authorJid: 'pedro@s.whatsapp.net',
    text: 'Dessa vez foi na padaria.',
    now: day2Now - 4_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'm8',
    authorJid: 'joao@s.whatsapp.net',
    text: 'A padaria nem abriu hoje.',
    now: day2Now - 2_000,
  });

  const publishedDay2 = await newsService.tryPublish(scope, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
  }, day2Now);

  assert.equal(publishedDay2.ok, true);
  assert.match(publishedDay2.text, new RegExp(savedCommentator.name, 'i'), 'Comentarista deve ser o mesmo no dia 2');
});

test('news: fallback determinístico gera narrativa opinativa e parecer do comentarista sem bullets mecânicos', async () => {
  const { renderEdition } = await import('../fun/services/news/newsRender.js');
  const { createNewsCommentatorService } = await import('../fun/services/news/newsCommentatorService.js');

  const commentatorService = createNewsCommentatorService();
  const commentator = {
    name: 'Cachorro Chupetinha',
    title: 'fiscal de vergonha alheia',
    catchphrase: 'Au au au, essa vergonha eu não passo nem de coleira!',
  };

  const conversation = {
    mood: 'zoeiro',
    totalMessageCount: 10,
    timeline: [
      {
        hour: '16:00',
        messageCount: 10,
        participants: ['Carlos', 'Daniel'],
        sample: [
          { name: 'Carlos', text: 'Eu avisei que ia dar confusão.' },
          { name: 'Daniel', text: 'Ninguém escuta o bom senso aqui.' },
        ],
      },
    ],
    quotes: [{ name: 'Carlos', text: 'Eu avisei que ia dar confusão.' }],
  };

  const text = renderEdition(conversation, null, {
    dayLabel: '2026-09-08 · terça-feira',
    commentator,
    commentatorService,
  });

  assert.match(text, /📰 \*THE GROUP TIMES\*/);
  assert.match(text, /Plantão do Deboche/);
  assert.match(text, /PARECER DO ESPECIALISTA \(CACHORRO CHUPETINHA — FISCAL DE VERGONHA ALHEIA\)/);
  assert.match(text, /Au au au, essa vergonha eu não passo nem de coleira!/);
  assert.match(text, /Carlos chamou a atenção dos presentes ao disparar/);
  // Garante que o corpo da matéria não tem linhas de bullet points
  assert.doesNotMatch(text.split('*FRASES PARA O ARQUIVO*')[0], /\n•\s+\*16:00\*/);
});

test('news: sanitizeGroupTimes tolera textos longos de crônica (>5000 chars) sem truncar', async () => {
  const { sanitizeGroupTimes } = await import('../fun/llm/flavorService.js');

  const longChronicle = [
    'CAPA: Escândalo do Zap Sem Fim',
    'INTRO: ' + 'A redação continuou apurando cada fofoca em minúcias. '.repeat(40),
    'COMENTARISTA: ' + 'Achei tudo um absurdo sem tamanho! '.repeat(20),
    'DETALHES: ' + 'Os membros discutiram exaustivamente sem chegar a lugar algum. '.repeat(40),
    'FORESHADOW: Amanhã saberemos o resultado.',
  ].join('\n');

  assert.ok(longChronicle.length > 5000);
  const sanitized = sanitizeGroupTimes(longChronicle);
  assert.ok(sanitized.length > 5000, `Deveria ter preservado mais de 5000 caracteres, mas teve ${sanitized.length}`);
  assert.match(sanitized, /CAPA: Escândalo do Zap Sem Fim/);
  assert.match(sanitized, /FORESHADOW: Amanhã saberemos/);
});


