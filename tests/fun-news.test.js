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

  // Quando maxChars é informado (como o limite de 2500 chars para leitura em 2 min), limita com segurança
  const capped = renderEdition(conversation, llmBits, {
    dayLabel: '2026-09-08 · terça-feira',
    commentator: { name: 'Cachorro Chupetinha', title: 'fiscal de vergonha alheia' },
    maxChars: 2500,
  });
  assert.ok(capped.length <= 2500, `Deveria limitar a 2500 caracteres, mas teve ${capped.length}`);
  assert.match(capped, /O Grande Debate Que Parou a Cidade/);
  assert.match(capped, /PARECER DO ESPECIALISTA/);
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

test('news: sanitizeGroupTimes limita crônica por padrão para leitura em até 2 minutos e respeita maxLen customizado', async () => {
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
  assert.ok(sanitized.length <= 3500, `Deveria ter limitado a no máximo 3500 caracteres, mas teve ${sanitized.length}`);
  assert.match(sanitized, /CAPA: Escândalo do Zap Sem Fim/);

  // Quando passado maxLen explicitamente maior, respeita
  const sanitizedCustom = sanitizeGroupTimes(longChronicle, 64000);
  assert.ok(sanitizedCustom.length > 5000);
  assert.match(sanitizedCustom, /FORESHADOW: Amanhã saberemos/);
});

test('news: fallbackDetails com 3 samples produz narrativa variada sem repetições de abertura de frase', async () => {
  const { renderEdition } = await import('../fun/services/news/newsRender.js');
  const { createNewsCommentatorService } = await import('../fun/services/news/newsCommentatorService.js');

  const conversation = {
    mood: 'zoeiro',
    totalMessageCount: 30,
    timeline: [
      {
        hour: '10:00',
        messageCount: 10,
        participants: ['Lucas'],
        sample: [{ name: 'Lucas', text: 'A santíssima trindade autista KKKKKKKKKKKKK' }],
      },
      {
        hour: '14:00',
        messageCount: 10,
        participants: ['Maximus'],
        sample: [{ name: 'Maximus', text: 'KKKKKKKKKKKKKKKKKKKKKKK eu avisei' }],
      },
      {
        hour: '18:00',
        messageCount: 10,
        participants: ['Digo'],
        sample: [{ name: 'Digo', text: 'Vcs costumam rebolar pra andar em hyrule?' }],
      },
    ],
    quotes: [],
  };

  const commentatorService = createNewsCommentatorService();
  const text = renderEdition(conversation, null, {
    dayLabel: '2026-09-08 · terça-feira',
    commentator: { name: 'Doutor Fuxico', title: 'psicanalista de boteco' },
    commentatorService,
  });

  // NÃO deve conter a repetição da frase fixa do fallback legado
  const matches = [...text.matchAll(/Em dado momento da apuração/gi)];
  assert.equal(matches.length, 0, 'Não deve conter a frase mecânica repetida "Em dado momento da apuração"');

  // Deve conter conectivos variados encadeados
  assert.match(text, /Durante a movimentação da apuração, Lucas/);
  assert.match(text, /Mais tarde, na apuração dos bastidores, Maximus/);
  assert.match(text, /Para fechar o apanhado das investigações, Digo/);
});

test('news: renderEdition insere gancho de transição jornalística antes do parecer do especialista', async () => {
  const { renderEdition } = await import('../fun/services/news/newsRender.js');

  const conversation = {
    mood: 'zoeiro',
    timeline: [{ participants: ['Eduardo'] }],
    quotes: [],
  };

  const text = renderEdition(conversation, null, {
    dayLabel: '2026-09-08 · terça-feira',
    commentator: { name: 'Doutor Fuxico', title: 'psicanalista de boteco' },
  });

  // Gancho editorial antes do parecer
  assert.match(text, /Para colocar uma lupa sobre esse espetáculo de zoeira/);
  assert.match(text, /🗣️ \*PARECER DO ESPECIALISTA/);
});

test('news: FRASES PARA O ARQUIVO deduplica e limita a no máximo 3 citações literais', async () => {
  const { renderEdition } = await import('../fun/services/news/newsRender.js');

  const conversation = {
    mood: 'conversado',
    timeline: [],
    quotes: [
      { name: 'Ana', text: 'Frase repetida número um.' },
      { name: 'Ana', text: 'Frase repetida número um.' }, // duplicata
      { name: 'Bia', text: 'Frase única número dois.' },
      { name: 'Carlos', text: 'Frase única número três.' },
      { name: 'Daniel', text: 'Frase excedente número quatro.' }, // além de 3
    ],
  };

  const text = renderEdition(conversation, null, {
    dayLabel: '2026-09-08 · terça-feira',
  });

  assert.match(text, /\*FRASES PARA O ARQUIVO\*/);
  const quotesSection = text.split('*FRASES PARA O ARQUIVO*')[1] || '';
  const lines = quotesSection.split('\n').filter((l) => l.startsWith('• '));

  assert.equal(lines.length, 3, 'Deve conter no máximo 3 citações únicas');
  assert.match(lines[0], /Frase repetida número um/);
  assert.match(lines[1], /Frase única número dois/);
  assert.match(lines[2], /Frase única número três/);
  assert.doesNotMatch(quotesSection, /Frase excedente número quatro/);
});

