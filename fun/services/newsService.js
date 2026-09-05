/** Jornal das 23:59 — resumo conversacional de cada grupo. */

import { collectDayConversation, conversationToSnapshotPayload } from './news/newsFacts.js';
import { renderEdition } from './news/newsRender.js';
import { composeLlmBits } from './news/newsLlm.js';
import { jidLocalPart, looksLikeOpaqueLid } from '../utils/identity.js';

export function extractEditionMentions(text = '', quotes = [], identityMap = null) {
  const result = new Set();
  const body = String(text || '');
  if (!body) return [];

  // 1. Menções das citações incluídas no jornal cujo número está presente no texto
  for (const quote of quotes || []) {
    for (const rawJid of quote?.mentionedJids || []) {
      const jid = String(rawJid || '').trim();
      if (!jid) continue;
      const local = jidLocalPart(jid);
      if (local && body.includes(`@${local}`)) {
        const canonical = identityMap?.resolve?.(jid) || jid;
        result.add(canonical);
        if (canonical !== jid) result.add(jid);
      }
    }
  }

  // 2. Extração de padrões @digits no texto (ex: @174994885714120 ou @551199999999)
  const mentionMatches = body.matchAll(/@(\d{8,20})\b/g);
  for (const match of mentionMatches) {
    const digits = match[1];
    if (identityMap?.resolve) {
      const resolved = identityMap.resolve(digits);
      if (resolved && resolved !== digits) {
        result.add(resolved);
      }
    }
    if (looksLikeOpaqueLid(digits)) {
      result.add(`${digits}@lid`);
    } else {
      result.add(`${digits}@s.whatsapp.net`);
    }
  }

  return [...result].filter(Boolean);
}

function dayKeyInTz(now, timeZone = 'America/Sao_Paulo') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now));
  } catch {
    return new Date(now).toISOString().slice(0, 10);
  }
}

function clockInTz(now, timeZone = 'America/Sao_Paulo') {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(now));
    return {
      hour: Number(parts.find((part) => part.type === 'hour')?.value) || 0,
      minute: Number(parts.find((part) => part.type === 'minute')?.value) || 0,
    };
  } catch {
    const date = new Date(now);
    return { hour: date.getHours(), minute: date.getMinutes() };
  }
}

/** Janela do jornal: 23:59–00:04, tolerante ao tick de 45s. */
export function isGroupNewsWindow(now, funConfig = {}) {
  const timeZone = funConfig.worldTimezone || 'America/Sao_Paulo';
  const targetHour = Number.isFinite(Number(funConfig.groupNewsHour)) ? Number(funConfig.groupNewsHour) : 23;
  const targetMinute = Number.isFinite(Number(funConfig.groupNewsMinute)) ? Number(funConfig.groupNewsMinute) : 59;
  const { hour, minute } = clockInTz(now, timeZone);
  return (hour === targetHour && minute >= targetMinute) ||
    (targetHour === 23 && targetMinute >= 55 && hour === 0 && minute <= 4);
}

export function createNewsService({
  newsRepository,
  journalMessageRepository = null,
  snapshotRepository = null,
  flavorService = null,
  getContactDisplayName = null,
  identityMap = null,
  random = Math.random,
} = {}) {
  function enabled(funConfig = {}) {
    return funConfig.groupNewsEnabled !== false;
  }

  // Mantém a API para produtores de eventos legados. Esses dados não entram mais
  // no texto publicado, mas continuam úteis para telemetria durante a transição.
  function log(scopeKey, eventType, { userJid = null, payload = {}, now = Date.now() } = {}) {
    try {
      return newsRepository?.logEvent?.({ scopeKey, eventType, userJid, payload, now }) || null;
    } catch {
      return null;
    }
  }

  async function composeEdition(scopeKey, funConfig = {}, now = Date.now()) {
    const timeZone = funConfig.worldTimezone || 'America/Sao_Paulo';
    const conversation = collectDayConversation({
      scopeKey,
      now,
      timeZone,
      deps: { journalMessageRepository, snapshotRepository },
      getContactDisplayName,
      readLimit: funConfig.groupNewsMessageReadLimit,
      conversationMaxChars: funConfig.groupNewsConversationMaxChars,
    });
    const llmBits = await composeLlmBits(
      conversation,
      flavorService,
      scopeKey,
      random,
      null,
      funConfig
    );
    const dayLabel = `${dayKeyInTz(now, timeZone)} · ${new Date(now).toLocaleDateString('pt-BR', { weekday: 'long', timeZone })}`;
    const text = renderEdition(conversation, llmBits, { dayLabel, random });
    const provider = llmBits?.capa ? 'llm-enhanced' : 'deterministic';
    const mentions = extractEditionMentions(text, conversation.quotes, identityMap);

    console.log(
      `[fun/news] edition scope=${String(scopeKey).slice(0, 28)} provider=${provider} messages=${conversation.totalMessageCount} mood=${conversation.mood} mentions=${mentions.length}`
    );

    return {
      text,
      provider,
      eventCount: 0,
      messageCount: conversation.totalMessageCount,
      facts: conversation,
      mentions,
    };
  }

  async function tryPublish(scopeKey, funConfig = {}, now = Date.now()) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    if (!isGroupNewsWindow(now, funConfig)) return { ok: false, reason: 'not-window' };

    const timeZone = funConfig.worldTimezone || 'America/Sao_Paulo';
    const { hour } = clockInTz(now, timeZone);
    const targetNow = hour === 0 ? now - 2 * 60 * 60_000 : now;
    const newsDay = dayKeyInTz(targetNow, timeZone);
    const meta = newsRepository?.getNewsMeta?.(scopeKey);
    if (meta?.lastDailyNewsDay === newsDay) return { ok: false, reason: 'already-today' };

    const edition = await composeEdition(scopeKey, funConfig, targetNow);
    try {
      snapshotRepository?.saveSnapshot?.({
        scopeKey,
        dayKey: newsDay,
        payload: conversationToSnapshotPayload(edition.facts),
        now: targetNow,
      });
      const retentionDays = Math.max(1, Number(funConfig.groupNewsMessageRetentionDays) || 3);
      journalMessageRepository?.pruneOlderThan?.(scopeKey, targetNow - retentionDays * 24 * 60 * 60_000);
      newsRepository?.pruneOlderThan?.(scopeKey, targetNow - 3 * 24 * 60 * 60_000);
    } catch (error) {
      console.warn(`[fun/news] cleanup fail ${String(scopeKey).slice(0, 28)}: ${error?.message || error}`);
    }

    newsRepository?.setNewsDay?.(scopeKey, newsDay, now);
    return {
      ok: true,
      text: edition.text,
      provider: edition.provider,
      eventCount: edition.eventCount,
      messageCount: edition.messageCount,
      newsDay,
      mentions: edition.mentions || [],
    };
  }

  return { enabled, log, composeEdition, tryPublish, isGroupNewsWindow, dayKeyInTz };
}
