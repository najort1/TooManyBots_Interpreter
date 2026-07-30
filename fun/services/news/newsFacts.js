/**
 * newsFacts.js — coletor central do jornal "The Group Times".
 *
 * Agrega dados das últimas 24h (e, para memória histórica, compara com snapshots)
 * em um objeto estruturado determinístico (DayFacts). Esse objeto alimenta:
 *  - renderEdition() em newsRender.js (categorias, rankings, prêmios, stats)
 *  - composeLlmBits() em newsLlm.js (capa + abertura + foreshadow)
 *
 * Princípios:
 *  - Tudo filtrado por scopeKey (isolamento entre grupos — privacidade).
 *  - Deps opcionais via ?.: grupos sem economia/casino/etc continuam funcionando.
 *  - Sem I/O externo: tudo vem dos repositórios injetados.
 *  - Determinístico: mesmoDayFacts → mesmo jornal (LLM é só tempero).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reasons do ledger que representam CASSINO (volume de apostas). */
const CASINO_REASONS = [
  'jackpot-hit',
  'roulette-bet',
  'slot-bet',
  'crash-bet',
  'bj-bet',
  'bj-win',
  'bj-push',
  'dice-tie',
  'bingo-entry',
  'bingo-win',
  'bingo-refund',
  'bingo-leave-refund',
  'bingo-solo',
  'tournament-entry',
  'tournament-win',
];

/** Reasons do ledger que representam CRIME/PvP (assaltos, heists, purga). */
const CRIME_REASONS = [
  'crime-win',
  'crime-victim',
  'crime-debt',
  'assault-win',
  'assault-fail',
  'assault-victim',
  'assault-win-property',
  'heist-win',
  'heist-fail',
];

/** Reasons que representam PROPRIEDADES (compra, aluguel/coleta, reparo). */
const PROPERTY_REASONS = ['property-buy', 'property-collect', 'property-repair'];

/**
 * Normaliza reason (remove sufixo dinâmico após ":") e agrupa por categoria macro.
 */
function reasonCategory(reason) {
  const r = String(reason || '');
  const prefix = r.includes(':') ? r.slice(0, r.indexOf(':')) : r;
  if (CASINO_REASONS.includes(prefix) || prefix.endsWith('-bet') || prefix.endsWith('-win')) {
    if (prefix.endsWith('-bet') || CASINO_REASONS.includes(prefix)) return 'casino';
  }
  if (CRIME_REASONS.includes(prefix)) return 'crime';
  if (PROPERTY_REASONS.includes(prefix)) return 'property';
  if (prefix.startsWith('stock-')) return 'stock';
  if (prefix.startsWith('shop-') || prefix === 'shop' || prefix === 'bazaar-buy' || prefix === 'bazaar-sell')
    return 'shop';
  if (prefix === 'job' || prefix.startsWith('job-') || prefix === 'practice-used') return 'job';
  if (prefix === 'flip-bet' || prefix === 'flip-win' || prefix === 'lucky-win' || prefix === 'lucky-miss')
    return 'games';
  if (prefix === 'pay' || prefix === 'divorce-fee') return 'social';
  if (prefix === 'mission-reward') return 'mission';
  if (prefix.startsWith('faction-')) return 'faction';
  return 'other';
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}
function safeNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function safeCall(fn, ...args) {
  try {
    return typeof fn === 'function' ? fn(...args) : null;
  } catch {
    return null;
  }
}

/**
 * Agrupa eventos de fun_daily_events por tipo.
 * @param {Array} events — lista de { eventType, payload, userJid, createdAt }
 */
export function bucketEvents(events) {
  const out = {};
  for (const e of safeArr(events)) {
    const t = String(e.eventType || '');
    (out[t] ||= []).push(e);
  }
  return out;
}

/**
 * Coleta todos os fatos do dia para o escopo.
 *
 * @param {object} p
 * @param {string} p.scopeKey
 * @param {Date|number} [p.now]
 * @param {object} p.deps — repositórios e serviços injetados (todos opcionais):
 *   { newsRepository, statsRepository, achievementRepository, relationshipRepository,
 *     casinoRepository, marketRepository, stockRepository, rouletteHistory,
 *     snapshotRepository, getContactDisplayName }
 * @param {string} [p.timeZone]
 * @returns {object} DayFacts
 */
