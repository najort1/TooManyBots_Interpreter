/**
 * Pauta conversacional do Jornal das 23:59.
 *
 * A edição lê mensagens elegíveis do próprio grupo, em ordem cronológica. A
 * seleção garante cobertura do dia inteiro mesmo em grupos muito ativos: cada
 * faixa temporal conserva abertura, desenvolvimento e encerramento em vez de
 * despejar apenas as mensagens mais recentes no contexto da LLM.
 */

const DAY_MS = 24 * 60 * 60_000;
const QUOTE_MAX = 3;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeCall(fn, ...args) {
  try {
    return typeof fn === 'function' ? fn(...args) : null;
  } catch {
    return null;
  }
}

function cleanText(value, maxChars = 400) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function firstName(value) {
  const raw = String(value || '').trim();
  return raw.split(/\s+/)[0] || '?';
}

function nameFor(message, getContactDisplayName) {
  if (message.source === 'bot') return 'Bot';
  try {
    const name = getContactDisplayName?.(message.authorJid);
    if (name) return firstName(name);
  } catch {
    // fallback below
  }
  return firstName(String(message.authorJid || '').split('@')[0]);
}

export function dayBoundsInTimeZone(now = Date.now(), timeZone = 'America/Sao_Paulo') {
  const date = new Date(Number(now) || Date.now());
  try {
    const dayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    const [year, month, day] = dayStr.split('-').map(Number);
    const baseUtc = Date.UTC(year, month - 1, day);

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(baseUtc));

    const pYear = Number(parts.find((p) => p.type === 'year')?.value);
    const pMonth = Number(parts.find((p) => p.type === 'month')?.value);
    const pDay = Number(parts.find((p) => p.type === 'day')?.value);
    const pHour = Number(parts.find((p) => p.type === 'hour')?.value) || 0;
    const pMin = Number(parts.find((p) => p.type === 'minute')?.value) || 0;
    const pSec = Number(parts.find((p) => p.type === 'second')?.value) || 0;

    const localAsUtc = Date.UTC(pYear, pMonth - 1, pDay, pHour, pMin, pSec);
    const offsetMs = localAsUtc - baseUtc;

    const since = baseUtc - offsetMs;
    const until = since + DAY_MS;
    return { since, until };
  } catch {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return { since: start, until: start + DAY_MS };
  }
}

function sampleChronologically(messages, maxMessages) {
  if (messages.length <= maxMessages) return messages;
  const selected = [];
  const segmentCount = Math.min(12, maxMessages);
  const perSegment = Math.max(1, Math.floor(maxMessages / segmentCount));

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const start = Math.floor((segment * messages.length) / segmentCount);
    const end = Math.floor(((segment + 1) * messages.length) / segmentCount);
    const segmentMessages = messages.slice(start, end);
    if (!segmentMessages.length) continue;
    const step = Math.max(1, Math.floor(segmentMessages.length / perSegment));
    for (let index = 0; index < segmentMessages.length && selected.length < maxMessages; index += step) {
      selected.push(segmentMessages[index]);
    }
  }

  return [...new Map(selected.map((message) => [message.messageId, message])).values()]
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .slice(0, maxMessages);
}

