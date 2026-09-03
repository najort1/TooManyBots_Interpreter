import { formatEventDate } from '../../events/eventTime.js';

const MIN_EVENT_ID_PREFIX_LENGTH = 4;

function shortEventId(eventId) {
  return String(eventId || '').slice(0, 8);
}

function findEventByIdPrefix(events, rawId) {
  const eventId = String(rawId || '').trim().toLowerCase();
  if (eventId.length < MIN_EVENT_ID_PREFIX_LENGTH) return { event: null, reason: 'invalid-id' };

  const matches = events.filter((event) => String(event.id).toLowerCase().startsWith(eventId));
  if (matches.length !== 1) return { event: null, reason: matches.length ? 'ambiguous-id' : 'not-found' };
  return { event: matches[0], reason: '' };
}

function formatEvent(event) {
  const lines = [
    `\`${shortEventId(event.id)}\` · *${event.title || event.eventType || 'Rolê'}*`,
    formatEventDate(event.startsAt, event.timezone) || 'Data não informada',
  ];
  if (event.extraction?.timeSource === 'assumed') lines.push('⏱️ Horário estimado pelo tipo de evento');
  if (event.location) lines.push(`📍 ${event.location}`);
  if (event.organizerName) lines.push(`Organiza: ${event.organizerName}`);
  if (event.items?.length) lines.push(`Levar: ${event.items.join(', ')}`);
  return lines.join('\n');
}

function getActiveGroupEvents(groupEventRepository, scopeKey, now = Date.now()) {
  if (!groupEventRepository?.listByScope) return null;
  groupEventRepository.markPastEvents?.(now);
  return groupEventRepository.listByScope(scopeKey, { includePast: false, limit: 100 });
}

export async function handleRolesCommand({
  scopeKey,
  isGroup,
  groupEventRepository,
  reply,
}) {
  if (!isGroup) {
    await reply('A lista de rolês é só no *grupo*.');
    return { handled: true };
  }

  const events = getActiveGroupEvents(groupEventRepository, scopeKey);
  if (!events) {
    await reply('Lista de rolês indisponível agora.');
    return { handled: true };
  }

  if (!events.length) {
    await reply('📅 *Rolês identificados*\n\nNenhum rolê ativo identificado neste grupo.');
    return { handled: true, count: 0 };
  }

  await reply(
    [
      '📅 *Rolês identificados*',
      '',
      ...events.flatMap((event, index) => [formatEvent(event), index < events.length - 1 ? '' : null]).filter((line) => line !== null),
      '',
      '_Para remover um item: `/removerrole <id>`._',
    ].join('\n')
  );
  return { handled: true, count: events.length };
}

export async function handleRemoveRoleCommand({
  scopeKey,
  isGroup,
  groupEventRepository,
  reply,
  args = [],
  msgTimeMs,
}) {
  if (!isGroup) {
    await reply('Remover rolê só no *grupo*.');
    return { handled: true };
  }

  const now = Number(msgTimeMs) || Date.now();
  const events = getActiveGroupEvents(groupEventRepository, scopeKey, now);
  if (!events) {
    await reply('Lista de rolês indisponível agora.');
    return { handled: true };
  }

  const selection = findEventByIdPrefix(events, args[0]);
  if (!selection.event) {
    if (selection.reason === 'invalid-id') {
      await reply('Use `/removerrole <id>` com o ID mostrado em `/roles`.');
    } else if (selection.reason === 'ambiguous-id') {
      await reply('Esse ID é ambíguo. Use mais caracteres do ID mostrado em `/roles`.');
    } else {
      await reply('Não encontrei esse rolê ativo na lista deste grupo. Veja `/roles`.');
    }
    return { handled: true, reason: selection.reason };
  }

  const result = groupEventRepository.updateEvent(
    selection.event.id,
    { status: 'cancelled' },
    { now }
  );
  if (!result?.ok) {
    await reply('Não consegui remover esse rolê agora. Tente novamente.');
    return { handled: true, reason: result?.reason || 'update-failed' };
  }

  await reply(
    `✅ Removi o rolê *${result.event.title || result.event.eventType || 'sem título'}* (\`${shortEventId(result.event.id)}\`) da lista.`
  );
  return { handled: true, eventId: result.event.id };
}