export function collectDayFacts({
  scopeKey,
  now = Date.now(),
  deps = {},
  timeZone = 'America/Sao_Paulo',
}) {
  const nowMs = Number(now) || Date.now();
  const since = nowMs - DAY_MS;
  const scope = String(scopeKey || '');
  const {
    newsRepository,
    statsRepository,
    achievementRepository,
    relationshipRepository,
    casinoRepository,
    marketRepository,
    stockRepository,
    rouletteHistory,
    snapshotRepository,
    dailyChallengeService,
  } = deps;

  // ── Eventos do dia (fun_daily_events) ────────────────────────────
  const events = safeArr(
    safeCall(newsRepository?.listSince?.bind(newsRepository), scope, since)
  );
  const buckets = bucketEvents(events);

  const marryEvents = safeArr(buckets.marry);
  const divorceEvents = safeArr(buckets.divorce);
  const assaultWinEvents = safeArr(buckets.assault_win);
  const propertyRobEvents = safeArr(buckets.property_rob);
  const propertyBuyEvents = safeArr(buckets.property_buy);
  const propertyCollectEvents = safeArr(buckets.property_collect);
  const crashLossEvents = safeArr(buckets.crash_loss);
  const casinoWinEvents = safeArr(buckets.casino_win);
  const purgaStartEvents = safeArr(buckets.purga_start);
  const purgaEndEvents = safeArr(buckets.purga_end);
  const notableQuotes = safeArr(buckets.notable_quote);

  // ── Ledger: economia / cassino / crime por reason (últimas 24h) ──
  const ledgerByReason = safeArr(
    safeCall(statsRepository?.sumLedgerByReason?.bind(statsRepository), { scopeKey: scope, since, until: nowMs })
  );
  const reasonMap = new Map(ledgerByReason.map((r) => [r.reason, r]));

  // ── Ledger por usuário: rankings de criminosos e azarados ────────
  const crimeByUser = safeArr(
    safeCall(statsRepository?.sumLedgerByUser?.bind(statsRepository), {
      scopeKey: scope,
      since,
      until: nowMs,
      reasons: ['crime-win', 'assault-win', 'assault-win-property', 'heist-win'],
      direction: 'credit',
    })
  ).sort((a, b) => b.gained - a.gained);

  const victimsByUser = safeArr(
    safeCall(statsRepository?.sumLedgerByUser?.bind(statsRepository), {
      scopeKey: scope,
      since,
      until: nowMs,
      reasons: ['crime-victim', 'crime-debt', 'assault-victim'],
      direction: 'debit',
    })
  ).sort((a, b) => b.lost - a.lost);

  // maiores perdedores (qualquer reason) — ranking de azarados
  const losersByUser = safeArr(
    safeCall(statsRepository?.sumLedgerByUser?.bind(statsRepository), {
      scopeKey: scope,
      since,
      until: nowMs,
    })
  )
    .filter((u) => u.lost > 0)
    .sort((a, b) => b.lost - a.lost);

  // ── Agregados por categoria (do ledger) ──────────────────────────
  const sumCategory = (cat) => {
    let gained = 0;
    let lost = 0;
    for (const r of ledgerByReason) {
      if (reasonCategory(r.reason) !== cat) continue;
      gained += r.gained;
      lost += r.lost;
    }
    return { gained, lost, net: gained - lost };
  };
  const casinoLedger = sumCategory('casino');
  const crimeLedger = sumCategory('crime');
  const propertyLedger = sumCategory('property');
  const stockLedger = sumCategory('stock');
  const jobLedger = sumCategory('job');

  // "dinheiro destruído" = sinks (razões puramente destruidoras)
  // "dinheiro criado" = mints (razões puramente criadoras)
  // Aproximação: soma de lost das categorias que tiram de circulação (bet/shop/repair/fee)
  // vs gained das que injetam (job/lucky/daily/jackpot do sistema).
  const destroyedReasons = ['shop', 'property', 'social', 'casino'];
  const createdReasons = ['job', 'games', 'mission', 'other'];
  let moneyDestroyed = 0;
  let moneyCreated = 0;
  for (const r of ledgerByReason) {
    const cat = reasonCategory(r.reason);
    if (destroyedReasons.includes(cat)) moneyDestroyed += 0; // cassino e shop são trocas, não sink real
  }
  // Melhor proxy de sink/mint: net negativo = retirou de circulação; net positivo = injetou.
  // Mas a maioria das reasons é transferência (net ≈ 0). Para o jornal usamos o volume de
  // apostas perdidas (cassino lost) como proxy de "destruído no cassino".
  moneyDestroyed = casinoLedger.lost; // moeda perdida no cassino (a casa vence)
  moneyCreated = casinoLedger.gained + jobLedger.gained + stockLedger.gained * 0; // pagamentos de cassino + salários

  // ── Economia: saúde (Gini, circulating) ──────────────────────────
  const healthMetrics = safeCall(deps.marketService?.collectHealthMetrics?.bind(deps.marketService), scope) || {
    circulatingCoins: 0,
    gini: 0,
    eventsLast24h: 0,
    activePlayers: 0,
  };

  // ── Sociedade: casamentos ativos + conquistas ─────────────────────
  const activeMarriages = safeArr(
    safeCall(relationshipRepository?.listActiveMarriages?.bind(relationshipRepository), scope)
  );
  const longestMarriage = activeMarriages.length ? activeMarriages[0] : null;
  const achievementsSince = safeArr(
    safeCall(achievementRepository?.listUnlockedSince?.bind(achievementRepository), scope, since, 30)
  );

  // ── Polícia: maiores assaltos (do log de eventos) ─────────────────
  const assaultsTotal = assaultWinEvents.reduce(
    (s, e) => s + safeNum(e.payload?.amount, 0),
    0
  );
  const biggestAssaultEvent = assaultWinEvents.reduce((best, e) => {
    const amt = safeNum(e.payload?.amount, 0);
    if (!best || amt > safeNum(best.payload?.amount, 0)) return e;
    return best;
  }, null);
  const propertyRobsTotal = propertyRobEvents.reduce(
    (s, e) => s + safeNum(e.payload?.amount, 0),
    0
  );

  // ── Cassino: maior crash loss, top apostador, streak roleta ───────
  const biggestCrashLossEvent = crashLossEvents.reduce((best, e) => {
    const amt = safeNum(e.payload?.amount, 0);
    if (!best || amt > safeNum(best.payload?.amount, 0)) return e;
    return best;
  }, null);
  const casinoLeaderboard = safeArr(
    safeCall(casinoRepository?.getLeaderboard?.bind(casinoRepository), scope, 3)
  );
  const rouletteStreak = safeCall(rouletteHistory?.getColorStreak?.bind(rouletteHistory), scope) || null;

  // ── Bolsa: maior alta/baixa das últimas 24h ──────────────────────
  const stockQuotes = safeArr(safeCall(stockRepository?.listQuotes?.bind(stockRepository), scope));
  let stockMoverUp = null;
  let stockMoverDown = null;
  for (const q of stockQuotes) {
    const prev = safeNum(q.previousPrice, 0);
    const cur = safeNum(q.price, 0);
    if (prev <= 0) continue;
    const deltaPct = ((cur - prev) / prev) * 100;
    if (!stockMoverUp || deltaPct > stockMoverUp.deltaPct) {
      stockMoverUp = { companyId: q.companyId, deltaPct };
    }
    if (!stockMoverDown || deltaPct < stockMoverDown.deltaPct) {
      stockMoverDown = { companyId: q.companyId, deltaPct };
    }
  }

  // ── Propriedades: maior proprietário (coleta do dia) ──────────────
  const rentByUser = safeArr(
    safeCall(statsRepository?.sumLedgerByUser?.bind(statsRepository), {
      scopeKey: scope,
      since,
      until: nowMs,
      reasons: ['property-collect'],
      direction: 'credit',
    })
  ).sort((a, b) => b.gained - a.gained);

  // ── Rankings consolidados ────────────────────────────────────────
  const topCoins = safeArr(safeCall(statsRepository?.getCoinsLeaderboard?.bind(statsRepository), scope, 3))
    .map((u) => ({ jid: u.userJid, coins: safeNum(u.coins, 0) }))
    .filter((u) => u.jid);
  const topCrims = crimeByUser
    .slice(0, 3)
    .map((u) => ({ jid: u.jid, total: u.gained }))
    .filter((u) => u.jid);
  const topUnlucky = losersByUser
    .slice(0, 3)
    .map((u) => ({ jid: u.jid, total: u.lost }))
    .filter((u) => u.jid);

  // ── Totais do grupo (para stats) ─────────────────────────────────
  const betsCount =
    ledgerByReason
      .filter((r) => reasonCategory(r.reason) === 'casino')
      .reduce((s, r) => s + r.count, 0) +
    safeArr(buckets.crash_loss).length +
    safeArr(buckets.casino_win).length;
  const propertiesBought = propertyBuyEvents.length;
  const coinsDestroyed = Math.max(0, moneyDestroyed);

  // ── Purga do dia (se ocorreu) ────────────────────────────────────
  const purgaHappened = purgaStartEvents.length > 0;

  // ── Mood: deriva da composição do dia ────────────────────────────
  const mood = deriveMood({
    eventsCount: events.length,
    marryEvents: marryEvents.length,
    divorceEvents: divorceEvents.length,
    crimesCount: assaultWinEvents.length,
    betsCount,
    moneyDestroyed: coinsDestroyed,
  });

  // ── Memória histórica (snapshots anteriores) ─────────────────────
  const snaps30d = safeArr(
    safeCall(snapshotRepository?.listSnapshotsSince?.bind(snapshotRepository), scope, nowMs - 30 * DAY_MS, 35)
  );
  const memory = buildHistoricalMemory({
    snaps: snaps30d,
    todayFacts: {
      assaultsTotal,
      crimesCount: assaultWinEvents.length,
      marriages: marryEvents.length,
      divorces: divorceEvents.length,
      casinoVolume: casinoLedger.gained + casinoLedger.lost,
      mood,
    },
  });

  // ── Personalidade do grupo (mood dominante últimos 7 dias) ───────
  const moodHistory7 = safeArr(
    safeCall(snapshotRepository?.getMoodHistory?.bind(snapshotRepository), scope, 7)
  );
  const personality = derivePersonality(moodHistory7, mood);

  const challenge =
    typeof dailyChallengeService?.getTodayStats === 'function'
      ? safeCall(dailyChallengeService.getTodayStats.bind(dailyChallengeService), scope)
      : null;

  const facts = {
    scopeKey: scope,
    since,
    now: nowMs,
    timeZone,
    eventsCount: events.length,
    buckets,
    economy: {
      casinoVolume: casinoLedger.gained + casinoLedger.lost,
      casinoGained: casinoLedger.gained,
      casinoLost: casinoLedger.lost,
      moneyDestroyed,
      moneyCreated,
      assaultsTotal,
      assaultsCount: assaultWinEvents.length,
      rentCollected: rentByUser[0]?.gained || 0,
      rentKing: rentByUser[0]?.jid || null,
      crimeVolume: crimeLedger.gained + crimeLedger.lost,
      propertyVolume: propertyLedger.gained + propertyLedger.lost,
      stockVolume: stockLedger.gained + stockLedger.lost,
      jobVolume: jobLedger.gained + jobLedger.lost,
      circulating: safeNum(healthMetrics.circulatingCoins, 0),
      gini: safeNum(healthMetrics.gini, 0),
      activePlayers: safeNum(healthMetrics.activePlayers, 0),
    },
    society: {
      marriages: marryEvents.length,
      divorces: divorceEvents.length,
      couplesActive: activeMarriages.length,
      longestMarriage,
      achievementsUnlocked: achievementsSince.length,
      achievementsRecent: achievementsSince.slice(0, 5),
      marryEvents,
      divorceEvents,
    },
    police: {
      assaultsTotal,
      assaultsCount: assaultWinEvents.length,
      biggestAssaultEvent,
      propertyRobs: propertyRobEvents.length,
      propertyRobsTotal,
      purgaHappened,
      purgaStart: purgaStartEvents[0] || null,
      purgaEnd: purgaEndEvents[0] || null,
      topCrims: crimeByUser.slice(0, 5),
      topVictims: victimsByUser.slice(0, 3),
    },
    casino: {
      volume: casinoLedger.gained + casinoLedger.lost,
      gained: casinoLedger.gained,
      lost: casinoLedger.lost,
      biggestCrashLossEvent,
      casinoWinEvents,
      crashLossEvents,
      leaderboard: casinoLeaderboard.map((g) => ({
        jid: g.userJid,
        profit: safeNum(g.profit, 0),
        games: safeNum(g.games, 0),
      })),
      rouletteStreak,
    },
    stocks: {
      moverUp: stockMoverUp,
      moverDown: stockMoverDown,
      quotesCount: stockQuotes.length,
    },
    rankings: {
      topCoins,
      topCrims,
      topUnlucky,
    },
    totals: {
      events: events.length,
      crimes: assaultWinEvents.length,
      bets: betsCount,
      marriages: marryEvents.length,
      divorces: divorceEvents.length,
      propertiesBought,
      coinsDestroyed,
      achievements: achievementsSince.length,
      purgas: purgaStartEvents.length,
    },
    mood,
    memory,
    personality,
    challenge,
    quotes: {
      list: notableQuotes.slice(0, 3).map((e) => ({
        userJid: e.userJid,
        quote: e.payload?.quote || '',
        kind: e.payload?.kind || 'quote',
      })),
      count: notableQuotes.length,
    },
  };

  return facts;
}