test('news config: resolveFunConfig normaliza groupNewsConcurrency, groupNewsTimeoutMs e groupNewsMaxAttempts', async () => {
  const { resolveFunConfig } = await import('../fun/config.js');

  // Defaults
  const def = resolveFunConfig({});
  assert.equal(def.groupNewsConcurrency, 2);
  assert.equal(def.groupNewsTimeoutMs, 75_000);
  assert.equal(def.groupNewsMaxAttempts, 3);

  // Valores customizados válidos
  const custom = resolveFunConfig({
    groupNewsConcurrency: 4,
    groupNewsTimeoutMs: 90_000,
    groupNewsMaxAttempts: 2,
  });
  assert.equal(custom.groupNewsConcurrency, 4);
  assert.equal(custom.groupNewsTimeoutMs, 90_000);
  assert.equal(custom.groupNewsMaxAttempts, 2);

  // Clamps
  const clamped = resolveFunConfig({
    groupNewsConcurrency: 99,
    groupNewsTimeoutMs: 5_000,
    groupNewsMaxAttempts: 10,
  });
  assert.equal(clamped.groupNewsConcurrency, 10);
  assert.equal(clamped.groupNewsTimeoutMs, 15_000);
  assert.equal(clamped.groupNewsMaxAttempts, 5);
});

test('news LLM: flavorService.line(group_times) tenta até 3x e recupera na 3ª tentativa', async () => {
  const { createFlavorService } = await import('../fun/llm/flavorService.js');
  const { resolveFunConfig } = await import('../fun/config.js');

  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  try {
    let attempts = 0;
    const flavor = createFlavorService({
      getConfig: () =>
        resolveFunConfig({
          zenEnabled: true,
          groupNewsMaxAttempts: 3,
          groupNewsTimeoutMs: 20_000,
        }),
      zenGenerate: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(`Timeout/erro temporário na tentativa ${attempts}`);
        }
        return [
          'CAPA: Vitória na Terceira Tentativa',
          'INTRO: O grupo finalmente conseguiu a matéria completa após instabilidade.',
          'COMENTARISTA: Eu avisei que no final tudo dava certo!',
          'DETALHES: O repórter investigou e confirmou os acontecimentos.',
          'FORESHADOW: Amanhã tem mais.',
        ].join('\n');
      },
      allowLiveLlm: true,
    });

    const result = await flavor.line('group_times', {
      scopeKey: '120363test@g.us',
      conversation: 'Conversa de teste',
    });

    assert.equal(attempts, 3, 'Deve ter tentado exatamente 3 vezes');
    assert.match(result, /CAPA: Vitória na Terceira Tentativa/);
    assert.equal(flavor.lastProvider('120363test@g.us'), 'zen');
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('news LLM: flavorService.line(group_times) esgota 3 tentativas e cai em fallback gracioso', async () => {
  const { createFlavorService } = await import('../fun/llm/flavorService.js');
  const { resolveFunConfig } = await import('../fun/config.js');

  const prev = process.env.FUN_DISABLE_LIVE_LLM;
  delete process.env.FUN_DISABLE_LIVE_LLM;

  try {
    let attempts = 0;
    const flavor = createFlavorService({
      getConfig: () =>
        resolveFunConfig({
          zenEnabled: true,
          groupNewsMaxAttempts: 3,
          groupNewsTimeoutMs: 20_000,
        }),
      zenGenerate: async () => {
        attempts += 1;
        throw new Error(`Falha persistente na tentativa ${attempts}`);
      },
      allowLiveLlm: true,
    });

    const result = await flavor.line('group_times', {
      scopeKey: '120363fail@g.us',
      conversation: 'Conversa que falhará',
    });

    assert.equal(attempts, 3, 'Deve ter esgotado as 3 tentativas');
    assert.equal(flavor.lastProvider('120363fail@g.us'), 'template');
    assert.match(result, /CAPA:/);
  } finally {
    if (prev !== undefined) process.env.FUN_DISABLE_LIVE_LLM = prev;
    else process.env.FUN_DISABLE_LIVE_LLM = '1';
  }
});

test('news: composeEdition gera texto conciso para leitura em até 2 minutos (<= 2500 chars)', async () => {
  const scope = uniqueGroup();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  const snapshotRepository = createFunSnapshotRepository({ getDatabase: getDb });
  const now = Date.UTC(2026, 8, 8, 23, 59, 30);

  for (let i = 1; i <= 5; i++) {
    journalMessageRepository.recordMessage({
      scopeKey: scope,
      messageId: `m${i}`,
      authorJid: `autor${i % 2 + 1}@s.whatsapp.net`,
      text: `Mensagem ${i} do dia com assunto animado para debate`,
      now: now - (10 - i) * 1000,
    });
  }

  const newsService = createNewsService({
    newsRepository,
    journalMessageRepository,
    snapshotRepository,
    getContactDisplayName: () => 'Autor',
    flavorService: {
      async line() {
        return [
          'CAPA: Título Curto e Provocativo',
          'INTRO: Abertura concisa com comentário afiado sobre as trapalhadas do grupo.',
          'COMENTARISTA: Parecer irônico e bem-humorado do especialista residente.',
          'DETALHES: ' + 'Fofoca detalhada porém sem enrolação. '.repeat(5),
          'FORESHADOW: Fecho cômico pro dia seguinte.',
        ].join('\n');
      },
      lastProvider: () => 'zen',
    },
  });

  const edition = await newsService.composeEdition(scope, {
    groupNewsEnabled: true,
    groupNewsMaxChars: 2500,
  }, now);

  assert.ok(edition);
  assert.ok(edition.text);
  assert.ok(
    edition.text.length <= 2500,
    `Edição deve ter no máximo 2500 caracteres para leitura em até 2 minutos, teve ${edition.text.length}`
  );
  assert.match(edition.text, /📰 \*THE GROUP TIMES\*/);
  assert.match(edition.text, /Título Curto e Provocativo/);
  assert.match(edition.text, /PARECER DO ESPECIALISTA/);
});



