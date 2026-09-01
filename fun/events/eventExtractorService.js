import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { looseParseFacts } from '../services/groupMemoryService.js';
import { createEventFingerprint, zonedLocalDateTimeToMs } from './eventTime.js';

const ACTIONS = new Set(['create', 'update', 'cancel', 'ignore']);
const EVENT_HINT_PATTERN = /\b(churras(?:co)?|rol[eê]|encontro|festa|balada|anivers[aá]rio|reuni[aã]o|jantar|almo[cç]o|caf[eé]|vai ter|bora|confirmad[oa]|adiad[oa]|cancelad[oa]|s[aá]bado|domingo|amanh[aã]|hoje|\d{1,2}[\/-]\d{1,2}|\d{1,2}h\d{0,2})\b/i;

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function trimText(value, max) {
  return text(value).replace(/[\r\n]+/g, ' ').slice(0, max);
}

function normalizeItems(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const items = [];
  for (const item of value) {
    const entry = trimText(item, 160);
    const key = entry.toLocaleLowerCase('pt-BR');
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    items.push(entry);
    if (items.length >= 20) break;
  }
  return items;
}

function extractJsonObject(raw) {
  const source = text(raw);
  if (!source) return null;
  const candidates = [source];
  const object = source.match(/\{[\s\S]*\}/)?.[0];
  if (object && object !== source) candidates.push(object);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // O fallback abaixo reaproveita a estratégia tolerante da memória.
    }
  }
  return null;
}

function recoverLooseEvent(raw) {
  const facts = looseParseFacts(raw);
  const summary = facts[0]?.summary || '';
  const source = String(raw || '');
  const field = (name) => source.match(new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i'))?.[1] || '';
  const action = field('action').toLowerCase();
  return {
    action: ACTIONS.has(action) ? action : 'ignore',
    title: summary,
    event_type: field('event_type') || field('type') || 'other',
    date: field('date'),
    time: field('time'),
    timezone: field('timezone'),
    location: field('location'),
    organizer_name: field('organizer_name'),
  };
}

function normalizeAction(value) {
  const action = text(value).toLowerCase();
  return ACTIONS.has(action) ? action : 'ignore';
}

function isPlausibleDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
}

function isPlausibleTime(value) {
  return /^\d{1,2}:\d{2}$/.test(text(value));
}

function buildSystem(referenceAt, timeZone) {
  return [
    'Você extrai anúncios reais de eventos de grupos brasileiros do WhatsApp.',
    'Não invente data, hora, local, itens ou organizador. Gírias e textos fragmentados são normais.',
    'Responda SOMENTE um objeto JSON. Use action: create, update, cancel ou ignore.',
    'Para create/update, só use action diferente de ignore quando houver data e hora explícitas ou inequivocamente resolvíveis a partir da referência.',
    'Use date no formato YYYY-MM-DD e time no formato HH:mm no timezone informado.',
    'Eventos do passado e conversa hipotética devem ser ignore. Cancelamento só quando a mensagem o disser explicitamente.',
    `Referência temporal da mensagem: ${new Date(referenceAt).toISOString()}. Timezone padrão: ${timeZone}.`,
    'Schema: {"action":"ignore|create|update|cancel","title":"","event_type":"","date":"YYYY-MM-DD","time":"HH:mm","timezone":"","location":"","items":[],"organizer_name":"","confidence":0}.',
  ].join('\n');
}

function buildPrompt({ text: messageText, quotedText, mentionedJids, fragmentText }) {
  return [
    `Mensagem atual:\n${trimText(messageText, 1_600)}`,
    quotedText ? `Mensagem citada:\n${trimText(quotedText, 700)}` : '',
    fragmentText ? `Fragmentos anteriores do mesmo autor:\n${trimText(fragmentText, 1_600)}` : '',
    mentionedJids?.length ? `Menções presentes: ${mentionedJids.join(', ')}` : '',
  ].filter(Boolean).join('\n\n');
}

function normalizeExtraction(raw, { referenceAt, timeZone }) {
  const parsed = extractJsonObject(raw) || recoverLooseEvent(raw);
  const action = normalizeAction(parsed?.action);
  if (action === 'ignore') return { ok: false, reason: 'not-announcement' };

  const date = text(parsed?.date || parsed?.event_date);
  const time = text(parsed?.time || parsed?.event_time);
  const zone = text(parsed?.timezone, timeZone);
  const startsAt = isPlausibleDate(date) && isPlausibleTime(time)
    ? zonedLocalDateTimeToMs({ date, time, timeZone: zone })
    : 0;

  if (action !== 'cancel' && !startsAt) {
    return { ok: false, reason: 'insufficient-date' };
  }

  const confidence = Math.max(0, Math.min(100, Number(parsed?.confidence) || 0));
  const eventType = trimText(parsed?.event_type || parsed?.type || 'other', 48);
  const title = trimText(parsed?.title || parsed?.name || eventType, 180);
  const location = trimText(parsed?.location, 240);
  const organizerName = trimText(parsed?.organizer_name || parsed?.organizer, 120);
  const items = normalizeItems(parsed?.items || parsed?.bring || parsed?.what_to_bring);

  return {
    ok: true,
    action,
    event: {
      title,
      eventType,
      startsAt,
      timezone: zone,
      location,
      items,
      organizerName,
      fingerprint: createEventFingerprint({ title, eventType, date, time, location }),
      extraction: {
        confidence,
        date,
        time,
        rawAction: action,
      },
    },
  };
}

export function isEventCandidate(textValue) {
  const content = text(textValue);
  return content.length >= 8 && EVENT_HINT_PATTERN.test(content);
}

export { isEventCandidate as shouldExtractEvent };

export function createEventExtractorService({ generateZen = openaiChatComplete, getLogger = () => null } = {}) {
  const logger = getLogger();

  async function extractAnnouncement({ text: messageText, quotedText = '', mentionedJids = [], msgTimeMs = Date.now(), funConfig = {}, fragmentText = '', bypassSignalCheck = false } = {}) {
    if (funConfig.groupEventsEnabled === false) return { ok: false, reason: 'disabled' };
    const candidateText = [messageText, fragmentText].filter(Boolean).join('\n');
    if (!bypassSignalCheck && !isEventCandidate(candidateText)) return { ok: false, reason: 'no-signal' };
    if (funConfig.zenEnabled === false || process.env.FUN_DISABLE_LIVE_LLM === '1') {
      return { ok: false, reason: 'llm-disabled' };
    }

    const referenceAt = Number(msgTimeMs) || Date.now();
    const timeZone = text(funConfig.worldTimezone, 'America/Sao_Paulo');
    const zen = resolveZenTaskParams('extract', funConfig);
    const endpoint = resolveZenEndpoint(funConfig);
    try {
      const raw = await generateZen({
        baseUrl: endpoint.baseUrl,
        model: endpoint.model,
        apiKey: endpoint.apiKey,
        system: buildSystem(referenceAt, timeZone),
        prompt: buildPrompt({ text: messageText, quotedText, mentionedJids, fragmentText }),
        timeoutMs: zen.timeoutMs,
        maxTokens: zen.maxTokens,
        temperature: zen.temperature,
        jsonMode: true,
        jsonOnly: true,
        sendSamplingParams: funConfig.zenSendSamplingParams,
      });
      return normalizeExtraction(raw, { referenceAt, timeZone });
    } catch (error) {
      logger?.debug?.('[eventExtractor] Zen falhou: %s', String(error?.message || error));
      return { ok: false, reason: 'llm-error' };
    }
  }

  return { extractAnnouncement, isEventCandidate };
}
