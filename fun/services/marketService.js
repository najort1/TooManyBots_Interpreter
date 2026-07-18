/**
 * Mercado utilitário Fun — economia 4 camadas, estoque, armas, assalto.
 * C1 motor · C2 jornalista · C3 arquétipos · C4 regulador.
 */

import { openaiChatComplete } from '../llm/openaiClient.js';
import { ollamaGenerate } from '../llm/ollamaClient.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { recordLlmHit, inventTemplateAlert } from '../llm/llmMetrics.js';
import {
  COLLECTIBLES,
  getCollectible,
  listCollectibles,
  listCategories,
  listUtilityShop,
  listWeaponShop,
} from '../shop/collectibles.js';
import {
  companyForItem,
  getCompany,
  listCompanies,
  categoriesForCompany,
  tickAsset,
  applyTradeFlow,
  decayAssetState,
  trendFrom,
  defaultRegulatorKnobs,
  clampKnobs,
  regulate,
  computeGini,
  computeAvgAbsDelta,
  scaleEventWaitMs,
  pushRecentArchetype,
  pushFingerprint,
  pushTruthLog,
  popNarrativeSeed,
  scheduleShock,
  takeDueShocks,
  pickDeceptionMode,
  applyDeceptionPlan,
  clampEventDescription,
  EVENT_INVENT_SYSTEM,
  JOURNALIST_SYSTEM,
  buildInventUserPrompt,
  buildJournalistUserPrompt,
  parseInventResponse,
  parseJournalistJson,
  pickTemplateSeed,
  resolveEventProposal,
  alignEventCopy,
  isCopyCoherent,
  buildDirectionFallbackCopy,
  fingerprintText,
  clampShockPct,
} from '../economy/index.js';
import { nameOf } from '../utils/userLabel.js';

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function pick(arr, random) {
  if (!arr?.length) return null;
  return arr[Math.floor(random() * arr.length)];
}

function arrow(trend) {
  if (trend === 'up') return '↑';
  if (trend === 'down') return '↓';
  return '→';
}

