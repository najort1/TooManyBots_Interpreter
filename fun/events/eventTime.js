const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function parseDateParts(value) {
  const match = String(value || '').trim().match(DATE_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseTimeParts(value) {
  const match = String(value || '').trim().match(TIME_PATTERN);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function localPartsAt(timestamp, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: String(timeZone || 'America/Sao_Paulo'),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(timestamp));
    const get = (type) => Number(parts.find((part) => part.type === type)?.value);
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const hour = get('hour');
    const minute = get('minute');
    if ([year, month, day, hour, minute].every(Number.isFinite)) {
      return { year, month, day, hour, minute };
    }
  } catch {
    // O caller valida o timezone ao comparar o resultado final.
  }
  return null;
}

function sameParts(left, right) {
  return left && right && left.year === right.year && left.month === right.month && left.day === right.day && left.hour === right.hour && left.minute === right.minute;
}

/**
 * Converte data/hora local explícita em epoch milliseconds no timezone IANA.
 * Retorna 0 quando a entrada é inválida ou cai numa hora inexistente (DST).
 */
export function zonedLocalDateTimeToMs({ date, time, timeZone = 'America/Sao_Paulo' } = {}) {
  const dateParts = parseDateParts(date);
  const timeParts = parseTimeParts(time);
  if (!dateParts || !timeParts) return 0;

  const desired = { ...dateParts, ...timeParts };
  const desiredAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute);
  let candidate = desiredAsUtc;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = localPartsAt(candidate, timeZone);
    if (!observed) return 0;
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute);
    const delta = desiredAsUtc - observedAsUtc;
    if (delta === 0) break;
    candidate += delta;
  }

  return sameParts(localPartsAt(candidate, timeZone), desired) ? candidate : 0;
}

export function formatEventDate(startsAt, timeZone = 'America/Sao_Paulo') {
  const timestamp = Number(startsAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: String(timeZone || 'America/Sao_Paulo'),
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString('pt-BR');
  }
}

export function createEventFingerprint({ title = '', eventType = 'other', date = '', time = '', location = '' } = {}) {
  const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [normalize(eventType), normalize(title), normalize(date), normalize(time), normalize(location)]
    .filter(Boolean)
    .join('|')
    .slice(0, 240);
}

export function buildReminderSchedule(funConfig = {}) {
  return {
    threeDaysEnabled: funConfig.groupEventReminderThreeDaysEnabled !== false,
    threeHoursEnabled: funConfig.groupEventReminderThreeHoursEnabled !== false,
  };
}
