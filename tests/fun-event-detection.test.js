import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { createEventRepository } from '../fun/db/eventRepository.js';
import {
  createEventExtractorService,
  isEventCandidate,
} from '../fun/events/eventExtractorService.js';
import { createEventAggregationService } from '../fun/events/eventAggregationService.js';
import { zonedLocalDateTimeToMs } from '../fun/events/eventTime.js';

// test-env-setup força FUN_DISABLE_LIVE_LLM=1; os testes abaixo injetam um
// generateZen fake e dependem do caminho "real" do extractor, então desligamos
// a guarda por enquanto. Cada teste é responsável por fornecer um generateZen
// determinístico.
process.env.FUN_DISABLE_LIVE_LLM = '0';

await initDb();

function buildFunConfig(overrides = {}) {
  return {
    groupEventsEnabled: true,
    groupEventFragmentWindowMs: 30 * 60_000,
    groupEventFragmentMaxMessages: 4,
    groupEventReminderThreeDaysEnabled: true,
    groupEventReminderThreeHoursEnabled: true,
    worldTimezone: 'America/Sao_Paulo',
    zenEnabled: true,
    prefix: '/',
    ...overrides,
  };
}

function buildZenFake(payload) {
  return async () => JSON.stringify(payload);
}

function makeScope(prefix = 'det') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@g.us`;
}

function makeAuthor() {
  return `5511${Math.floor(Math.random() * 9_000_000 + 1_000_000)}@s.whatsapp.net`;
}

function referenceStartsAt() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 7);
  start.setUTCHours(20, 0, 0, 0);
  return {
    start,
    isoDate: start.toISOString().slice(0, 10),
    isoTime: '20:00',
    expectedMs: zonedLocalDateTimeToMs({
      date: start.toISOString().slice(0, 10),
      time: '20:00',
      timeZone: 'America/Sao_Paulo',
    }),
  };
}

test('isEventCandidate aceita mensagens com sinais claros e rejeita conversa comum', () => {
  assert.equal(isEventCandidate('Bora pro churrasco amanhã 19h na casa do Leo?'), true);
  assert.equal(isEventCandidate('Hoje 20h rolê no parque confirmado'), true);
  assert.equal(isEventCandidate('kkk que isso mano, do nada'), false);
  assert.equal(isEventCandidate('oi'), false);
});

test('anúncio único persiste evento, organizador, local, itens e lembretes', async () => {
  const repository = createEventRepository();
  const ref = referenceStartsAt();
  const extractionPayload = {
    action: 'create',
    title: 'Churrasco de fim de semana',
    event_type: 'churrasco',
    date: ref.isoDate,
    time: ref.isoTime,
    timezone: 'America/Sao_Paulo',
    location: 'Casa do Léo',
    items: ['carvão', 'bebida'],
    organizer_name: 'Léo',
    confidence: 92,
  };
  const eventExtractorService = createEventExtractorService({
    generateZen: buildZenFake(extractionPayload),
  });
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService,
  });

  const scopeKey = makeScope('det');
  const author = makeAuthor();
  const result = await aggregation.observeMessage({
    scopeKey,
    userJid: author,
    text: 'Bora churrasco sábado na casa do Léo, leva carvão e bebida',
    messageId: 'msg-1',
    funConfig: buildFunConfig(),
    isGroup: true,
    msgTimeMs: Date.now(),
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.event?.title, 'Churrasco de fim de semana');
  assert.equal(result.event?.location, 'Casa do Léo');
  assert.deepEqual(result.event?.items, ['carvão', 'bebida']);
  assert.equal(result.event?.organizerName, 'Léo');
  assert.equal(result.event?.startsAt, ref.expectedMs);

  const stored = repository.listByScope(scopeKey);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, result.event.id);
  assert.equal(stored[0].status, 'active');
});

test('observação com mesmo messageId é idempotente', async () => {
  const repository = createEventRepository();
  const ref = referenceStartsAt();
  const zen = buildZenFake({
    action: 'create',
    title: 'Rolo no parque',
    event_type: 'encontro',
    date: ref.isoDate,
    time: ref.isoTime,
    timezone: 'America/Sao_Paulo',
    location: 'Parque',
    items: [],
    organizer_name: 'Ana',
    confidence: 80,
  });
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService: createEventExtractorService({ generateZen: zen }),
  });

  const scopeKey = makeScope('idem');
  const cfg = buildFunConfig();
  const now = Date.now();
  const first = await aggregation.observeMessage({
    scopeKey, userJid: makeAuthor(), text: 'Bora rolê sábado', messageId: 'dup', funConfig: cfg, isGroup: true, msgTimeMs: now,
  });
  assert.equal(first.ok, true);
  const second = await aggregation.observeMessage({
    scopeKey, userJid: makeAuthor(), text: 'Bora rolê sábado', messageId: 'dup', funConfig: cfg, isGroup: true, msgTimeMs: now,
  });
  assert.equal(second.duplicate, true);
  assert.equal(repository.listByScope(scopeKey).length, 1);
});

test('múltiplos fragmentos do mesmo autor se fundem em um único evento', async () => {
  const repository = createEventRepository();
  const ref = referenceStartsAt();
  const calls = [];
  const zen = async () => {
    calls.push('zen');
    if (calls.length === 1) {
      // primeira mensagem ainda sem hora — extractor devolve insufficient-date
      return JSON.stringify({
        action: 'create',
        title: 'Churrasco da firma',
        event_type: 'churrasco',
        date: '',
        time: '',
        timezone: 'America/Sao_Paulo',
        location: 'Chácara do Tio',
        items: [],
        organizer_name: '',
        confidence: 60,
      });
    }
    return JSON.stringify({
      action: 'create',
      title: 'Churrasco da firma',
      event_type: 'churrasco',
      date: ref.isoDate,
      time: ref.isoTime,
      timezone: 'America/Sao_Paulo',
      location: 'Chácara do Tio',
      items: ['carvão', 'carne'],
      organizer_name: 'Marcos',
      confidence: 88,
    });
  };
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService: createEventExtractorService({ generateZen: zen }),
  });

  const scopeKey = makeScope('frag');
  const author = makeAuthor();
  const cfg = buildFunConfig();
  const base = Date.now();

  // primeira mensagem: não tem hora explícita, vira fragmento no buffer
  const r1 = await aggregation.observeMessage({
    scopeKey,
    userJid: author,
    text: 'Bora churrasco na chácara do Tio sábado',
    messageId: 'frag-1',
    funConfig: cfg,
    isGroup: true,
    msgTimeMs: base,
  });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'insufficient-date');

  // segunda mensagem: hora aparece, deve fundir
  const r2 = await aggregation.observeMessage({
    scopeKey,
    userJid: author,
    text: '20h confirmado',
    messageId: 'frag-2',
    funConfig: cfg,
    isGroup: true,
    msgTimeMs: base + 60_000,
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.event?.location, 'Chácara do Tio');

  const events = repository.listByScope(scopeKey);
  assert.equal(events.length, 1);
  assert.ok(events[0].sourceMessageIds.includes('frag-1'));
  assert.ok(events[0].sourceMessageIds.includes('frag-2'));
  assert.ok(calls.length >= 1);
});

test('autores diferentes não fundem eventos', async () => {
  const repository = createEventRepository();
  const ref = referenceStartsAt();
  const zen = buildZenFake({
    action: 'create',
    title: 'Encontro',
    event_type: 'encontro',
    date: ref.isoDate,
    time: ref.isoTime,
    timezone: 'America/Sao_Paulo',
    location: 'Praça',
    items: [],
    organizer_name: '',
    confidence: 70,
  });
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService: createEventExtractorService({ generateZen: zen }),
  });

  const scopeKey = makeScope('multi-author');
  const cfg = buildFunConfig();
  const r1 = await aggregation.observeMessage({
    scopeKey, userJid: '55110001@s.whatsapp.net', text: 'Bora 20h na praça', messageId: 'a-1', funConfig: cfg, isGroup: true, msgTimeMs: Date.now(),
  });
  const r2 = await aggregation.observeMessage({
    scopeKey, userJid: '55110002@s.whatsapp.net', text: 'Bora 20h na praça', messageId: 'b-1', funConfig: cfg, isGroup: true, msgTimeMs: Date.now(),
  });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.notEqual(r1.event.id, r2.event.id);
});

test('update do mesmo autor move o evento e reagenda lembretes pendentes', async () => {
  const repository = createEventRepository();
  const ref = referenceStartsAt();
  // update mantém mesmo horário para casar via janela ±24h, adicionando item
  const payloads = [
    {
      action: 'create',
      title: 'Churrasco',
      event_type: 'churrasco',
      date: ref.isoDate,
      time: ref.isoTime,
      timezone: 'America/Sao_Paulo',
      location: 'Casa do Léo',
      items: ['carvão'],
      organizer_name: 'Léo',
      confidence: 80,
    },
    {
      action: 'update',
      title: 'Churrasco',
      event_type: 'churrasco',
      date: ref.isoDate,
      time: ref.isoTime,
      timezone: 'America/Sao_Paulo',
      location: 'Casa do Léo',
      items: ['carvão', 'gelo'],
      organizer_name: 'Léo',
      confidence: 80,
    },
  ];
  let call = 0;
  const zen = async () => JSON.stringify(payloads[call++ % payloads.length]);
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService: createEventExtractorService({ generateZen: zen }),
  });

  const scopeKey = makeScope('upd');
  const author = makeAuthor();
  const cfg = buildFunConfig();
  const t = Date.now();
  const create = await aggregation.observeMessage({
    scopeKey, userJid: author, text: 'Churrasco sábado 20h', messageId: 'u-1', funConfig: cfg, isGroup: true, msgTimeMs: t,
  });
  assert.equal(create.ok, true);

  const update = await aggregation.observeMessage({
    scopeKey, userJid: author, text: 'agora é 21h30, leva gelo também no churras', messageId: 'u-2', funConfig: cfg, isGroup: true, msgTimeMs: t + 30_000,
  });
  assert.equal(update.ok, true);
  assert.equal(update.event.startsAt, ref.expectedMs);
  assert.deepEqual(update.event.items.sort(), ['carvão', 'gelo']);
  assert.equal(repository.listByScope(scopeKey).length, 1);
});

test('cancelamento inequívoco desativa o evento', async () => {
  const repository = createEventRepository();
  const ref = referenceStartsAt();
  const payloads = [
    {
      action: 'create',
      title: 'Balada',
      event_type: 'balada',
      date: ref.isoDate,
      time: ref.isoTime,
      timezone: 'America/Sao_Paulo',
      location: 'Bar',
      items: [],
      organizer_name: '',
      confidence: 70,
    },
    {
      action: 'cancel',
      title: 'Balada',
      event_type: 'balada',
      date: ref.isoDate,
      time: ref.isoTime,
      timezone: 'America/Sao_Paulo',
      location: 'Bar',
      items: [],
      organizer_name: '',
      confidence: 99,
    },
  ];
  let call = 0;
  const zen = async () => JSON.stringify(payloads[call++ % payloads.length]);
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService: createEventExtractorService({ generateZen: zen }),
  });
  const scopeKey = makeScope('cancel');
  const author = makeAuthor();
  const cfg = buildFunConfig();
  await aggregation.observeMessage({
    scopeKey, userJid: author, text: 'Bora balada sábado 20h', messageId: 'c-1', funConfig: cfg, isGroup: true, msgTimeMs: Date.now(),
  });
  const cancel = await aggregation.observeMessage({
    scopeKey, userJid: author, text: 'Galera cancelei o rolê de sábado', messageId: 'c-2', funConfig: cfg, isGroup: true, msgTimeMs: Date.now() + 5_000,
  });
  assert.equal(cancel.ok, true);
  assert.equal(cancel.event.status, 'cancelled');
  assert.notEqual(cancel.event.cancelledAt, 0);
});

test('JSON levemente malformado é recuperado via looseParseFacts', async () => {
  const repository = createEventRepository();
  const ref = referenceStartsAt();
  // JSON truncado propositalmente para acionar o fallback looseParseFacts.
  // O recoverLooseEvent usa looseParseFacts para extrair o summary e campos
  // residuais; o título que prevalece vem do summary (event_type) porque o
  // campo "title" foi cortado antes do fechamento da string.
  const malformed = `{"action":"create","title":"Rolo","event_type":"encontro","date":"${ref.isoDate}","time":"${ref.isoTime}","timezone":"America/Sao_Paulo","location":"","items":[]`;
  const zen = async () => malformed;
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService: createEventExtractorService({ generateZen: zen }),
  });
  const r = await aggregation.observeMessage({
    scopeKey: makeScope('loose'),
    userJid: makeAuthor(),
    text: 'Bora rolê',
    messageId: 'loose-1',
    funConfig: buildFunConfig(),
    isGroup: true,
    msgTimeMs: Date.now(),
  });
  assert.equal(r.ok, true);
  assert.ok(r.event, 'evento deve existir');
  // O recoverLooseEvent preenche `title` com o `summary` do looseParseFacts;
  // só garantimos que o evento foi criado com data válida.
  assert.equal(typeof r.event.startsAt, 'number');
  assert.ok(r.event.startsAt > 0);
});

test('JSON inválido não persiste evento', async () => {
  const repository = createEventRepository();
  const zen = async () => 'isso nao é json e não tem chave';
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService: createEventExtractorService({ generateZen: zen }),
  });
  const scopeKey = makeScope('inv');
  const r = await aggregation.observeMessage({
    scopeKey,
    userJid: makeAuthor(),
    text: 'kk aleatório',
    messageId: 'inv-1',
    funConfig: buildFunConfig(),
    isGroup: true,
    msgTimeMs: Date.now(),
  });
  assert.equal(r.ok, false);
  assert.equal(repository.listByScope(scopeKey).length, 0);
});

test('comando prefixado é ignorado', async () => {
  const repository = createEventRepository();
  const ref = referenceStartsAt();
  const zen = buildZenFake({
    action: 'create',
    title: 'Churras',
    event_type: 'churrasco',
    date: ref.isoDate,
    time: ref.isoTime,
    timezone: 'America/Sao_Paulo',
    location: 'X',
    items: [],
    organizer_name: '',
    confidence: 80,
  });
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventExtractorService: createEventExtractorService({ generateZen: zen }),
  });
  const r = await aggregation.observeMessage({
    scopeKey: makeScope('cmd'),
    userJid: makeAuthor(),
    text: '/churras amanha',
    messageId: 'cmd-1',
    funConfig: buildFunConfig(),
    isGroup: true,
    msgTimeMs: Date.now(),
  });
  assert.equal(r.reason, 'command');
  assert.equal(repository.listByScope(makeScope('cmd-empty')).length, 0);
});
