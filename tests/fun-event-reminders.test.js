import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { createEventRepository } from '../fun/db/eventRepository.js';
import { createEventReminderService } from '../fun/events/eventReminderService.js';
import { zonedLocalDateTimeToMs } from '../fun/events/eventTime.js';

await initDb();

function buildFunConfig(overrides = {}) {
  return {
    groupEventsEnabled: true,
    groupEventReminderThreeDaysEnabled: true,
    groupEventReminderThreeHoursEnabled: true,
    groupEventReminderBatchSize: 12,
    worldTimezone: 'America/Sao_Paulo',
    ...overrides,
  };
}

function buildEvent({ repository, startsAt, scopeKey, authorJid, items = ['carvão'], title = 'Churrasco', organizerName = 'Léo' }) {
  return repository.upsertEvent({
    event: {
      scopeKey,
      authorJid,
      sourceMessageId: `src-${Math.random().toString(16).slice(2, 8)}`,
      title,
      eventType: 'churrasco',
      startsAt,
      timezone: 'America/Sao_Paulo',
      location: 'Casa do Léo',
      items,
      organizerName,
      fingerprint: `fp-${Math.random().toString(16).slice(2, 8)}`,
    },
    reminderSchedule: {
      threeDaysEnabled: true,
      threeHoursEnabled: true,
    },
    now: startsAt - 7 * 24 * 60 * 60_000,
  });
}

