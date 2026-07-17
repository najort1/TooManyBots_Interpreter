/**
 * Mercado utilitário Fun — preços dinâmicos, estoque, armas, assalto.
 */

import { openaiChatComplete } from '../llm/openaiClient.js';
import { ollamaGenerate } from '../llm/ollamaClient.js';
import {
  COLLECTIBLES,
  getCollectible,
  listCollectibles,
  listCategories,
  listUtilityShop,
  listWeaponShop,
} from '../shop/collectibles.js';

/** História de mercado: 5–8 linhas (fofoca de bairro), não 1 frase nem livro. */
const EVENT_DESC_MAX = 900;
const EVENT_DESC_LINES_MAX = 8;

const EVENT_SYSTEM = `Você gera NOTÍCIAS de mercado de rua (combustível, munição, armas, veículos, defesa) para bot WhatsApp BR.

JSON único sem markdown:
{"title":"...","description":"...","category":"combustivel|municao|arma|veiculo|defesa","impactPct":number}

REGRAS:
- title ≤80 chars, estilo manchete de bairro
- description: HISTÓRIA curta com 5 a 8 linhas (use \\n entre linhas). Entre 350 e 850 caracteres.
  Tom: fofoca de mercado paralelo, besteirol leve, pt-BR de rua. Cena + rumor + consequência no preço.
  NÃO seja 1 frase. NÃO vire livro (máx 8 linhas). Sem inventar preços em coins.
- category DEVE ser uma das listadas
- impactPct entre -28 e +35 (inteiro ≠ 0)
- coerente (gasolina cara → combustivel sobe; operação policial → arma/municao sobe; excesso → preço desce)`;

