const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

function dateParts(timestamp, timeZone) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value));
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

export function resolveFactTimeZone(timeZone) {
  return String(timeZone || DEFAULT_TIME_ZONE);
}

export function formatFactDate(timestamp, timeZone = DEFAULT_TIME_ZONE) {
  return dateParts(timestamp, resolveFactTimeZone(timeZone)) || 'data-desconhecida';
}

export function factCreatedAt(fact) {
  return Number(fact?.createdAt || fact?.firstSeenAt || fact?.updatedAt) || 0;
}

export function formatDatedFact(fact, text, timeZone = DEFAULT_TIME_ZONE) {
  return `[data_do_fato=${formatFactDate(factCreatedAt(fact), timeZone)}] ${String(text || '').trim()}`;
}

export function buildFactTemporalContext({ now = Date.now(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  const tz = resolveFactTimeZone(timeZone);
  return [
    '<contexto_temporal_dos_fatos>',
    `data_atual=${formatFactDate(now, tz)}`,
    `fuso=${tz}`,
    'Interprete "hoje", "ontem", "amanhã" e outras referências relativas a partir de data_do_fato, nunca da data atual. Antes de tratar algo como futuro, compare data_do_fato com data_atual.',
    '</contexto_temporal_dos_fatos>',
  ].join('\n');
}
