import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import { createNewsService } from '../fun/services/newsService.js';
import {
  buildNewsCoverPrompt,
  resolveNewsCoverCaption,
  resolveNewsCoverFestiveSeason,
  generateNewsCover,
  sendNewsCoverWithRetry,
  withCoverDeadline,
  NEWS_COVER_COMMAND,
} from '../fun/services/news/newsCover.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

const CONVERSATION = {
  mood: 'movimentado',
  messages: [
    { source: 'human', name: 'Ana Souza', authorJid: 'ana@s.whatsapp.net', text: 'mensagem um' },
    { source: 'human', name: 'Bia Souza', authorJid: 'bia@s.whatsapp.net', text: 'mensagem dois' },
  ],
  timeline: [
    { hour: '09:00', messageCount: 2, participants: ['Ana Souza'], sample: [] },
    { hour: '21:00', messageCount: 9, participants: ['Ana Souza', 'Bia Souza'], sample: [] },
  ],
  quotes: [],
};

function mockImageService({ result = null, error = null, calls = [] } = {}) {
  return {
    calls,
    generateImage: async (args) => {
      calls.push(args);
      if (error) throw error;
      return result;
    },
  };
}

test('capa: prompt determinístico traz mood, participantes, pico horário e comentarista', () => {
  const prompt = buildNewsCoverPrompt({
    conversation: CONVERSATION,
    commentator: { name: 'Craque Neto do Zap', title: 'comentarista esportivo raivoso' },
    festiveSeason: null,
  });

  assert.match(prompt, /capa de jornal/i);
  assert.match(prompt, /tumulto animado/); // cena do mood movimentado
  assert.match(prompt, /Ana Souza, Bia Souza/); // participantes (máx 4)
  assert.match(prompt, /21:00/); // pico da timeline
  assert.match(prompt, /Craque Neto do Zap/);
  assert.match(prompt, /comentarista esportivo raivoso/);
  assert.match(prompt, /NÃO escreva nenhum texto/i); // arte sem texto legível
  // Sem tema festivo → nada de neve/confete
  assert.doesNotMatch(prompt, /natalino|carnaval|junino|réveillon/i);

  // Mood desconhecido cai no fallback de prosa
  const fallback = buildNewsCoverPrompt({ conversation: { mood: 'xpto' }, festiveSeason: null });
  assert.match(fallback, /mesa de boteco/);

  // Tema festivo presente (natal → clima natalino/neve)
  const natal = buildNewsCoverPrompt({ conversation: CONVERSATION, festiveSeason: 'natal' });
  assert.match(natal, /clima natalino: neve caindo/);

  const carnaval = buildNewsCoverPrompt({ conversation: CONVERSATION, festiveSeason: 'carnaval' });
  assert.match(carnaval, /clima de carnaval: confetes/);
});

test('capa: temporada festiva resolvida no fuso do jornal (natal em dezembro, nada em outubro)', () => {
  assert.equal(resolveNewsCoverFestiveSeason(Date.UTC(2026, 11, 20, 2, 0, 0), 'America/Sao_Paulo'), 'natal');
  assert.equal(resolveNewsCoverFestiveSeason(Date.UTC(2026, 11, 31, 2, 0, 0), 'America/Sao_Paulo'), 'ano_novo');
  assert.equal(resolveNewsCoverFestiveSeason(Date.UTC(2026, 9, 20, 2, 0, 0), 'America/Sao_Paulo'), null);
});

test('capa: caption usa a manchete quando o texto decolou, senão o mood do dia', () => {
  assert.equal(
    resolveNewsCoverCaption({ capa: 'Caos Generalizado: ninguém acordou' }, CONVERSATION),
    '📰 Caos Generalizado: ninguém acordou'
  );
  assert.equal(resolveNewsCoverCaption(null, CONVERSATION), '📰 The Group Times — Caos Generalizado na Redação');
  assert.equal(resolveNewsCoverCaption(null, { mood: 'silencioso' }), '📰 The Group Times — Plantão do Silêncio');
});

