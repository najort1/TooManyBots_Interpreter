/**
 * Camadas 2–3: IA sugere archetype + narrativa; catálogo resolve impacto.
 */

import {
  ARCHETYPE_IDS,
  EVENT_ARCHETYPES,
  TEMPLATE_EVENT_SEEDS,
  getArchetype,
  pickArchetypeWeighted,
  resolveEventFocus,
  sampleImpactFromArchetype,
  clampShockPct,
} from './archetypes.js';
import { fingerprintText, clamp } from './math.js';
import { REASON_GUIDE } from './deception.js';
import { getCompany, listCompanies, categoriesForCompany } from './companies.js';

export const EVENT_DESC_MAX = 900;
export const EVENT_DESC_LINES_MAX = 8;

export function clampEventDescription(raw) {
  let text = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!text) return '';
  text = text.replace(/\\n/g, '\n');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, EVENT_DESC_LINES_MAX);
  return lines.join('\n').slice(0, EVENT_DESC_MAX);
}

/**
 * System curto — DeepSeek free gasta tokens no thinking;
 * regras longas viram eco no content em vez de JSON.
 */
export const EVENT_INVENT_SYSTEM = `Evento de mercado de rua (pt-BR, WhatsApp). Responda SÓ JSON:
{"archetype":"<id>","category":"combustivel|municao|arma|veiculo|defesa","companyId":"<id>","title":"<manchete ≤80>","body":"<3-6 frases fofoca>"}
archetype/companyId = IDs do user. category coerente com a empresa.
Alta = escassez/fila; queda = sobra/desconto; flat = lateral. Sem preços em coins, sem %.`;

export const JOURNALIST_SYSTEM = `Você é repórter de rua do bairro. Você NÃO inventa números de mercado.
Recebe FACTS oficiais (JSON). Use só esses números se citar %.
direction=up → texto de alta/escassez; direction=down → texto de queda/sobra; direction=flat → lateral.
Tom: fofoca BR, besteirol leve, 5–8 linhas, sem markdown.
JSON: {"title":"≤80","body":"5-8 linhas com \\n","tone":"bull|bear|chaos|calm"}`;