export function createMarketService({
  repository,
  marketRepository,
  effectsRepository = null,
  factionService = null,
  casinoRepository = null,
  stockService = null,
  propertyService = null,
  random = Math.random,
  getLogger = () => null,
  generateZen = openaiChatComplete,
  generateOllama = ollamaGenerate,
} = {}) {
  if (!repository) throw new Error('[fun/marketService] repository required');
  if (!marketRepository) throw new Error('[fun/marketService] marketRepository required');

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.marketEnabled !== false,
      minMs: Math.max(5 * 60_000, Math.floor(numOr(funConfig.marketEventMinMs, 45 * 60_000))),
      maxMs: Math.max(10 * 60_000, Math.floor(numOr(funConfig.marketEventMaxMs, 3 * 60 * 60_000))),
      breakChance: Math.min(0.35, Math.max(0, numOr(funConfig.marketBreakChance, 0.06))),
      repairRate: Math.min(0.6, Math.max(0.05, numOr(funConfig.marketRepairRate, 0.22))),
      announce: funConfig.marketAnnounce !== false,
      restockMs: Math.max(
        60 * 60_000,
        Math.floor(numOr(funConfig.marketRestockMs, 7 * 24 * 60 * 60_000))
      ),
      assaultCooldownMs: Math.max(0, Math.floor(numOr(funConfig.assaultCooldownMs, 10 * 60_000))),
      assaultMinSteal: Math.max(1, Math.floor(numOr(funConfig.assaultMinSteal, 8))),
      assaultMaxStealRatio: Math.min(0.4, Math.max(0.05, numOr(funConfig.assaultMaxStealRatio, 0.12))),
      assaultBaseChance: Math.min(0.75, Math.max(0.1, numOr(funConfig.assaultBaseChance, 0.38))),
      assaultFailFinePct: Math.min(0.1, Math.max(0, numOr(funConfig.assaultFailFinePct, 0.012))),
      assaultFailFineMin: Math.max(0, Math.floor(numOr(funConfig.assaultFailFineMin, 5))),
      assaultFailFineMax: Math.max(1, Math.floor(numOr(funConfig.assaultFailFineMax, 30))),
      heistShopMin: Math.max(1, Math.floor(numOr(funConfig.heistShopMin, 48))),
      heistShopMax: Math.max(1, Math.floor(numOr(funConfig.heistShopMax, 100))),
      heistShopBaseChance: Math.min(0.85, Math.max(0.1, numOr(funConfig.heistShopBaseChance, 0.5))),
      heistBankMin: Math.max(1, Math.floor(numOr(funConfig.heistBankMin, 150))),
      heistBankMax: Math.max(1, Math.floor(numOr(funConfig.heistBankMax, 340))),
      heistBankBaseChance: Math.min(0.85, Math.max(0.1, numOr(funConfig.heistBankBaseChance, 0.34))),
      heistBankCooldownMs: Math.max(0, Math.floor(numOr(funConfig.heistBankCooldownMs, 12 * 60_000))),
    };
  }

  /**
   * Reposição semanal (tempo real): estoque volta ao stockMax.
   * Na 1ª visita só marca o relógio (já nasce cheio).
   */
  function maybeWeeklyRestock(scopeKey, funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    const meta = marketRepository.getMeta(scopeKey);
    const last = Number(meta.lastRestockAt) || 0;
    if (last <= 0) {
      marketRepository.setMeta(scopeKey, {
        lastEventAt: meta.lastEventAt,
        nextEventAt: meta.nextEventAt,
        lastRestockAt: now,
        now,
      });
      return { restocked: false, nextAt: now + o.restockMs, lastAt: now };
    }
    if (now - last < o.restockMs) {
      return { restocked: false, nextAt: last + o.restockMs, lastAt: last };
    }
    marketRepository.restockAllToMax(scopeKey, now);
    marketRepository.setMeta(scopeKey, {
      lastEventAt: meta.lastEventAt,
      nextEventAt: meta.nextEventAt,
      lastRestockAt: now,
      now,
    });
    return { restocked: true, nextAt: now + o.restockMs, lastAt: now };
  }

  function formatRestockEta(ms) {
    const sec = Math.max(0, Math.ceil(ms / 1000));
    if (sec < 3600) return `${Math.ceil(sec / 60)}min`;
    const h = Math.floor(sec / 3600);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
  }

  function loadRegulator(scopeKey) {
    const meta = marketRepository.getMeta(scopeKey);
    return clampKnobs({ ...defaultRegulatorKnobs(), ...(meta.economy || {}) });
  }

  function saveRegulator(scopeKey, reg, extra = {}, now = Date.now()) {
    const meta = marketRepository.getMeta(scopeKey);
    return marketRepository.setMeta(scopeKey, {
      lastEventAt: extra.lastEventAt !== undefined ? extra.lastEventAt : meta.lastEventAt,
      nextEventAt: extra.nextEventAt !== undefined ? extra.nextEventAt : meta.nextEventAt,
      lastRestockAt: extra.lastRestockAt !== undefined ? extra.lastRestockAt : meta.lastRestockAt,
      lastEconomyTickAt:
        extra.lastEconomyTickAt !== undefined ? extra.lastEconomyTickAt : meta.lastEconomyTickAt,
      economy: clampKnobs(reg),
      now,
    });
  }

  function ensureMarket(scopeKey, funConfig = {}, now = Date.now()) {
    marketRepository.ensurePrices(scopeKey, now);
    if (typeof marketRepository.ensureAssetStates === 'function') {
      marketRepository.ensureAssetStates(scopeKey, now);
    }
    maybeWeeklyRestock(scopeKey, funConfig, now);
    const meta = marketRepository.getMeta(scopeKey);
    if (!meta.economy || !Object.keys(meta.economy).length) {
      saveRegulator(scopeKey, defaultRegulatorKnobs(), {}, now);
    }
    if (!meta.nextEventAt) {
      const o = opts(funConfig);
      const lo = Math.min(o.minMs, o.maxMs);
      const hi = Math.max(o.minMs, o.maxMs);
      const wait = lo + Math.floor(random() * Math.max(1, hi - lo));
      const reg = loadRegulator(scopeKey);
      marketRepository.setMeta(scopeKey, {
        lastEventAt: meta.lastEventAt,
        nextEventAt: now + scaleEventWaitMs(wait, reg),
        lastRestockAt: meta.lastRestockAt,
        economy: reg,
        now,
      });
    }
  }

  function recordTrade(scopeKey, itemId, side, price, now = Date.now()) {
    if (!marketRepository.getAssetState) return;
    const col = getCollectible(itemId);
    const persona = companyForItem(col);
    const cur = marketRepository.getAssetState(scopeKey, itemId);
    const next = applyTradeFlow(cur, { side, qty: 1, price, personality: persona });
    marketRepository.setAssetState({
      scopeKey,
      itemId,
      supply: next.supply,
      demand: next.demand,
      eventShock: cur.eventShock,
      volumeBuy: next.volumeBuy,
      volumeSell: next.volumeSell,
      now,
    });
  }

  function collectHealthMetrics(scopeKey) {
    let balances = [];
    try {
      if (typeof repository.listScopeCoinBalances === 'function') {
        balances = repository.listScopeCoinBalances(scopeKey);
      } else if (typeof repository.getCoinsLeaderboard === 'function') {
        balances = repository
          .getCoinsLeaderboard(scopeKey, 200)
          .map((r) => Number(r.coins) || 0);
      }
    } catch {
      balances = [];
    }
    const circulating = balances.reduce((a, b) => a + b, 0);
    const prices = marketRepository.listPrices(scopeKey);
    let invested = 0;
    try {
      const inv = marketRepository.listAllInventoryInScope?.(scopeKey) || [];
      for (const row of inv) {
        const p = marketRepository.getPrice(scopeKey, row.itemId)?.price || 0;
        invested += p;
      }
    } catch {
      invested = 0;
    }
    const reg = loadRegulator(scopeKey);
    const baseline = Number(reg.baselineCoins) || Math.max(circulating, 1);
    const recent = marketRepository.listRecentEvents?.(scopeKey, 20) || [];
    const dayAgo = Date.now() - 24 * 60 * 60_000;
    const eventsLast24h = recent.filter((e) => (e.createdAt || 0) >= dayAgo).length;
    return {
      circulatingCoins: circulating,
      baselineCoins: baseline,
      gini: computeGini(balances),
      mintSink: Number(reg.mintSinkEstimate) || 0,
      activePlayers: balances.length,
      investedValue: invested,
      avgAbsDeltaPct: computeAvgAbsDelta(prices),
      eventsLast24h,
    };
  }

  function maybeRegulate(scopeKey, funConfig = {}, now = Date.now()) {
    if (funConfig.economyEnabled === false) return loadRegulator(scopeKey);
    let reg = loadRegulator(scopeKey);
    const every = Math.max(60_000, numOr(funConfig.economyRegulateMs, 30 * 60_000));
    if (reg.lastRegulateAt && now - reg.lastRegulateAt < every) return reg;
    if (!reg.baselineCoins) {
      const m0 = collectHealthMetrics(scopeKey);
      reg.baselineCoins = Math.max(1, m0.circulatingCoins || 1);
    }
    const metrics = collectHealthMetrics(scopeKey);
    reg = regulate(metrics, reg, now);
    saveRegulator(scopeKey, reg, {}, now);
    return reg;
  }

  /**
   * Tick de economia sem evento: mean-reversion, decay S/D, shocks agendados (decepção).
   */
  function tickEconomy(scopeKey, funConfig = {}, now = Date.now()) {
    if (funConfig.economyEnabled === false) return { ok: false, reason: 'disabled' };
    ensureMarket(scopeKey, funConfig, now);
    const meta = marketRepository.getMeta(scopeKey);
    const every = Math.max(60_000, numOr(funConfig.economyTickMs, 15 * 60_000));
    // buffer de negócios usa o mesmo relógio (mesmo se mercado “too-soon” no meio)
    let propertyTick = { ticked: 0, totalAdded: 0 };
    if (propertyService?.tickScope && funConfig.propertiesEnabled !== false) {
      try {
        propertyTick = propertyService.tickScope(scopeKey, funConfig, now) || propertyTick;
      } catch {
        /* ignore */
      }
    }
    if (meta.lastEconomyTickAt && now - meta.lastEconomyTickAt < every) {
      return {
        ok: false,
        reason: 'too-soon',
        nextInMs: every - (now - meta.lastEconomyTickAt),
        propertyTick,
      };
    }

    let reg = maybeRegulate(scopeKey, funConfig, now);
    const duePack = takeDueShocks(reg, now);
    reg = duePack.reg;
    const changed = [];

    // aplica follow-ups de decepção silenciosamente (preço) sem anúncio obrigatório
    for (const sh of duePack.due) {
      const resolved = resolveEventProposal(
        {
          archetype: sh.archetype,
          category: sh.category,
          companyId: sh.companyId,
          maxShockPct: sh.maxShockPct,
          title: 'Ajuste de mercado',
          body: 'O bairro digere o boato anterior.',
          source: 'deception-followup',
        },
        { reg, random }
      );
      const aff = applyResolvedImpact(scopeKey, resolved, reg, now, null);
      changed.push(...aff);
      reg = pushTruthLog(reg, {
        kind: 'scheduled_shock',
        archetype: resolved.archetype,
        category: resolved.category,
        reason: sh.reason,
        at: now,
      });
    }

    for (const item of COLLECTIBLES) {
      const persona = companyForItem(item);
      let state = marketRepository.getAssetState(scopeKey, item.id);
      state = decayAssetState(state, persona, reg);
      const cur = marketRepository.getPrice(scopeKey, item.id);
      const price = cur?.price ?? item.basePrice;
      const tick = tickAsset({
        price,
        basePrice: item.basePrice,
        personality: persona,
        supply: state.supply,
        demand: state.demand,
        volumeBuy: state.volumeBuy,
        volumeSell: state.volumeSell,
        eventShock: state.eventShock,
        reg,
        random,
      });
      if (tick.price !== price) {
        marketRepository.setPrice({
          scopeKey,
          itemId: item.id,
          price: tick.price,
          previousPrice: price,
          trend: trendFrom(price, tick.price),
          eventId: '',
          now,
        });
        changed.push({
          itemId: item.id,
          name: item.name,
          previousPrice: price,
          price: tick.price,
          trend: trendFrom(price, tick.price),
          deltaPct: tick.deltaPct,
        });
      }
      marketRepository.setAssetState({
        scopeKey,
        itemId: item.id,
        supply: tick.supply,
        demand: tick.demand,
        eventShock: tick.eventShock,
        volumeBuy: state.volumeBuy * (reg.volumeDecay || 0.72),
        volumeSell: state.volumeSell * (reg.volumeDecay || 0.72),
        now,
      });
    }

    // Bolsa: cotações de empresa no mesmo tick (preço virtual, sem fluxo de player)
    let stockChanged = [];
    if (stockService?.tickQuotes && funConfig.bolsaEnabled !== false) {
      try {
        const stockTick = stockService.tickQuotes(scopeKey, reg, now);
        stockChanged = stockTick?.changed || [];
      } catch {
        // ignore — mercado de itens já atualizou
      }
    }

    saveRegulator(scopeKey, reg, { lastEconomyTickAt: now }, now);
    return {
      ok: true,
      changed,
      stockChanged,
      scheduledApplied: duePack.due.length,
    };
  }

  /**
   * Licença de armas é SEMPRE por usuário (userJid + scope).
   * Comprar a chave não libera o grupo — cada um paga a própria.
   */
  function hasWeaponsLicense(userJid, scopeKey, now = Date.now()) {
    if (!userJid || !scopeKey) return false;
    if (effectsRepository?.getEffect) {
      const e = effectsRepository.getEffect(userJid, scopeKey, 'weapons_license', now);
      if (e) return true;
    }
    // fallback legado: inventário com chave_armas (se algum dia entrar no inventário)
    const bag = marketRepository.listInventory(userJid, scopeKey);
    return bag.some((i) => i.itemId === 'chave_armas' && i.condition === 'ok');
  }

  function hydrateItems(scopeKey, list) {
    const prices = marketRepository.listPrices(scopeKey);
    return list.map((c) => {
      const p = prices.find((x) => x.itemId === c.id);
      const price = p?.price ?? c.basePrice;
      const prev = p?.previousPrice ?? c.basePrice;
      const delta = price - prev;
      const deltaPct = prev > 0 ? Math.round((delta / prev) * 100) : 0;
      const stock = marketRepository.getStock(scopeKey, c.id);
      return {
        ...c,
        price,
        previousPrice: prev,
        trend: p?.trend || 'flat',
        delta,
        deltaPct,
        stock,
        lastEventId: p?.lastEventId || '',
      };
    });
  }

  function gallery(scopeKey, funConfig = {}, { shop = 'utility' } = {}) {
    ensureMarket(scopeKey, funConfig);
    const latest = marketRepository.latestEvent(scopeKey);
    const base = shop === 'weapons' ? listWeaponShop() : listUtilityShop();
    return { items: hydrateItems(scopeKey, base), latestEvent: latest, shop };
  }

  /**
   * Inventa proposta de evento.
   * Ordem fixa (sempre):
   *   1) Zen (principal — mais inteligente / proxy OpenCode)
   *   2) Ollama (só se Zen falhar ou estiver desligado)
   *   3) Template local
   */
  async function inventEvent(funConfig = {}, reg = null) {
    const log = getLogger?.();
    const regulator = reg || clampKnobs(defaultRegulatorKnobs());
    const { reg: regAfterSeed, seed } = popNarrativeSeed({ ...regulator });
    const prompt = buildInventUserPrompt({
      recentFingerprints: regulator.recentFingerprints || [],
      recentArchetypes: regulator.recentArchetypes || [],
      narrativeSeed: seed,
      companyMoods: listCompanies().map((co) => ({
        id: co.id,
        mood: co.risk > 0.7 ? 'hot' : co.risk < 0.3 ? 'stable' : 'warm',
      })),
    });
    // System curto: thinking free ecoa regras longas em vez de JSON
    const inventSystem = EVENT_INVENT_SYSTEM;
    const task = resolveZenTaskParams('invent', funConfig);

    // 1) Zen — principal (só jsonMode; free-mode do DeepSeek só raciocina e não fecha JSON)
    if (process.env.FUN_DISABLE_LIVE_LLM !== '1' && funConfig.zenEnabled !== false) {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const raw = await generateZen({
            baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3300',
            model: funConfig.zenModel || 'glm_5_2',
            system: inventSystem,
            prompt,
            timeoutMs: task.timeoutMs,
            maxTokens: task.maxTokens,
            temperature: attempt === 1 ? task.temperature : Math.min(1.05, task.temperature + 0.15),
            apiKey: funConfig.zenApiKey || '',
            jsonMode: true,
            jsonOnly: true,
            sendSamplingParams: funConfig.zenSendSamplingParams === true,
          });
          const parsed = parseInventResponse(raw);
          if (parsed) {
            const source = parsed.salvaged ? 'zen-salvage' : 'zen';
            recordLlmHit('invent', source, { title: parsed.title, attempt });
            log?.info?.(
              {
                source,
                model: funConfig.zenModel,
                title: parsed.title,
                attempt,
              },
              'fun market invent via zen'
            );
            return {
              ...parsed,
              description: parsed.body,
              source,
              _regAfterSeed: regAfterSeed,
              _seed: seed,
            };
          }
          console.warn(
            `[fun/market] zen invent inválido (#${attempt}, modelo=${funConfig.zenModel || 'glm_5_2'}) raw=${String(raw || '').slice(0, 100).replace(/\s+/g, ' ')}`
          );
          log?.warn?.(
            {
              model: funConfig.zenModel,
              attempt,
              preview: String(raw || '').slice(0, 160),
            },
            'fun market zen invent invalid'
          );
        } catch (err) {
          console.warn(`[fun/market] zen event fail (#${attempt}): ${err?.message || err}`);
          log?.warn?.(
            { err: err?.message || String(err), attempt },
            'fun market zen invent fail'
          );
        }
      }
      console.warn('[fun/market] zen esgotou tentativas → tenta ollama');
    }

    // 2) Ollama — fallback
    if (process.env.FUN_DISABLE_LIVE_LLM !== '1' && funConfig.ollamaEnabled !== false) {
      try {
        const raw = await generateOllama({
          baseUrl: funConfig.ollamaBaseUrl || 'http://127.0.0.1:11434',
          model: funConfig.ollamaModel || 'gemma4:latest',
          system: inventSystem,
          prompt,
          timeoutMs: Math.max(8000, numOr(funConfig.ollamaTimeoutMs, 25000)),
          keepAlive: funConfig.ollamaKeepAlive ?? -1,
          think: false,
          numPredict: Math.min(600, task.maxTokens),
          temperature: 0.9,
        });
        const parsed = parseInventResponse(raw);
        if (parsed) {
          const source = parsed.salvaged ? 'ollama-salvage' : 'ollama';
          recordLlmHit('invent', source, { title: parsed.title });
          log?.info?.(
            { source, model: funConfig.ollamaModel, title: parsed.title },
            'fun market invent via ollama (fallback)'
          );
          return {
            ...parsed,
            description: parsed.body,
            source,
            _regAfterSeed: regAfterSeed,
            _seed: seed,
          };
        }
        console.warn(
          `[fun/market] ollama invent inválido (modelo=${funConfig.ollamaModel || 'gemma4'}) → template`
        );
      } catch (err) {
        console.warn(`[fun/market] ollama event fail: ${err?.message || err} → template`);
      }
    }

    // 3) Template — último recurso
    const t = pickTemplateSeed(regulator.recentFingerprints || [], random);
    recordLlmHit('invent', 'template', { title: t.title });
    const alert = inventTemplateAlert(0.4, 5);
    if (alert) {
      console.warn(`[fun/market] ${alert.message}`);
      log?.warn?.(alert, 'fun market invent template rate high');
    }
    log?.info?.({ source: 'template', title: t.title }, 'fun market invent template');
    return {
      archetype: t.archetype,
      category: t.category,
      companyId: t.companyId,
      title: t.title,
      body: t.body,
      description: t.body,
      source: 'template',
      _regAfterSeed: regAfterSeed,
      _seed: seed,
    };
  }

  /**
   * Opcional: reescreve title/body com FACTS oficiais (direction/%) — anti-alucinação.
   * Desligado por default (marketJournalistEnabled).
   */
  async function maybeJournalistRewrite(facts, funConfig = {}) {
    if (funConfig.marketJournalistEnabled !== true) return null;
    if (process.env.FUN_DISABLE_LIVE_LLM === '1') return null;
    if (funConfig.zenEnabled === false) return null;
    const task = resolveZenTaskParams('journalist', funConfig);
    try {
      const raw = await generateZen({
        baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3300',
        model: funConfig.zenModel || 'glm_5_2',
        system: JOURNALIST_SYSTEM,
        prompt: buildJournalistUserPrompt(facts),
        timeoutMs: task.timeoutMs,
        maxTokens: task.maxTokens,
        temperature: task.temperature,
        apiKey: funConfig.zenApiKey || '',
        jsonMode: true,
        jsonOnly: true,
        sendSamplingParams: funConfig.zenSendSamplingParams === true,
      });
      const parsed = parseJournalistJson(raw);
      if (parsed?.title && parsed?.body) {
        recordLlmHit('journalist', 'zen', { title: parsed.title });
        return parsed;
      }
    } catch (err) {
      getLogger?.()?.warn?.(
        { err: err?.message || String(err) },
        'fun market journalist fail'
      );
    }
    recordLlmHit('journalist', 'skip', {});
    return null;
  }

  /**
   * Aplica impacto resolvido (catálogo) + tick do motor — sem % da IA.
   */
  /** Quanto o mercado está acima do base (média dos itens). */
  function marketOverheat(scopeKey) {
    let sum = 0;
    let n = 0;
    for (const item of COLLECTIBLES) {
      if (!item.utilityShop && !item.weaponShop) continue;
      const p = marketRepository.getPrice(scopeKey, item.id)?.price ?? item.basePrice;
      const base = Math.max(1, item.basePrice);
      sum += p / base;
      n += 1;
    }
    if (!n) return 0;
    return Math.max(0, sum / n - 1);
  }

  function applyResolvedImpact(scopeKey, resolved, reg, now = Date.now(), eventId = null) {
    const affected = [];
    const impact = resolved.impact;
    const heat = marketOverheat(scopeKey);
    for (const item of COLLECTIBLES) {
      if (item.category !== resolved.category) continue;
      const persona = companyForItem(item);
      const cur = marketRepository.getPrice(scopeKey, item.id);
      const prev = cur?.price ?? item.basePrice;
      const overItem = prev / Math.max(1, item.basePrice);
      let state = marketRepository.getAssetState
        ? marketRepository.getAssetState(scopeKey, item.id)
        : { supply: 1, demand: 1, eventShock: 0, volumeBuy: 0, volumeSell: 0 };

      if (impact && !impact.rumorOnly) {
        let scale = Number(reg.eventImpactMult) || 1;
        const sens = Number(persona.eventSensitivity) || 1;
        let shock = (impact.shockPct || 0) * scale * sens;
        let dSupply = (impact.supplyDelta || 0) * scale;
        let dDemand = (impact.demandDelta || 0) * scale;

        // item já caro: alta quase não pega; queda passa limpa
        if (shock > 0 && overItem > 1.2) {
          shock *= Math.max(0.15, 1.2 - overItem * 0.45);
          dDemand *= 0.5;
        }
        // teto duro de choque por evento
        shock = Math.max(-12, Math.min(10, shock));

        state = {
          ...state,
          supply: Math.min(3, Math.max(0.2, state.supply + dSupply)),
          demand: Math.min(3, Math.max(0.2, state.demand + dDemand)),
          eventShock: (state.eventShock || 0) + shock,
        };
      }

      // evento: aplica tick uma vez (sem empilhar foguete)
      const tick = tickAsset({
        price: prev,
        basePrice: item.basePrice,
        personality: persona,
        supply: state.supply,
        demand: state.demand,
        volumeBuy: state.volumeBuy * 0.5,
        volumeSell: state.volumeSell * 0.5,
        eventShock: state.eventShock,
        reg: { ...reg, baseNoisePct: Math.min(Number(reg.baseNoisePct) || 0.012, 0.01) },
        random,
      });

      // cap de movimento por evento: ±12% do preço anterior
      const maxUp = Math.round(prev * 1.12);
      const maxDown = Math.max(1, Math.round(prev * 0.88));
      let nextPrice = tick.price;
      if (nextPrice > maxUp) nextPrice = maxUp;
      if (nextPrice < maxDown) nextPrice = maxDown;
      // ainda respeita floor/ceil da persona
      const floor = Math.max(1, Math.floor(item.basePrice * (persona.floorMult || 0.4)));
      const ceil = Math.max(floor + 1, Math.floor(item.basePrice * (persona.ceilMult || 2.2)));
      nextPrice = Math.min(ceil, Math.max(floor, nextPrice));

      const trend = trendFrom(prev, nextPrice);
      marketRepository.setPrice({
        scopeKey,
        itemId: item.id,
        price: nextPrice,
        previousPrice: prev,
        trend,
        eventId: eventId || '',
        now,
      });
      if (marketRepository.setAssetState) {
        marketRepository.setAssetState({
          scopeKey,
          itemId: item.id,
          supply: tick.supply,
          demand: tick.demand,
          eventShock: Math.max(-20, Math.min(20, tick.eventShock)),
          volumeBuy: state.volumeBuy * 0.5,
          volumeSell: state.volumeSell * 0.5,
          now,
        });
      }
      affected.push({
        itemId: item.id,
        name: item.name,
        previousPrice: prev,
        price: nextPrice,
        trend,
        deltaPct: prev > 0 ? ((nextPrice - prev) / prev) * 100 : 0,
        primaryReason: tick.primaryReason,
        companyId: persona.id,
      });
    }

    // Mesmo choque na cotação da empresa (bolsa)
    if (stockService?.applyEventImpact) {
      try {
        const stockHits = stockService.applyEventImpact(scopeKey, resolved, reg, now);
        for (const s of stockHits || []) {
          affected.push({
            itemId: `stock:${s.companyId}`,
            name: s.name,
            previousPrice: s.previousPrice,
            price: s.price,
            trend: s.trend,
            deltaPct: s.deltaPct,
            companyId: s.companyId,
            kind: 'stock',
          });
        }
      } catch {
        // ignore
      }
    }

    void heat;
    return affected;
  }

  /** Compat: evento legado com impactPct numérico (só testes/old rows). */
  function applyEventToPrices(scopeKey, event, now = Date.now()) {
    const reg = loadRegulator(scopeKey);
    const resolved = resolveEventProposal(
      {
        archetype: event.archetype || undefined,
        category: event.category,
        companyId: event.companyId,
        title: event.title,
        body: event.description,
        // se só tem impactPct legado, força soft via display — mas usa catálogo se tiver archetype
        source: event.source || 'legacy',
      },
      { reg, random }
    );
    // Se evento já tem impactPct e sem archetype, sintetiza shock
    if (!event.archetype && event.impactPct) {
      resolved.impact = {
        archetype: 'legacy',
        supplyDelta: event.impactPct > 0 ? -0.1 : 0.1,
        demandDelta: event.impactPct > 0 ? 0.15 : -0.15,
        shockPct: Number(event.impactPct) || 0,
        rumorOnly: false,
      };
    }
    return applyResolvedImpact(scopeKey, resolved, reg, now, event.id);
  }

    function tryBreakItem(scopeKey, funConfig, now = Date.now()) {
    const o = opts(funConfig);
    if (random() > o.breakChance) return null;
    const pool = marketRepository
      .listAllInventoryInScope(scopeKey)
      .filter((inv) => !marketRepository.findOpenListingByInventory(inv.id));
    // prefere veículos/armas
    const preferred = pool.filter((i) => {
      const c = getCollectible(i.itemId);
      return c && (c.category === 'veiculo' || c.category === 'arma');
    });
    const free = preferred.length ? preferred : pool;
    if (!free.length) return null;
    const victim = pick(free, random);
    if (!victim) return null;
    marketRepository.setInventoryCondition(victim.id, 'broken', now);
    const col = getCollectible(victim.itemId);
    const price = marketRepository.getPrice(scopeKey, victim.itemId)?.price || col?.basePrice || 50;
    const repairCost = Math.max(5, Math.floor(price * o.repairRate));
    return {
      inventoryId: victim.id,
      userJid: victim.userJid,
      itemId: victim.itemId,
      itemName: col?.name || victim.itemId,
      repairCost,
    };
  }

  async function runMarketEvent({
    scopeKey,
    funConfig = {},
    now = Date.now(),
    force = false,
  }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    ensureMarket(scopeKey, funConfig, now);
    const meta = marketRepository.getMeta(scopeKey);
    if (!force && meta.nextEventAt > 0 && now < meta.nextEventAt) {
      return {
        ok: false,
        reason: 'too-soon',
        nextEventAt: meta.nextEventAt,
        retryInMs: meta.nextEventAt - now,
      };
    }

    let reg = maybeRegulate(scopeKey, funConfig, now);
    const heat = marketOverheat(scopeKey);
    reg = clampKnobs({ ...reg, marketOverheat: heat });
    // mercado já inflado: força seed de correção
    if (heat > 0.4 && random() < 0.7) {
      reg = {
        ...reg,
        narrativeSeeds: ['profit_take', 'demand_slump', 'liquidity_flood', ...(reg.narrativeSeeds || [])].slice(
          0,
          6
        ),
      };
    }

    const draft = await inventEvent(funConfig, reg);
    if (draft._regAfterSeed) reg = clampKnobs({ ...draft._regAfterSeed, marketOverheat: heat });
    // seed do regulador volta como bias de arquétipo (foi popado no invent)
    if (draft._seed) {
      reg = {
        ...reg,
        narrativeSeeds: [draft._seed, ...(reg.narrativeSeeds || [])].slice(0, 6),
      };
    }

    let proposal = {
      archetype: draft.archetype || draft._seed || undefined,
      category: draft.category,
      companyId: draft.companyId,
      title: draft.title,
      body: draft.body || draft.description,
      source: draft.source,
    };

    // resolve primeiro para saber direção real (pré-deception)
    let resolvedPreview = resolveEventProposal(proposal, { reg, random, overheat: heat });
    const company = resolvedPreview.company || getCompany(resolvedPreview.companyId);
    const deceptionMode = pickDeceptionMode({
      reg,
      companyRisk: company?.risk ?? 0.3,
      random,
    });

    const plan = applyDeceptionPlan({
      mode: deceptionMode,
      archetypeId: resolvedPreview.archetype,
      trueDirection: (resolvedPreview.impact?.shockPct || 0) >= 0 ? 'up' : 'down',
      primaryReason: 'event_residual',
      category: resolvedPreview.category,
      companyId: resolvedPreview.companyId,
      now,
      random,
    });

    if (plan.forceRumor || plan.effectiveArchetype === 'rumor_only') {
      proposal = { ...proposal, forceArchetype: 'rumor_only', archetype: 'rumor_only' };
    } else if (plan.effectiveArchetype) {
      proposal = { ...proposal, archetype: plan.effectiveArchetype };
    }

    const resolved = resolveEventProposal(proposal, { reg, random, overheat: heat });
    const affected = applyResolvedImpact(scopeKey, resolved, reg, now, null);

    const avgDelta =
      affected.length > 0
        ? affected.reduce((s, a) => s + (a.deltaPct || 0), 0) / affected.length
        : resolved.impact?.rumorOnly
          ? 0
          : resolved.displayShockHint || 0;
    const impactPct = clampShockPct(avgDelta);
    const direction =
      avgDelta > 0.5 ? 'up' : avgDelta < -0.5 ? 'down' : 'flat';
    const primaryReason = affected[0]?.primaryReason || 'event_residual';

    // Copy pública SEMPRE alinha com o % / setas do anúncio (não mentir no mesmo post).
    // Deception hype/contrarian age no follow-up de preço, não na manchete vs ticker.
    const aligned = alignEventCopy({
      title: resolved.title,
      body: resolved.body,
      direction,
      archetype: resolved.archetype,
      category: resolved.category,
      companyId: resolved.companyId,
      random,
    });
    let title = aligned.title;
    let description = clampEventDescription(aligned.body);
    let copyHardFallback = false;

    // Opcional: jornalista reescreve com FACTS (direction + %) — marketJournalistEnabled
    if (funConfig.marketJournalistEnabled === true) {
      const j = await maybeJournalistRewrite(
        {
          direction,
          impactPct,
          archetype: resolved.archetype,
          category: resolved.category,
          companyId: resolved.companyId,
          companyName: getCompany(resolved.companyId)?.name || '',
          draftTitle: title,
          draftBody: description,
        },
        funConfig
      );
      if (j?.title && j?.body) {
        const realigned = alignEventCopy({
          title: j.title,
          body: j.body,
          direction,
          archetype: resolved.archetype,
          category: resolved.category,
          companyId: resolved.companyId,
          random,
        });
        title = realigned.title;
        description = clampEventDescription(realigned.body);
      }
    }

    // Portão final: se ainda incoerente (LLM criativo / seed residual), copy sintética da categoria real.
    // Isso é a garantia de que o anúncio nunca mente sobre o ticker.
    if (
      !isCopyCoherent({
        title,
        body: description,
        direction,
        category: resolved.category,
        companyId: resolved.companyId,
      })
    ) {
      const fb = buildDirectionFallbackCopy({
        direction,
        category: resolved.category,
        companyId: resolved.companyId,
      });
      title = fb.title;
      description = clampEventDescription(fb.body);
      copyHardFallback = true;
    }

    const truth = {
      archetype: resolved.archetype,
      impact: resolved.impact,
      deceptionMode,
      primaryReason,
      plan: {
        mode: plan.mode,
        smokeReason: plan.smokeReason,
        // journalDirection histórica: follow-up; anúncio usa direction real
        journalDirection: direction,
        intendedJournalDirection: plan.journalDirection,
      },
      copyAligned: aligned.realigned,
      copyHardFallback,
      narrativeDirection: aligned.narrativeDirection,
      ignoredAiImpactPct: draft.ignoredAiImpactPct,
      affected: affected.map((a) => ({
        itemId: a.itemId,
        previousPrice: a.previousPrice,
        price: a.price,
        deltaPct: a.deltaPct,
      })),
    };

    const event = marketRepository.insertEvent({
      scopeKey,
      title,
      description,
      category: resolved.category,
      impactPct,
      source: draft.source || 'template',
      now,
      archetype: resolved.archetype,
      deceptionMode,
      companyId: resolved.companyId,
      truth,
    });

    // re-bind event id on prices
    for (const a of affected) {
      marketRepository.setPrice({
        scopeKey,
        itemId: a.itemId,
        price: a.price,
        previousPrice: a.previousPrice,
        trend: a.trend,
        eventId: event.id,
        now,
      });
    }

    if (plan.followUp) {
      reg = scheduleShock(reg, plan.followUp);
    }
    reg = pushRecentArchetype(reg, resolved.archetype);
    reg = pushFingerprint(reg, fingerprintText(title, description));
    reg = pushTruthLog(reg, {
      eventId: event.id,
      deceptionMode,
      archetype: resolved.archetype,
      impactPct,
      at: now,
    });
    // limpa seed usado
    if (draft._seed && Array.isArray(reg.narrativeSeeds)) {
      reg.narrativeSeeds = reg.narrativeSeeds.filter((s) => s !== draft._seed);
    }

    const broken = tryBreakItem(scopeKey, funConfig, now);
    const lo = Math.min(o.minMs, o.maxMs);
    const hi = Math.max(o.minMs, o.maxMs);
    const baseWait = lo + Math.floor(random() * Math.max(1, hi - lo));
    const wait = scaleEventWaitMs(baseWait, reg);

    saveRegulator(
      scopeKey,
      reg,
      {
        lastEventAt: now,
        nextEventAt: now + wait,
      },
      now
    );

    return {
      ok: true,
      event,
      affected,
      broken,
      announce: o.announce,
      deceptionMode,
      archetype: resolved.archetype,
      companyId: resolved.companyId,
      truth,
    };
  }

    /**
   * @param {{ scopeKey: string, funConfig?: object, now?: number, autonomous?: boolean }} input
   * autonomous=true (relógio do mundo): quando o horário chega, dispara de verdade
   * sem “soft-skip” aleatório — não depende de alguém mandar msg.
   */
  async function tryAutoMarketEvent({
    scopeKey,
    funConfig = {},
    now = Date.now(),
    autonomous = false,
  } = {}) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    ensureMarket(scopeKey, funConfig, now);
    // tick de preços / decepção agendada mesmo entre eventos
    if (autonomous && funConfig.economyEnabled !== false) {
      tickEconomy(scopeKey, funConfig, now);
    }
    const meta = marketRepository.getMeta(scopeKey);
    if (meta.nextEventAt > now) {
      return { ok: false, reason: 'scheduled', nextEventAt: meta.nextEventAt };
    }
    // No fluxo de mensagem ainda pode pular de leve; no tick autônomo, honra o relógio.
    if (!autonomous && random() > 0.22 && meta.nextEventAt > 0) {
      return { ok: false, reason: 'soft-skip' };
    }
    return runMarketEvent({ scopeKey, funConfig, now, force: true });
  }

  function buyFromShop({
    userJid,
    scopeKey,
    itemId,
    funConfig = {},
    now = Date.now(),
    shop = 'utility',
  }) {
    const col = getCollectible(itemId);
    if (!col) return { ok: false, reason: 'unknown-item' };
    if (shop === 'weapons' && !col.weaponShop) {
      return { ok: false, reason: 'wrong-shop' };
    }
    if (shop === 'utility' && !col.utilityShop) {
      return { ok: false, reason: 'wrong-shop' };
    }
    if (shop === 'weapons' && !hasWeaponsLicense(userJid, scopeKey, now)) {
      return { ok: false, reason: 'no-license' };
    }

    ensureMarket(scopeKey, funConfig, now);
    const stock = marketRepository.getStock(scopeKey, col.id);
    if (stock <= 0) {
      return { ok: false, reason: 'out-of-stock' };
    }

    const p = marketRepository.getPrice(scopeKey, col.id);
    const price = p?.price ?? col.basePrice;
    const bal =
      repository.getUserStats(userJid, scopeKey)?.coins ??
      repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < price) {
      return { ok: false, reason: 'insufficient-funds', coins: bal, price };
    }

    if (!marketRepository.consumeStock(scopeKey, col.id, now)) {
      return { ok: false, reason: 'out-of-stock' };
    }

    const spend = repository.addCoins({
      userJid,
      scopeKey,
      amount: -price,
      now,
      reason: `shop-buy:${col.id}`,
    });
    if (!spend.ok) {
      // devolve estoque
      marketRepository.setStock(scopeKey, col.id, stock, now);
      return { ok: false, reason: 'spend-failed' };
    }

    const inv = marketRepository.addInventory({
      userJid,
      scopeKey,
      itemId: col.id,
      acquiredPrice: price,
      condition: 'ok',
      usesLeft: Number.isFinite(col.uses) ? col.uses : -1,
      now,
    });

    recordTrade(scopeKey, col.id, 'buy', price, now);

    return {
      ok: true,
      item: col,
      price,
      inventory: inv,
      stockLeft: marketRepository.getStock(scopeKey, col.id),
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      trend: p?.trend || 'flat',
    };
  }

  // compat aliases
  const buyFromGallery = (args) => buyFromShop({ ...args, shop: 'utility' });

  function inventoryOf(userJid, scopeKey, funConfig = {}) {
    ensureMarket(scopeKey, funConfig);
    const rows = marketRepository.listInventory(userJid, scopeKey);
    return rows.map((inv) => {
      const col = getCollectible(inv.itemId);
      const market = marketRepository.getPrice(scopeKey, inv.itemId);
      const listing = marketRepository.findOpenListingByInventory(inv.id);
      const price = market?.price ?? col?.basePrice ?? 0;
      const repairCost = Math.max(5, Math.floor(price * opts(funConfig).repairRate));
      return {
        ...inv,
        collectible: col,
        marketPrice: price,
        trend: market?.trend || 'flat',
        listed: Boolean(listing),
        listingId: listing?.id || '',
        listingPrice: listing?.price || 0,
        repairCost: inv.condition === 'broken' ? repairCost : 0,
      };
    });
  }

  function findReadyItem(userJid, scopeKey, predicate) {
    const bag = inventoryOf(userJid, scopeKey);
    return (
      bag.find(
        (i) =>
          i.condition === 'ok' &&
          !i.listed &&
          (i.usesLeft === -1 || i.usesLeft > 0) &&
          predicate(i)
      ) || null
    );
  }

  /** Sempre a arma mais forte pronta (não a primeira da lista). */
  function findBestWeapon(userJid, scopeKey) {
    const bag = inventoryOf(userJid, scopeKey);
    const ready = bag.filter(
      (i) =>
        i.collectible?.category === 'arma' &&
        i.condition === 'ok' &&
        !i.listed &&
        (i.usesLeft === -1 || i.usesLeft > 0)
    );
    if (!ready.length) return null;
    ready.sort(
      (a, b) =>
        (Number(b.collectible?.assaultPower) || 0) - (Number(a.collectible?.assaultPower) || 0)
    );
    return ready[0];
  }

  function consumeUse(inv, now = Date.now()) {
    if (!inv) return null;
    if (inv.usesLeft < 0) return inv;
    const next = inv.usesLeft - 1;
    if (next <= 0) {
      marketRepository.deleteInventory(inv.id);
      return null;
    }
    return marketRepository.setUsesLeft(inv.id, next);
  }

  function consumeOneConsumable(userJid, scopeKey, itemId) {
    const bag = inventoryOf(userJid, scopeKey);
    const unit = bag.find(
      (i) => i.itemId === itemId && i.condition === 'ok' && !i.listed
    );
    if (!unit) return false;
    marketRepository.deleteInventory(unit.id);
    return true;
  }

  function computeFailFine(coins, o) {
    const bal = Math.max(0, Math.floor(Number(coins) || 0));
    const raw = Math.floor(bal * o.assaultFailFinePct);
    return Math.min(bal, Math.min(o.assaultFailFineMax, Math.max(o.assaultFailFineMin, raw)));
  }

  function ammoUnitCost(scopeKey, funConfig = {}) {
    ensureMarket(scopeKey, funConfig);
    const p = marketRepository.getPrice(scopeKey, 'municao');
    return p?.price ?? getCollectible('municao')?.basePrice ?? 38;
  }

  function applyVehicleBonus(userJid, scopeKey) {
    const vehicle = findReadyItem(
      userJid,
      scopeKey,
      (i) => i.collectible?.category === 'veiculo'
    );
    let vehicleBonus = 0;
    let usedGas = false;
    if (vehicle) {
      const need = vehicle.collectible?.requires;
      if (need === 'gasolina' && consumeOneConsumable(userJid, scopeKey, 'gasolina')) {
        usedGas = true;
        vehicleBonus = vehicle.itemId === 'carro' ? 14 : 9;
      } else if (!need) {
        vehicleBonus = 5;
      }
    }
    return { vehicleBonus, usedGas, vehicle };
  }

  function checkAssaultCooldown(userJid, scopeKey, cooldownMs, now) {
    if (!casinoRepository?.checkCooldown) return { ok: true };
    const cd = casinoRepository.checkCooldown(userJid, scopeKey, 'assault', cooldownMs, now);
    if (!cd.ok) {
      return { ok: false, reason: 'cooldown', retryInMs: cd.retryInMs };
    }
    return { ok: true };
  }

  function touchAssaultCooldown(userJid, scopeKey, now) {
    if (casinoRepository?.touchCooldown) {
      casinoRepository.touchCooldown(userJid, scopeKey, 'assault', now);
    }
  }

  /**
   * Alvos NPC de heist (banco / lojinha).
   * @returns {{ kind: 'bank'|'shop', label: string } | null}
   */
  function resolveHeistTarget(token) {
    const t = String(token || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (!t) return null;
    if (['banco', 'bank', 'caixa', 'cofre'].includes(t)) {
      return { kind: 'bank', label: 'Banco central' };
    }
    if (['loja', 'lojinha', 'mercearia', 'bar', 'shop', 'boteco'].includes(t)) {
      return { kind: 'shop', label: 'Lojinha da esquina' };
    }
    return null;
  }

  /**
   * EV aproximado: lucro médio se repetir muitas vezes
   * (payout médio × chance − multa média × falha − custo munição).
   */
  function estimateWeaponEv({
    weaponCol,
    mode,
    funConfig = {},
    scopeKey = '',
    level = 5,
  }) {
    const o = opts(funConfig);
    const power = Number(weaponCol?.assaultPower) || 0;
    const ammoCost =
      weaponCol?.requires === 'municao' ? ammoUnitCost(scopeKey, funConfig) : 0;
    const failFineMid = Math.round((o.assaultFailFineMin + o.assaultFailFineMax) / 2);

    let baseChance;
    let avgPayout;
    let note = '';

    if (mode === 'bank') {
      baseChance = o.heistBankBaseChance + power / 200 + level * 0.006;
      avgPayout = (o.heistBankMin + o.heistBankMax) / 2;
      avgPayout *= 1 + power / 220;
      note = 'NPC';
    } else if (mode === 'shop') {
      baseChance = o.heistShopBaseChance + power / 220 + level * 0.006;
      avgPayout = (o.heistShopMin + o.heistShopMax) / 2;
      avgPayout *= 1 + power / 280;
      note = 'NPC';
    } else {
      // PvP: assume alvo médio ~250c
      const tCoins = 250;
      baseChance = o.assaultBaseChance + power / 200 + level * 0.008 - 0.05;
      const stealCap = tCoins * o.assaultMaxStealRatio;
      avgPayout = ((o.assaultMinSteal + stealCap) / 2) * (1 + power / 200);
      note = 'PvP ~250c';
    }

    const chance = Math.min(0.82, Math.max(0.12, baseChance));
    const ev = chance * avgPayout - (1 - chance) * failFineMid - ammoCost;
    return {
      chance,
      avgPayout: Math.round(avgPayout),
      ammoCost,
      failFineMid,
      ev: Math.round(ev),
      note,
      weapon: weaponCol,
    };
  }

  function formatEvTable(scopeKey, funConfig = {}, level = 5) {
    const weapons = listWeaponShop();
    const lines = [
      '📐 *Tabela de EV* (valor esperado)',
      '_EV = lucro médio por tentativa se você repetir muitas vezes — já desconta falha e munição._',
      '_Não é garantia do próximo hit; é a média no longo prazo._',
      '',
      '🏦 *Banco* (melhor farm de coins):',
    ];
    for (const w of weapons) {
      const e = estimateWeaponEv({
        weaponCol: w,
        mode: 'bank',
        funConfig,
        scopeKey,
        level,
      });
      const sign = e.ev >= 0 ? '+' : '';
      lines.push(
        `${w.emoji} *${w.id}* · ~${Math.round(e.chance * 100)}% · EV *${sign}${e.ev}*c · prêmio ~${e.avgPayout}c${e.ammoCost ? ` · munição −${e.ammoCost}` : ''}`
      );
    }
    lines.push('', '🏪 *Lojinha* (mais fácil, menos prêmio):');
    for (const w of weapons) {
      const e = estimateWeaponEv({
        weaponCol: w,
        mode: 'shop',
        funConfig,
        scopeKey,
        level,
      });
      const sign = e.ev >= 0 ? '+' : '';
      lines.push(
        `${w.emoji} *${w.id}* · ~${Math.round(e.chance * 100)}% · EV *${sign}${e.ev}*c`
      );
    }
    lines.push(
      '',
      '👤 *Jogador* (for fun, ganho menor — assume alvo com ~250c):'
    );
    for (const w of weapons) {
      const e = estimateWeaponEv({
        weaponCol: w,
        mode: 'player',
        funConfig,
        scopeKey,
        level,
      });
      const sign = e.ev >= 0 ? '+' : '';
      lines.push(
        `${w.emoji} *${w.id}* · ~${Math.round(e.chance * 100)}% · EV *${sign}${e.ev}*c`
      );
    }
    return lines.join('\n');
  }

  function formatAssaultHelp(scopeKey, funConfig = {}, userJid = '') {
    ensureMarket(scopeKey, funConfig);
    const level =
      (userJid && repository.getUserStats(userJid, scopeKey)?.level) || 5;
    const o = opts(funConfig);
    const restock = maybeWeeklyRestock(scopeKey, funConfig);
    const lines = [
      '🔫 *Assalto*',
      '',
      '*Modos:*',
      `• \`/assaltar banco\` — *melhor grana* (${o.heistBankMin}–${o.heistBankMax}c)`,
      `• \`/assaltar lojinha\` — mais fácil (${o.heistShopMin}–${o.heistShopMax}c)`,
      '• `/assaltar @pessoa` — for fun entre players (ganho menor, ainda real)',
      '',
      'Precisa de *arma*. Pistola/rifle gastam *municao*. Carro/moto + *gasolina* ajudam.',
      `Reposição de estoque da loja: a cada *7 dias* (próxima em ~${formatRestockEta(Math.max(0, restock.nextAt - Date.now()))}).`,
      '',
      formatEvTable(scopeKey, funConfig, level),
    ];
    return lines.join('\n');
  }

  /**
   * Heist NPC (banco / lojinha) — fonte principal de coin do loop de armas.
   */
  function assaultHeist({
    attackerJid,
    scopeKey,
    heist,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    const a = String(attackerJid || '');
    if (!a || !heist?.kind) return { ok: false, reason: 'invalid-target' };

    const cdMs = heist.kind === 'bank' ? o.heistBankCooldownMs : o.assaultCooldownMs;
    const cd = checkAssaultCooldown(a, scopeKey, cdMs, now);
    if (!cd.ok) return cd;

    const weapon = findBestWeapon(a, scopeKey);
    if (!weapon) return { ok: false, reason: 'no-weapon' };
    const wCol = weapon.collectible;

    if (wCol.requires === 'municao') {
      if (!consumeOneConsumable(a, scopeKey, 'municao')) {
        return { ok: false, reason: 'no-ammo' };
      }
    }

    const { vehicleBonus, usedGas } = applyVehicleBonus(a, scopeKey);
    const aStats =
      repository.getUserStats(a, scopeKey) || repository.ensureUserRow(a, scopeKey, now);

    let chance =
      heist.kind === 'bank' ? o.heistBankBaseChance : o.heistShopBaseChance;
    chance += (Number(wCol.assaultPower) || 0) / (heist.kind === 'bank' ? 200 : 220);
    chance += (Number(aStats.level) || 1) * 0.006;
    chance += vehicleBonus / 100;
    chance = Math.min(0.82, Math.max(0.12, chance));

    consumeUse(weapon, now);
    touchAssaultCooldown(a, scopeKey, now);

    const roll = random();
    const success = roll < chance;
    const powerBoost = 1 + (Number(wCol.assaultPower) || 0) / (heist.kind === 'bank' ? 220 : 280);

    if (!success) {
      const fine = computeFailFine(aStats.coins, o);
      if (fine > 0) {
        repository.addCoins({
          userJid: a,
          scopeKey,
          amount: -fine,
          now,
          reason: `heist-fail:${heist.kind}`,
        });
      }
      return {
        ok: true,
        success: false,
        mode: heist.kind,
        heistLabel: heist.label,
        chance,
        roll,
        fine,
        weapon: wCol,
        usedGas,
        vehicleBonus,
        coins: repository.getUserStats(a, scopeKey)?.coins || 0,
      };
    }

    const minP = heist.kind === 'bank' ? o.heistBankMin : o.heistShopMin;
    const maxP = heist.kind === 'bank' ? o.heistBankMax : o.heistShopMax;
    const lo = Math.min(minP, maxP);
    const hi = Math.max(minP, maxP);
    const base = lo + Math.floor(random() * Math.max(1, hi - lo + 1));
    const payout = Math.max(lo, Math.floor(base * powerBoost));

    repository.addCoins({
      userJid: a,
      scopeKey,
      amount: payout,
      now,
      reason: `heist-win:${heist.kind}`,
    });

    return {
      ok: true,
      success: true,
      mode: heist.kind,
      heistLabel: heist.label,
      chance,
      roll,
      stolen: payout,
      weapon: wCol,
      usedGas,
      vehicleBonus,
      coins: repository.getUserStats(a, scopeKey)?.coins || 0,
    };
  }

  /**
   * Assalto PvP (for fun, ganho real mas menor que banco).
   */
  function assaultPlayer({
    attackerJid,
    targetJid,
    scopeKey,
    funConfig = {},
    now = Date.now(),
  }) {
    const o = opts(funConfig);
    const a = String(attackerJid || '');
    const t = String(targetJid || '');
    if (!a || !t || a === t) return { ok: false, reason: 'invalid-target' };

    const cd = checkAssaultCooldown(a, scopeKey, o.assaultCooldownMs, now);
    if (!cd.ok) return cd;

    const weapon = findBestWeapon(a, scopeKey);
    if (!weapon) return { ok: false, reason: 'no-weapon' };
    const wCol = weapon.collectible;

    if (wCol.requires === 'municao') {
      if (!consumeOneConsumable(a, scopeKey, 'municao')) {
        return { ok: false, reason: 'no-ammo' };
      }
    }

    const { vehicleBonus, usedGas } = applyVehicleBonus(a, scopeKey);

    const defenderVest = findReadyItem(
      t,
      scopeKey,
      (i) => i.collectible?.id === 'colete' || i.collectible?.category === 'defesa'
    );
    const defenderWeapon = findBestWeapon(t, scopeKey);

    const aStats =
      repository.getUserStats(a, scopeKey) || repository.ensureUserRow(a, scopeKey, now);
    const tStats =
      repository.getUserStats(t, scopeKey) || repository.ensureUserRow(t, scopeKey, now);
    const tCoins = Number(tStats.coins) || 0;
    const propBuffer =
      typeof propertyService?.totalBuffer === 'function'
        ? propertyService.totalBuffer(scopeKey, t)
        : 0;
    if (tCoins < o.assaultMinSteal && propBuffer < o.assaultMinSteal) {
      return { ok: false, reason: 'target-poor', coins: tCoins, propBuffer };
    }

    let chance = o.assaultBaseChance;
    chance += (Number(wCol.assaultPower) || 0) / 200;
    chance += (Number(aStats.level) || 1) * 0.008;
    chance += vehicleBonus / 100;
    chance -= (Number(tStats.level) || 1) * 0.01;
    chance -= (Number(defenderVest?.collectible?.defensePower) || 0) / 120;
    chance -= (Number(defenderWeapon?.collectible?.assaultPower) || 0) / 250;
    if (tCoins > 200) chance += 0.04;
    if (tCoins > 500) chance += 0.03;
    if (propBuffer > 40) chance += 0.03;
    chance = Math.min(0.82, Math.max(0.12, chance));

    consumeUse(weapon, now);
    if (defenderVest && random() < 0.55) {
      consumeUse(defenderVest, now);
    }
    touchAssaultCooldown(a, scopeKey, now);

    const roll = random();
    const success = roll < chance;

    if (!success) {
      const fine = computeFailFine(aStats.coins, o);
      if (fine > 0) {
        repository.addCoins({
          userJid: a,
          scopeKey,
          amount: -fine,
          now,
          reason: 'assault-fail',
        });
      }
      return {
        ok: true,
        success: false,
        mode: 'player',
        chance,
        roll,
        fine,
        weapon: wCol,
        usedGas,
        vehicleBonus,
        coins: repository.getUserStats(a, scopeKey)?.coins || 0,
        targetCoins: tCoins,
      };
    }

    // 1) prioriza caixa do negócio (buffer); 2) residual na carteira
    let fromBuffer = 0;
    let propertyHit = null;
    let propertyDef = null;
    let propertyDamage = 0;
    const powerBoost = 1 + (Number(wCol.assaultPower) || 0) / 200;
    const stealCapWallet = Math.floor(tCoins * o.assaultMaxStealRatio);
    const wantTotal = Math.max(
      o.assaultMinSteal,
      Math.floor(
        (o.assaultMinSteal + random() * Math.max(1, stealCapWallet - o.assaultMinSteal + propBuffer * 0.3)) *
          powerBoost
      )
    );

    if (propertyService?.robBuffer && propBuffer > 0) {
      const rob = propertyService.robBuffer({
        targetJid: t,
        scopeKey,
        maxWant: wantTotal,
        now,
      });
      fromBuffer = Number(rob.stolen) || 0;
      propertyHit = rob.property;
      propertyDef = rob.def;
      propertyDamage = rob.damage || 0;
    }

    let fromWallet = 0;
    const remain = Math.max(0, wantTotal - fromBuffer);
    if (remain >= o.assaultMinSteal && tCoins >= o.assaultMinSteal) {
      const cap = Math.min(tCoins, Math.floor(tCoins * o.assaultMaxStealRatio), remain);
      fromWallet = Math.max(
        o.assaultMinSteal,
        Math.min(cap, Math.floor(o.assaultMinSteal + random() * Math.max(1, cap - o.assaultMinSteal)))
      );
      if (fromWallet > 0) {
        repository.addCoins({
          userJid: t,
          scopeKey,
          amount: -fromWallet,
          now,
          reason: 'assault-victim',
        });
      }
    }

    const finalSteal = fromBuffer + fromWallet;
    if (finalSteal <= 0) {
      return { ok: false, reason: 'target-poor', coins: tCoins, propBuffer };
    }

    if (fromBuffer > 0) {
      repository.addCoins({
        userJid: a,
        scopeKey,
        amount: fromBuffer,
        now,
        reason: 'assault-win-property',
      });
    }
    if (fromWallet > 0) {
      repository.addCoins({
        userJid: a,
        scopeKey,
        amount: fromWallet,
        now,
        reason: 'assault-win',
      });
    }

    return {
      ok: true,
      success: true,
      mode: 'player',
      chance,
      roll,
      stolen: finalSteal,
      stolenBuffer: fromBuffer,
      stolenWallet: fromWallet,
      propertyName: propertyDef?.name || null,
      propertyDamage,
      propertyHealth: propertyHit?.health ?? null,
      weapon: wCol,
      usedGas,
      vehicleBonus,
      coins: repository.getUserStats(a, scopeKey)?.coins || 0,
      targetCoins: repository.getUserStats(t, scopeKey)?.coins || 0,
    };
  }

  /**
   * Entrada unificada: heist NPC (token) ou PvP (jid).
   * @param {{ targetJid?: string, heistToken?: string }} args
   */
  function assault({
    attackerJid,
    targetJid,
    heistToken,
    scopeKey,
    funConfig = {},
    now = Date.now(),
  }) {
    const heist = resolveHeistTarget(heistToken || targetJid);
    if (heist) {
      return assaultHeist({
        attackerJid,
        scopeKey,
        heist,
        funConfig,
        now,
      });
    }
    return assaultPlayer({
      attackerJid,
      targetJid,
      scopeKey,
      funConfig,
      now,
    });
  }

  function factionArsenal(scopeKey) {
    if (!factionService?.listByScope && !factionService) return [];
    // conta armas trophy nos membros
    const factions =
      factionService.listByScope?.(scopeKey) ||
      factionService.factionRepository?.listByScope?.(scopeKey) ||
      [];
    // factionService may not expose listByScope - use getUserFaction per inv
    const allInv = marketRepository.listAllInventoryInScope
      ? // list all including broken? use raw query via listInventory not available for all users
        null
      : null;
    void allInv;

    // simpler: scan all inventory in scope from DB via listAllInventoryInScope (ok only)
    const okItems = marketRepository.listAllInventoryInScope(scopeKey);
    // also need broken? only ok trophies
    const map = new Map(); // factionId -> { name, score, pieces }

    for (const inv of okItems) {
      const col = getCollectible(inv.itemId);
      if (!col?.factionTrophy) continue;
      const uf = factionService.getUserFaction?.(scopeKey, inv.userJid);
      if (!uf?.faction) continue;
      const fid = uf.faction.id;
      if (!map.has(fid)) {
        map.set(fid, {
          factionId: fid,
          name: uf.faction.name,
          emoji: uf.faction.emoji,
          score: 0,
          pieces: 0,
        });
      }
      const row = map.get(fid);
      row.pieces += 1;
      row.score += Number(col.assaultPower) || 10;
    }

    return [...map.values()].sort((a, b) => b.score - a.score);
  }

  function listOnBazaar({
    userJid,
    scopeKey,
    inventoryId,
    price,
    now = Date.now(),
  }) {
    const inv = marketRepository.getInventoryById(inventoryId);
    if (!inv || inv.userJid !== userJid || inv.scopeKey !== scopeKey) {
      return { ok: false, reason: 'not-found' };
    }
    if (inv.condition === 'broken') return { ok: false, reason: 'broken' };
    if (marketRepository.findOpenListingByInventory(inv.id)) {
      return { ok: false, reason: 'already-listed' };
    }
    const ask = Math.floor(Number(price) || 0);
    if (ask < 1 || ask > 1_000_000) return { ok: false, reason: 'invalid-price' };
    const listing = marketRepository.createListing({
      scopeKey,
      sellerJid: userJid,
      inventoryId: inv.id,
      itemId: inv.itemId,
      price: ask,
      now,
    });
    return { ok: true, listing, collectible: getCollectible(inv.itemId) };
  }

  function cancelListing({ userJid, scopeKey, listingId }) {
    const listing = marketRepository.getListing(listingId);
    if (!listing || listing.scopeKey !== scopeKey || listing.status !== 'open') {
      return { ok: false, reason: 'not-found' };
    }
    if (listing.sellerJid !== userJid) return { ok: false, reason: 'not-owner' };
    marketRepository.closeListing(listingId, 'cancelled');
    return { ok: true };
  }

  function buyFromBazaar({ userJid, scopeKey, listingId, now = Date.now() }) {
    const listing = marketRepository.getListing(listingId);
    if (!listing || listing.scopeKey !== scopeKey || listing.status !== 'open') {
      return { ok: false, reason: 'not-found' };
    }
    if (listing.sellerJid === userJid) return { ok: false, reason: 'self-buy' };
    const inv = marketRepository.getInventoryById(listing.inventoryId);
    if (!inv || inv.condition === 'broken') {
      marketRepository.closeListing(listingId, 'cancelled');
      return { ok: false, reason: 'item-gone' };
    }
    const price = listing.price;
    const bal =
      repository.getUserStats(userJid, scopeKey)?.coins ??
      repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < price) {
      return { ok: false, reason: 'insufficient-funds', coins: bal, price };
    }
    const spend = repository.addCoins({
      userJid,
      scopeKey,
      amount: -price,
      now,
      reason: `bazaar-buy:${listing.id}`,
    });
    if (!spend.ok) return { ok: false, reason: 'spend-failed' };
    repository.addCoins({
      userJid: listing.sellerJid,
      scopeKey,
      amount: price,
      now,
      reason: `bazaar-sell:${listing.id}`,
    });
    const uses = inv.usesLeft;
    marketRepository.deleteInventory(inv.id);
    const newInv = marketRepository.addInventory({
      userJid,
      scopeKey,
      itemId: inv.itemId,
      acquiredPrice: price,
      condition: 'ok',
      usesLeft: uses,
      now,
    });
    marketRepository.closeListing(listingId, 'sold');
    return {
      ok: true,
      listing,
      inventory: newInv,
      collectible: getCollectible(inv.itemId),
      price,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      sellerJid: listing.sellerJid,
    };
  }

  function buyFromBazaar({ userJid, scopeKey, listingId, now = Date.now() }) {
    const listing = marketRepository.getListing(listingId);
    if (!listing || listing.scopeKey !== scopeKey || listing.status !== 'open') {
      return { ok: false, reason: 'not-found' };
    }
    if (listing.sellerJid === userJid) return { ok: false, reason: 'self-buy' };
    const inv = marketRepository.getInventoryById(listing.inventoryId);
    if (!inv || inv.condition === 'broken') {
      marketRepository.closeListing(listingId, 'cancelled');
      return { ok: false, reason: 'item-gone' };
    }
    const price = listing.price;
    const bal =
      repository.getUserStats(userJid, scopeKey)?.coins ??
      repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < price) {
      return { ok: false, reason: 'insufficient-funds', coins: bal, price };
    }
    const spend = repository.addCoins({
      userJid,
      scopeKey,
      amount: -price,
      now,
      reason: `bazaar-buy:${listing.id}`,
    });
    if (!spend.ok) return { ok: false, reason: 'spend-failed' };
    repository.addCoins({
      userJid: listing.sellerJid,
      scopeKey,
      amount: price,
      now,
      reason: `bazaar-sell:${listing.id}`,
    });
    const uses = inv.usesLeft;
    marketRepository.deleteInventory(inv.id);
    const newInv = marketRepository.addInventory({
      userJid,
      scopeKey,
      itemId: inv.itemId,
      acquiredPrice: price,
      condition: 'ok',
      usesLeft: uses,
      now,
    });
    marketRepository.closeListing(listingId, 'sold');
    recordTrade(scopeKey, listing.itemId, 'buy', price, now);
    return {
      ok: true,
      listing,
      inventory: newInv,
      collectible: getCollectible(inv.itemId),
      price,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
      sellerJid: listing.sellerJid,
    };
  }

  function repairItem({
    userJid,
    scopeKey,
    inventoryId,
    funConfig = {},
    now = Date.now(),
  }) {
    const inv = marketRepository.getInventoryById(inventoryId);
    if (!inv || inv.userJid !== userJid || inv.scopeKey !== scopeKey) {
      return { ok: false, reason: 'not-found' };
    }
    if (inv.condition !== 'broken') return { ok: false, reason: 'not-broken' };
    const col = getCollectible(inv.itemId);
    const price =
      marketRepository.getPrice(scopeKey, inv.itemId)?.price || col?.basePrice || 50;
    const cost = Math.max(5, Math.floor(price * opts(funConfig).repairRate));
    const bal =
      repository.getUserStats(userJid, scopeKey)?.coins ??
      repository.ensureUserRow(userJid, scopeKey, now).coins;
    if (bal < cost) {
      return { ok: false, reason: 'insufficient-funds', coins: bal, price: cost };
    }
    const spend = repository.addCoins({
      userJid,
      scopeKey,
      amount: -cost,
      now,
      reason: `repair:${inv.itemId}`,
    });
    if (!spend.ok) return { ok: false, reason: 'spend-failed' };
    marketRepository.setInventoryCondition(inv.id, 'ok', now);
    return {
      ok: true,
      inventory: marketRepository.getInventoryById(inv.id),
      cost,
      collectible: col,
      coins: repository.getUserStats(userJid, scopeKey)?.coins || 0,
    };
  }

  function formatShopList(scopeKey, funConfig, shop = 'utility', userJid = '') {
    const { items, latestEvent } = gallery(scopeKey, funConfig, { shop });
    const restock = maybeWeeklyRestock(scopeKey, funConfig);
    const eta = formatRestockEta(Math.max(0, restock.nextAt - Date.now()));
    const title =
      shop === 'weapons' ? '🔫 *Loja de armas*' : '🛒 *Mercado de rua*';
    const lines = [
      title,
      latestEvent
        ? `_Evento:_ *${latestEvent.title}* (${latestEvent.impactPct > 0 ? '+' : ''}${latestEvent.impactPct}% · ${latestEvent.category})`
        : '_Mercado estável no momento._',
      `_Reposição de estoque: semanal (tempo real) · próxima em ~${eta}_`,
      '',
    ];
    for (const it of items) {
      const ar = arrow(it.trend);
      const delta = it.delta !== 0 ? ` ${ar}${Math.abs(it.deltaPct)}%` : '';
      const stockLabel = it.stock <= 0 ? 'ESGOTADO' : `${it.stock} un.`;
      lines.push(
        `${it.emoji} *${it.id}* — *${it.price}*c${delta} · ${stockLabel}`,
        `   ${it.name} · ${it.benefit}`,
        it.requires ? `   precisa de: *${it.requires}*` : null,
        ''
      );
    }
    if (shop === 'weapons') {
      lines.push('Comprar: `/adquirir pistola` · chave *só sua* (`/comprar chave_armas`)');
      lines.push('Assalto: `/assaltar banco` · `/assaltar lojinha` · `/assaltar @user`');
      lines.push('', formatEvTable(
        scopeKey,
        funConfig,
        (userJid && repository.getUserStats(userJid, scopeKey)?.level) || 5
      ));
    } else {
      lines.push('Comprar: `/adquirir gasolina` · Armas (chave individual): `/armas`');
      lines.push('Assalto (farm): `/assaltar banco` · EV: `/assaltar`');
    }
    lines.push('Itens: `/inventario` · Players: `/bazar`');
    return lines.filter((l) => l != null).join('\n');
  }

  function formatGallery(scopeKey, funConfig = {}) {
    return formatShopList(scopeKey, funConfig, 'utility');
  }

  function formatWeaponsShop(scopeKey, funConfig, userJid) {
    if (!hasWeaponsLicense(userJid, scopeKey)) {
      return [
        '🔫 *Loja de armas* — *trancada pra você*',
        'A chave é *individual*: quem compra libera *só a própria conta*.',
        'O resto do grupo continua trancado — corrida por coins e apostas.',
        'Comprar: `/loja` → `/comprar chave_armas`',
        '',
        '_Com chave: assalte *banco* (melhor grana) ou *lojinha*. Players é for fun._',
      ].join('\n');
    }
    return formatShopList(scopeKey, funConfig, 'weapons', userJid);
  }

  function formatEventAnnouncement(result, getContactDisplayName) {
    if (!result?.ok || !result.event) return '';
    const e = result.event;
    const sign = e.impactPct > 0 ? '+' : '';
    const story = clampEventDescription(e.description);
    const company = e.companyId ? getCompany(e.companyId) : null;
    const pureStock =
      e.companyId && categoriesForCompany(e.companyId).length === 0;
    // PatoCoin etc.: não rotular como "arma/munição" no ticker da manchete
    const sectorLabel = pureStock ? 'bolsa' : e.category;
    const lines = [
      '📰 *Mercado de rua*',
      `*${e.title}*`,
      '',
      story || null,
      '',
      company
        ? `${company.emoji} *${company.name}* · *${sectorLabel}* · *${sign}${e.impactPct}%*`
        : `Categoria *${e.category}* · *${sign}${e.impactPct}%*`,
    ];
    if (result.affected?.length) {
      // pure-stock: prioriza a ação; senão itens de rua
      const ordered = pureStock
        ? [
            ...result.affected.filter((a) => a.kind === 'stock' || String(a.itemId || '').startsWith('stock:')),
            ...result.affected.filter((a) => a.kind !== 'stock' && !String(a.itemId || '').startsWith('stock:')),
          ]
        : result.affected;
      lines.push(
        ordered
          .slice(0, 4)
          .map((a) => `${arrow(a.trend)}${a.name} ${a.previousPrice}→${a.price}`)
          .join(' · ')
      );
    }
    if (result.broken) {
      const who = nameOf(getContactDisplayName, result.broken.userJid);
      lines.push(
        '',
        `💥 *Quebrou!* ${who} — *${result.broken.itemName}*`,
        `Conserto *${result.broken.repairCost}*c · \`/consertar ${result.broken.inventoryId.slice(0, 8)}\``
      );
    }
    lines.push('', '_/mercado · /armas · /bazar · /bolsa_');
    return lines.filter((l) => l != null).join('\n');
  }

  return {
    gallery,
    formatGallery,
    formatWeaponsShop,
    hasWeaponsLicense,
    runMarketEvent,
    tryAutoMarketEvent,
    tickEconomy,
    maybeRegulate,
    loadRegulator,
    maybeWeeklyRestock,
    buyFromShop,
    buyFromGallery,
    inventoryOf,
    listOnBazaar,
    cancelListing,
    buyFromBazaar,
    repairItem,
    assault,
    assaultHeist,
    assaultPlayer,
    resolveHeistTarget,
    formatAssaultHelp,
    formatEvTable,
    estimateWeaponEv,
    findBestWeapon,
    factionArsenal,
    formatEventAnnouncement,
    applyEventToPrices,
    listOpenListings: (scopeKey) => marketRepository.listOpenListings(scopeKey),
    getListing: (id) => marketRepository.getListing(id),
    getCollectible,
    listCollectibles,
    listCategories,
    listUtilityShop,
    listWeaponShop,
    arrow,
  };
}