/**
 * Deriva o mood do dia a partir das proporções de eventos.
 * Ordem de prioridade: caotico > apostador > romantico > calmo > medio.
 */
export function deriveMood({
  eventsCount,
  marryEvents,
  divorceEvents,
  crimesCount,
  betsCount,
  moneyDestroyed,
}) {
  if (eventsCount === 0 && crimesCount === 0 && betsCount === 0 && marryEvents === 0) {
    return 'calmo';
  }
  if (crimesCount >= 50) return 'caotico';
  if (betsCount >= 30) return 'apostador';
  if (marryEvents >= 1 && crimesCount === 0 && betsCount < 10) return 'romantico';
  if (eventsCount === 0) return 'calmo';
  return 'medio';
}

/**
 * Constrói comparações históricas a partir dos snapshots dos últimos 30 dias.
 * @returns {Array<{ kind, text }>} — bullets prontos para o jornal
 */
export function buildHistoricalMemory({ snaps, todayFacts }) {
  const out = [];
  if (!snaps || snaps.length === 0) return out;

  // maior assalto dos últimos 30 dias?
  let maxAssaultEver = 0;
  let maxCrimesEver = 0;
  let maxCasinoVolumeEver = 0;
  for (const s of snaps) {
    const p = s.payload || {};
    maxAssaultEver = Math.max(maxAssaultEver, safeNum(p.economy?.assaultsTotal, 0));
    maxCrimesEver = Math.max(maxCrimesEver, safeNum(p.totals?.crimes, 0));
    maxCasinoVolumeEver = Math.max(maxCasinoVolumeEver, safeNum(p.economy?.casinoVolume, 0));
  }

  if (todayFacts.assaultsTotal > maxAssaultEver && todayFacts.assaultsTotal > 0) {
    out.push({ kind: 'record-assault', text: `Maior assalto registrado em 30 dias: *${todayFacts.assaultsTotal}c*` });
  }
  if (todayFacts.crimesCount > maxCrimesEver && todayFacts.crimesCount >= 5) {
    out.push({ kind: 'record-crime', text: `Recorde de crimes diários: *${todayFacts.crimesCount}*` });
  }
  if (todayFacts.casinoVolume > maxCasinoVolumeEver && todayFacts.casinoVolume > 1000) {
    out.push({ kind: 'record-casino', text: `Novo recorde de volume no cassino (*${todayFacts.casinoVolume}c*)` });
  }

  // dias sem divórcio (streak de snaps com divorces === 0)
  let daysNoDivorce = 0;
  for (const s of snaps) {
    if (safeNum(s.payload?.totals?.divorces, 0) === 0) daysNoDivorce += 1;
    else break;
  }
  if (daysNoDivorce >= 5 && todayFacts.divorces === 0) {
    out.push({ kind: 'no-divorce-streak', text: `*${daysNoDivorce + 1}* dias seguidos sem nenhum divórcio` });
  }

  // dias sem casamento
  let daysNoMarry = 0;
  for (const s of snaps) {
    if (safeNum(s.payload?.totals?.marriages, 0) === 0) daysNoMarry += 1;
    else break;
  }
  if (todayFacts.marriages > 0 && daysNoMarry >= 7) {
    out.push({ kind: 'first-marry', text: `Primeiro casamento em *${daysNoMarry}* dias` });
  }

  // streak de moods caóticos (dias consecutivos terminando hoje, se hoje é caótico)
  if (todayFacts.mood === 'caotico') {
    let chaosStreak = 1;
    for (const s of snaps) {
      if (String(s.payload?.mood) === 'caotico') chaosStreak += 1;
      else break;
    }
    if (chaosStreak >= 3) {
      out.push({
        kind: 'chaos-streak',
        text: `${chaosStreak}º dia seguido de alta criminalidade`,
      });
    }
  }

  return out.slice(0, 4); // máx 4 bullets de memória
}