export function buildInventUserPrompt({
  recentFingerprints = [],
  recentArchetypes = [],
  narrativeSeed = null,
  companyMoods = [],
} = {}) {
  const companies = listCompanies()
    .map((c) => `${c.id}(${c.name})`)
    .join(', ');
  const archetypes = ARCHETYPE_IDS.join(', ');
  const banned = recentFingerprints.slice(-8).filter(Boolean);
  const used = recentArchetypes.slice(-8);
  return [
    `Archetypes válidos: ${archetypes}`,
    `Empresas: ${companies}`,
    narrativeSeed ? `Preferência do regulador (tom): ${narrativeSeed}` : null,
    used.length ? `Arquétipos recentes (varie): ${used.join(', ')}` : null,
    banned.length ? `NÃO repita ganchos parecidos com: ${banned.join(' || ')}` : null,
    companyMoods.length
      ? `Clima: ${companyMoods.map((m) => `${m.id}:${m.mood}`).join(', ')}`
      : null,
    'Gere UM evento. Só o objeto JSON (nada de explicar regras).',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildJournalistUserPrompt(facts) {
  return `FACTS oficiais (não invente outros números):\n${JSON.stringify(facts, null, 0)}`;
}

/** Manchete de bairro (pt-BR) — não schema/inglês de instrução. */
export function looksLikeStreetHeadline(text) {
  const s = String(text || '').trim();
  if (s.length < 16 || s.length > 140) return false;
  if (looksLikeInventPromptEcho(s)) return false;
  // precisa de alguma “vida” de mercado/rua
  if (
    !/[áàâãéêíóôõúç]/i.test(s) &&
    !/\b(fila|preço|preco|gasolina|peixe|bomba|uno|pato|estoque|blitz|zap|bairro|desce|sobe|explode|sumiu|lote)\b/i.test(
      s
    )
  ) {
    // inglês puro de schema
    if (/\b(category|companyId|archetype|must|should|omit|coherent)\b/i.test(s)) return false;
  }
  if (/^(category|companyId|archetype|title|body)\b/i.test(s)) return false;
  return true;
}

/**
 * Eco do system/user prompt (DeepSeek thinking às vezes recicla regras como "manchete").
 */
export function looksLikeInventPromptEcho(text) {
  const s = String(text || '').trim();
  if (!s) return true;
  if (
    /JSON [uú]nico|NUNCA diga|impactPct|goodForCategories|archetype DEVE|companyId DEVE|sem markdown|sem texto fora|Responda APENAS|Ensure not to say|se o archetype|if archetype|category one of|category uma das|one of:|coherent with|coerente com a empresa|listados \(ou omita\)|IDs de empresa|FACTS oficiais|user prompt|combustivel\|municao\|arma|title ≤|body:\s*5 a 8|ALTERNE alta e queda/i.test(
      s
    )
  ) {
    return true;
  }
  if (
    /^(if |se o |ensure |n[aã]o invente|nunca diga|category one|category uma|companyId DEVE|REGRAS:)/i.test(
      s
    )
  ) {
    return true;
  }
  // schema / inglês de instrução
  if (/\b(must be|should be|omit|required field|json object)\b/i.test(s) && s.length < 200) {
    return true;
  }
  return false;
}

/**
 * Parse da IA inventora — descarta impactPct se vier.
 */
/**
 * Fecha JSON truncado pelo max_tokens (body cortado no meio).
 */
export function repairTruncatedInventJson(text) {
  let s = String(text || '').trim();
  if (!s.includes('{')) return '';
  // pega do primeiro {
  const start = s.indexOf('{');
  s = s.slice(start);
  if (!s) return '';
  try {
    JSON.parse(s);
    return s;
  } catch {
    /* repair */
  }
  // fecha aspas abertas e chaves
  let out = s;
  const quotes = (out.match(/"/g) || []).length;
  if (quotes % 2 === 1) out += '"';
  // remove vírgula trailing antes de fechar
  out = out.replace(/,\s*$/, '');
  const open = (out.match(/\{/g) || []).length;
  const close = (out.match(/\}/g) || []).length;
  if (open > close) out += '}'.repeat(open - close);
  try {
    JSON.parse(out);
    return out;
  } catch {
    return '';
  }
}

export function parseInventJson(raw) {
  const text = String(raw || '').trim();
  let blob = '';
  const m = text.match(/\{[\s\S]*\}/);
  if (m) blob = m[0];
  else blob = repairTruncatedInventJson(text);
  if (!blob) return null;
  try {
    let j;
    try {
      j = JSON.parse(blob);
    } catch {
      const fixed = repairTruncatedInventJson(blob || text);
      if (!fixed) return null;
      j = JSON.parse(fixed);
    }
    let archetype = String(j.archetype || j.eventTag || j.tag || '')
      .trim()
      .toLowerCase();
    if (!getArchetype(archetype)) {
      // tenta classificar por palavras-chave se free-form
      archetype = classifyFreeTextToArchetype(
        `${j.title || ''} ${j.body || j.description || ''}`
      );
    }
    if (!getArchetype(archetype)) return null;

    const cats = ['combustivel', 'municao', 'arma', 'veiculo', 'defesa'];
    let category = String(j.category || '').trim().toLowerCase();
    if (!cats.includes(category)) category = '';

    const companyId = String(j.companyId || j.focusCompany || j.company || '')
      .trim()
      .toLowerCase();

    const title = String(j.title || 'Movimento de mercado').slice(0, 100);
    const body = clampEventDescription(j.body || j.description || '');
    if (!body) return null;
    if (looksLikeInventPromptEcho(title) || looksLikeInventPromptEcho(body)) return null;
    // rejeita título em inglês de raciocínio
    if (
      title.length < 80 &&
      !/[áàâãéêíóôõúç]/i.test(title) &&
      /\b(the|list|exactly|should|archetype|category)\b/i.test(title)
    ) {
      return null;
    }

    // impactPct da IA é IGNORADO de propósito (contrato anti-colapso)
    return {
      archetype,
      category: category || undefined,
      companyId: companyId || undefined,
      title,
      body,
      ignoredAiImpactPct:
        j.impactPct !== undefined && j.impactPct !== null
          ? Number(j.impactPct)
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Zen free às vezes devolve prosa em vez de JSON.
 * Tenta recuperar title/body + classifica archetype/categoria/empresa.
 * Rejeita eco óbvio do system prompt.
 */
export function salvageInventFromProse(raw) {
  let text = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!text || text.length < 28) return null;

  // eco / fragmento de instrução (system prompt ou schema em inglês)
  if (looksLikeInventPromptEcho(text)) return null;

  // tenta JSON de novo após limpar fence
  const asJson = parseInventJson(text);
  if (asJson) return { ...asJson, salvaged: false };

  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[*#>\-\d.\s]+/, '').trim())
    .filter((l) => l && !looksLikeInventPromptEcho(l) && looksLikeStreetHeadline(l));
  // se filtro de manchete zerou, tenta linhas longas sem eco
  const fallbackLines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[*#>\-\d.\s]+/, '').trim())
    .filter((l) => l.length >= 24 && !looksLikeInventPromptEcho(l));
  const pickLines = lines.length ? lines : fallbackLines;
  if (!pickLines.length) return null;

  let title = pickLines[0].slice(0, 80);
  let bodyLines = pickLines.slice(1);
  if (pickLines.length === 1 && pickLines[0].length > 70) {
    const m = pickLines[0].match(/^(.{12,72}?)([.!?…])\s+(.+)$/s);
    if (m) {
      title = `${m[1]}${m[2]}`.slice(0, 80);
      bodyLines = [m[3]];
    }
  }
  // se título parece "Empresa: resto", ok
  title = title.replace(/^["“]|["”]$/g, '').trim();
  if (looksLikeInventPromptEcho(title) || !looksLikeStreetHeadline(title)) return null;
  let body = clampEventDescription(bodyLines.join('\n') || pickLines[0]);
  if (!body || body.length < 36) {
    // single-line salvage: repete título como body se for manchete boa
    if (title.length >= 36 && looksLikeStreetHeadline(title)) {
      body = title;
    } else {
      return null;
    }
  }
  if (looksLikeInventPromptEcho(body)) return null;

  const blob = `${title}\n${body}`;
  const archetype = classifyFreeTextToArchetype(blob);
  if (!getArchetype(archetype)) return null;

  return {
    archetype,
    category: inferNarrativeCategory(blob) || undefined,
    companyId: inferNarrativeCompany(blob) || undefined,
    title: title.slice(0, 100) || 'Movimento de mercado',
    body,
    salvaged: true,
  };
}

/** JSON primeiro; se falhar, tenta prosa (Zen free). */
export function parseInventResponse(raw) {
  return parseInventJson(raw) || salvageInventFromProse(raw);
}

export function parseJournalistJson(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const title = String(j.title || '').slice(0, 100);
    const body = clampEventDescription(j.body || j.description || '');
    if (!title || !body) return null;
    return {
      title,
      body,
      tone: String(j.tone || 'chaos').slice(0, 20),
    };
  } catch {
    return null;
  }
}

/** Classificador keyword → archetype (fallback seguro). */
export function classifyFreeTextToArchetype(text) {
  const t = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/boato|rumor|primo|dizem que|nao confirm|não confirm/.test(t)) return 'rumor_only';
  if (/pato|meme|viral|fomo|zap pirado/.test(t)) return 'meme_spike';
  if (/blitz|operacao|operação|apreend|policia|polícia/.test(t)) return 'blitz_luxury';
  if (/contrabando|lote|encheu|sobra|desmanche|barato/.test(t)) return 'liquidity_flood';
  if (/seco|sumiu|escassez|fogo|explod|fabrica|fábrica|falta/.test(t)) return 'supply_shock';
  if (/corrida|fila|lancamento|lançamento|procura|demanda/.test(t)) return 'demand_boom';
  if (/inflacao|inflação|ninguem quer|ninguém quer|freia|morreu a procura/.test(t))
    return 'demand_slump';
  if (/normaliz|semana morna|calmo|sem drama/.test(t)) return 'soft_recovery';
  if (/realiz|caiu depois|tomou lucro/.test(t)) return 'profit_take';
  return 'soft_recovery';
}

export function pickTemplateSeed(recentFingerprints = [], random = Math.random) {
  const pool = TEMPLATE_EVENT_SEEDS.filter((s) => {
    const fp = fingerprintText(s.title, s.body);
    return !recentFingerprints.some((r) => r && fp && (r.includes(fp.slice(0, 20)) || fp.includes(String(r).slice(0, 20))));
  });
  const list = pool.length ? pool : [...TEMPLATE_EVENT_SEEDS];
  return list[Math.floor(random() * list.length)];
}

/**
 * Resolve proposta (IA ou template) → impacto matemático + meta.
 */
export function resolveEventProposal(proposal, { reg, random = Math.random, overheat = 0 } = {}) {
  const recent = reg?.recentArchetypes || [];
  const heat = Number(overheat) || Number(reg?.marketOverheat) || 0;

  const proposedArchetype =
    proposal?.archetype && getArchetype(proposal.archetype) ? proposal.archetype : null;

  let archetype =
    proposedArchetype ||
    pickArchetypeWeighted(recent, random, reg?.narrativeSeeds?.[0] || null, heat);

  let archetypeSwapped = false;
  // mercado quente: se a IA pediu alta, 55% troca por correção
  if (
    heat > 0.35 &&
    getArchetype(archetype)?.bias === 'up' &&
    random() < Math.min(0.75, 0.35 + heat * 0.35)
  ) {
    const next = pickArchetypeWeighted(recent, random, 'profit_take', heat);
    if (next !== archetype) archetypeSwapped = true;
    archetype = next;
  }

  // false_alarm já pode ter forçado rumor_only no deception plan
  if (proposal?.forceArchetype && getArchetype(proposal.forceArchetype)) {
    if (proposal.forceArchetype !== archetype) archetypeSwapped = true;
    archetype = proposal.forceArchetype;
  }

  const focus = resolveEventFocus(
    archetype,
    {
      companyId: proposal?.companyId,
      category: proposal?.category,
    },
    random
  );

  let impact = sampleImpactFromArchetype(archetype, random);
  if (!impact) {
    impact = sampleImpactFromArchetype('soft_recovery', random);
    archetype = 'soft_recovery';
    archetypeSwapped = true;
  }

  // Cap global de choque por evento (anti-foguete)
  const hardCap = 12;
  impact = {
    ...impact,
    shockPct: clamp(impact.shockPct, -hardCap, hardCap),
    supplyDelta: clamp(impact.supplyDelta, -0.35, 0.35),
    demandDelta: clamp(impact.demandDelta, -0.4, 0.4),
  };

  // Cap de decepção: se maxShockPct setado no follow-up
  if (proposal?.maxShockPct != null && impact) {
    const cap = Math.abs(Number(proposal.maxShockPct) || 8);
    impact = {
      ...impact,
      shockPct: clamp(impact.shockPct, -cap, cap),
      supplyDelta: clamp(impact.supplyDelta, -cap / 50, cap / 50),
      demandDelta: clamp(impact.demandDelta, -cap / 50, cap / 50),
    };
  }

  // mercado já caro: amortece alta residual
  if (heat > 0.3 && impact.shockPct > 0) {
    impact = {
      ...impact,
      shockPct: impact.shockPct * Math.max(0.25, 1 - heat * 0.45),
      demandDelta: (impact.demandDelta || 0) * 0.6,
    };
  }

  const displayShock = clampShockPct(
    (impact.shockPct || 0) * (Number(reg?.eventImpactMult) || 1)
  );

  // Se o arquétipo mudou de bias, descarta copy da inventora (evita "subiu" com queda)
  const proposedBias = proposedArchetype
    ? getArchetype(proposedArchetype)?.bias || 'flat'
    : null;
  const finalBias = getArchetype(archetype)?.bias || 'flat';
  const biasMismatch =
    archetypeSwapped && proposedBias && proposedBias !== finalBias && proposedBias !== 'flat';

  let title = String(proposal?.title || EVENT_ARCHETYPES[archetype]?.label || 'Mercado').slice(
    0,
    100
  );
  let body = clampEventDescription(proposal?.body || '');
  if (biasMismatch) {
    title = EVENT_ARCHETYPES[archetype]?.label || 'Mercado';
    body = '';
  }

  return {
    archetype,
    category: focus.category,
    companyId: focus.companyId,
    company: focus.company,
    impact,
    title,
    body,
    archetypeSwapped,
    biasMismatch: Boolean(biasMismatch),
    displayShockHint: displayShock, // só para UI após aplicar; não veio da IA
    source: proposal?.source || 'resolved',
  };
}

/** Normaliza pt-BR pra matching de tom da narrativa. */
function normalizeNarrativeText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Infere se o texto fala de alta, queda ou neutro.
 * @returns {'up'|'down'|'flat'}
 */
export function inferNarrativeDirection(text) {
  // remove negações comuns pra não contar "nem fila" / "sem escassez" como alta
  let t = normalizeNarrativeText(text);
  if (!t.trim()) return 'flat';
  t = t
    .replace(/\b(nem|sem|nao|não|nenhuma?|nenhum)\s+(fila|escassez|apert[oa]|fomo|alta|subida)\b/g, ' ')
    .replace(/\b(nao|não)\s+(subiu|sobe|encarec|sumiu|lotou)\b/g, ' ')
    .replace(/\b(nao|não)\s+(caiu|desce|barato|sobra|esfria)\b/g, ' ');

  const upRe =
    /mais cara|mais caro|subiu|sobe|subida|alta inesper|encarec|escassez|sumiu|\bfila\b|fomo|apert(o|ou)|lotou|procura|escasso|seco|sem produto|preco sobe|preço sobe|gasolina cara|encareceu|disparou|esquent|prateleira magra|falta de|viraliz|fomo/;
  const downRe =
    /mais barata|mais barato|caiu|desce|queda|barato|sobra|desconto|freia|morreu a procura|promo|esfria|recu(a|ou)|desceu|alivi|mais em conta|baixa(r|ou)? o preco|baixa(r|ou)? o preço|preco cai|preço cai|estoque sobra|estoque encalhad|encalhad|liquidac|liquida[cç][aã]o|excesso|desovar|lote barato|promocao|promoção|realizou|tomou lucro|ninguem quer|ninguém quer|estoque gigante|caminh[aã]o inteiro|parado num deposito|parado no deposito|esfria|bolso vazio/;

  let up = 0;
  let down = 0;
  for (const m of t.matchAll(new RegExp(upRe.source, 'g'))) {
    void m;
    up += 1;
  }
  for (const m of t.matchAll(new RegExp(downRe.source, 'g'))) {
    void m;
    down += 1;
  }

  if (up === 0 && down === 0) return 'flat';
  if (up > down) return 'up';
  if (down > up) return 'down';
  return 'flat';
}

/**
 * Cópia pública coerente com o ticker anunciado?
 * (direção, setor e empresa citados no texto)
 */
export function isCopyCoherent({
  title,
  body,
  direction,
  category = null,
  companyId = null,
} = {}) {
  const blob = `${title || ''}\n${body || ''}`;
  if (!String(body || title || '').trim()) return false;
  const nDir = inferNarrativeDirection(blob);
  const nCat = inferNarrativeCategory(blob);
  const nCo = inferNarrativeCompany(blob);
  const dir =
    direction === 'up' || direction === 'down' || direction === 'flat' ? direction : 'flat';
  const cid = String(companyId || '');
  const companyCats = cid ? categoriesForCompany(cid) : [];
  const pureStock = Boolean(cid) && companyCats.length === 0;

  if ((dir === 'up' && nDir === 'down') || (dir === 'down' && nDir === 'up')) return false;
  if (dir === 'flat' && (nDir === 'up' || nDir === 'down')) return false;
  if (category && nCat && nCat !== category) return false;
  if (cid && nCo && nCo !== cid) return false;
  // PatoCoin (só bolsa) não pode misturar itens de rua no corpo (peixeira, gasolina…)
  if (pureStock && mentionsStreetGoods(blob)) return false;
  // empresa de rua: se o texto ancora a empresa, o setor do texto deve ser dela
  if (nCo && nCat) {
    const coCats = categoriesForCompany(nCo);
    if (coCats.length && !coCats.includes(nCat)) return false;
  }
  return true;
}

/** Itens de rua explícitos — não “munição” genérica do fallback sintético. */
function mentionsStreetGoods(text) {
  const t = normalizeNarrativeText(text);
  return /peixeira|pistola|rifle|\bfaca\b|canivete|gasolina|gal[aã]o|litro|colete|cartucho|escapamento|\bmoto\b|\bcarro\b|posto da|blindad/.test(
    t
  );
}

/**
 * Infere o setor da narrativa (gasolina vs colete vs arma…).
 * @returns {string|null} category id ou null se ambíguo
 */
export function inferNarrativeCategory(text) {
  const t = normalizeNarrativeText(text);
  if (!t.trim()) return null;

  const scores = {
    combustivel: 0,
    municao: 0,
    arma: 0,
    veiculo: 0,
    defesa: 0,
  };

  const bump = (cat, n = 1) => {
    scores[cat] = (scores[cat] || 0) + n;
  };

  // "bomba" de gasolina ≠ BombaTech; não usar "bomba" solto em combustível
  if (/gasolina|combust|posto|gal[aã]o|litro|ze do gas|z[eé] do g[aá]s|caminh[aã]o.*(comb|gas)|tanque|bomba de gasolina|bomba do posto/.test(t)) {
    bump('combustivel', 3);
  }
  if (/municao|muni[cç][aã]o|cartucho|carregador/.test(t)) bump('municao', 3);
  // \barma\b evita "armadilha"; peixeira/pistola/etc. são âncoras fortes
  if (
    /\barma\b|pistola|rifle|\bfaca\b|peixeira|canivete|a[cç]ao de fogo|bombatech/.test(t)
  ) {
    bump('arma', 3);
  }
  if (/moto|carro|veiculo|ve[ií]culo|escapamento|oficina|duas rodas|uno motors|\buno\b/.test(t)) {
    bump('veiculo', 2);
  }
  if (/colete|defesa|blindad|satelite|sat[eé]lite|escudo|tatico|t[aá]tico/.test(t)) {
    bump('defesa', 3);
  }

  let best = null;
  let bestScore = 0;
  for (const [cat, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      best = cat;
      bestScore = sc;
    }
  }
  return bestScore >= 2 ? best : null;
}

/**
 * Infere se o texto ancora uma empresa pelo nome (PatoCoin vs BombaTech…).
 * @returns {string|null} company id
 */
export function inferNarrativeCompany(text) {
  const t = normalizeNarrativeText(text);
  if (!t.trim()) return null;
  const scores = Object.create(null);
  const bump = (id, n = 1) => {
    scores[id] = (scores[id] || 0) + n;
  };

  if (/patocoin|pato coin|sticker de pato|\bpatos?\b.*coin|coin.*pato/.test(t)) {
    bump('patocoin', 4);
  }
  if (/bombatech|bomba tech/.test(t)) bump('bombatech', 4);
  if (/peixaria|jo[aã]o.*peixe/.test(t)) bump('peixaria', 3);
  if (/uno motors|\buno\b.*motor|oficina.*uno/.test(t)) bump('uno_motors', 3);
  if (/burgerzap|burger zap|lanche.*app/.test(t)) bump('burgerzap', 3);
  if (/satelite br|sat[eé]lite br|satelite_br/.test(t)) bump('satelite_br', 3);

  let best = null;
  let bestScore = 0;
  for (const [id, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      best = id;
      bestScore = sc;
    }
  }
  return bestScore >= 3 ? best : null;
}

const CATEGORY_LABEL = Object.freeze({
  combustivel: 'combustível',
  municao: 'munição',
  arma: 'arma',
  veiculo: 'veículo',
  defesa: 'defesa',
});

/** Fallback mínimo coerente quando não há seed da categoria. */
export function buildDirectionFallbackCopy({ direction, category, companyId } = {}) {
  const cat = CATEGORY_LABEL[category] || 'mercado de rua';
  const company = companyId ? getCompany(companyId) : null;
  const who = company?.name || 'o bairro';

  if (direction === 'up') {
    return {
      title: `${cat} aperta no bairro`,
      body: [
        `Rolou aquele clima de aperto com *${cat}* hoje.`,
        `${who} tá com a prateleira mais magra que ontem.`,
        'A galera comenta fila, demora e preço subindo de leve.',
        'Ninguém quer admitir, mas o bolso já notou.',
        'Quem precisa, compra o suficiente e segue o baile.',
        'No grupo do zap: “subiu de novo?” — parece que sim.',
      ].join('\n'),
    };
  }
  if (direction === 'down') {
    return {
      title: `${cat} esfria um pouco`,
      body: [
        `Parece que *${cat}* deu uma aliviada no preço por aí.`,
        `${who} não tá gritando promoção, mas o valor recuou.`,
        'Tem gente aproveitando pra repor estoque sem drama.',
        'Quem pagou o pico ontem fingiu que não viu o grupo.',
        'O bairro respira. O ego de quem comprou cedo, nem tanto.',
        'Por enquanto tá mais em conta — até a próxima onda.',
      ].join('\n'),
    };
  }
  return {
    title: 'Semana morna no mercado',
    body: [
      `Nem fila, nem blitze, nem caos com *${cat}*.`,
      `${who} segue no ritmo de sempre.`,
      'Preço anda de lado. Fofoca fraca.',
      'Quem vivia de susto reclama que “tá sem conteúdo”.',
      'Às vezes o drama é não ter drama.',
      'Normalização chata — e saudável pro bolso.',
    ].join('\n'),
  };
}

/**
 * Escolhe seed de template alinhado à direção real do preço.
 * Prefere mesma categoria/empresa; se não houver, fallback por direção.
 */
export function pickAlignedTemplate({
  direction = 'flat',
  archetype = null,
  category = null,
  companyId = null,
  random = Math.random,
} = {}) {
  const dir = direction === 'up' || direction === 'down' ? direction : 'flat';
  const seeds = [...TEMPLATE_EVENT_SEEDS];

  const biasOf = (id) => getArchetype(id)?.bias || 'flat';
  const matchesDir = (s) => {
    const b = biasOf(s.archetype);
    if (dir === 'flat') return b === 'flat' || s.archetype === 'soft_recovery';
    return b === dir;
  };

  let pool = seeds.filter(matchesDir);
  if (!pool.length) pool = seeds;

  const byCategory = category ? pool.filter((s) => s.category === category) : [];
  const byCompany = companyId ? pool.filter((s) => s.companyId === companyId) : [];
  const byArch = archetype ? pool.filter((s) => s.archetype === archetype) : [];

  // Se não há seed da categoria, gera copy genérica coerente (evita notícia de munição pra gasolina)
  if (category && !byCategory.length && !byCompany.length) {
    const fb = buildDirectionFallbackCopy({ direction: dir, category, companyId });
    return {
      title: fb.title,
      body: fb.body,
      archetype: archetype || (dir === 'up' ? 'supply_shock' : dir === 'down' ? 'liquidity_flood' : 'soft_recovery'),
      category,
      companyId: companyId || null,
      synthetic: true,
    };
  }

  const prefer = byArch.length
    ? byArch
    : byCategory.length
      ? byCategory
      : byCompany.length
        ? byCompany
        : pool;

  // Só seeds cuja copy já é coerente com o ticker anunciado
  const coherent = prefer.filter((s) =>
    isCopyCoherent({
      title: s.title,
      body: s.body,
      direction: dir,
      category: category || s.category,
      companyId: companyId || s.companyId,
    })
  );
  const list = coherent.length ? coherent : [];
  if (!list.length) {
    const fb = buildDirectionFallbackCopy({
      direction: dir,
      category: category || prefer[0]?.category,
      companyId: companyId || prefer[0]?.companyId,
    });
    return {
      title: fb.title,
      body: fb.body,
      archetype: archetype || (dir === 'up' ? 'supply_shock' : dir === 'down' ? 'liquidity_flood' : 'soft_recovery'),
      category: category || prefer[0]?.category || null,
      companyId: companyId || prefer[0]?.companyId || null,
      synthetic: true,
    };
  }
  const pick = list[Math.floor(random() * list.length)];
  return {
    title: pick.title,
    body: pick.body,
    archetype: pick.archetype,
    category: pick.category,
    companyId: pick.companyId,
  };
}

/**
 * Garante que title/body não contradigam a direção **nem o setor** do anúncio.
 * Decepção (hype/contrarian) NÃO pode mentir no mesmo post que mostra o %.
 *
 * Realinha se:
 * - body vazio
 * - narrativa up/down oposta ao ticker
 * - texto fala de outro setor (gasolina vs colete/defesa, etc.)
 * - direção real up/down e texto só "fofoca neutra" sem tom de preço (fraco demais)
 */
export function alignEventCopy({
  title,
  body,
  direction,
  archetype = null,
  category = null,
  companyId = null,
  random = Math.random,
} = {}) {
  const dir =
    direction === 'up' || direction === 'down' || direction === 'flat' ? direction : 'flat';
  const combined = `${title || ''}\n${body || ''}`;
  const narr = inferNarrativeDirection(combined);
  const textCat = inferNarrativeCategory(combined);
  const textCompany = inferNarrativeCompany(combined);
  const focusCompany = String(companyId || '').toLowerCase();

  // Um único portão: se já é coerente, não mexe
  if (
    isCopyCoherent({
      title,
      body,
      direction: dir,
      category,
      companyId,
    })
  ) {
    return {
      title: String(title || 'Movimento de mercado').slice(0, 100),
      body: clampEventDescription(body),
      realigned: false,
      narrativeDirection: narr,
      narrativeCategory: textCat,
      narrativeCompany: textCompany,
    };
  }

  // Preferir template alinhado; se ainda incoerente, sintético da categoria real
  const seed = pickAlignedTemplate({
    direction: dir,
    archetype,
    category,
    companyId,
    random,
  });
  let titleOut = seed.title;
  let bodyOut = seed.body;
  if (
    !isCopyCoherent({
      title: titleOut,
      body: bodyOut,
      direction: dir,
      category,
      companyId,
    })
  ) {
    const fb = buildDirectionFallbackCopy({ direction: dir, category, companyId });
    titleOut = fb.title;
    bodyOut = fb.body;
  }

  const directionContradicts =
    (dir === 'up' && narr === 'down') ||
    (dir === 'down' && narr === 'up') ||
    (dir === 'flat' && (narr === 'up' || narr === 'down'));
  const categoryContradicts =
    Boolean(category) && Boolean(textCat) && textCat !== category;
  const companyContradicts =
    Boolean(focusCompany) && Boolean(textCompany) && textCompany !== focusCompany;
  const weakTone = (dir === 'up' || dir === 'down') && narr === 'flat';

  return {
    title: String(titleOut || 'Movimento de mercado').slice(0, 100),
    body: clampEventDescription(bodyOut),
    realigned: true,
    narrativeDirection: inferNarrativeDirection(`${titleOut}\n${bodyOut}`),
    narrativeCategory: category || inferNarrativeCategory(`${titleOut}\n${bodyOut}`),
    fromTemplate: seed.archetype,
    reason: directionContradicts
      ? 'direction'
      : categoryContradicts
        ? 'category'
        : companyContradicts
          ? 'company'
          : weakTone
            ? 'weak-tone'
            : 'empty',
    narrativeCompany: focusCompany || textCompany,
  };
}

export function buildJournalistFacts({
  titleHint,
  bodyHint,
  category,
  company,
  archetype,
  avgDeltaPct,
  direction,
  primaryReason,
  affected,
  deceptionMode,
  hardNumbers,
}) {
  const reason = primaryReason || 'noise';
  return {
    ticker: company?.name || category,
    companyId: company?.id || null,
    category,
    archetype,
    deltaPct: Math.round((Number(avgDeltaPct) || 0) * 10) / 10,
    direction,
    primaryReason: reason,
    reasonGuide: REASON_GUIDE[reason] || REASON_GUIDE.noise,
    deception: { mode: deceptionMode || 'none' },
    personalityFlavor: company?.flavor || '',
    hardNumbers: hardNumbers || {},
    affectedPreview: (affected || []).slice(0, 4).map((a) => ({
      name: a.name,
      prev: a.previousPrice,
      price: a.price,
      deltaPct: a.deltaPct,
    })),
    // se já tem body da invent, jornalista pode só polir — facts incluem hint
    draftTitle: titleHint || null,
    draftBody: bodyHint || null,
  };
}

/**
 * Sanitiza notícia: se IA inventou % diferente, não confiar — usamos title/body
 * mas strip de padrões de preço inventado opcional.
 * Com hardDeltaPct, realinha tom se o texto contradisser o sinal do % publicado.
 */
export function sanitizeNewsText(text, hardDeltaPct = null) {
  let t = clampEventDescription(text);
  if (hardDeltaPct != null && Number.isFinite(Number(hardDeltaPct))) {
    const dir =
      Number(hardDeltaPct) > 0.5 ? 'up' : Number(hardDeltaPct) < -0.5 ? 'down' : 'flat';
    const narr = inferNarrativeDirection(t);
    const contradicts =
      (dir === 'up' && narr === 'down') ||
      (dir === 'down' && narr === 'up') ||
      (dir === 'flat' && (narr === 'up' || narr === 'down'));
    if (contradicts) {
      const seed = pickAlignedTemplate({ direction: dir });
      t = clampEventDescription(seed.body);
    }
  }
  return t;
}