function capConversation(messages, maxChars) {
  const lines = [];
  let used = 0;
  for (const message of messages) {
    const line = `[${message.hour}] ${message.name}: ${message.text}`;
    if (used + line.length + 1 > maxChars && lines.length) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

function selectQuotes(messages) {
  const candidates = messages
    .filter((message) => message.source === 'human')
    .filter((message) => message.text.length >= 18 && message.text.length <= 220)
    .filter((message) => !/^k{2,}|^(sim|não|nao|ok|blz|bom dia)$/i.test(message.text))
    .sort((left, right) => {
      const leftScore = Number(/[!?]|kkk|rsrs|😂|🤣/i.test(left.text)) + Math.min(left.text.length / 120, 1);
      const rightScore = Number(/[!?]|kkk|rsrs|😂|🤣/i.test(right.text)) + Math.min(right.text.length / 120, 1);
      return rightScore - leftScore;
    });

  const authors = new Set();
  const quotes = [];
  for (const candidate of candidates) {
    if (authors.has(candidate.authorJid)) continue;
    authors.add(candidate.authorJid);
    quotes.push({ name: candidate.name, text: candidate.text, messageId: candidate.messageId });
    if (quotes.length >= QUOTE_MAX) break;
  }
  return quotes;
}

function deriveMood(messages) {
  if (messages.length === 0) return 'silencioso';
  const text = messages.map((message) => message.text).join(' ').toLowerCase();
  const laughCount = (text.match(/\b(k{2,}|rsrs|haha|kkkkk?)\b|😂|🤣/g) || []).length;
  const tensionCount = (text.match(/\b(briga|treta|raiva|ódio|odio|mentira|absurdo|discussão|discussao)\b/g) || []).length;
  if (tensionCount >= 6) return 'movimentado';
  if (laughCount >= 8) return 'zoeiro';
  if (messages.length >= 90) return 'movimentado';
  return 'conversado';
}

function buildTimeline(messages) {
  if (!messages.length) return [];
  const blockCount = Math.min(4, Math.max(1, Math.ceil(messages.length / 25)));
  const blocks = [];
  for (let index = 0; index < blockCount; index += 1) {
    const start = Math.floor((index * messages.length) / blockCount);
    const end = Math.floor(((index + 1) * messages.length) / blockCount);
    const block = messages.slice(start, end);
    if (!block.length) continue;
    const names = [...new Set(block.map((message) => message.name).filter((name) => name !== 'Bot'))].slice(0, 4);
    blocks.push({
      hour: `${block[0].hour}–${block.at(-1).hour}`,
      messageCount: block.length,
      participants: names,
      sample: block.slice(0, 4).map((message) => ({ name: message.name, text: message.text })),
    });
  }
  return blocks;
}

function compactHistoricalThemes(snapshotRepository, scopeKey, now) {
  const previous = safeArray(
    safeCall(snapshotRepository?.listSnapshotsSince?.bind(snapshotRepository), scopeKey, now - 7 * DAY_MS, 7)
  );
  return previous
    .map((snapshot) => String(snapshot.payload?.mood || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

export function collectDayConversation({
  scopeKey,
  now = Date.now(),
  deps = {},
  timeZone = 'America/Sao_Paulo',
  getContactDisplayName = null,
  readLimit = 1200,
  conversationMaxChars = 28_000,
}) {
  const nowMs = Number(now) || Date.now();
  const bounds = dayBoundsInTimeZone(nowMs, timeZone);
  const scope = String(scopeKey || '');
  const query = {
    since: bounds.since,
    until: Math.min(bounds.until, nowMs + 1),
    limit: readLimit,
  };
  const sampledResult = safeCall(
    deps.journalMessageRepository?.listSampledBetween?.bind(deps.journalMessageRepository),
    scope,
    query
  );
  const rawMessages = safeArray(
    sampledResult?.messages ||
      safeCall(deps.journalMessageRepository?.listBetween?.bind(deps.journalMessageRepository), scope, query)
  );
  const totalMessageCount = Number(
    sampledResult?.total ||
      safeCall(deps.journalMessageRepository?.countBetween?.bind(deps.journalMessageRepository), scope, query)
  ) || rawMessages.length;
  const sampled = sampleChronologically(rawMessages, Math.max(20, Math.min(320, readLimit)));
  const messages = sampled.map((message) => ({
    ...message,
    name: nameFor(message, getContactDisplayName),
    hour: new Date(message.occurredAt).toLocaleTimeString('pt-BR', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
    text: cleanText(message.text, 400),
  })).filter((message) => message.text);

  const participants = [...new Set(messages.filter((message) => message.source === 'human').map((message) => message.authorJid))];
  const mood = deriveMood(messages);
  const quiet = totalMessageCount < 4;
  const quotes = selectQuotes(messages);

  return {
    scopeKey: scope,
    now: nowMs,
    timeZone,
    since: bounds.since,
    until: Math.min(bounds.until, nowMs + 1),
    mood,
    quiet,
    totalMessageCount,
    sampledMessageCount: messages.length,
    participantCount: participants.length,
    messages,
    conversation: capConversation(messages, conversationMaxChars),
    timeline: buildTimeline(messages),
    quotes,
    historicalMoods: compactHistoricalThemes(deps.snapshotRepository, scope, nowMs),
  };
}

export function conversationToSnapshotPayload(conversation) {
  return {
    mood: conversation.mood,
    totalMessageCount: conversation.totalMessageCount,
    participantCount: conversation.participantCount,
    timeline: conversation.timeline.map((block) => ({
      hour: block.hour,
      messageCount: block.messageCount,
      participantCount: block.participants.length,
    })),
  };
}

// Compatibilidade para consumidores históricos de eventos. O jornal atual não
// usa esses helpers, mas eles continuam servindo testes/relatórios legados.
export function bucketEvents(events) {
  const buckets = {};
  for (const event of safeArray(events)) {
    const type = String(event?.eventType || '');
    if (type) (buckets[type] ||= []).push(event);
  }
  return buckets;
}

export function collectDayFacts({ scopeKey, now = Date.now(), deps = {}, timeZone = 'America/Sao_Paulo' } = {}) {
  const since = (Number(now) || Date.now()) - DAY_MS;
  const events = safeArray(safeCall(deps.newsRepository?.listSince?.bind(deps.newsRepository), scopeKey, since));
  const buckets = bucketEvents(events);
  const total = events.length;
  const farewellByUser = new Map();
  for (const event of safeArray(buckets.despedir)) {
    const jid = String(event?.userJid || '');
    if (!jid) continue;
    const current = farewellByUser.get(jid) || { jid, count: 0, lastAt: 0 };
    current.count += 1;
    current.lastAt = Math.max(current.lastAt, Number(event.createdAt) || 0);
    farewellByUser.set(jid, current);
  }
  const topFarewellUsers = [...farewellByUser.values()]
    .sort((left, right) => right.count - left.count || left.lastAt - right.lastAt)
    .slice(0, 3);
  const despedidas = safeArray(buckets.despedir).length;
  return {
    scopeKey: String(scopeKey || ''),
    now: Number(now) || Date.now(),
    since,
    timeZone,
    eventsCount: total,
    buckets,
    mood: total ? 'medio' : 'calmo',
    totals: { events: total, despedidas },
    economy: { casinoVolume: 0, assaultsTotal: 0, rentCollected: 0, moneyDestroyed: 0, circulating: 0, gini: 0 },
    society: { marriages: safeArray(buckets.marry).length, divorces: safeArray(buckets.divorce).length, couplesActive: 0, achievementsUnlocked: 0, despedidas, topFarewellUsers },
    police: { assaultsTotal: 0, assaultsCount: safeArray(buckets.assault_win).length, propertyRobs: safeArray(buckets.property_rob).length },
    casino: { volume: 0, lost: 0 },
    rankings: { topCoins: [] },
  };
}

export function factsToSnapshotPayload(facts) {
  return {
    mood: facts?.mood || 'calmo',
    totals: facts?.totals || {},
    economy: facts?.economy || {},
    society: facts?.society || {},
    police: facts?.police || {},
    casino: facts?.casino || {},
    rankings: facts?.rankings || {},
  };
}
