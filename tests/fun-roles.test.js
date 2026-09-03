import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { createEventRepository } from '../fun/db/eventRepository.js';
import { parseFunCommand } from '../fun/commands/router.js';
import {
  handleRemoveRoleCommand,
  handleRolesCommand,
} from '../fun/commands/handlers/roles.js';
import { FUN_COMMANDS } from '../fun/constants.js';
import { zonedLocalDateTimeToMs } from '../fun/events/eventTime.js';

await initDb();

function makeScope(prefix = 'roles') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@g.us`;
}

function createDetectedEvent(repository, { scopeKey, title = 'Churrasco', source = '' } = {}) {
  const startsAt = zonedLocalDateTimeToMs({
    date: '2099-01-01',
    time: '20:00',
    timeZone: 'America/Sao_Paulo',
  });
  return repository.upsertEvent({
    event: {
      scopeKey,
      authorJid: '5511999999999@s.whatsapp.net',
      sourceMessageId: source || `message-${Math.random().toString(16).slice(2, 8)}`,
      title,
      eventType: 'churrasco',
      startsAt,
      timezone: 'America/Sao_Paulo',
      location: 'Casa do Léo',
      items: ['carvão'],
      organizerName: 'Léo',
      fingerprint: `event-${Math.random().toString(16).slice(2, 8)}`,
    },
    reminderSchedule: { threeDaysEnabled: true, threeHoursEnabled: true },
    now: startsAt - 7 * 24 * 60 * 60_000,
  });
}

test('parseFunCommand reconhece /roles e /removerrole', () => {
  assert.equal(parseFunCommand('/roles')?.command, FUN_COMMANDS.ROLES);
  assert.equal(parseFunCommand('/removerrole a1b2')?.command, FUN_COMMANDS.REMOVE_ROLE);
});

test('/roles lista somente eventos ativos do grupo com ID de remoção', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('list');
  const current = createDetectedEvent(repository, { scopeKey, title: 'Rolê da sexta' });
  const cancelled = createDetectedEvent(repository, { scopeKey, title: 'Rolê cancelado' });
  repository.updateEvent(cancelled.event.id, { status: 'cancelled' });
  createDetectedEvent(repository, { scopeKey: makeScope('other'), title: 'Outro grupo' });

  const replies = [];
  const result = await handleRolesCommand({
    scopeKey,
    isGroup: true,
    groupEventRepository: repository,
    reply: async (message) => replies.push(message),
  });

  assert.equal(result.handled, true);
  assert.equal(result.count, 1);
  assert.match(replies[0], /Rolê da sexta/);
  assert.match(replies[0], new RegExp(current.event.id.slice(0, 8)));
  assert.doesNotMatch(replies[0], /Rolê cancelado|Outro grupo/);
  assert.match(replies[0], /removerrole <id>/);
});

test('/removerrole permite a qualquer membro cancelar apenas o evento do próprio grupo', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('remove');
  const current = createDetectedEvent(repository, { scopeKey, title: 'Encontro principal' });
  const otherScope = makeScope('other');
  const other = createDetectedEvent(repository, { scopeKey: otherScope, title: 'Encontro de outro grupo' });
  const replies = [];

  const result = await handleRemoveRoleCommand({
    userJid: '5511888888888@s.whatsapp.net',
    scopeKey,
    isGroup: true,
    groupEventRepository: repository,
    args: [current.event.id.slice(0, 8)],
    msgTimeMs: Date.now(),
    reply: async (message) => replies.push(message),
  });

  assert.equal(result.handled, true);
  assert.equal(result.eventId, current.event.id);
  assert.equal(repository.getById(current.event.id).status, 'cancelled');
  assert.equal(repository.getById(other.event.id).status, 'active');
  assert.equal(repository.listDueReminders({ scopeKey, now: current.event.startsAt + 1 }).length, 0);
  assert.match(replies[0], /Removi o rolê.*Encontro principal/i);
});

test('/roles não mostra rolês passados', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('past');
  const past = repository.upsertEvent({
    event: {
      scopeKey,
      authorJid: '5511999999999@s.whatsapp.net',
      sourceMessageId: `past-${Math.random().toString(16).slice(2, 8)}`,
      title: 'Rolê antigo',
      eventType: 'encontro',
      startsAt: Date.now() - 60_000,
      timezone: 'America/Sao_Paulo',
    },
    reminderSchedule: {},
    now: Date.now() - 120_000,
  });
  const replies = [];

  await handleRolesCommand({
    scopeKey,
    isGroup: true,
    groupEventRepository: repository,
    reply: async (message) => replies.push(message),
  });

  assert.equal(repository.getById(past.event.id).status, 'past');
  assert.match(replies[0], /Nenhum rolê ativo/i);
});

test('/roles sinaliza quando o horário foi estimado', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('assumed-time');
  const created = createDetectedEvent(repository, { scopeKey, title: 'Almoção' });
  repository.updateEvent(created.event.id, {
    extraction: { timeSource: 'assumed' },
  });
  const replies = [];

  await handleRolesCommand({
    scopeKey,
    isGroup: true,
    groupEventRepository: repository,
    reply: async (message) => replies.push(message),
  });

  assert.match(replies[0], /Horário estimado/i);
});

test('/removerrole rejeita ID inexistente sem modificar eventos ativos', async () => {
  const repository = createEventRepository();
  const scopeKey = makeScope('missing');
  const current = createDetectedEvent(repository, { scopeKey });
  const replies = [];

  const result = await handleRemoveRoleCommand({
    scopeKey,
    isGroup: true,
    groupEventRepository: repository,
    args: ['abcd1234'],
    reply: async (message) => replies.push(message),
  });

  assert.equal(result.handled, true);
  assert.equal(result.reason, 'not-found');
  assert.equal(repository.getById(current.event.id).status, 'active');
  assert.match(replies[0], /Não encontrei.*\/roles/i);
});