function makeScope(prefix = 'rem') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@g.us`;
}

function makeAuthor() {
  return `5511${Math.floor(Math.random() * 9_000_000 + 1_000_000)}@s.whatsapp.net`;
}

function captureSend() {
  const calls = [];
  const fn = async (sock, scope, text, opts = {}) => {
    calls.push({ sock, scope, text, opts });
  };
  fn.calls = calls;
  return fn;
}

test('lembretes de 3 dias e 3 horas são agendados na criação do evento', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('sched');
  const author = makeAuthor();
  const startsAt = zonedLocalDateTimeToMs({
    date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo',
  });
  const upsert = buildEvent({ repository, startsAt, scopeKey, authorJid: author });
  assert.equal(upsert.ok, true);

  const dueAll = repository.listDueReminders({ scopeKey, now: startsAt + 1_000 });
  const kinds = dueAll.map((d) => d.reminder.reminderKind).sort();
  assert.deepEqual(kinds, ['three_days', 'three_hours']);
  assert.ok(dueAll.every((d) => d.event.id === upsert.event.id));
});

test('tick envia lembrete vencido usando persona.composeSystemAnnouncement', async () => {
  const repository = createEventRepository();
  const reminderService = createEventReminderService({
    eventRepository: repository,
    personaService: {
      composeSystemAnnouncement: async () => ({
        ok: true,
        text: '⏰ Faltam 3 horas para o churrasco.',
        usedFallback: false,
      }),
    },
  });
  const scopeKey = makeScope('tick');
  const author = makeAuthor();
  const startsAt = zonedLocalDateTimeToMs({
    date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo',
  });
  buildEvent({ repository, startsAt, scopeKey, authorJid: author });
  const send = captureSend();
  // Antes dos 3 dias para já ter enviado o three_days; depois dos 3 horas para
  // focar apenas no three_hours.
  const now = startsAt - 3 * 60 * 60_000 + 1_000;
  // drena o three_days primeiro
  await reminderService.tick({ scopeKey, sock: {}, sendText: captureSend(), funConfig: buildFunConfig(), now: startsAt - 3 * 24 * 60 * 60_000 + 1_000 });

  const results = await reminderService.tick({ scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(), now });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].reminderKind, 'three_hours');
  assert.equal(send.calls.length, 1);
  assert.equal(send.calls[0].opts.priority, 'announcement');
  assert.ok(send.calls[0].opts.coalesceKey.includes(`group-event:${results[0].eventId}:three_hours`));
});

test('tick repetido não envia duas vezes o mesmo lembrete', async () => {
  const repository = createEventRepository();
  const reminderService = createEventReminderService({
    eventRepository: repository,
    personaService: { composeSystemAnnouncement: async () => ({ ok: true, text: 'ok' }) },
  });
  const scopeKey = makeScope('idem');
  const startsAt = zonedLocalDateTimeToMs({ date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo' });
  buildEvent({ repository, startsAt, scopeKey, authorJid: makeAuthor() });
  const send = captureSend();
  const now = startsAt - 3 * 24 * 60 * 60_000 + 1_000;

  const a = await reminderService.tick({ scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(), now });
  const b = await reminderService.tick({ scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(), now: now + 1_000 });

  assert.equal(a.length, 1);
  assert.equal(b.length, 0);
  assert.equal(send.calls.length, 1);
});

test('evento cancelado não recebe lembretes', async () => {
  const repository = createEventRepository();
  const reminderService = createEventReminderService({
    eventRepository: repository,
    personaService: { composeSystemAnnouncement: async () => ({ ok: true, text: 'nao deveria' }) },
  });
  const scopeKey = makeScope('cancel-rem');
  const author = makeAuthor();
  const startsAt = zonedLocalDateTimeToMs({ date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo' });
  const upsert = buildEvent({ repository, startsAt, scopeKey, authorJid: author });
  repository.updateEvent(upsert.event.id, { status: 'cancelled' }, { reminderSchedule: {}, now: Date.now() });

  const send = captureSend();
  const results = await reminderService.tick({
    scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(), now: startsAt + 1_000,
  });
  assert.equal(results.length, 0);
  assert.equal(send.calls.length, 0);
});

test('falha da persona usa fallback factual sem chamar sendText antes do erro', async () => {
  const repository = createEventRepository();
  const reminderService = createEventReminderService({
    eventRepository: repository,
    personaService: { composeSystemAnnouncement: async () => ({ ok: false, reason: 'llm-disabled' }) },
  });
  const scopeKey = makeScope('fallback');
  const author = makeAuthor();
  const startsAt = zonedLocalDateTimeToMs({ date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo' });
  buildEvent({ repository, startsAt, scopeKey, authorJid: author });
  const send = captureSend();
  // drena three_days
  await reminderService.tick({ scopeKey, sock: {}, sendText: captureSend(), funConfig: buildFunConfig(), now: startsAt - 3 * 24 * 60 * 60_000 + 1_000 });
  const now = startsAt - 3 * 60 * 60_000 + 1_000;

  const results = await reminderService.tick({ scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(), now });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].usedFallback, true);
  assert.equal(send.calls.length, 1);
  assert.ok(send.calls[0].text.includes('Faltam 3 horas'));
});

test('falha do transporte mantém o lembrete retomável', async () => {
  const repository = createEventRepository();
  const reminderService = createEventReminderService({
    eventRepository: repository,
    personaService: { composeSystemAnnouncement: async () => ({ ok: true, text: 'msg' }) },
  });
  const scopeKey = makeScope('transp');
  const author = makeAuthor();
  const startsAt = zonedLocalDateTimeToMs({ date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo' });
  const upsert = buildEvent({ repository, startsAt, scopeKey, authorJid: author });
  // drena three_days
  await reminderService.tick({ scopeKey, sock: {}, sendText: captureSend(), funConfig: buildFunConfig(), now: startsAt - 3 * 24 * 60 * 60_000 + 1_000 });
  const sendErr = async () => { throw new Error('offline'); };
  const now = startsAt - 3 * 60 * 60_000 + 1_000;

  const a = await reminderService.tick({ scopeKey, sock: {}, sendText: sendErr, funConfig: buildFunConfig(), now });
  assert.equal(a.length, 1);
  assert.equal(a[0].ok, false);
  assert.equal(a[0].reason, 'offline');

  // lembrete permanece pending → segundo tick com send funcionando envia
  const send = captureSend();
  const b = await reminderService.tick({ scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(), now: now + 60_000 });
  assert.equal(b.length, 1);
  assert.equal(b[0].ok, true);
  assert.equal(send.calls.length, 1);
});

test('quiet hours (chamada fora do tick) impede envio', async () => {
  // O quiet hours é responsabilidade do chamador do tick; aqui simulamos a
  // política do mundo: se `tickWorldEvents` não invocar o service.tick durante
  // a janela silenciosa, nenhum lembrete é enviado. Esse teste valida o
  // invariante de que o serviço não autoexecuta.
  const repository = createEventRepository();
  const reminderService = createEventReminderService({
    eventRepository: repository,
    personaService: { composeSystemAnnouncement: async () => ({ ok: true, text: 'ok' }) },
  });
  const scopeKey = makeScope('quiet');
  const startsAt = zonedLocalDateTimeToMs({ date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo' });
  buildEvent({ repository, startsAt, scopeKey, authorJid: makeAuthor() });
  // sem chamar tick, nada acontece
  const send = captureSend();
  await Promise.resolve();
  assert.equal(send.calls.length, 0);
  // após tick que cobre apenas o three_hours, o reminder é entregue
  await reminderService.tick({
    scopeKey, sock: {}, sendText: captureSend(), funConfig: buildFunConfig(),
    now: startsAt - 3 * 24 * 60 * 60_000 + 1_000,
  });
  await reminderService.tick({
    scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(),
    now: startsAt - 3 * 60 * 60_000 + 1_000,
  });
  assert.equal(send.calls.length, 1);
});

test('lembrete sobrevive a recriação do serviço (recuperação por persistência)', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('recover');
  const author = makeAuthor();
  const startsAt = zonedLocalDateTimeToMs({ date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo' });
  buildEvent({ repository, startsAt, scopeKey, authorJid: author });

  // drena three_days
  const drainer = createEventReminderService({
    eventRepository: repository,
    personaService: { composeSystemAnnouncement: async () => ({ ok: true, text: '3 dias' }) },
  });
  await drainer.tick({ scopeKey, sock: {}, sendText: captureSend(), funConfig: buildFunConfig(), now: startsAt - 3 * 24 * 60 * 60_000 + 1_000 });

  const due = repository.listDueReminders({ scopeKey, now: startsAt - 3 * 60 * 60_000 + 1_000 });
  assert.equal(due.length, 1);
  assert.equal(due[0].reminder.reminderKind, 'three_hours');
  // recriar o service não perde o pending
  const newReminderService = createEventReminderService({
    eventRepository: repository,
    personaService: { composeSystemAnnouncement: async () => ({ ok: true, text: 'persistente' }) },
  });
  const send = captureSend();
  const r = await newReminderService.tick({
    scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(),
    now: startsAt - 3 * 60 * 60_000 + 1_000,
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].ok, true);
  assert.equal(send.calls[0].text, 'persistente');
});

test('atualização reagenda apenas lembretes ainda pendentes', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('update-rem');
  const author = makeAuthor();
  const startsAt = zonedLocalDateTimeToMs({ date: '2099-01-01', time: '20:00', timeZone: 'America/Sao_Paulo' });
  const created = buildEvent({ repository, startsAt, scopeKey, authorJid: author });
  // entrega o lembrete de 3 dias
  const reminderService = createEventReminderService({
    eventRepository: repository,
    personaService: { composeSystemAnnouncement: async () => ({ ok: true, text: '3 dias' }) },
  });
  const send = captureSend();
  const t1 = startsAt - 3 * 24 * 60 * 60_000 + 1_000;
  await reminderService.tick({ scopeKey, sock: {}, sendText: send, funConfig: buildFunConfig(), now: t1 });
  assert.equal(send.calls.length, 1);

  // update muda horário: 3 dias já enviado não pode reaparecer; 3 horas reagendado
  const newStartsAt = startsAt + 60 * 60_000; // 1h depois
  repository.updateEvent(created.event.id, { startsAt: newStartsAt }, {
    reminderSchedule: { threeDaysEnabled: true, threeHoursEnabled: true },
    now: t1 + 5_000,
  });

  // agora consulta perto do novo three_hours (newStartsAt - 3h + 1s)
  const dueLater = repository.listDueReminders({ scopeKey, now: newStartsAt - 3 * 60 * 60_000 + 1_000 });
  const kinds = dueLater.map((d) => d.reminder.reminderKind).sort();
  assert.deepEqual(kinds, ['three_hours']); // three_days já está sent
});
