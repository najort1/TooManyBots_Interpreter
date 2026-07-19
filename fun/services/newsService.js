/**
 * The Group Times — log diário + manchetes 23:59.
 */

function dayKeyInTz(now, timeZone = 'America/Sao_Paulo') {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // en-CA → YYYY-MM-DD
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
  // 23:59–23:59+ e 00:00–00:04
  if (hour === targetH && minute >= targetM) return true;
  if (targetH === 23 && targetM >= 55 && hour === 0 && minute <= 4) return true;
  return false;
}

export function createNewsService({
  newsRepository,
  flavorService = null,
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

  function templateHeadlines(events) {
    const lines = ['📰 *The Group Times*', '_Edição da madrugada_', ''];
    if (!events.length) {
      lines.push(
        '*MANCHETE:* Nada rolou. O grupo só existiu.',
        '*ECONOMIA:* Preços de peixe e ego estáveis.',
        '*FOFOCA:* Silêncio ensurdecedor no zap.'
      );
      return lines.join('\n');
    }

    const byType = new Map();
    for (const e of events) {
      const list = byType.get(e.eventType) || [];
      list.push(e);
      byType.set(e.eventType, list);
    }

    const allOf = (type) => byType.get(type) || [];
    const pick = (type) => {
      const list = allOf(type);
      return list[Math.floor(random() * list.length)] || null;
    };

    const crash = pick('crash_loss') || pick('casino_loss');
    const marry = pick('marry');
    const assault = pick('assault_win');
    const assaultN = allOf('assault_win').length;
    const market = pick('market_move');
    const prop = pick('property_buy') || pick('property_rob');

    // usa os números reais do grupo (não texto genérico idêntico)
    const assaultTotal = allOf('assault_win').reduce(
      (s, e) => s + (Number(e.payload?.amount) || 0),
      0
    );

    const headline =
      crash
        ? `*MANCHETE:* Alguém perdeu *${crash.payload?.amount || '?'}c* e jurou que foi bug.`
        : assaultN > 1
          ? `*MANCHETE:* *${assaultN}* assaltos no dia · *${assaultTotal}c* no total. O bairro viu.`
          : assault
            ? `*MANCHETE:* Assalto rendeu *${assault.payload?.amount || '?'}c*. O bairro viu.`
            : `*MANCHETE:* O dia foi mediano. O ego, não.`;

    const eco =
      market
        ? `*ECONOMIA:* Mercado moveu *${market.payload?.deltaPct ?? '?'}%* em ${market.payload?.name || 'algo'}.`
        : prop
          ? `*ECONOMIA:* Negócio novo no pedaço — alguém se achou patrão.`
          : assaultN
            ? `*ECONOMIA:* Fluxo de assalto no ar. Contador: *${assaultTotal}c*.`
            : `*ECONOMIA:* Bolsa e pastel no piloto automático.`;

    const fofoca =
      marry
        ? `*FOFOCA:* Casamento no sistema. Apostas de divórcio abertas.`
        : assaultN
          ? `*FOFOCA:* Alguém jura que o assalto foi “estratégia”. Ninguém acredita.`
          : `*FOFOCA:* Ninguém se divorciou (ainda). Decepcionante.`;

    lines.push(headline, eco, fofoca);
    lines.push('', `_Eventos registrados: ${events.length}_`);
    return lines.join('\n');
  }

  async function composeEdition(scopeKey, funConfig = {}, now = Date.now()) {
    const since = now - 24 * 60 * 60_000;
    // SEMPRE filtrado por scopeKey — nunca mistura eventos de outro grupo
    const events = newsRepository.listSince(scopeKey, since);
    let text = '';
    let provider = 'template';

    if (flavorService && typeof flavorService.line === 'function' && events.length) {
      const summary = events
        .slice(0, 40)
        .map((e) => {
          const p = e.payload || {};
          // reforça isolamento: se payload vier com jid, só o tipo+números
          return `${e.eventType}${p.amount != null ? ` amount=${p.amount}` : ''}${p.name ? ` name=${p.name}` : ''}${p.deltaPct != null ? ` delta=${p.deltaPct}%` : ''}`;
        })
        .join('\n');
      try {
        const out = await flavorService.line('group_times', {
          events: summary,
          count: events.length,
          // isolamento do anti-repeat / ban list por grupo
          scopeKey: String(scopeKey || ''),
        });
        const raw = typeof out === 'string' ? out : out?.text;
        const providerHit = flavorService.lastProvider?.() || 'llm';
        // template-timeout devolve fallback curto — não trate como LLM
        if (
          raw &&
          String(raw).trim().length > 40 &&
          !String(providerHit).includes('template')
        ) {
          text = `📰 *The Group Times*\n\n${String(raw).trim()}`.slice(0, 1800);
          provider = providerHit;
        } else if (raw && String(raw).trim().length > 40 && providerHit === 'template') {
          // line() devolveu template via fallback interno
          text = `📰 *The Group Times*\n\n${String(raw).trim()}`.slice(0, 1800);
          provider = 'template';
        }
      } catch (err) {
        console.warn(
          `[fun/news] compose LLM fail scope=${String(scopeKey).slice(0, 28)}: ${err?.message || err}`
        );
      }
    }

    if (!text) {
      text = templateHeadlines(events);
      provider = 'template';
    }

    console.log(
      `[fun/news] edition scope=${String(scopeKey).slice(0, 28)} provider=${provider} events=${events.length}`
    );

    return { text, provider, eventCount: events.length };
  }

  /**
   * Tenta publicar se estiver na janela e ainda não publicou hoje.
   * @returns {{ ok: boolean, text?: string, reason?: string }}
   */
  async function tryPublish(scopeKey, funConfig = {}, now = Date.now()) {
    if (!enabled(funConfig)) return { ok: false, reason: 'disabled' };
    if (!isGroupNewsWindow(now, funConfig)) return { ok: false, reason: 'not-window' };

    const tz = funConfig.worldTimezone || 'America/Sao_Paulo';
    const today = dayKeyInTz(now, tz);
    // se estamos em 00:00–00:04, o "dia do jornal" ainda é o dia civil anterior
    const { hour } = clockInTz(now, tz);
    let newsDay = today;
    if (hour === 0) {
      // use yesterday key
      newsDay = dayKeyInTz(now - 2 * 60 * 60_000, tz);
    }

    const meta = newsRepository.getNewsMeta(scopeKey);
    if (meta.lastDailyNewsDay === newsDay) {
      return { ok: false, reason: 'already-today' };
    }

    const edition = await composeEdition(scopeKey, funConfig, now);
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