test('capa: geração via o mesmo caminho do /gerar (telemetria news-cover) e falha silenciosa', async () => {
  const scope = uniqueGroup();

  // Sucesso: buffer devolvido + command próprio + prompt montado
  const okService = mockImageService({
    result: { ok: true, buffer: Buffer.from('png'), url: '', text: '' },
  });
  const okCover = await generateNewsCover({
    scopeKey: scope,
    imageGenerationService: okService,
    conversation: CONVERSATION,
    commentator: { name: 'Fiscal do Rolo', title: 'auditor sênior' },
    funConfig: { worldTimezone: 'America/Sao_Paulo' },
    now: Date.UTC(2026, 11, 20, 2, 0, 0),
  });
  assert.equal(okCover.ok, true);
  assert.equal(okCover.festiveSeason, 'natal');
  assert.match(okCover.prompt, /clima natalino/);
  assert.equal(okService.calls.length, 1);
  assert.equal(okService.calls[0].command, NEWS_COVER_COMMAND);
  assert.equal(okService.calls[0].scopeKey, scope);

  // Quota exaurida: ok:false sem lançar erro
  const quotaService = mockImageService({
    result: { ok: false, reason: 'quota-exceeded', remaining: 0, limit: 25 },
  });
  const quotaCover = await generateNewsCover({
    scopeKey: scope,
    imageGenerationService: quotaService,
    conversation: CONVERSATION,
  });
  assert.equal(quotaCover.ok, false);
  assert.equal(quotaCover.reason, 'quota-exceeded');

  // Serviço lançando exceção: engolido (capa é enfeite)
  const boomService = mockImageService({ error: new Error('provider exploded') });
  const boomCover = await generateNewsCover({
    scopeKey: scope,
    imageGenerationService: boomService,
    conversation: CONVERSATION,
  });
  assert.equal(boomCover.ok, false);

  // Sem serviço: no-service
  assert.equal(
    (await generateNewsCover({ scopeKey: scope, imageGenerationService: null, conversation: CONVERSATION })).reason,
    'no-service'
  );
});

test('capa: composeEdition gera capa em paralelo e devolve cover + caption da manchete', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 3, 23, 59, 30);
  const imageService = mockImageService({
    result: { ok: true, buffer: Buffer.from('cover-png'), url: '', text: '' },
  });

  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    journalMessageRepository: createFunJournalMessageRepository({ getDatabase: getDb }),
    imageGenerationService: imageService,
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
    getContactDisplayName: (jid) => ({ ana: 'Ana', bia: 'Bia' })[String(jid).split('@')[0]] || jid,
  });

  const chat = [
    { id: 'c1', author: 'ana@s.whatsapp.net', text: 'A enquete de ontem rendeu mais assunto do que o esperado.' },
    { id: 'c2', author: 'bia@s.whatsapp.net', text: 'Eu voto de novo, só pra ver o Carlos perder a compostura.' },
    { id: 'c3', author: 'ana@s.whatsapp.net', text: 'O veredito foi comprado, todo mundo aqui sabe disso muito bem.' },
    { id: 'c4', author: 'bia@s.whatsapp.net', text: 'Reclamar do resultado da enquete é a tradição mais antiga.' },
  ];
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  chat.forEach((m, i) => {
    journalMessageRepository.recordMessage({
      scopeKey: scope,
      messageId: m.id,
      authorJid: m.author,
      text: m.text,
      now: now - (10 - i) * 1000,
    });
  });

  const edition = await newsService.composeEdition(
    scope,
    { groupNewsEnabled: true, worldTimezone: 'UTC', groupNewsMaxChars: 2500 },
    now
  );
  assert.ok(edition?.text);
  assert.equal(imageService.calls.length, 1, 'capa deveria ser solicitada uma vez');
  assert.equal(edition.cover?.buffer?.toString(), 'cover-png');
  assert.equal(edition.coverCaption, '📰 Enquete domina a redação');
});

