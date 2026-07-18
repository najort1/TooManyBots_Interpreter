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
import { getCompany, listCompanies } from './companies.js';

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

/** Prompt: IA NÃO manda impactPct. */
export const EVENT_INVENT_SYSTEM = `Você gera EVENTOS de mercado de rua (WhatsApp BR) para um jogo.

JSON único sem markdown:
{"archetype":"...","category":"combustivel|municao|arma|veiculo|defesa","companyId":"...","title":"...","body":"..."}

REGRAS:
- archetype DEVE ser um dos IDs listados no user prompt
- ALTERNE alta e queda: NÃO faça só lançamento/boom/luxo. Prefira também: estoque sobrando, demanda fraca, blitze, bolso vazio, normalização
- companyId DEVE ser um dos IDs de empresa listados (ou omita)
- category uma das: combustivel, municao, arma, veiculo, defesa — e coerente com a empresa
- title ≤80 chars, manchete de bairro
- body: 5 a 8 linhas (\\n), 350–850 chars, fofoca/besteirol leve pt-BR
- COERÊNCIA OBRIGATÓRIA title+body com o archetype:
  * alta (supply_shock, demand_boom, meme_spike, blitz_luxury): escassez, fila, preço sobe, aperto
  * queda (liquidity_flood, demand_slump, profit_take, austerity_soft): sobra, desconto, preço cai, freio
  * flat (soft_recovery, rumor_only): lateral, boato, sem drama de preço
  NUNCA diga "mais cara/subiu" se o archetype é de queda; NUNCA diga "mais barata/caiu" se é de alta
- NÃO invente preços em coins
- NÃO envie impactPct, percentuais de preço, supplyDelta nem demandDelta
- NÃO repita os ganchos proibidos do user prompt`;

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
    'Gere UM evento coerente (JSON).',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildJournalistUserPrompt(facts) {
  return `FACTS oficiais (não invente outros números):\n${JSON.stringify(facts, null, 0)}`;
}

/**
 * Parse da IA inventora — descarta impactPct se vier.
 */
export function parseInventJson(raw) {
  const text = String(raw || '').trim();
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
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
  const t = normalizeNarrativeText(text);
  if (!t.trim()) return 'flat';

  const upRe =
    /mais cara|mais caro|subiu|sobe|subida|alta inesper|encarec|escassez|sumiu|fila|fomo|apert(o|ou)|lotou|procura|escasso|seco|sem produto|preco sobe|preço sobe|gasolina cara|encareceu|disparou|esquent/;
  const downRe =
    /mais barata|mais barato|caiu|desce|queda|barato|sobra|desconto|freia|morreu a procura|promo|esfria|recu(a|ou)|desceu|alivi|mais em conta|baixa(r|ou)? o preco|baixa(r|ou)? o preço|preco cai|preço cai|estoque sobra|liquidez|lote barato|promocao|promoção|realizou|tomou lucro|ninguem quer|ninguém quer/;

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
  const pick = prefer[Math.floor(random() * prefer.length)] || seeds[0];
  return {
    title: pick.title,
    body: pick.body,
    archetype: pick.archetype,
    category: pick.category,
    companyId: pick.companyId,
  };
}

/**
 * Garante que title/body não contradigam a direção real publicada no anúncio.
 * Decepção (hype/contrarian) NÃO pode mentir no mesmo post que mostra o %.
 *
 * Mantém a copy se:
 * - body existe e a narrativa é flat (tom neutro), ou
 * - narrativa bate com a direção real, ou
 * - direção real é flat e narrativa também é flat
 * Realinha (template) se body vazio, ou se up vs down se contradizem.
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
  const empty = !String(body || '').trim();

  const contradicts =
    (dir === 'up' && narr === 'down') ||
    (dir === 'down' && narr === 'up') ||
    (dir === 'flat' && (narr === 'up' || narr === 'down'));

  if (!empty && !contradicts) {
    return {
      title: String(title || 'Movimento de mercado').slice(0, 100),
      body: clampEventDescription(body),
      realigned: false,
      narrativeDirection: narr,
    };
  }

  const seed = pickAlignedTemplate({
    direction: dir,
    archetype,
    category,
    companyId,
    random,
  });
  return {
    title: seed.title.slice(0, 100),
    body: clampEventDescription(seed.body),
    realigned: true,
    narrativeDirection: inferNarrativeDirection(`${seed.title}\n${seed.body}`),
    fromTemplate: seed.archetype,
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
