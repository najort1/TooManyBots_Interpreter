import { formatEventDate } from './eventTime.js';

function text(value) {
  return String(value ?? '').trim();
}

function fallbackReminder(event, reminderKind) {
  const timing = reminderKind === 'three_days' ? 'Faltam 3 dias' : 'Faltam 3 horas';
  const title = text(event.title, event.eventType || 'evento');
  const when = formatEventDate(event.startsAt, event.timezone);
  const lines = [`⏰ *${timing}*: ${title}.`];
  if (when) lines.push(`📅 ${when}`);
  if (event.location) lines.push(`📍 ${event.location}`);
  if (event.items?.length) lines.push(`🎒 Levar: ${event.items.join(', ')}`);
  return lines.join('\n');
}

export function createEventReminderService({ eventRepository, personaService = null, getLogger = () => null } = {}) {
  if (!eventRepository) throw new Error('[eventReminderService] eventRepository required');
  const logger = getLogger();

  async function composeReminder(event, reminderKind, funConfig, now) {
    const fallback = fallbackReminder(event, reminderKind);
    if (typeof personaService?.composeSystemAnnouncement !== 'function') {
      return { text: fallback, usedFallback: true, reason: 'persona-unavailable' };
    }
    const generated = await personaService.composeSystemAnnouncement({
      scopeKey: event.scopeKey,
      kind: 'event-reminder',
      data: {
        lead_time: reminderKind === 'three_days' ? 'faltam 3 dias' : 'faltam 3 horas',
        evento: event.title || event.eventType,
        quando: formatEventDate(event.startsAt, event.timezone),
        local: event.location,
        levar: event.items || [],
        organizador: event.organizerName,
      },
      funConfig,
      now,
    });
    const message = text(generated?.text);
    return message
      ? { text: message, usedFallback: false }
      : { text: fallback, usedFallback: true, reason: generated?.reason || 'persona-empty' };
  }

  /**
   * Executado pelo world tick depois do gate de quiet hours. O claim persistente
   * impede que ticks repetidos enviem duas vezes o mesmo lembrete.
   */
  async function tick({ scopeKey, sock, sendText, funConfig = {}, now = Date.now() } = {}) {
    const scope = text(scopeKey);
    if (!scope.endsWith('@g.us')) return [];
    if (funConfig.groupEventsEnabled === false) return [];
    if (!sock || typeof sendText !== 'function') return [];

    const due = eventRepository.listDueReminders({
      scopeKey: scope,
      now,
      limit: funConfig.groupEventReminderBatchSize,
    });
    const results = [];
    for (const entry of due) {
      const { event, reminder } = entry;
      if (event.status !== 'active') {
        continue;
      }
      const claimed = eventRepository.claimReminder({
        eventId: reminder.eventId,
        reminderKind: reminder.reminderKind,
        now,
      });
      if (!claimed) continue;

      try {
        const message = await composeReminder(event, claimed.reminderKind, funConfig, now);
        await sendText(sock, scope, message.text, {
          priority: 'announcement',
          coalesceKey: `group-event:${event.id}:${claimed.reminderKind}`,
        });
        const marked = eventRepository.markReminderSent({
          eventId: claimed.eventId,
          reminderKind: claimed.reminderKind,
          leaseToken: claimed.leaseToken,
          now,
        });
        results.push({
          scopeKey: scope,
          kind: 'event-reminder',
          eventId: event.id,
          reminderKind: claimed.reminderKind,
          ok: marked,
          usedFallback: message.usedFallback,
          reason: marked ? null : 'lease-lost',
        });
      } catch (error) {
        const reason = text(error?.message, 'send-error');
        eventRepository.releaseReminder({
          eventId: claimed.eventId,
          reminderKind: claimed.reminderKind,
          leaseToken: claimed.leaseToken,
          error: reason,
          now,
        });
        logger?.warn?.('[eventReminder] envio falhou: %s', reason);
        results.push({
          scopeKey: scope,
          kind: 'event-reminder',
          eventId: event.id,
          reminderKind: claimed.reminderKind,
          ok: false,
          reason,
        });
      }
    }
    return results;
  }

  return { tick, composeReminder, fallbackReminder };
}