test('capa: fallback silencioso — serviço de imagem falhando NÃO quebra a publicação', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 3, 23, 59, 30);
  const failingService = mockImageService({
    result: { ok: false, reason: 'quota-exceeded', remaining: 0, limit: 25 },
  });

  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    journalMessageRepository: createFunJournalMessageRepository({ getDatabase: getDb }),
    imageGenerationService: failingService,
    flavorService: {
      async line() {
        return [
          'CAPA: Edição sobrevive sem capa',
          'INTRO: A redação funcionou mesmo sem fotógrafo.',
          'DETALHES: A fila andou.',
          'FORESHADOW: Amanhã tem mais.',
        ].join('\n');
      },
      lastProvider: () => 'zen',
    },
    getContactDisplayName: (jid) => jid,
  });

  const chat = [
    { id: 'f1', author: 'ana@s.whatsapp.net', text: 'A redação funcionou mesmo sem fotógrafo hoje, coherentíssimo.' },
    { id: 'f2', author: 'bia@s.whatsapp.net', text: 'A fila andou e ninguém questionou o checksum do caos geral.' },
    { id: 'f3', author: 'ana@s.whatsapp.net', text: 'O caos geral continua com o mesmo desenrolo de sempre aqui.' },
    { id: 'f4', author: 'bia@s.whatsapp.net', text: 'Ninguém saiu da sala e ninguém explicou nada até agora mesmo.' },
  ];
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  chat.forEach((m, i) => {
    journalMessageRepository.recordMessage({
      scopeKey: scope,
      messageId: m.id,
      authorJid: m.author,
      text: m.text,
      now: now - (10 - i) * 1000,
    });
  });

  // tryPublish completo: capa falha (quota), edição é publicada do mesmo jeito
  const published = await newsService.tryPublish(scope, {
    groupNewsEnabled: true,
    worldTimezone: 'UTC',
    groupNewsHour: 23,
    groupNewsMinute: 59,
  }, now);
  assert.equal(published.ok, true, `publicação deveria seguir sem capa: ${published?.reason}`);
  assert.match(published.text, /Edição sobrevive sem capa/);
  assert.equal(published.cover, null);

  // Flag da feature desligada: serviço nem é chamado
  const untouchedService = mockImageService({ result: { ok: true, buffer: Buffer.from('x'), url: '', text: '' } });
  const offService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    journalMessageRepository: createFunJournalMessageRepository({ getDatabase: getDb }),
    imageGenerationService: untouchedService,
    getContactDisplayName: (jid) => jid,
  });
  await offService.composeEdition(
    uniqueGroup(),
    { groupNewsEnabled: true, worldTimezone: 'UTC', groupNewsCoverEnabled: false, groupNewsMaxChars: 2500 },
    now
  );
  assert.equal(untouchedService.calls.length, 0, 'flag desligada não deve chamar o gerador');
});

test('capa: envio capa → texto → áudio com retry e falha de transporte sem lançar', async () => {
  const scope = uniqueGroup();
  const sends = [];
  const sendImage = async (sock, to, payload) => {
    sends.push({ to, payload });
    return { key: { id: 'cover-1' } };
  };

  const ok = await sendNewsCoverWithRetry(
    {},
    scope,
    { coverBuffer: Buffer.from('png'), caption: '📰 Manchete', mentions: ['ana@s.whatsapp.net'] },
    { sendImage }
  );
  assert.equal(ok.ok, true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, scope);
  assert.equal(sends[0].payload.caption, '📰 Manchete');
  assert.deepEqual(sends[0].payload.mentions, ['ana@s.whatsapp.net']);
  assert.equal(sends[0].payload.imageBuffer.toString(), 'png');

  // Sem buffer e sem URL: nem tenta
  assert.equal(
    (await sendNewsCoverWithRetry({}, scope, { coverBuffer: null, coverUrl: '' }, { sendImage })).reason,
    'missing-cover'
  );

  // Transporte falhando: esgota tentativas sem lançar
  let attempts = 0;
  const failing = await sendNewsCoverWithRetry(
    {},
    scope,
    { coverBuffer: Buffer.from('png'), caption: '' },
    {
      sendImage: async () => {
        attempts += 1;
        throw new Error('socket down');
      },
      delays: [1],
    }
  );
  assert.equal(failing.ok, false);
  assert.equal(attempts, 2);
  assert.equal(failing.reason, 'socket down');

  // Guard de envio devolvendo { skipped: true }: NÃO é sucesso — ok:false com
  // motivo do guard, sem retry (guard é persistente, tentar de novo não muda).
  let skippedAttempts = 0;
  const skipped = await sendNewsCoverWithRetry(
    {},
    scope,
    { coverBuffer: Buffer.from('png'), caption: '' },
    {
      sendImage: async () => {
        skippedAttempts += 1;
        return { skipped: true, reason: 'anti-ban-guard' };
      },
      delays: [1],
      maxAttempts: 3,
    }
  );
  assert.equal(skipped.ok, false, 'skipped não pode ser tratado como sucesso');
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.reason, 'anti-ban-guard');
  assert.equal(skippedAttempts, 1, 'guard persistente não merece retry');

  // Sem transporte nenhum: ok:false silencioso
  assert.equal(
    (await sendNewsCoverWithRetry({}, scope, { coverUrl: 'https://example.com/a.png' })).reason,
    'no-transport'
  );
});