/**
 * Deriva a "personalidade" do grupo a partir do histórico de moods (7 dias).
 * Se >=5/7 dias foram do mesmo mood (não-médio), assume essa identidade.
 * @returns {{ mood: string|null, daysDominant: number, line: string|null }}
 */
export function derivePersonality(moodHistory, todayMood) {
  const history = safeArr(moodHistory).map((m) => String(m?.mood || 'medio'));
  // inclui hoje
  const all = [todayMood, ...history];
  const counts = {};
  for (const m of all) counts[m] = (counts[m] || 0) + 1;
  let dominant = null;
  let max = 0;
  for (const [m, c] of Object.entries(counts)) {
    if (m === 'medio') continue;
    if (c > max) {
      max = c;
      dominant = m;
    }
  }
  if (!dominant || max < 4) return { mood: null, daysDominant: 0, line: null };

  const lines = {
    apostador:
      'Aparentemente este grupo acredita que investir significa clicar em "apostar".',
    caotico: 'O índice de criminalidade daqui continua impressionando especialistas.',
    romantico: 'O cartório local já considera abrir uma filial só pra este grupo.',
    calmo: 'Este grupo tem uma relação suspeita com o silêncio. Algo está sendo tramado.',
  };
  return {
    mood: dominant,
    daysDominant: max,
    line: lines[dominant] || null,
  };
}

/**
 * Resume o DayFacts para persistência no snapshot (sem eventos brutos, ~2KB).
 */
export function factsToSnapshotPayload(facts) {
  return {
    mood: facts.mood,
    totals: facts.totals,
    economy: {
      casinoVolume: facts.economy.casinoVolume,
      assaultsTotal: facts.economy.assaultsTotal,
      rentCollected: facts.economy.rentCollected,
      moneyDestroyed: facts.economy.moneyDestroyed,
      circulating: facts.economy.circulating,
      gini: facts.economy.gini,
    },
    society: {
      marriages: facts.society.marriages,
      divorces: facts.society.divorces,
      couplesActive: facts.society.couplesActive,
      achievements: facts.society.achievementsUnlocked,
    },
    police: {
      assaultsTotal: facts.police.assaultsTotal,
      assaultsCount: facts.police.assaultsCount,
      propertyRobs: facts.police.propertyRobs,
    },
    casino: {
      volume: facts.casino.volume,
      lost: facts.casino.lost,
    },
    rankings: {
      topCoins: facts.rankings.topCoins,
    },
  };
}
