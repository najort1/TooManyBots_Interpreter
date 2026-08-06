/**
 * The Group Times — log diário + manchetes 23:59.
 */

import { collectDayFacts, factsToSnapshotPayload } from './news/newsFacts.js';
import { renderEdition } from './news/newsRender.js';
import { composeLlmBits } from './news/newsLlm.js';

function dayKeyInTz(now, timeZone = 'America/Sao_Paulo') {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return fmt.format(new Date(now));
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
    const hour = Number(parts.find((p) => p.type === 'hour')?.value) || 0;
    const minute = Number(parts.find((p) => p.type === 'minute')?.value) || 0;
    return { hour, minute };
  } catch {
    const d = new Date(now);
    return { hour: d.getHours(), minute: d.getMinutes() };
  }
}

/**
 * Janela do jornal: 23:59–00:04 (tolera tick de 45s).
 */
export function isGroupNewsWindow(now, funConfig = {}) {
  const tz = funConfig.worldTimezone || 'America/Sao_Paulo';
  const targetH = Number.isFinite(Number(funConfig.groupNewsHour))
    ? Number(funConfig.groupNewsHour)
    : 23;
  const targetM = Number.isFinite(Number(funConfig.groupNewsMinute))
    ? Number(funConfig.groupNewsMinute)
    : 59;
  const { hour, minute } = clockInTz(now, tz);
  if (hour === targetH && minute >= targetM) return true;
  if (targetH === 23 && targetM >= 55 && hour === 0 && minute <= 4) return true;
  return false;
}

export function createNewsService({
  newsRepository,
  snapshotRepository = null,
  statsRepository = null,
  achievementRepository = null,
  relationshipRepository = null,
  casinoRepository = null,
  marketRepository = null,
  stockRepository = null,
  rouletteHistory = null,
  marketService = null,
  flavorService = null,
  dailyChallengeService = null,
  groupMemoryService = null,
  getContactDisplayName = null,
  random = Math.random,
} = {}) {
  function enabled(funConfig = {}) {
    return funConfig.groupNewsEnabled !== false;
  }

  function log(scopeKey, eventType, { userJid = null, payload = {}, now = Date.now() } = {}) {
    try {
      return newsRepository.logEvent({
        scopeKey,
        eventType,
        userJid,
        payload,
        now,
      });
    } catch {
      return null;
    }
  }

  async function composeEdition(scopeKey, funConfig = {}, now = Date.now()) {
    const tz = funConfig.worldTimezone || 'America/Sao_Paulo';

    const deps = {
      newsRepository,
      statsRepository,
      achievementRepository,
      relationshipRepository,
      casinoRepository,
      marketRepository,
      stockRepository,
      rouletteHistory,
      snapshotRepository,
      marketService,
      dailyChallengeService,
    };

    const facts = collectDayFacts({ scopeKey, now, deps, timeZone: tz });
    const llmBits = await composeLlmBits(
      facts,
      flavorService,
      scopeKey,
      random,
      groupMemoryService,
      funConfig
    );

    const dayLabel =
      dayKeyInTz(now, tz) +
      ' · ' +
      new Date(now).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: tz });
    const text = renderEdition(facts, llmBits, {
      getContactDisplayName,
      random,
      dayLabel,
    });

    const provider = llmBits.capa ? 'llm-enhanced' : 'deterministic';

    console.log(
      '[fun/news] edition scope=' +
        String(scopeKey).slice(0, 28) +
        ' provider=' +
        provider +
        ' events=' +
        facts.eventsCount +
        ' mood=' +
        facts.mood
    );

    return { text, provider, eventCount: facts.eventsCount, facts };
  }

  /**
   * Tenta publicar se estiver na janela e ainda não publicou hoje.
   * Após publicar, persiste o snapshot diário para memória histórica.
   * @returns {{ ok: boolean, text?: string, reason?: string }}
   */
  async function tryPublish(scopeKey, funConfig = {}, now = Date.now()) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    if (!isGroupNewsWindow(now, funConfig)) return { ok: false, reason: 'not-window' };

    const tz = funConfig.worldTimezone || 'America/Sao_Paulo';
    const today = dayKeyInTz(now, tz);
    const { hour } = clockInTz(now, tz);
    let newsDay = today;
    if (hour === 0) {
      newsDay = dayKeyInTz(now - 2 * 60 * 60_000, tz);
    }

    const meta = newsRepository.getNewsMeta(scopeKey);
    if (meta.lastDailyNewsDay === newsDay) {
      return { ok: false, reason: 'already-today' };
    }

    const edition = await composeEdition(scopeKey, funConfig, now);

    if (edition.facts && snapshotRepository?.saveSnapshot) {
      try {
        const payload = factsToSnapshotPayload(edition.facts);
        snapshotRepository.saveSnapshot({
          scopeKey,
          dayKey: newsDay,
          payload,
          now,
        });
      } catch (err) {
        console.warn(
          '[fun/news] snapshot save fail ' +
            String(scopeKey).slice(0, 28) +
            ': ' +
            (err?.message || err)
        );
      }
    }

    newsRepository.setNewsDay(scopeKey, newsDay, now);
    newsRepository.pruneOlderThan(scopeKey, now - 3 * 24 * 60 * 60_000);

    return {
      ok: true,
      text: edition.text,
      provider: edition.provider,
      eventCount: edition.eventCount,
      newsDay,
    };
  }

  return {
    enabled,
    log,
    composeEdition,
    tryPublish,
    isGroupNewsWindow,
    dayKeyInTz,
  };
}