test('capa: deadline TOTAL — backend que nunca resolve é descartado e a edição publica', async () => {
  const scope = uniqueGroup();
  const now = Date.UTC(2026, 8, 3, 23, 59, 30);

  // Unidade: promise que nunca resolve + prazo curto → cover-timeout, sem vazar timer
  const hungPromise = new Promise(() => {});
  const started = Date.now();
  const raced = await withCoverDeadline(hungPromise, 60);
  assert.equal(raced.ok, false);
  assert.equal(raced.reason, 'cover-timeout');
  assert.ok(Date.now() - started < 5000, 'deadline deve soltar a espera');

  // Integração: composeEdition segue dentro do prazo, capa descartada, edição inteira
  const hangService = { generateImage: () => new Promise(() => {}) };
  const newsService = createNewsService({
    newsRepository: createFunNewsRepository({ getDatabase: getDb }),
    journalMessageRepository: createFunJournalMessageRepository({ getDatabase: getDb }),
    imageGenerationService: hangService,
    flavorService: {
      async line() {
        return [
          'CAPA: Edição sai mesmo com fotógrafo preso no trânsito',
          'INTRO: O grupo discutiu a enquete o dia inteiro.',
          'DETALHES: Ninguém mudou de assunto.',
          'FORESHADOW: Amanhã tem mais.',
        ].join('\n');
      },
      lastProvider: () => 'zen',
    },
    getContactDisplayName: (jid) => jid,
  });
  const chat = [
    { id: 't1', author: 'ana@s.whatsapp.net', text: 'A enquete de ontem rendeu mais assunto do que o esperado.' },
    { id: 't2', author: 'bia@s.whatsapp.net', text: 'Eu voto de novo, só pra ver o Carlos perder a compostura.' },
    { id: 't3', author: 'ana@s.whatsapp.net', text: 'O veredito foi comprado, todo mundo aqui sabe disso muito bem.' },
    { id: 't4', author: 'bia@s.whatsapp.net', text: 'Reclamar do resultado da enquete é a tradição mais antiga.' },
  ];
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  chat.forEach((m, i) => {
    journalMessageRepository.recordMessage({
      scopeKey: scope,
      messageId: m.id,
      authorJid: m.author,
      text: m.text,
      now: now - (10 - i) * 1000,
    });
  });

  const startedAt = Date.now();
  const edition = await newsService.composeEdition(
    scope,
    {
      groupNewsEnabled: true,
      worldTimezone: 'UTC',
      groupNewsMaxChars: 2500,
      groupNewsCoverTimeoutMs: 60,
    },
    now
  );
  assert.ok(edition?.text, 'edição deve existir mesmo com a capa pendurada para sempre');
  assert.match(edition.text, /fotógrafo preso no trânsito/);
  assert.equal(edition.cover, null, 'capa pendurada deve ser descartada');
  assert.ok(Date.now() - startedAt < 5000, 'composeEdition não pode esperar o backend de imagem resolver');
});

test('capa: deadline também no ENVIO — sendImage pendurado não trava a publicação do texto', async () => {
  const scope = uniqueGroup();

  // Envio pendurado (socket preso) + prazo curto: race solta com cover-timeout
  const hungSendImage = async () => new Promise(() => {});
  const started = Date.now();
  const raced = await withCoverDeadline(
    sendNewsCoverWithRetry(
      {},
      scope,
      { coverBuffer: Buffer.from('png'), caption: '📰 capa' },
      { sendImage: hungSendImage, maxAttempts: 2, delays: [1] }
    ),
    80
  );
  assert.equal(raced.ok, false);
  assert.equal(raced.reason, 'cover-timeout');
  assert.ok(Date.now() - started < 5000, 'envio da capa não pode segurar o tick');
});
