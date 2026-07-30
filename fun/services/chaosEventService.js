/**
 * Purga — evento diário de 10 minutos (referência ao filme Uma Noite de Crime).
 * Ativa 1x/dia em horário configurável.
 * Durante o evento: assalto livre, sem arma / sem munição = punhos (50%), saldo negativo
 * limitado, heat desativado.
 * Defesa: alvo resolve conta de matemática em N s (msgTime do Baileys, não wall-clock).
 * Cooldown entre assaltos por atacante (padrão 30s) para evitar flood no pico do evento.
 *
 * Critério de atividade: apenas jogadores com interação nos últimos N minutos
 * podem ser vítimas (activityWindowMs, padrão 3 min).
 *
 * Proteção pós-roubo: quem foi roubado e ainda não mandou mensagem no chat
 * não pode ser roubado de novo até interagir (anti-farm de AFK).
 *
 * Concorrência (muitos users ao mesmo tempo):
 * - cooldown por atacante
 * - alvo com desafio pendente = target-busy (não sobrescreve)
 * - transferência relê saldo live (sem double-steal por snapshot stale)
 * - resolução de desafio é atômica (delete-first)
 * - grace de entrega Baileys antes de auto-timeout no wall-clock
 */

import { getDb } from '../../db/context.js';

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/** Timestamp de evento: prefere msgTime do Baileys; rejeita futuro absurdo. */
function resolveEventTime(msgTimeMs, wallNow = Date.now()) {
  const n = Number(msgTimeMs);
  if (!Number.isFinite(n) || n <= 0) return wallNow;
  // skew futuro > 10s → wall (clock do cliente/WA esquisito)
  if (n > wallNow + 10_000) return wallNow;
  return Math.floor(n);
}

function generateMathChallenge(random) {
  const terms = 2;
  const nums = [];
  const ops = [];
  let expression = '';
  let total = 0;

  for (let i = 0; i < terms; i++) {
    const n = 1 + Math.floor(random() * 19);
    nums.push(n);
  }

  for (let i = 0; i < terms - 1; i++) {
    ops.push(random() < 0.5 ? '+' : '-');
  }

  total = nums[0];
  expression = String(nums[0]);
  for (let i = 0; i < ops.length; i++) {
    expression += ` ${ops[i]} ${nums[i + 1]}`;
    if (ops[i] === '+') {
      total += nums[i + 1];
    } else {
      total -= nums[i + 1];
    }
  }

  if (total < 0) {
    return generateMathChallenge(random);
  }

  return { expression, answer: total };
}