const TEMPLATE_EVENTS = [
  {
    title: 'Posto da região seca',
    description: [
      'Acordou cedo quem queria encher o galão.',
      'O posto da avenida abriu com a bomba “sem produto” e a fila já dava a volta no quarteirão.',
      'Gente brigando por funil, moto sem gasolina no meio da rua, zé da esquina cobrando taxa de “ajuda”.',
      'No mercado paralelo o litro sumiu do mapa — ou virou artigo de luxo.',
      'Quem tem tanque cheio vira celebridade; quem não tem, paga o preço da sede.',
      'Combustível de rua sobe. O resto do bairro fica a pé, zoando no grupo.',
    ].join('\n'),
    category: 'combustivel',
    impactPct: 18,
  },
  {
    title: 'Caminhão-tanque vaza na BR',
    description: [
      'Caminhão-tanque tombou na curva da BR. Cheiro de gasolina a quilômetros.',
      'Trânsito parado, bombeiro, youtuber filmando, e o pessoal do desmanche já calculando o lucro.',
      'Enquanto a pista não limpa, o posto da cidade seca de verdade.',
      'Quem tinha estoque escondeu; quem não tinha, inventou “escassez técnica”.',
      'Por uma semana o combustível vira caça ao tesouro.',
      'Preço sobe, paciência desce, e o mercado de rua faz a festa.',
    ].join('\n'),
    category: 'combustivel',
    impactPct: 14,
  },
  {
    title: 'Alta tensão aumenta preço da munição',
    description: [
      'Rumores de instabilidade regional rodam no zap antes do jornal.',
      'Alguém jura que viu viatura demais; outro jura que viu caixa demais saindo de fundo de loja.',
      'Nos pontos de venda as balas somem da prateleira “sem explicação”.',
      'Vendedor fala baixo, sobe o preço e ainda finje que tá fazendo favor.',
      'Quem não comprou ontem paga o nervoso de hoje.',
      'Caixa de munição vira artigo quente — e o bairro inteiro finge que não sabe por quê.',
    ].join('\n'),
    category: 'municao',
    impactPct: 16,
  },
  {
    title: 'Operação apreende munição',
    description: [
      'Chegou a operação. Caixa lacrada, flash no celular, boato no grupo em três minutos.',
      'O fornecedor “sumiu pra resolver umas coisas” e o estoque de cartucho foi junto.',
      'No paralelo sobrou mais conversa do que munição.',
      'Quem tinha caixa escondeu debaixo da cama; quem precisava, engoliu o preço novo.',
      'Mercado aperta o cinto — no sentido literal de cartucho.',
      'Munição sobe. A moral do assalto, por enquanto, desce.',
    ].join('\n'),
    category: 'municao',
    impactPct: 16,
  },
  {
    title: 'Desmanche lotado de peças',
    description: [
      'O desmanche da beira da pista encheu de peça “com nota duvidosa”.',
      'Capô, roda, banco, farol — tudo com desconto de quem não pergunta a procedência.',
      'Dono de oficina sorri; dono de carro “zero de rua” chora o preço antigo.',
      'Oferta demais puxa o valor de veículo pra baixo, mesmo o que ainda anda.',
      'No bazar o papo é “pega agora que amanhã normaliza”.',
      'Hoje o metal tá barato. O orgulho de quem pagou caro ontem, não.',
    ].join('\n'),
    category: 'veiculo',
    impactPct: -12,
  },
  {
    title: 'Corrida de moto no fim de semana',
    description: [
      'Sábado à noite a avenida virou autódromo improvisado.',
      'Grito de escapamento, aposta no zap, e gente comprando gasolina como se fosse água.',
      'Quem tem moto vira astro; quem não tem, fica na calçada filmando.',
      'Demanda por duas rodas e combustível sobe junto com o volume do som.',
      'Oficina e “mercado de rua” já anotaram o preço novo na testa.',
      'Fim de semana de corrida: bolso leve, adrenalina cara.',
    ].join('\n'),
    category: 'veiculo',
    impactPct: 11,
  },
  {
    title: 'Blitze pesada no centro',
    description: [
      'Centro fechado em blitze. Luz no rosto, cinto no chão, nervoso no ar.',
      'Quem andava “preparado” preferiu deixar o kit em casa — e o preço subiu por solidariedade.',
      'No underground o colete e a arma viraram artigo de luxo de madrugada.',
      'Vendedor some, volta, e cobra como se tivesse inventado a lei da oferta.',
      'Rumor corre: “tá quente”. Mercado responde: “então tá caro”.',
      'Armas e defesa sobem. O centro respira aliviado… o bazar, não.',
    ].join('\n'),
    category: 'arma',
    impactPct: 15,
  },
  {
    title: 'Fornecedor de colete some',
    description: [
      'O cara do colete “não atende mais”. Nem zap, nem recado na padaria.',
      'Teorias: viagem, apreensão, ou só cansaço de vender medo em forma de tecido.',
      'Sobra um estoque minguado e um monte de gente querendo se sentir invencível.',
      'Defesa individual vira artigo de luxo — e de fofoca.',
      'Quem tem colete anda de peito estufado; quem não tem, paga o susto no preço.',
      'Mercado de defesa aperta. O ego de quem comprou cedo, infla.',
    ].join('\n'),
    category: 'defesa',
    impactPct: 13,
  },
  {
    title: 'Sobram facas de peixeira no bazar',
    description: [
      'Chegou um lote. Ninguém sabe de onde. Todo mundo sabe o preço: barato.',
      'Peixeira, canivete, “presente de cozinha” com cara de outra coisa.',
      'O bazar encheu de cutelaria e de gente fingindo que vai filetar peixe.',
      'Excesso puxa o valor pra baixo — até a arma curta sente o clima.',
      'Vendedor pede pra levar duas; comprador negocia a terceira “de brinde”.',
      'Hoje o aço tá em promoção. A vergonha alheia, inclusa.',
    ].join('\n'),
    category: 'arma',
    impactPct: -9,
  },
  {
    title: 'Inflação come o bolso',
    description: [
      'Pão subiu, passagem subiu, e o povo ainda quer carro de filme.',
      'No mercado de rua a grana sumiu primeiro — o desejo ficou pra depois.',
      'Veículo e rifle param de girar: ninguém quer pagar o preço de ontem com o salário de hoje.',
      'Vendedor baixa a postura (e o preço) pra não ficar com o pátio lotado.',
      'Quem esperou “pra ver” talvez tenha acertado o timing pela primeira vez.',
      'Itens caros freiam. O bolso agradece; o ego, nem tanto.',
    ].join('\n'),
    category: 'veiculo',
    impactPct: -8,
  },
  {
    title: 'Contrabando de cartucho',
    description: [
      'Dizem que entrou carga. Dizem baixo, mas todo mundo ouviu.',
      'Caixa de cartucho aparece em quantidade suspeita — e com sorriso de quem não pergunta origem.',
      'De repente sobra munição onde ontem só tinha desculpa.',
      'Preço despenca, estoque incha, e o “especialista” do grupo jura que é golpe.',
      'Mercado informal enche o bolso de quem vende volume; esvazia o drama de quem tava sem bala.',
      'Munição barata por enquanto. Aproveita antes do rumor mudar de lado.',
    ].join('\n'),
    category: 'municao',
    impactPct: -14,
  },
];

