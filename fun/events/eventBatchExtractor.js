import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { createEventFingerprint, zonedLocalDateTimeToMs } from './eventTime.js';

const ACTIONS = new Set(['create', 'update', 'cancel', 'ignore']);
const ASSUMED_TIME_BY_TYPE = Object.freeze([
  { pattern: /\b(?:almo[cç]o|almo[cç][aã]o)\b/i, time: '12:00' },
  { pattern: /\b(?:jantar|jantinha)\b/i, time: '20:00' },
  { pattern: /\bcaf[eé](?:\s+da\s+manh[aã])?\b/i, time: '09:00' },
]);

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

function isPlausibleDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
}

function isPlausibleTime(value) {
  return /^\d{1,2}:\d{2}$/.test(text(value));
}

function normalizeAction(value) {
  const action = text(value).toLowerCase();
  return ACTIONS.has(action) ? action : 'ignore';
}

function parseJsonObject(raw) {
  const source = text(raw);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {
    const wrapped = source.match(/\{[\s\S]*\}/)?.[0];
    if (!wrapped) return null;
    try {
      return JSON.parse(wrapped);
    } catch {
      return null;
    }
  }
}

function dateTimeLabel(value) {
  const at = Number(value);
  if (!Number.isFinite(at) || at <= 0) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      dateStyle: 'short',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString();
  }
}

function assumedTime(title, eventType) {
  const subject = `${text(eventType)} ${text(title)}`;
  return ASSUMED_TIME_BY_TYPE.find((rule) => rule.pattern.test(subject))?.time || '';
}

function formatMessage(message, index, contextCount, messageMaxChars) {
  const kind = index < contextCount ? 'CONTEXTO' : 'NOVA';
  const author = trimText(message?.name || message?.userJid || 'Participante', 80);
  const body = trimText(message?.text, messageMaxChars);
  const extras = [
    message?.quotedText ? `citada: ${trimText(message.quotedText, 180)}` : '',
    Array.isArray(message?.mentionedJids) && message.mentionedJids.length
      ? `menções: ${message.mentionedJids.slice(0, 8).join(', ')}`
      : '',
  ].filter(Boolean);
  return `[${index}] ${kind} · ${dateTimeLabel(message?.at)} · ${author}: ${body}${extras.length ? ` (${extras.join(' · ')})` : ''}`;
}

function formatActiveEvents(events) {
  if (!events.length) return 'Nenhum evento ativo persistido.';
  return events.map((event) => [
    `id=${event.id}`,
    `autor=${event.authorJid}`,
    `título=${event.title}`,
    `tipo=${event.eventType}`,
    `início=${dateTimeLabel(event.startsAt)}`,
    `local=${event.location || '-'}`,
  ].join(' | ')).join('\n');
}

function buildSystem({ referenceAt, timeZone, contextCount }) {
  return [
    'Você extrai anúncios reais de eventos em grupos brasileiros de WhatsApp.',
    'Responda SOMENTE JSON válido no schema: {"operations":[...]}.',
    'Cada operation: {"action":"create|update|cancel|ignore","message_indices":[0],"target_event_id":"","title":"","event_type":"","date":"YYYY-MM-DD","time":"HH:mm","time_source":"explicit|assumed","timezone":"","location":"","items":[],"organizer_name":"","confidence":0}.',
    'message_indices deve apontar somente linhas que comprovam a operação. Para create, update ou cancel, inclua ao menos uma linha marcada NOVA. Linhas CONTEXTO apenas ajudam a entender continuidade e NUNCA podem, sozinhas, provocar escrita.',
    'Extraia todas as operações independentes presentes no lote. Não invente eventos, local, data, itens, organizador ou cancelamento.',
    'Para update/cancel, use target_event_id somente da lista de eventos ativos fornecida. Cancelamento precisa ser explícito e inequívoco.',
    'Para create/update, data é obrigatória. Horário explícito usa time_source="explicit". Sem horário, você SÓ pode usar time_source="assumed" para almoço/almoção=12:00, jantar=20:00 ou café=09:00; em qualquer outro caso ignore a operação.',
    'Eventos passados ou hipotéticos devem ser ignore. confidence é 0 a 100.',
    `Referência temporal: ${new Date(referenceAt).toISOString()}. Timezone padrão: ${timeZone}. Linhas iniciais de CONTEXTO: ${contextCount}.`,
  ].join('\n');
}

function normalizeMessageIndices(value, batchSize, contextCount) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const indices = [];
  for (const raw of value) {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= batchSize || seen.has(index)) continue;
    seen.add(index);
    indices.push(index);
  }
  indices.sort((left, right) => left - right);
  if (!indices.length || !indices.some((index) => index >= contextCount)) return [];
  return indices;
}