export function createChaosEventService({
  repository,
  eventRepository,
  getMarketService = null,
  random = Math.random,
  getNewsService = null,
} = {}) {
  if (!repository) throw new Error('[fun/chaosEventService] repository required');
  if (!eventRepository) throw new Error('[fun/chaosEventService] eventRepository required');

  /** @type {Map<string, { attackers: Map<string,number>, victims: Map<string,number>, startAt: number }>} */
  const leaderboards = new Map();

  /**
   * Desafios de defesa por scope → victimJid.
   * expiresAt: limite justo (msgTime / wall na criação + timeout)
   * hardExpiresAt: wall-clock + grace — só então processExpired executa o roubo
   */
  /** @type {Map<string, Map<string, object>>} */
  const challenges = new Map();

  /** Cooldown de assalto: `${scope}\0${attackerJid}` → readyAt (wall-clock) */
  /** @type {Map<string, number>} */
  const assaultCooldowns = new Map();

  /**
   * Último roubo bem-sucedido na Purga: `${scope}\0${victimJid}` → timestamp.
   * Enquanto a vítima não mandar mensagem depois disso, não pode ser roubada de novo.
   * @type {Map<string, number>}
   */
  const lastRobbedAt = new Map();

  /**
   * Tracker de atividade de chat próprio do fun (por scope+jid).
   * Independente do TMB / conversation_events — alimentado pelo pipeline onIncomingMessage.
   * Chave: `${scope}\0${jid}` → lastActivityMs.
   * @type {Map<string, number>}
   */
  const activityByScopeJid = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.chaosEventEnabled !== false,
      hour: Math.max(0, Math.min(23, Math.floor(numOr(funConfig.chaosEventHour, 23)))),
      minute: Math.max(0, Math.min(59, Math.floor(numOr(funConfig.chaosEventMinute, 30)))),
      durationMs: Math.max(60_000, Math.floor(numOr(funConfig.chaosEventDurationMs, 10 * 60_000))),
      noWeaponSuccess: Math.min(0.75, Math.max(0.1, numOr(funConfig.chaosEventNoWeaponSuccess, 0.50))),
      weaponBaseChance: Math.min(0.85, Math.max(0.1, numOr(funConfig.chaosEventWeaponBaseChance, 0.60))),
      maxStealAmount: Math.max(1, Math.floor(numOr(funConfig.chaosEventMaxStealAmount, 100))),
      maxDebt: Math.max(0, Math.floor(numOr(funConfig.chaosEventMaxDebt, 100))),
      defenseEnabled: funConfig.chaosEventDefenseEnabled !== false,
      defenseTimeoutMs: Math.max(1000, Math.floor(numOr(funConfig.chaosEventDefenseTimeoutMs, 8000))),
      /** Tempo extra no wall-clock p/ Baileys atrasar a entrega da resposta de defesa */
      defenseDeliveryGraceMs: Math.max(
        0,
        Math.floor(numOr(funConfig.chaosEventDefenseDeliveryGraceMs, 25_000))
      ),
      activityWindowMs: Math.max(
        60_000,
        Math.floor(numOr(funConfig.chaosEventActivityWindowMs, 3 * 60_000))
      ),
      /** Cooldown entre assaltos do mesmo atacante no mesmo grupo (padrão 30s) */
      assaultCooldownMs: Math.max(0, Math.floor(numOr(funConfig.chaosEventAssaultCooldownMs, 30_000))),
    };
  }

  function robKey(scopeKey, victimJid) {
    return `${String(scopeKey || '')}\0${String(victimJid || '')}`;
  }

  function markVictimRobbed(scopeKey, victimJid, now = Date.now()) {
    lastRobbedAt.set(robKey(scopeKey, victimJid), Number(now) || Date.now());
  }

  function clearRobbedMarks(scopeKey) {
    const prefix = `${String(scopeKey || '')}\0`;
    for (const k of [...lastRobbedAt.keys()]) {
      if (k.startsWith(prefix)) lastRobbedAt.delete(k);
    }
  }

  /**
   * True se a vítima já foi roubada e ainda não mandou mensagem depois do roubo.
   */
  function isVictimSilentAfterRob(scopeKey, victimJid, clock = Date.now()) {
    const robbedAt = lastRobbedAt.get(robKey(scopeKey, victimJid)) || 0;
    if (robbedAt <= 0) return false;
    const lastAct = getLastPlayerActivity(victimJid, scopeKey, clock);
    // precisa de interação *depois* do roubo
    return !(lastAct > robbedAt);
  }

  /**
   * Arma utilizável na Purga: se exige munição e não tem, tenta a próxima (ex.: faca).
   * Sem nenhuma arma usável → null (punhos).
   */
  function pickUsableWeapon(ms, userJid, scopeKey) {
    if (!ms) return null;
    let bag = [];
    try {
      bag = typeof ms.inventoryOf === 'function' ? ms.inventoryOf(userJid, scopeKey) || [] : [];
    } catch {
      bag = [];
    }
    const weapons = bag
      .filter(
        (i) =>
          i?.collectible?.category === 'arma' &&
          i.condition === 'ok' &&
          !i.listed &&
          (i.usesLeft === -1 || i.usesLeft > 0)
      )
      .sort(
        (a, b) =>
          (Number(b.collectible?.assaultPower) || 0) -
          (Number(a.collectible?.assaultPower) || 0)
      );

    const hasAmmo = () => {
      try {
        return bag.some(
          (i) =>
            i.itemId === 'municao' &&
            i.condition === 'ok' &&
            !i.listed &&
            (i.usesLeft === -1 || i.usesLeft > 0)
        );
      } catch {
        return false;
      }
    };

    for (const w of weapons) {
      const req = w.collectible?.requires;
      if (req === 'municao' && !hasAmmo()) {
        continue; // arma de fogo sem cartucho → tenta melee / punhos
      }
      return w;
    }

    // Fallback: findBestWeapon + checagem de munição (se inventoryOf indisponível)
    if (!weapons.length && typeof ms.findBestWeapon === 'function') {
      const w = ms.findBestWeapon(userJid, scopeKey);
      if (!w) return null;
      if (w.collectible?.requires === 'municao') {
        // tenta consumir depois; se falhar, caller trata como punhos
        return w;
      }
      return w;
    }
    return null;
  }

  function cooldownKey(scopeKey, attackerJid) {
    return `${String(scopeKey || '')}\0${String(attackerJid || '')}`;
  }

  function getAssaultCooldownRemaining(scopeKey, attackerJid, now = Date.now()) {
    const readyAt = assaultCooldowns.get(cooldownKey(scopeKey, attackerJid)) || 0;
    return Math.max(0, readyAt - now);
  }

  function setAssaultCooldown(scopeKey, attackerJid, funConfig = {}, now = Date.now()) {
    const ms = opts(funConfig).assaultCooldownMs;
    if (ms <= 0) return 0;
    const readyAt = now + ms;
    assaultCooldowns.set(cooldownKey(scopeKey, attackerJid), readyAt);
    return readyAt;
  }

  function clearAssaultCooldowns(scopeKey) {
    const prefix = `${String(scopeKey || '')}\0`;
    for (const key of assaultCooldowns.keys()) {
      if (key.startsWith(prefix)) assaultCooldowns.delete(key);
    }
  }

  function isEventActive(scopeKey, now = Date.now()) {
    const raw = eventRepository.get(scopeKey);
    if (raw.eventType !== 'crime_chaos') return false;
    if (raw.endsAt <= now) return false;
    return {
      active: true,
      eventType: 'crime_chaos',
      startsAt: raw.startsAt,
      endsAt: raw.endsAt,
      remainingMs: Math.max(0, raw.endsAt - now),
    };
  }

  function tryStartEvent(scopeKey, funConfig = {}, now = Date.now(), options = {}) {
    const o = opts(funConfig);
    if (!o.enabled && !options.force) return { ok: false, reason: 'disabled' };

    const already = isEventActive(scopeKey, now);
    if (already) return { ok: false, reason: 'already-active', status: already };

    const tz = String(funConfig.worldTimezone || 'America/Sao_Paulo');
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(new Date(now));
    const currentHour = Number((parts.find((p) => p.type === 'hour') || {}).value);
    const currentMinute = Number((parts.find((p) => p.type === 'minute') || {}).value);
    const dow = (parts.find((p) => p.type === 'weekday') || {}).value;
    const isWeekend = dow === 'Sat' || dow === 'Sun';
    const h = isWeekend
      ? numOr(funConfig.chaosEventWeekendHour, 22)
      : numOr(funConfig.chaosEventHour, 23);
    const m = isWeekend
      ? numOr(funConfig.chaosEventWeekendMinute, 0)
      : numOr(funConfig.chaosEventMinute, 30);
    const windowOk = currentHour === h && currentMinute >= m && currentMinute < m + 5;
    if (!windowOk && !options.force) return { ok: false, reason: 'wrong-hour' };

    const raw = eventRepository.get(scopeKey);
    const fmtDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    const todayDate = fmtDate.format(new Date(now));
    const lastDate = fmtDate.format(new Date(raw.lastSpawnAt));

    if (lastDate === todayDate && raw.lastSpawnAt > 0 && !options.force) {
      return { ok: false, reason: 'already-today' };
    }

    const duration = o.durationMs;
    const event = eventRepository.upsert(scopeKey, {
      eventType: 'crime_chaos',
      multiplier: 1,
      startsAt: now,
      endsAt: now + duration,
      lastSpawnAt: now,
      payload: { label: 'PURGA' },
    });

    leaderboards.set(scopeKey, {
      attackers: new Map(),
      victims: new Map(),
      startAt: now,
    });

    // Limpa estado stale da purga anterior do escopo.
    // Motivo: se formatEndAnnouncement não rodou (bot reiniciado, announce pulado),
    // lastRobbedAt/assaultCooldowns/challenges persistiam e contaminavam o novo evento
    // (vítimas com escudo permanente, cooldowns antigos, desafios dangling).
    clearRobbedMarks(scopeKey);
    clearAssaultCooldowns(scopeKey);
    clearActivity(scopeKey);
    const staleChallenges = challenges.get(String(scopeKey || ''));
    if (staleChallenges) {
      staleChallenges.clear();
      challenges.delete(String(scopeKey || ''));
    }
    warningSent.delete(`${scopeKey}:2min`);
    // Limpa flags de fim anunciado para o escopo (qualquer endsAt anterior)
    for (const k of [...endSent.keys()]) {
      if (k.startsWith(`${scopeKey}:`)) endSent.delete(k);
    }

    try {
      const ns = typeof getNewsService === 'function' ? getNewsService() : null;
      ns?.log?.(scopeKey, 'purga_start', {
        payload: { duration, endsAt: now + duration },
      });
    } catch {}

    return {
      ok: true,
      eventType: 'crime_chaos',
      event,
      durationMs: duration,
      endsAt: now + duration,
      remainingMs: duration,
      label: 'PURGA',
    };
  }

  function getTimeRemaining(scopeKey, now = Date.now()) {
    const event = isEventActive(scopeKey, now);
    if (!event) return 0;
    return event.remainingMs;
  }

  function recordLeaderboard(scopeKey, attackerJid, victimJid, stolen) {
    let lb = leaderboards.get(scopeKey);
    if (!lb) {
      lb = { attackers: new Map(), victims: new Map(), startAt: Date.now() };
      leaderboards.set(scopeKey, lb);
    }
    const atk = String(attackerJid || '');
    const vic = String(victimJid || '');
    lb.attackers.set(atk, (lb.attackers.get(atk) || 0) + stolen);
    lb.victims.set(vic, (lb.victims.get(vic) || 0) + stolen);
  }

  function getEventLeaderboard(scopeKey) {
    const lb = leaderboards.get(scopeKey);
    if (!lb) return { attackers: [], victims: [] };
    const attackers = [...lb.attackers.entries()]
      .map(([jid, total]) => ({ jid, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    const victims = [...lb.victims.entries()]
      .map(([jid, total]) => ({ jid, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);
    return { attackers, victims };
  }

  function cleanupLeaderboard(scopeKey) {
    leaderboards.delete(scopeKey);
  }

  /**
   * Transferência atômica o bastante para pico de concorrência:
   * relê saldo live (ignora snapshot stale) e nunca lança exceção para cima.
   */
  function executeAssaultTransfer(scopeKey, attackerJid, targetJid, desired, tCoinsSnapshot, now, maxDebt = 100) {
    try {
      const debtCap = Math.max(0, Math.floor(Number(maxDebt) || 0));
      const want = Math.max(0, Math.floor(Number(desired) || 0));
      if (want <= 0) {
        return { stolen: 0, stolenFromWallet: 0, stolenFromDebt: 0 };
      }

      let tCoins = Number(tCoinsSnapshot);
      try {
        const live = repository.getUserStats(targetJid, scopeKey);
        if (live && Number.isFinite(Number(live.coins))) {
          tCoins = Number(live.coins);
        }
      } catch {
        if (!Number.isFinite(tCoins)) tCoins = 0;
      }
      if (!Number.isFinite(tCoins)) tCoins = 0;

      const finalTaken = Math.min(want, Math.max(0, tCoins));
      let finalDebt = want - finalTaken;

      if (finalDebt > 0) {
        const currentNegative = Math.abs(Math.min(0, tCoins - finalTaken));
        const maxAdditionalDebt = Math.max(0, debtCap - currentNegative);
        finalDebt = Math.min(finalDebt, maxAdditionalDebt);
      }

      if (finalTaken > 0) {
        repository.addCoins({
          userJid: targetJid, scopeKey, amount: -finalTaken, now, reason: 'crime-victim',
        });
      }

      if (finalDebt > 0) {
        repository.addCoinsAllowNegative({
          userJid: targetJid, scopeKey, amount: -finalDebt, now, reason: 'crime-debt',
        });
      }

      const totalStolen = finalTaken + finalDebt;
      if (totalStolen > 0) {
        repository.addCoins({
          userJid: attackerJid, scopeKey, amount: totalStolen, now, reason: 'crime-win',
        });
      }

      if (totalStolen > 0) {
        recordLeaderboard(scopeKey, attackerJid, targetJid, totalStolen);
        // vítima roubada: só pode ser alvo de novo após mandar mensagem
        markVictimRobbed(scopeKey, targetJid, now);
      }

      return { stolen: totalStolen, stolenFromWallet: finalTaken, stolenFromDebt: finalDebt };
    } catch {
      return { stolen: 0, stolenFromWallet: 0, stolenFromDebt: 0, error: true };
    }
  }

  function activityKey(scopeKey, jid) {
    return `${String(scopeKey || '')}\0${String(jid || '')}`;
  }

  /**
   * Registra atividade de chat de um jogador no escopo (chamado pelo pipeline onIncomingMessage).
   * Fonte canônica da Purga — independe do TMB / conversation_events.
   * @param {string} scopeKey
   * @param {string} jid
   * @param {number} [now] — timestamp ms da mensagem (msgTimeMs do Baileys preferencial)
   */
  function registerActivity(scopeKey, jid, now = Date.now()) {
    const ts = Number(now) || Date.now();
    const key = activityKey(scopeKey, jid);
    const prev = activityByScopeJid.get(key) || 0;
    // monotônico: só avança (msgTime de chegada tardia não deve regredir)
    if (ts > prev) activityByScopeJid.set(key, ts);
  }

  function clearActivity(scopeKey) {
    const prefix = `${String(scopeKey || '')}\0`;
    for (const k of [...activityByScopeJid.keys()]) {
      if (k.startsWith(prefix)) activityByScopeJid.delete(k);
    }
  }

  function getLastPlayerActivity(jid, scopeKey, now = Date.now()) {
    // Fonte primária: tracker interno do fun (escopado por grupo).
    const internal = activityByScopeJid.get(activityKey(scopeKey, jid)) || 0;
    if (internal > 0) return internal;
    // Fallback retroativo: conversation_events do core. Só usado se o tracker
    // interno ainda não registrou atividade (ex.: bot reiniciado há poucos ms).
    try {
      const db = getDb();
      const row = db.prepare(`
        SELECT occurred_at
        FROM analytics.conversation_events
        WHERE jid = ?
        ORDER BY occurred_at DESC
        LIMIT 1
      `).get(String(jid || ''));
      return row ? Number(row.occurred_at) || 0 : 0;
    } catch {
      return 0;
    }
  }

  function doCrimeAssault({
    attackerJid,
    targetJid,
    scopeKey,
    amount,
    funConfig = {},
    now = Date.now(),
  }) {
    try {
      // Relógio do assalto = momento do processamento (prod: Date.now() no handler; testes: injetado).
      // NÃO usar resolveEventTime/msgTime aqui — o desafio só existe quando o bot responde.
      // Clamp de skew futuro quebraria timelines controlados de teste e a janela de AFK.
      const clock =
        Number.isFinite(Number(now)) && Number(now) > 0
          ? Math.floor(Number(now))
          : Date.now();
      const a = String(attackerJid || '');
      const t = String(targetJid || '');
      if (!a || !t || a === t) return { ok: false, reason: 'invalid-target' };

      const event = isEventActive(scopeKey, clock);
      if (!event) return { ok: false, reason: 'event-inactive' };

      const o = opts(funConfig);

      const cdLeft = getAssaultCooldownRemaining(scopeKey, a, clock);
      if (cdLeft > 0) {
        return {
          ok: false,
          reason: 'cooldown',
          remainingMs: cdLeft,
          cooldownMs: o.assaultCooldownMs,
        };
      }

      const lastActivity = getLastPlayerActivity(t, scopeKey, clock);
      if (lastActivity > 0 && clock - lastActivity > o.activityWindowMs) {
        return { ok: false, reason: 'inactive-target' };
      }

      // Roubado e ainda mudo no chat → não pode ser farmado de novo
      if (isVictimSilentAfterRob(String(scopeKey || ''), t, clock)) {
        return { ok: false, reason: 'victim-silent-after-rob' };
      }

      // Alvo já sob desafio: não sobrescreve (evita roubo silencioso do 1º atacante)
      const scopeChallenges = challenges.get(String(scopeKey || ''));
      const existing = scopeChallenges?.get(t);
      if (existing) {
        const hard = Number(existing.hardExpiresAt) || Number(existing.expiresAt) || 0;
        if (clock <= hard) {
          return {
            ok: false,
            reason: 'target-busy',
            remainingMs: Math.max(0, hard - clock),
          };
        }
        // hard-expirado e ainda na map: liquida antes de novo assalto
        resolveChallenge({
          scopeKey,
          targetJid: t,
          answer: 'timeout',
          now: clock,
          eventTime: hard + 1,
        });
        // O resolve acima pode ter roubado a vítima (atacante antigo) e aplicado
        // escudo via markVictimRobbed. Re-checa antes de prosseguir — evita duplo
        // roubo na mesma vítima no mesmo instante.
        if (isVictimSilentAfterRob(String(scopeKey || ''), t, clock)) {
          return { ok: false, reason: 'victim-silent-after-rob' };
        }
      }

      const requested = Math.max(1, Math.floor(Number(amount) || 1));
      const desired = Math.min(requested, o.maxStealAmount);

      const ms = typeof getMarketService === 'function' ? getMarketService() : null;

      // Arma usável (com munição se precisar) → senão punhos (mesma chance de sem arma)
      let weapon = pickUsableWeapon(ms, a, scopeKey);
      let wCol = weapon?.collectible || null;
      let usedFists = false;

      const tStats = repository.getUserStats(t, scopeKey) || repository.ensureUserRow(t, scopeKey, clock);
      const tCoins = Number(tStats.coins) || 0;
      repository.ensureUserRow(a, scopeKey, clock);

      let success = false;
      let chance = 0;

      if (weapon && wCol) {
        let usable = true;
        if (wCol.requires === 'municao') {
          if (!ms?.consumeOneConsumable?.(a, scopeKey, 'municao')) {
            usable = false;
          }
        }
        if (usable) {
          const power = Number(wCol.assaultPower) || 0;
          chance = Math.min(0.85, Math.max(0.12, o.weaponBaseChance + power / 200));
          if (ms?.consumeUse) ms.consumeUse(weapon, clock);
          success = random() < chance;
        } else {
          // sem munição e pickUsable falhou no peek → punhos
          weapon = null;
          wCol = null;
          usedFists = true;
          chance = o.noWeaponSuccess;
          success = random() < chance;
        }
      } else {
        usedFists = true;
        chance = o.noWeaponSuccess;
        success = random() < chance;
      }

      // Cooldown após tentativa (sucesso, falha ou pending) — anti-flood no pico
      setAssaultCooldown(scopeKey, a, funConfig, clock);

      if (!success) {
        return {
          ok: true, success: false, mode: 'crime_event',
          event: true, chance, weapon: wCol || null, fists: usedFists,
          stolen: 0, reason: 'failed',
          cooldownMs: o.assaultCooldownMs,
          coins: repository.getUserStats(a, scopeKey)?.coins || 0,
        };
      }

      if (!o.defenseEnabled) {
        const transfer = executeAssaultTransfer(scopeKey, a, t, desired, tCoins, clock, o.maxDebt);
        return {
          ok: true, success: true, mode: 'crime_event',
          event: true, chance, weapon: wCol || null, fists: usedFists,
          stolen: transfer.stolen, stolenFromWallet: transfer.stolenFromWallet,
          stolenFromDebt: transfer.stolenFromDebt, targetCoins: tCoins,
          targetAfter: Number(repository.getUserStats(t, scopeKey)?.coins) || 0,
          coins: repository.getUserStats(a, scopeKey)?.coins || 0,
          cooldownMs: o.assaultCooldownMs,
        };
      }

      const challenge = generateMathChallenge(random);
      // expiresAt: prazo justo a partir do processamento (quando o desafio é emitido)
      // hardExpiresAt: + grace Baileys — processExpired só liquida depois
      // Resposta do alvo é avaliada com msgTime (checkMessageForChallenge)
      const expiresAt = clock + o.defenseTimeoutMs;
      const hardExpiresAt = expiresAt + o.defenseDeliveryGraceMs;
      const challengeData = {
        attackerJid: a,
        amount: desired,
        tCoins,
        maxDebt: o.maxDebt,
        expression: challenge.expression,
        answer: challenge.answer,
        expiresAt,
        hardExpiresAt,
        createdAt: clock,
      };

      let map = challenges.get(String(scopeKey || ''));
      if (!map) {
        map = new Map();
        challenges.set(String(scopeKey || ''), map);
      }
      map.set(t, challengeData);

      return {
        ok: true, success: 'pending', mode: 'crime_event',
        event: true, chance, weapon: wCol || null, fists: usedFists,
        stolen: 0, reason: 'defense',
        cooldownMs: o.assaultCooldownMs,
        challenge: {
          targetJid: t,
          attackerJid: a,
          expression: challenge.expression,
          answer: challenge.answer,
          expiresAt,
          hardExpiresAt,
          defenseTimeoutMs: o.defenseTimeoutMs,
        },
        coins: repository.getUserStats(a, scopeKey)?.coins || 0,
      };
    } catch (err) {
      return {
        ok: false,
        reason: 'internal-error',
        message: err?.message || 'assault-error',
      };
    }
  }

  function getPendingChallenge(scopeKey, targetJid, now = Date.now()) {
    const scopeChallenges = challenges.get(String(scopeKey || ''));
    if (!scopeChallenges) return null;
    const c = scopeChallenges.get(String(targetJid || ''));
    if (!c) return null;
    // Um único relógio (msgTime/teste/wall) — nunca misturar Date.now() à parte
    const clock = resolveEventTime(now, Date.now());
    const hard = Number(c.hardExpiresAt) || Number(c.expiresAt) || 0;
    // Soft-expired (prazo justo) mas ainda no grace: devolve sem apagar
    if (clock > c.expiresAt && clock <= hard) {
      return { expired: true, softExpired: true, ...c };
    }
    // Hard-expired: remove da map (caller liquida via processExpired/resolve)
    if (clock > hard) {
      scopeChallenges.delete(String(targetJid || ''));
      if (scopeChallenges.size === 0) challenges.delete(String(scopeKey || ''));
      return { expired: true, hardExpired: true, ...c };
    }
    return { ...c };
  }

  /**
   * Resolve desafio de defesa.
   * @param {number} [eventTime] — msgTime da resposta (Baileys). Decide se entrou no prazo.
   * @param {number} [now] — wall-clock (transferências / ledger).
   */
  function resolveChallenge({
    scopeKey,
    targetJid,
    answer,
    now = Date.now(),
    eventTime = null,
  }) {
    try {
      const t = String(targetJid || '');
      const s = String(scopeKey || '');
      const wallNow = Number(now) || Date.now();
      const fairTime = resolveEventTime(
        eventTime != null ? eventTime : wallNow,
        wallNow
      );

      const scopeChallenges = challenges.get(s);
      if (!scopeChallenges) return { ok: false, reason: 'no-challenge' };

      const c = scopeChallenges.get(t);
      if (!c) return { ok: false, reason: 'no-challenge' };
      // Delete-first: atômico no event-loop — evita double-resolve sob race
      scopeChallenges.delete(t);
      if (scopeChallenges.size === 0) challenges.delete(s);

      const debtCap = Number.isFinite(Number(c.maxDebt)) ? Number(c.maxDebt) : 100;
      const timedOut = fairTime > Number(c.expiresAt);

      if (timedOut) {
        const transfer = executeAssaultTransfer(s, c.attackerJid, t, c.amount, c.tCoins, wallNow, debtCap);
        return {
          ok: true, defended: false, timedOut: true,
          attackerJid: c.attackerJid, expression: c.expression, correctAnswer: c.answer,
          stolen: transfer.stolen,
          stolenFromWallet: transfer.stolenFromWallet,
          stolenFromDebt: transfer.stolenFromDebt,
        };
      }

      const parsed = Math.floor(Number(answer));
      if (!Number.isFinite(parsed)) {
        const transfer = executeAssaultTransfer(s, c.attackerJid, t, c.amount, c.tCoins, wallNow, debtCap);
        return {
          ok: true, defended: false, invalid: true,
          attackerJid: c.attackerJid, expression: c.expression, correctAnswer: c.answer,
          stolen: transfer.stolen,
          stolenFromWallet: transfer.stolenFromWallet,
          stolenFromDebt: transfer.stolenFromDebt,
        };
      }

      if (parsed === c.answer) {
        return {
          ok: true, defended: true,
          attackerJid: c.attackerJid, expression: c.expression, correctAnswer: c.answer,
          stolen: 0,
        };
      }

      const transfer = executeAssaultTransfer(s, c.attackerJid, t, c.amount, c.tCoins, wallNow, debtCap);
      return {
        ok: true, defended: false,
        attackerJid: c.attackerJid, expression: c.expression, correctAnswer: c.answer,
        givenAnswer: parsed,
        stolen: transfer.stolen,
        stolenFromWallet: transfer.stolenFromWallet,
        stolenFromDebt: transfer.stolenFromDebt,
      };
    } catch (err) {
      return { ok: false, reason: 'internal-error', message: err?.message || 'resolve-error' };
    }
  }

  /**
   * Liquida desafios cujo hardExpiresAt (wall + grace Baileys) já passou.
   * Não usa expiresAt fair — senão roubaria antes da msg atrasada chegar.
   */
  function processExpiredChallenges(scopeKey, now = Date.now()) {
    try {
      const scopeChallenges = challenges.get(String(scopeKey || ''));
      if (!scopeChallenges) return [];
      const wallNow = Number(now) || Date.now();
      const results = [];
      for (const [targetJid, c] of [...scopeChallenges.entries()]) {
        const hard = Number(c.hardExpiresAt) || Number(c.expiresAt) || 0;
        if (wallNow > hard) {
          const t = String(targetJid);
          // Re-check + delete atômico (pode ter sido resolvido entre o for e agora)
          if (!scopeChallenges.has(targetJid)) continue;
          scopeChallenges.delete(targetJid);
          const debtCap = Number.isFinite(Number(c.maxDebt)) ? Number(c.maxDebt) : 100;
          const transfer = executeAssaultTransfer(
            String(scopeKey), c.attackerJid, t, c.amount, c.tCoins, wallNow, debtCap
          );
          results.push({
            targetJid: t, attackerJid: c.attackerJid,
            expression: c.expression, correctAnswer: c.answer,
            stolen: transfer.stolen, timedOut: true,
          });
        }
      }
      if (scopeChallenges.size === 0) challenges.delete(String(scopeKey || ''));
      return results;
    } catch {
      return [];
    }
  }

  function formatStartAnnouncement(result, funConfig = {}) {
    if (!result?.ok) return '';
    const o = opts(funConfig);
    const minutes = Math.max(1, Math.round((result.durationMs || o.durationMs || 0) / 60000));
    const defSec = Math.max(1, Math.round(o.defenseTimeoutMs / 1000));
    const cdSec = Math.max(0, Math.round(o.assaultCooldownMs / 1000));
    const actMin = Math.max(1, Math.round(o.activityWindowMs / 60_000));
    return [
      '🚨🚨 *PURGA — ESTADO DE EMERGÊNCIA*',
      '',
      'A cidade entrou em colapso.',
      'A polícia abandonou as ruas.',
      '',
      `Durante *${minutes} minutos*:`,
      '💰 Qualquer valor pode ser roubado',
      '🔫 Armas se tiver · sem munição = *punhos*',
      `👁️ Só alvos ativos nos últimos *${actMin} min*`,
      '🔇 Roubado e mudo no chat? Não pode ser roubado de novo até mandar msg',
      `🧮 Defenda-se resolvendo a conta em ${defSec}s`,
      cdSec > 0 ? `⏳ Cooldown de ${cdSec}s entre assaltos` : null,
      '🔥 Heat foi desativado — sem wanted',
      '💸 Saldo negativo permitido (limitado)',
      '',
      `\`/crime @alvo quantia\``,
      '🧮 Se for atacado, DIGITE O NÚMERO da conta para se defender',
      '',
      'Boa sorte...',
    ].filter((line) => line != null).join('\n');
  }

  function formatWarningAnnouncement(remainingMs) {
    const min = Math.ceil(remainingMs / 60000);
    if (min <= 0) return '';
    return [
      '⚠️ *PURGA — AVISO*',
      '',
      `Faltam apenas *${min} minuto${min !== 1 ? 's' : ''}* de caos.`,
      'Preparem-se para o retorno da lei.',
    ].join('\n');
  }

  function formatEndAnnouncement(scopeKey, getContactDisplayName) {
    const lb = getEventLeaderboard(scopeKey);
    const lines = [
      '🚓🚓 *FIM DA PURGA*',
      '',
      'As forças policiais retomaram o controle da cidade.',
      'O evento terminou. O heat está de volta.',
    ];

    if (lb.attackers.length > 0) {
      lines.push('', '🏆 *Maiores criminosos:*');
      const medals = ['🥇', '🥈', '🥉'];
      lb.attackers.forEach((entry, i) => {
        const name = nameOr(entry.jid, getContactDisplayName);
        lines.push(`${medals[i] || '▪'} ${name} — *${entry.total}* roubados`);
      });
    }

    if (lb.victims.length > 0) {
      lines.push('', '😭 *Maiores vítimas:*');
      lb.victims.slice(0, 1).forEach((entry) => {
        const name = nameOr(entry.jid, getContactDisplayName);
        lines.push(`😭 ${name} perdeu *${entry.total}*`);
      });
    }

    lines.push('', '_Até a próxima Purga._');
    const finalLb = { attackers: [...lb.attackers], victims: [...lb.victims] };
    cleanupLeaderboard(scopeKey);
    clearAssaultCooldowns(scopeKey);
    clearRobbedMarks(scopeKey);
    try {
      const ns = typeof getNewsService === 'function' ? getNewsService() : null;
      ns?.log?.(scopeKey, 'purga_end', {
        payload: { attackers: finalLb.attackers.slice(0, 5), victims: finalLb.victims.slice(0, 3) },
      });
    } catch {}
    return lines.join('\n');
  }

  function nameOr(jid, getName) {
    try {
      return typeof getName === 'function' ? getName(jid) : jid.split('@')[0];
    } catch {
      return jid.split('@')[0];
    }
  }

  function isHeatDisabled(scopeKey, now = Date.now()) {
    return Boolean(isEventActive(scopeKey, now));
  }

  function cooldownRemaining(scopeKey, now = Date.now()) {
    const raw = eventRepository.get(scopeKey);
    if (raw.eventType !== 'crime_chaos') return 0;
    if (raw.endsAt <= now) return 0;
    return raw.endsAt - now;
  }

  const warningSent = new Map();
  const endSent = new Map();

  function shouldSendWarning(scopeKey, now = Date.now()) {
    const event = isEventActive(scopeKey, now);
    if (!event) return false;
    const remaining = event.remainingMs;
    const warningWindow = 140_000;
    if (remaining > warningWindow || remaining < 10_000) return false;
    const key = `${scopeKey}:2min`;
    if (warningSent.get(key)) return false;
    warningSent.set(key, true);
    return true;
  }

  function resetWarning(scopeKey) {
    warningSent.delete(`${scopeKey}:2min`);
  }

  function shouldSendEnd(scopeKey, now = Date.now()) {
    const raw = eventRepository.get(scopeKey);
    if (raw.eventType !== 'crime_chaos') return false;
    if (raw.endsAt > now) return false;
    // Evita re-anúncio ao reiniciar o bot — se já passou mais de uma duração
    // de evento desde o fim, o evento é considerado estaleiro.
    const eventDuration = raw.endsAt - raw.startsAt;
    if (now - raw.endsAt > eventDuration) return false;
    const key = `${scopeKey}:${raw.endsAt}`;
    if (endSent.get(key)) return false;
    endSent.set(key, true);
    return true;
  }

  /**
   * Intercepta resposta numérica de defesa.
   * @param {number} [now] — preferir msgTimeMs do Baileys (hora em que o user enviou).
   *   Atraso de entrega no wall-clock NÃO deve invalidar defesa no prazo.
   */
  function checkMessageForChallenge(scopeKey, senderJid, text, now = Date.now()) {
    try {
      const t = String(senderJid || '');
      const s = String(scopeKey || '');
      if (!t || !s) return { matched: false };

      // `now` = msgTimeMs do Baileys (hora em que o user enviou a mensagem)
      const fairTime = resolveEventTime(now, Date.now());

      const scopeChallenges = challenges.get(s);
      if (!scopeChallenges) return { matched: false };
      const c = scopeChallenges.get(t);
      if (!c) return { matched: false };

      const hard = Number(c.hardExpiresAt) || Number(c.expiresAt) || 0;

      // Soft-timeout pelo msgTime: user mandou tarde → roubo
      if (fairTime > Number(c.expiresAt)) {
        const result = resolveChallenge({
          scopeKey: s,
          targetJid: t,
          answer: 'timeout',
          now: fairTime,
          eventTime: fairTime,
        });
        return { matched: true, result };
      }

      // Extrai o primeiro número — "18", "é 18", "18 resposta"
      const numMatch = String(text || '').match(/-?\d+/);
      const parsed = numMatch ? Math.floor(Number(numMatch[0])) : NaN;
      if (!Number.isFinite(parsed)) return { matched: false };

      if (parsed === c.answer) {
        const result = resolveChallenge({
          scopeKey: s,
          targetJid: t,
          answer: parsed,
          now: fairTime,
          eventTime: fairTime,
        });
        return { matched: true, result };
      }

      // Número errado: não consome — pode tentar de novo enquanto hardExpires não passou
      if (fairTime > hard) {
        const result = resolveChallenge({
          scopeKey: s,
          targetJid: t,
          answer: 'timeout',
          now: fairTime,
          eventTime: fairTime,
        });
        return { matched: true, result };
      }

      return { matched: false };
    } catch {
      return { matched: false };
    }
  }

  return {
    isEventActive,
    tryStartEvent,
    getTimeRemaining,
    doCrimeAssault,
    getPendingChallenge,
    resolveChallenge,
    processExpiredChallenges,
    checkMessageForChallenge,
    formatStartAnnouncement,
    formatWarningAnnouncement,
    formatEndAnnouncement,
    getEventLeaderboard,
    isHeatDisabled,
    cooldownRemaining,
    getAssaultCooldownRemaining,
    shouldSendWarning,
    resetWarning,
    shouldSendEnd,
    registerActivity,
  };
}
