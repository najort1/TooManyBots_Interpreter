import { normalizeBoolean } from './normalization.js';

const VALID_DAYS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const DEFAULT_ALLOWED_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function normalizeAllowedDays(input) {
  const values = Array.isArray(input) ? input : [];
  const dedup = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!VALID_DAYS.has(normalized) || dedup.has(normalized)) continue;
    dedup.add(normalized);
    result.push(normalized);
  }
  return result.length > 0 ? result : [...DEFAULT_ALLOWED_DAYS];
}

function normalizeTimeRangeValue(value, fallback) {
  const normalized = String(value ?? '').trim();
  if (/^\d{2}:\d{2}$/.test(normalized)) {
    const [hours, minutes] = normalized.split(':').map(Number);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return normalized;
    }
  }
  return fallback;
}

function parseMinutesOfDay(value) {
  const [hourStr, minuteStr] = String(value ?? '00:00').split(':');
  const hours = Number(hourStr);
  const minutes = Number(minuteStr);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return (hours * 60) + minutes;
}

function isMinuteWithinRange(currentMinutes, startMinutes, endMinutes) {
  if (startMinutes === endMinutes) return true;
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Overnight window: 22:00-06:00.
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function computeEasterDateUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKeyFromUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns a map keyed by `YYYY-MM-DD` with official Brazilian national holidays
 * for the given year in the Gregorian calendar.
 *
 * @param {number} year
 * @returns {Map<string, string>}
 */
export function getBrazilNationalHolidaysByYear(year) {
  const normalizedYear = Number.isFinite(Number(year)) ? Number(year) : new Date().getUTCFullYear();
  const holidays = new Map([
    [`${normalizedYear}-01-01`, 'Confraternizacao Universal'],
    [`${normalizedYear}-04-21`, 'Tiradentes'],
    [`${normalizedYear}-05-01`, 'Dia do Trabalho'],
    [`${normalizedYear}-09-07`, 'Independencia do Brasil'],
    [`${normalizedYear}-10-12`, 'Nossa Senhora Aparecida'],
    [`${normalizedYear}-11-02`, 'Finados'],
    [`${normalizedYear}-11-15`, 'Proclamacao da Republica'],
    [`${normalizedYear}-11-20`, 'Dia Nacional de Zumbi e da Consciencia Negra'],
    [`${normalizedYear}-12-25`, 'Natal'],
  ]);

  const easter = computeEasterDateUtc(normalizedYear);
  const goodFriday = new Date(easter.getTime() - (2 * 24 * 60 * 60 * 1000));
  holidays.set(dateKeyFromUtcDate(goodFriday), 'Sexta-Feira Santa');

  return holidays;
}

function formatLocalParts(nowTs, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(new Date(nowTs));
    const asObject = {};
    for (const part of parts) {
      asObject[part.type] = part.value;
    }
    return {
      weekday: String(asObject.weekday || '').toLowerCase(),
      year: Number(asObject.year || 0),
      month: Number(asObject.month || 0),
      day: Number(asObject.day || 0),
      hour: Number(asObject.hour || 0),
      minute: Number(asObject.minute || 0),
      timezone,
    };
  } catch {
    if (timezone !== DEFAULT_TIMEZONE) {
      return formatLocalParts(nowTs, DEFAULT_TIMEZONE);
    }
    const local = new Date(nowTs);
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return {
      weekday: weekdays[local.getDay()],
      year: local.getFullYear(),
      month: local.getMonth() + 1,
      day: local.getDate(),
      hour: local.getHours(),
      minute: local.getMinutes(),
      timezone: DEFAULT_TIMEZONE,
    };
  }
}

function resolveDateKey(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * Normalizes availability configuration and returns a canonical representation.
 *
 * @param {Record<string, unknown>} [rawConfig={}]
 * @returns {{
 *   restrictBySchedule: boolean,
 *   allowedDays: string[],
 *   timeRangeStart: string,
 *   timeRangeEnd: string,
 *   outsideScheduleMessage: string,
 *   includeBrazilNationalHolidays: boolean,
 *   timezone: string
 * }}
 */
export function normalizeAvailabilityConfig(rawConfig = {}) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    restrictBySchedule: normalizeBoolean(config.restrictBySchedule, false),
    allowedDays: normalizeAllowedDays(config.allowedDays),
    timeRangeStart: normalizeTimeRangeValue(config.timeRangeStart, '08:00'),
    timeRangeEnd: normalizeTimeRangeValue(config.timeRangeEnd, '18:00'),
    outsideScheduleMessage:
      String(config.outsideScheduleMessage ?? 'Nosso atendimento esta fora do horario configurado.').trim() ||
      'Nosso atendimento esta fora do horario configurado.',
    includeBrazilNationalHolidays: normalizeBoolean(config.includeBrazilNationalHolidays, false),
    timezone: String(config.timezone ?? DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
  };
}

/**
 * Evaluates whether the current timestamp is within the configured schedule.
 *
 * @param {Record<string, unknown>} [rawConfig={}]
 * @param {{ nowTs?: number }} [options={}]
 * @returns {{
 *   available: boolean,
 *   reason: 'disabled' | 'day' | 'time' | 'holiday' | 'ok',
 *   dateKey: string,
 *   weekday: string,
 *   timezone: string
 * }}
 */
export function evaluateAvailability(rawConfig = {}, { nowTs = Date.now() } = {}) {
  const config = normalizeAvailabilityConfig(rawConfig);
  if (!config.restrictBySchedule) {
    return {
      available: true,
      reason: 'disabled',
      dateKey: '',
      weekday: '',
      timezone: config.timezone,
    };
  }

  const parts = formatLocalParts(nowTs, config.timezone);
  const dateKey = resolveDateKey(parts);

  if (config.includeBrazilNationalHolidays) {
    const holidays = getBrazilNationalHolidaysByYear(parts.year);
    if (holidays.has(dateKey)) {
      return {
        available: false,
        reason: 'holiday',
        dateKey,
        weekday: parts.weekday,
        timezone: parts.timezone,
      };
    }
  }

  if (!config.allowedDays.includes(parts.weekday)) {
    return {
      available: false,
      reason: 'day',
      dateKey,
      weekday: parts.weekday,
      timezone: parts.timezone,
    };
  }

  const startMinutes = parseMinutesOfDay(config.timeRangeStart);
  const endMinutes = parseMinutesOfDay(config.timeRangeEnd);
  const currentMinutes = (parts.hour * 60) + parts.minute;
  if (!isMinuteWithinRange(currentMinutes, startMinutes, endMinutes)) {
    return {
      available: false,
      reason: 'time',
      dateKey,
      weekday: parts.weekday,
      timezone: parts.timezone,
    };
  }

  return {
    available: true,
    reason: 'ok',
    dateKey,
    weekday: parts.weekday,
    timezone: parts.timezone,
  };
}