function clampEventDescription(raw) {
  let text = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!text) return '';
  // JSON às vezes manda "\\n" literal
  text = text.replace(/\\n/g, '\n');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, EVENT_DESC_LINES_MAX);
  return lines.join('\n').slice(0, EVENT_DESC_MAX);
}

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function pick(arr, random) {
  if (!arr?.length) return null;
  return arr[Math.floor(random() * arr.length)];
}

function clampImpact(pct) {
  return Math.max(-30, Math.min(40, Math.round(Number(pct) || 0)));
}

function applyPct(price, pct) {
  const base = Math.max(1, Math.floor(Number(price) || 1));
  return Math.max(1, Math.round(base * (1 + pct / 100)));
}

function trendFrom(prev, next) {
  if (next > prev) return 'up';
  if (next < prev) return 'down';
  return 'flat';
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

  function ensureMarket(scopeKey, funConfig = {}, now = Date.now()) {
    marketRepository.ensurePrices(scopeKey, now);
    maybeWeeklyRestock(scopeKey, funConfig, now);
    const meta = marketRepository.getMeta(scopeKey);
    if (!meta.nextEventAt) {
      const o = opts(funConfig);
      const lo = Math.min(o.minMs, o.maxMs);
      const hi = Math.max(o.minMs, o.maxMs);
      const wait = lo + Math.floor(random() * Math.max(1, hi - lo));
      marketRepository.setMeta(scopeKey, {
        lastEventAt: meta.lastEventAt,
        nextEventAt: now + wait,
        lastRestockAt: meta.lastRestockAt,
        now,
      });
    }
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

  async function inventEvent(funConfig = {}) {
    const cats = ['combustivel', 'municao', 'arma', 'veiculo', 'defesa'];
    const prompt = `Categorias: ${cats.join(', ')}. Gere evento de mercado de rua coerente (JSON).`;

    if (process.env.FUN_DISABLE_LIVE_LLM !== '1' && funConfig.zenEnabled !== false) {
      try {
        const raw = await generateZen({
          baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3000',
          model: funConfig.zenModel || 'mimo-v2.5-free',
          system: EVENT_SYSTEM,
          prompt,
          timeoutMs: Math.max(5000, numOr(funConfig.zenTimeoutMs, 20000)),
          maxTokens: 520,
          temperature: 0.9,
          apiKey: funConfig.zenApiKey || '',
        });
        const parsed = parseEventJson(raw, cats);
        if (parsed) return { ...parsed, source: 'zen' };
      } catch (err) {
        console.warn(`[fun/market] zen event fail: ${err?.message || err}`);
      }
    }

    if (process.env.FUN_DISABLE_LIVE_LLM !== '1' && funConfig.ollamaEnabled !== false) {
      try {
        const raw = await generateOllama({
          baseUrl: funConfig.ollamaBaseUrl || 'http://127.0.0.1:11434',
          model: funConfig.ollamaModel || 'gemma4:latest',
          system: EVENT_SYSTEM,
          prompt,
          timeoutMs: Math.max(8000, numOr(funConfig.ollamaTimeoutMs, 25000)),
          keepAlive: funConfig.ollamaKeepAlive ?? -1,
          think: false,
          numPredict: 480,
          temperature: 0.9,
        });
        const parsed = parseEventJson(raw, cats);
        if (parsed) return { ...parsed, source: 'ollama' };
      } catch (err) {
        console.warn(`[fun/market] ollama event fail: ${err?.message || err}`);
      }
    }

    const t = pick(TEMPLATE_EVENTS, random);
    return {
      ...t,
      description: clampEventDescription(t.description),
      source: 'template',
    };
  }

  function parseEventJson(raw, cats) {
    const text = String(raw || '').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      const j = JSON.parse(m[0]);
      const category = String(j.category || '').trim().toLowerCase();
      if (!cats.includes(category)) return null;
      const impactPct = clampImpact(j.impactPct);
      if (impactPct === 0) return null;
      const description = clampEventDescription(j.description);
      if (!description) return null;
      return {
        title: String(j.title || 'Movimento de mercado').slice(0, 100),
        description,
        category,
        impactPct,
      };
    } catch {
      return null;
    }
  }

  function applyEventToPrices(scopeKey, event, now = Date.now()) {
    const affected = [];
    for (const item of COLLECTIBLES) {
      if (item.category !== event.category) continue;
      const cur = marketRepository.getPrice(scopeKey, item.id);
      const prev = cur?.price ?? item.basePrice;
      const next = applyPct(prev, event.impactPct);
      const trend = trendFrom(prev, next);
      marketRepository.setPrice({
        scopeKey,
        itemId: item.id,
        price: next,
        previousPrice: prev,
        trend,
        eventId: event.id,
        now,
      });
      affected.push({
        itemId: item.id,
        name: item.name,
        previousPrice: prev,
        price: next,
        trend,
      });
    }
    return affected;
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

    const draft = await inventEvent(funConfig);
    const event = marketRepository.insertEvent({
      scopeKey,
      title: draft.title,
      description: clampEventDescription(draft.description),
      category: draft.category,
      impactPct: clampImpact(draft.impactPct),
      source: draft.source,
      now,
    });
    const affected = applyEventToPrices(scopeKey, event, now);
    const broken = tryBreakItem(scopeKey, funConfig, now);
    const lo = Math.min(o.minMs, o.maxMs);
    const hi = Math.max(o.minMs, o.maxMs);
    marketRepository.setMeta(scopeKey, {
      lastEventAt: now,
      nextEventAt: now + lo + Math.floor(random() * Math.max(1, hi - lo)),
      now,
    });
    return { ok: true, event, affected, broken, announce: o.announce };
  }

  async function tryAutoMarketEvent({ scopeKey, funConfig = {}, now = Date.now() }) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    ensureMarket(scopeKey, funConfig, now);
    const meta = marketRepository.getMeta(scopeKey);
    if (meta.nextEventAt > now) {
      return { ok: false, reason: 'scheduled', nextEventAt: meta.nextEventAt };
    }
    if (random() > 0.22 && meta.nextEventAt > 0) {
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
    if (tCoins < o.assaultMinSteal) {
      return { ok: false, reason: 'target-poor', coins: tCoins };
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

    const stealCap = Math.floor(tCoins * o.assaultMaxStealRatio);
    const steal = Math.max(
      o.assaultMinSteal,
      Math.min(
        stealCap,
        Math.floor(o.assaultMinSteal + random() * Math.max(1, stealCap - o.assaultMinSteal))
      )
    );
    const powerBoost = 1 + (Number(wCol.assaultPower) || 0) / 200;
    const finalSteal = Math.min(
      tCoins,
      Math.max(o.assaultMinSteal, Math.floor(steal * powerBoost))
    );

    repository.addCoins({
      userJid: t,
      scopeKey,
      amount: -finalSteal,
      now,
      reason: 'assault-victim',
    });
    repository.addCoins({
      userJid: a,
      scopeKey,
      amount: finalSteal,
      now,
      reason: 'assault-win',
    });

    return {
      ok: true,
      success: true,
      mode: 'player',
      chance,
      roll,
      stolen: finalSteal,
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
    const lines = [
      '📰 *Mercado de rua*',
      `*${e.title}*`,
      '',
      story || null,
      '',
      `Categoria *${e.category}* · *${sign}${e.impactPct}%*`,
    ];
    if (result.affected?.length) {
      lines.push(
        result.affected
          .slice(0, 4)
          .map((a) => `${arrow(a.trend)}${a.name} ${a.previousPrice}→${a.price}`)
          .join(' · ')
      );
    }
    if (result.broken) {
      const who =
        (typeof getContactDisplayName === 'function' &&
          getContactDisplayName(result.broken.userJid)) ||
        result.broken.userJid.split('@')[0];
      lines.push(
        '',
        `💥 *Quebrou!* ${who} — *${result.broken.itemName}*`,
        `Conserto *${result.broken.repairCost}*c · \`/consertar ${result.broken.inventoryId.slice(0, 8)}\``
      );
    }
    lines.push('', '_/mercado · /armas · /bazar_');
    return lines.filter((l) => l != null).join('\n');
  }

  return {
    gallery,
    formatGallery,
    formatWeaponsShop,
    hasWeaponsLicense,
    runMarketEvent,
    tryAutoMarketEvent,
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
