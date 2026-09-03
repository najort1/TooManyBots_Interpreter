import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { createEventRepository } from '../fun/db/eventRepository.js';
import { createEventAggregationService } from '../fun/events/eventAggregationService.js';
import { parseEventBatch } from '../fun/events/eventBatchExtractor.js';
import { isEventCandidate } from '../fun/events/eventExtractorService.js';
import { zonedLocalDateTimeToMs } from '../fun/events/eventTime.js';

await initDb();

function buildFunConfig(overrides = {}) {
  return {
    groupEventsEnabled: true,
    groupEventBatchSize: 40,
    groupEventBatchContextMessages: 10,
    groupEventBatchMaxRetries: 0,
    groupEventFragmentWindowMs: 30 * 60_000,
    groupEventReminderThreeDaysEnabled: true,
    groupEventReminderThreeHoursEnabled: true,
    worldTimezone: 'America/Sao_Paulo',
    zenEnabled: true,
    prefix: '/',
    ...overrides,
  };
}

function makeScope(prefix = 'det') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@g.us`;
}

function makeAuthor(index = 0) {
  return `5511${String(1_000_000 + index).padStart(8, '0')}@s.whatsapp.net`;
}

function futureStartsAt() {
  return zonedLocalDateTimeToMs({
    date: '2099-01-01',
    time: '20:00',
    timeZone: 'America/Sao_Paulo',
  });
}

function createOperation({ action = 'create', indices = [0], authorJid = makeAuthor(), title = 'Churrasco', targetEventId = '' } = {}) {
  return {
    action,
    messageIndices: indices,
    targetEventId,
    authorJid,
    event: {
      title,
      eventType: 'churrasco',
      startsAt: futureStartsAt(),
      timezone: 'America/Sao_Paulo',
      location: 'Casa do Léo',
      items: ['carvão'],
      organizerName: 'Léo',
      fingerprint: `churrasco|${title.toLowerCase()}|2099 01 01|20 00|casa do leo`,
      extraction: { confidence: 90, date: '2099-01-01', time: '20:00', timeSource: 'explicit', rawAction: action },
    },
  };
}

async function addMessages(aggregation, { scopeKey, count, start = 0, funConfig = buildFunConfig(), authors = [makeAuthor()] }) {
  for (let index = start; index < start + count; index += 1) {
    await aggregation.observeMessage({
      scopeKey,
      userJid: authors[index % authors.length],
      text: `Mensagem comum ${index}`,
      messageId: `message-${index}`,
      msgTimeMs: Date.now() + index,
      funConfig,
      isGroup: true,
    });
  }
}

async function forceBatch(aggregation, { scopeKey, funConfig, start = 0, authors }) {
  await addMessages(aggregation, { scopeKey, count: 1, start, funConfig, authors });
  aggregation._buffers.get(scopeKey).flushing = true;
  await addMessages(aggregation, { scopeKey, count: 39, start: start + 1, funConfig, authors });
  aggregation._buffers.get(scopeKey).flushing = false;
  return aggregation.flushScope(scopeKey, funConfig, Date.now() + start + 40);
}

test('isEventCandidate continua sendo um sinal barato, não um gate do lote', () => {
  assert.equal(isEventCandidate('Bora pro churrasco amanhã 19h na casa do Leo?'), true);
  assert.equal(isEventCandidate('kkk que isso mano, do nada'), false);
});

test('39 mensagens não chamam LLM; a 40ª envia todas as 40 novas', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('threshold');
  const calls = [];
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventBatchExtractor: {
      extractBatch: async (input) => {
        calls.push(input);
        return { ok: true, operations: [createOperation({ indices: [0, 39] })] };
      },
    },
  });
  const config = buildFunConfig();

  await addMessages(aggregation, { scopeKey, count: 39, funConfig: config });
  assert.equal(calls.length, 0);
  assert.equal((await aggregation.flushScope(scopeKey, config)).reason, 'too-few');

  aggregation._buffers.get(scopeKey).flushing = true;
  await addMessages(aggregation, { scopeKey, count: 1, start: 39, funConfig: config });
  aggregation._buffers.get(scopeKey).flushing = false;
  const result = await aggregation.flushScope(scopeKey, config);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].batch.length, 40);
  assert.equal(calls[0].contextCount, 0);
  assert.equal(repository.listByScope(scopeKey).length, 1);
});

test('um lote pode criar eventos independentes de autores diferentes', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('multi');
  const authors = [makeAuthor(1), makeAuthor(2)];
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventBatchExtractor: {
      extractBatch: async () => ({
        ok: true,
        operations: [
          createOperation({ indices: [0], authorJid: authors[0], title: 'Churrasco da Ana' }),
          createOperation({ indices: [1], authorJid: authors[1], title: 'Jantar do Beto' }),
        ],
      }),
    },
  });

  const result = await forceBatch(aggregation, { scopeKey, funConfig: buildFunConfig(), authors });
  const events = repository.listByScope(scopeKey);
  assert.equal(result.applied.length, 2);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.title).sort(), ['Churrasco da Ana', 'Jantar do Beto']);
});

test('lote seguinte recebe 10 mensagens de contexto e rejeita escrita só do contexto', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('continuity');
  const calls = [];
  let call = 0;
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventBatchExtractor: {
      extractBatch: async (input) => {
        calls.push(input);
        call += 1;
        return call === 1
          ? { ok: true, operations: [] }
          : { ok: true, operations: [createOperation({ indices: [9], title: 'Não deve criar' })] };
      },
    },
  });
  const config = buildFunConfig();

  await forceBatch(aggregation, { scopeKey, funConfig: config });
  await forceBatch(aggregation, { scopeKey, funConfig: config, start: 40 });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].contextCount, 10);
  assert.equal(calls[1].batch.length, 50);
  assert.equal(calls[1].batch[0].messageId, 'message-30');
  assert.equal(calls[1].batch[9].messageId, 'message-39');
  assert.equal(calls[1].batch[10].messageId, 'message-40');
  assert.equal(repository.listByScope(scopeKey).length, 0);
});

test('mensagens que chegam durante a LLM formam e drenam o próximo lote completo', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('in-flight');
  const config = buildFunConfig();
  let releaseFirst;
  const firstPending = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventBatchExtractor: {
      extractBatch: async () => {
        calls += 1;
        if (calls === 1) {
          await firstPending;
          return { ok: true, operations: [createOperation({ indices: [0], title: 'Primeiro lote' })] };
        }
        return { ok: true, operations: [createOperation({ indices: [10], title: 'Segundo lote' })] };
      },
    },
  });

  for (let index = 0; index < 40; index += 1) {
    await aggregation.observeMessage({
      scopeKey,
      userJid: makeAuthor(),
      text: `Primeiro lote ${index}`,
      messageId: `in-flight-${index}`,
      funConfig: config,
      isGroup: true,
    });
  }
  await Promise.resolve();
  assert.equal(calls, 1);

  for (let index = 40; index < 80; index += 1) {
    await aggregation.observeMessage({
      scopeKey,
      userJid: makeAuthor(),
      text: `Segundo lote ${index}`,
      messageId: `in-flight-${index}`,
      funConfig: config,
      isGroup: true,
    });
  }
  assert.equal(aggregation._buffers.get(scopeKey).messages.length, 40);

  releaseFirst();
  for (let attempt = 0; attempt < 10 && calls < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(calls, 2);
  assert.equal(repository.listByScope(scopeKey).length, 2);
});

test('falha da LLM reencadeia as 40 mensagens sem duplicar o lote', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('retry');
  let attempts = 0;
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventBatchExtractor: {
      extractBatch: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return { ok: true, operations: [createOperation({ indices: [0] })] };
      },
    },
  });
  const config = buildFunConfig();

  const first = await forceBatch(aggregation, { scopeKey, funConfig: config });
  assert.equal(first.ok, false);
  assert.equal(aggregation._buffers.get(scopeKey).messages.length, 40);
  const second = await aggregation.flushScope(scopeKey, config);

  assert.equal(second.ok, true);
  assert.equal(attempts, 2);
  assert.equal(repository.listByScope(scopeKey).length, 1);
});

test('cancelamento com target explícito cancela evento e seus lembretes', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('cancel');
  const authorJid = makeAuthor();
  const created = repository.upsertEvent({
    event: {
      scopeKey,
      authorJid,
      sourceMessageId: 'original-event',
      title: 'Churrasco',
      eventType: 'churrasco',
      startsAt: futureStartsAt(),
      timezone: 'America/Sao_Paulo',
      fingerprint: 'churrasco|original',
    },
    reminderSchedule: { threeDaysEnabled: true, threeHoursEnabled: true },
  });
  const aggregation = createEventAggregationService({
    eventRepository: repository,
    eventBatchExtractor: {
      extractBatch: async () => ({
        ok: true,
        operations: [createOperation({ action: 'cancel', indices: [0], authorJid, targetEventId: created.event.id })],
      }),
    },
  });

  await forceBatch(aggregation, { scopeKey, funConfig: buildFunConfig(), authors: [authorJid] });
  assert.equal(repository.getById(created.event.id).status, 'cancelled');
  assert.equal(repository.listDueReminders({ scopeKey, now: futureStartsAt() + 1 }).length, 0);
});

test('IDs de mensagem são comparados exatamente, sem colisão por substring', () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('source');
  repository.upsertEvent({
    event: {
      scopeKey,
      authorJid: makeAuthor(),
      sourceMessageId: 'message-1',
      title: 'Evento',
      eventType: 'other',
      startsAt: futureStartsAt(),
      timezone: 'America/Sao_Paulo',
    },
  });
  assert.equal(repository.getByAnySourceMessage({ scopeKey, messageId: 'message-1' })?.title, 'Evento');
  assert.equal(repository.getByAnySourceMessage({ scopeKey, messageId: 'message-10' }), null);
});

test('Almoção sem horário recebe 12:00 estimado somente com time_source assumed', () => {
  const batch = [{ messageId: 'almoco-1', userJid: makeAuthor(), text: 'Nosso Almoção será dia 26/09', at: Date.UTC(2026, 7, 31, 17) }];
  const operations = parseEventBatch(JSON.stringify({
    operations: [{
      action: 'create', message_indices: [0], title: 'Almoção', event_type: 'almoço',
      date: '2026-09-26', time: '12:00', time_source: 'assumed', timezone: 'America/Sao_Paulo', confidence: 90,
    }],
  }), { batch, contextCount: 0, referenceAt: Date.UTC(2026, 7, 31, 17), timeZone: 'America/Sao_Paulo' });

  assert.equal(operations.length, 1);
  assert.equal(operations[0].event.startsAt, zonedLocalDateTimeToMs({ date: '2026-09-26', time: '12:00', timeZone: 'America/Sao_Paulo' }));
  assert.equal(operations[0].event.extraction.timeSource, 'assumed');
});