function normalizeOperation(raw, { batch, contextCount, referenceAt, timeZone }) {
  const action = normalizeAction(raw?.action);
  if (action === 'ignore') return null;

  const messageIndices = normalizeMessageIndices(raw?.message_indices, batch.length, contextCount);
  if (!messageIndices.length) return null;

  const title = trimText(raw?.title || raw?.name, 180);
  const eventType = trimText(raw?.event_type || raw?.type || 'other', 48);
  const date = text(raw?.date || raw?.event_date);
  const requestedTimeSource = text(raw?.time_source).toLowerCase();
  const rawTime = text(raw?.time || raw?.event_time);
  const defaultTime = requestedTimeSource === 'assumed' ? assumedTime(title, eventType) : '';
  const explicitTime = requestedTimeSource === 'assumed' ? '' : rawTime;
  const time = explicitTime || defaultTime;
  const timeSource = explicitTime ? 'explicit' : defaultTime ? 'assumed' : '';
  const timezone = text(raw?.timezone, timeZone);
  const startsAt = isPlausibleDate(date) && isPlausibleTime(time)
    ? zonedLocalDateTimeToMs({ date, time, timeZone: timezone })
    : 0;

  if (action !== 'cancel' && (!startsAt || startsAt < Number(referenceAt) - 60_000)) return null;

  const primaryNewIndex = messageIndices.find((index) => index >= contextCount);
  const authorJid = text(batch[primaryNewIndex]?.userJid);
  if (!authorJid) return null;

  const location = trimText(raw?.location, 240);
  const organizerName = trimText(raw?.organizer_name || raw?.organizer, 120);
  const items = normalizeItems(raw?.items || raw?.bring || raw?.what_to_bring);
  const confidence = Math.max(0, Math.min(100, Math.round(Number(raw?.confidence) || 0)));

  return {
    action,
    messageIndices,
    targetEventId: trimText(raw?.target_event_id, 120),
    authorJid,
    event: {
      title: title || eventType,
      eventType,
      startsAt,
      timezone,
      location,
      items,
      organizerName,
      fingerprint: createEventFingerprint({ title: title || eventType, eventType, date, time, location }),
      extraction: {
        confidence,
        date,
        time,
        timeSource,
        rawAction: action,
      },
    },
  };
}

export function parseEventBatch(raw, {
  batch = [],
  contextCount = 0,
  referenceAt = Date.now(),
  timeZone = 'America/Sao_Paulo',
  maxOperations = 12,
} = {}) {
  const parsed = parseJsonObject(raw);
  const candidates = Array.isArray(parsed?.operations)
    ? parsed.operations
    : parsed && typeof parsed === 'object' ? [parsed] : [];
  const operations = [];
  const cap = Math.min(20, Math.max(1, Number(maxOperations) || 12), Math.max(1, Math.floor(batch.length / 2)));
  for (const candidate of candidates.slice(0, cap)) {
    const normalized = normalizeOperation(candidate, { batch, contextCount, referenceAt, timeZone });
    if (normalized) operations.push(normalized);
  }
  return operations;
}

export function createEventBatchExtractor({ generateZen = openaiChatComplete, getLogger = () => null } = {}) {
  const logger = getLogger();

  async function extractBatch({ batch = [], contextCount = 0, activeEvents = [], funConfig = {}, now = Date.now() } = {}) {
    if (funConfig.groupEventsEnabled === false) return { ok: false, reason: 'disabled', operations: [] };
    if (!Array.isArray(batch) || batch.length <= contextCount) return { ok: false, reason: 'empty-batch', operations: [] };
    if (funConfig.zenEnabled === false || process.env.FUN_DISABLE_LIVE_LLM === '1') {
      return { ok: false, reason: 'llm-disabled', operations: [] };
    }

    const referenceAt = Number(now) || Date.now();
    const timeZone = text(funConfig.worldTimezone, 'America/Sao_Paulo');
    const messageMaxChars = Math.max(120, Math.min(1_500, Number(funConfig.groupEventBatchMessageMaxChars) || 700));
    const maxOperations = Math.max(1, Math.min(20, Number(funConfig.groupEventBatchMaxOperations) || 12));
    const task = resolveZenTaskParams('extract', funConfig);
    const endpoint = resolveZenEndpoint(funConfig);
    const prompt = [
      'Eventos ativos para update/cancel:',
      formatActiveEvents(activeEvents),
      '',
      'Mensagens do grupo:',
      batch.map((message, index) => formatMessage(message, index, contextCount, messageMaxChars)).join('\n'),
    ].join('\n');
    const totalTries = Math.max(1, Math.min(8, Number(funConfig.groupEventBatchMaxRetries ?? funConfig.zenMaxRetries ?? 3) + 1));
    let lastError = null;

    for (let attempt = 1; attempt <= totalTries; attempt += 1) {
      try {
        const raw = await generateZen({
          baseUrl: endpoint.baseUrl,
          model: endpoint.model,
          apiKey: endpoint.apiKey,
          system: buildSystem({ referenceAt, timeZone, contextCount }),
          prompt,
          timeoutMs: task.timeoutMs,
          maxTokens: task.maxTokens,
          temperature: task.temperature,
          jsonMode: true,
          jsonOnly: true,
          sendSamplingParams: funConfig.zenSendSamplingParams,
        });
        return {
          ok: true,
          operations: parseEventBatch(raw, { batch, contextCount, referenceAt, timeZone, maxOperations }),
          attempt,
        };
      } catch (error) {
        lastError = error;
        logger?.debug?.('[eventBatchExtractor] Zen falhou: %s', String(error?.message || error));
      }
    }

    throw lastError || new Error('event-batch-extraction-failed');
  }

  return { extractBatch };
}
