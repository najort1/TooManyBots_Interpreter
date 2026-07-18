/**
 * Bateria ampliada de avaliação de modelos OpenAI-compat (proxy local).
 * NÃO altera config do bot.
 *
 *   node fun/scripts/probe-model-compare.mjs
 *   node fun/scripts/probe-model-compare.mjs --models=grok45medium,glm_5_2
 *   node fun/scripts/probe-model-compare.mjs --base=http://127.0.0.1:3300 --n-invent=8
 */
import {
  extractChatText,
  extractJsonFromChat,
  looksLikeIncompleteOrMeta,
} from '../llm/openaiClient.js';
import {
  EVENT_INVENT_SYSTEM,
  buildInventUserPrompt,
  parseInventResponse,
  isCopyCoherent,
  inferNarrativeDirection,
} from '../economy/eventPipeline.js';
import { listCompanies, getCompany, categoriesForCompany } from '../economy/companies.js';
import { getArchetype } from '../economy/archetypes.js';
import { sanitizeFlavor, looksLikeScoreboardEcho } from '../llm/flavorService.js';
import { sanitizeTarotText } from '../services/tarotService.js';

const BASE = arg('base', process.env.GLM_EVAL_BASE || 'http://127.0.0.1:3300');
const MODELS = String(arg('models', 'grok45medium,glm_5_2'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const N_INVENT = Math.max(3, Math.min(12, Number(arg('n-invent', '8')) || 8));
const N_FLAVOR = Math.max(3, Math.min(12, Number(arg('n-flavor', '6')) || 6));
const N_CHAOS = Math.max(2, Math.min(8, Number(arg('n-chaos', '4')) || 4));
const N_PROFILE = Math.max(2, Math.min(6, Number(arg('n-profile', '3')) || 3));
const N_TAROT = Math.max(1, Math.min(4, Number(arg('n-tarot', '2')) || 2));
const N_MEMORY = Math.max(1, Math.min(4, Number(arg('n-memory', '2')) || 2));
const N_ASSAULT = Math.max(1, Math.min(3, Number(arg('n-assault', '2')) || 2));

function arg(name, fb) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fb;
  return hit.slice(name.length + 3);
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function p50(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function jaccard(a, b) {
  const ta = new Set(
    String(a || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\W+/)
      .filter((w) => w.length > 3)
  );
  const tb = new Set(
    String(b || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\W+/)
      .filter((w) => w.length > 3)
  );
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function pairMaxJaccard(titles) {
  let m = 0;
  for (let i = 0; i < titles.length; i += 1) {
    for (let j = i + 1; j < titles.length; j += 1) {
      m = Math.max(m, jaccard(titles[i], titles[j]));
    }
  }
  return m;
}

async function rawComplete(model, { system, prompt, temperature, maxTokens, jsonMode }) {
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const t0 = Date.now();
  const res = await fetch(`${BASE.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`http-${res.status} ${err.slice(0, 160)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  const content = String(msg.content || '');
  const reasoning = String(msg.reasoning_content || msg.reasoning || msg.thinking || '');
  return {
    ms,
    finish: data.choices?.[0]?.finish_reason,
    contentLen: content.length,
    reasoningLen: reasoning.length,
    contentPreview: content.slice(0, 180),
    extracted: extractChatText(data),
    jsonOnly: extractJsonFromChat(data),
  };
}

function scoreInvent(parsed, raw, seedBias) {
  const issues = [];
  if (!parsed) return { ok: false, issues: ['parse-fail'], rawLen: String(raw || '').length };

  if (!parsed.title || parsed.title.length < 10) issues.push('title-short');
  if (!parsed.body || parsed.body.length < 60) issues.push('body-short');
  if (/category uma das|companyId DEVE|itself\?|Actually|JSON único|archetype DEVE/i.test(parsed.title + parsed.body)) {
    issues.push('prompt-echo');
  }
  if (looksLikeIncompleteOrMeta(parsed.title)) issues.push('title-meta');

  const arch = getArchetype(parsed.archetype);
  if (!arch) issues.push('bad-archetype');

  const co = parsed.companyId ? getCompany(parsed.companyId) : null;
  if (parsed.companyId && !co) issues.push('bad-company');

  if (parsed.category && co) {
    const cats = categoriesForCompany(parsed.companyId);
    // pure stock (patocoin) can have empty categories
    if (cats.length && !cats.includes(parsed.category)) issues.push('company-cat-mismatch');
  }

  const nDir = inferNarrativeDirection(`${parsed.title}\n${parsed.body}`);
  if (seedBias === 'down' && nDir === 'up') issues.push('bias-mismatch-up');
  if (seedBias === 'up' && nDir === 'down') issues.push('bias-mismatch-down');

  // soft coherence with inferred dir
  if (parsed.category && nDir !== 'flat') {
    const c = isCopyCoherent({
      title: parsed.title,
      body: parsed.body,
      direction: nDir,
      category: parsed.category,
      companyId: parsed.companyId,
    });
    if (!c) issues.push('incoherent-copy');
  }

  return {
    ok: !issues.some((x) =>
      ['parse-fail', 'prompt-echo', 'bad-archetype', 'title-meta', 'company-cat-mismatch'].includes(x)
    ),
    softOk: issues.length === 0,
    issues,
    title: parsed.title,
    bodyLen: parsed.body?.length || 0,
    archetype: parsed.archetype,
    companyId: parsed.companyId,
    category: parsed.category,
    nDir,
    salvaged: Boolean(parsed.salvaged),
  };
}

function scoreProse(text, { min = 16, max = 500, allowGt = false } = {}) {
  const issues = [];
  let t = String(text || '').trim().replace(/^>\s*/, '');
  if (!t) issues.push('empty');
  if (looksLikeIncompleteOrMeta(t)) issues.push('meta');
  if (looksLikeScoreboardEcho(t)) issues.push('scoreboard');
  if (
    !/[áàâãéêíóôõúç]/i.test(t) &&
    /\b(the|which|respond|english|sentences|brazilian|avoid any)\b/i.test(t)
  ) {
    issues.push('english');
  }
  if (/\bn[aã]o posso (usar|escrever)\b/i.test(t)) issues.push('refusal-meta');
  if (t.length < min) issues.push('short');
  if (!allowGt && t.length > max) issues.push('long');
  return { ok: issues.length === 0, issues, text: t, len: t.length, preview: t.slice(0, 120) };
}

async function evalModel(model) {
  console.log(`\n########## MODEL ${model} ##########`);
  const report = {
    model,
    invent: [],
    flavor: [],
    chaos: [],
    profile: [],
    tarot: [],
    memory: [],
    assault: [],
    errors: [],
  };

  const inventPromptDown = buildInventUserPrompt({
    recentFingerprints: [],
    recentArchetypes: ['quiet_week', 'blitz_luxury'],
    narrativeSeed: 'down',
    companyMoods: listCompanies().map((c) => ({ id: c.id, mood: 'warm' })),
  });
  const inventPromptUp = buildInventUserPrompt({
    recentFingerprints: [],
    recentArchetypes: ['demand_slump'],
    narrativeSeed: 'up',
    companyMoods: listCompanies().map((c) => ({ id: c.id, mood: 'hot' })),
  });

  // INVENT
  console.log(`\n--- ${model} INVENT x${N_INVENT} ---`);
  for (let i = 0; i < N_INVENT; i += 1) {
    const bias = i % 2 === 0 ? 'down' : 'up';
    const prompt = (bias === 'down' ? inventPromptDown : inventPromptUp) + '\nGere UM evento. Só JSON.';
    try {
      const r = await rawComplete(model, {
        system: EVENT_INVENT_SYSTEM,
        prompt,
        temperature: 0.75,
        maxTokens: 1400,
        jsonMode: true,
      });
      const rawText = r.jsonOnly || r.extracted || '';
      const parsed = parseInventResponse(rawText);
      const score = scoreInvent(parsed, rawText, bias);
      report.invent.push({ i, bias, ms: r.ms, finish: r.finish, contentLen: r.contentLen, reasoningLen: r.reasoningLen, ...score });
      console.log(
        score.ok ? '✓' : '✗',
        `#${i}`,
        bias,
        `${r.ms}ms`,
        score.title || score.issues.join(','),
        score.issues.length ? `[${score.issues.join(',')}]` : ''
      );
    } catch (e) {
      report.invent.push({ i, ok: false, issues: [e.message], ms: 0 });
      report.errors.push(`invent#${i}: ${e.message}`);
      console.log('✗', `#${i}`, e.message);
    }
  }

  // FLAVOR
  console.log(`\n--- ${model} FLAVOR x${N_FLAVOR} ---`);
  const flavorSystem =
    'Narrador de zap BR. 1–3 frases COMPLETAS em pt-BR. Sem raciocínio, sem meta, sem inglês, sem inventar coins/XP/placar. Só o texto final.';
  const flavorPrompts = [
    { key: 'flip_win', p: 'Vitória no cara ou coroa. Ângulo: azar cósmico. 1–3 frases. Sem coins. Só texto.' },
    { key: 'roulette_win', p: 'Ganhou roleta no 17 vermelho. Ângulo: inveja do grupo. Sem placar. Só texto.' },
    { key: 'slot_lose', p: 'Perdeu no slot. Ângulo: mico elegante. 1–2 frases. Sem coins. Só texto.' },
    { key: 'ship', p: 'Ship 31% Eduardo e Lucy. Zoação leve. 1–2 frases pt-BR. Só texto.' },
    { key: 'level_up', p: 'Subiu de nível no bot do grupo. Ângulo: humildade falsa. Sem XP número. Só texto.' },
    { key: 'marry_accept', p: 'Casamento aceito no zap entre A e B. Deboche carinhoso. 1–2 frases. Só texto.' },
    { key: 'crash_win', p: 'Cashout no crash a tempo. Ângulo: sorte com cara de skill. Sem coins. Só texto.' },
    { key: 'bet_result', p: 'Ganhou duelo de moeda. Ângulo: torcida do zap. Sem valor. Só texto.' },
  ].slice(0, N_FLAVOR);

  for (const fc of flavorPrompts) {
    try {
      const r = await rawComplete(model, {
        system: flavorSystem,
        prompt: fc.p,
        temperature: 0.95,
        maxTokens: 280,
        jsonMode: false,
      });
      const clean = sanitizeFlavor(r.extracted || r.contentPreview, 400);
      const score = scoreProse(clean || r.extracted, { min: 16, max: 450 });
      // se sanitize zerou mas raw tinha lixo, conta como fail (cascade no bot usaria template)
      if (!clean && r.extracted) score.issues.push('sanitized-empty');
      if (!clean && r.extracted) score.ok = false;
      report.flavor.push({ key: fc.key, ms: r.ms, contentLen: r.contentLen, reasoningLen: r.reasoningLen, ...score });
      console.log(score.ok ? '✓' : '✗', fc.key, `${r.ms}ms`, score.issues.join(',') || 'ok', JSON.stringify(score.preview || ''));
    } catch (e) {
      report.flavor.push({ key: fc.key, ok: false, issues: [e.message] });
      report.errors.push(`flavor:${fc.key}: ${e.message}`);
      console.log('✗', fc.key, e.message);
    }
  }

  // CHAOS
  console.log(`\n--- ${model} CHAOS x${N_CHAOS} ---`);
  const chaosCases = [
    {
      key: 'illuminati',
      system: 'Teoria Illuminati de zoeira pt-BR. 2–3 frases. Só a teoria. Sem meta.',
      prompt: 'Eduardo controla algo absurdo na cidade (pão, Wi-Fi, ônibus). Escreva a teoria.',
    },
    {
      key: 'gossip',
      system: 'Fofoca 100% FALSA e engraçada de zap. 2–3 frases. Só a fofoca.',
      prompt: 'Fofoca falsa sobre Nina no grupo.',
    },
    {
      key: 'oracle',
      system: 'Oráculo louco de WhatsApp BR. 2–3 frases. Só a resposta.',
      prompt: 'Pergunta: Vou passar na prova? Responda absurdo e engraçado.',
    },
    {
      key: 'cancel',
      system: 'Cancelamento ABSURDO de WhatsApp. 2–3 frases. Só o cancelamento.',
      prompt: 'Cancele Bruno por motivo ridículo.',
    },
  ].slice(0, N_CHAOS);

  for (const cc of chaosCases) {
    try {
      const r = await rawComplete(model, {
        system: cc.system,
        prompt: cc.prompt,
        temperature: 1.0,
        maxTokens: 400,
        jsonMode: false,
      });
      const clean = sanitizeFlavor(r.extracted || r.contentPreview, 500);
      const score = scoreProse(clean || r.extracted, { min: 24, max: 600 });
      if (!clean && r.extracted) {
        score.ok = false;
        score.issues.push('sanitized-empty');
      }
      report.chaos.push({ key: cc.key, ms: r.ms, ...score });
      console.log(score.ok ? '✓' : '✗', cc.key, `${r.ms}ms`, score.issues.join(',') || 'ok', JSON.stringify(score.preview || ''));
    } catch (e) {
      report.chaos.push({ key: cc.key, ok: false, issues: [e.message] });
      console.log('✗', cc.key, e.message);
    }
  }

  // PROFILE
  console.log(`\n--- ${model} PROFILE x${N_PROFILE} ---`);
  const profileSystem = `Extraia JSON:
{"nickname":string|null,"bio":string|null,"birthday":string|null,"title":string|null,"extras":string|null}
NÃO invente. birthday só dia/mês. extras = resto que não entrou nos outros. Só JSON.`;
  const profileSamples = [
    'me chamam de dudu, sou um proano que nunca pisou no fabio e conhecido por adorar o cachorro chupetão faço aniversario 28/11 e sou negro',
    'apelido: Nina, conhecido por mandar figurinha no comprovante, niver 12/08',
    'sou o Mago, título Lenda, niver 01 de janeiro, torço pro time X e odeio café',
  ].slice(0, N_PROFILE);

  for (let i = 0; i < profileSamples.length; i += 1) {
    try {
      const r = await rawComplete(model, {
        system: profileSystem,
        prompt: `Texto:\n"""${profileSamples[i]}"""\nExtraia.`,
        temperature: 0.3,
        maxTokens: 400,
        jsonMode: true,
      });
      const raw = r.jsonOnly || r.extracted;
      let j = null;
      try {
        j = JSON.parse(raw);
      } catch {
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        if (m) j = JSON.parse(m[0]);
      }
      const issues = [];
      if (!j) issues.push('parse-fail');
      else {
        if (i === 0 && !/dudu/i.test(String(j.nickname || ''))) issues.push('miss-nick');
        if (i === 0 && !/28/.test(String(j.birthday || ''))) issues.push('miss-bday');
        if (i === 1 && !/nina/i.test(String(j.nickname || ''))) issues.push('miss-nick');
        if (i === 1 && !/12|08|8/.test(String(j.birthday || ''))) issues.push('miss-bday');
        if (i === 2 && !/mago/i.test(String(j.nickname || ''))) issues.push('miss-nick');
      }
      const ok = issues.length === 0;
      report.profile.push({ i, ok, issues, ms: r.ms, json: j });
      console.log(ok ? '✓' : '✗', `#${i}`, issues.join(',') || 'ok', j ? JSON.stringify(j).slice(0, 140) : '');
    } catch (e) {
      report.profile.push({ i, ok: false, issues: [e.message] });
      console.log('✗', `#${i}`, e.message);
    }
  }

  // TAROT
  console.log(`\n--- ${model} TAROT x${N_TAROT} ---`);
  const tarotSystem = `Tarólogo caótico-bom de zap BR. Use só as cartas dadas.  pt-BR, engraçado mas útil. Sem destino absoluto. Sem inventar outras cartas. Só a leitura.`;
  for (let i = 0; i < N_TAROT; i += 1) {
    try {
      const r = await rawComplete(model, {
        system: tarotSystem,
        prompt: `Pergunta: vou conseguir emprego?
Tiragem:
Carta 1: O Louco (DIREITA) — início, salto
Carta 2: A Estrela (INVERTIDA) — esperança abalada
Carta 3: O Sol (DIREITA) — clareza, sucesso
Escreva a leitura (até 1200 chars).`,
        temperature: 0.9,
        maxTokens: 900,
        jsonMode: false,
      });
      const clean = sanitizeTarotText(r.extracted || r.contentPreview, 1500);
      const issues = [];
      if (!clean) issues.push('empty-after-sanitize');
      if (clean && clean.length < 80) issues.push('short');
      if (clean && !/louco|estrela|sol/i.test(clean)) issues.push('missing-cards');
      if (clean && /\b(I need|we should|in Portuguese)\b/i.test(clean)) issues.push('english-meta');
      const ok = issues.length === 0;
      report.tarot.push({ i, ok, issues, ms: r.ms, len: clean?.length || 0, preview: (clean || '').slice(0, 100) });
      console.log(ok ? '✓' : '✗', `#${i}`, `${r.ms}ms`, issues.join(',') || `len=${clean?.length}`);
    } catch (e) {
      report.tarot.push({ i, ok: false, issues: [e.message] });
      console.log('✗', `#${i}`, e.message);
    }
  }

  // MEMORY EXTRACT
  console.log(`\n--- ${model} MEMORY x${N_MEMORY} ---`);
  const memSystem = `Extraia fatos engraçados de chat WhatsApp. JSON: {"facts":[{"kind":"epic_fail|running_gag|rivalry|nickname|event","summary":"...","subjects":[0],"keywords":["k"],"score":50}]}
subjects = IDs numéricos das mensagens [N]. Nunca nomes. Se nada: {"facts":[]}. Só JSON.`;
  for (let i = 0; i < N_MEMORY; i += 1) {
    try {
      const r = await rawComplete(model, {
        system: memSystem,
        prompt: `Mensagens:
[0] João: mano bati o carro no poste ontem kkk
[1] Maria: João é fogo
[2] Pedro: bora daily
Extraia 0–2 fatos. subjects com IDs.`,
        temperature: 0.35,
        maxTokens: 400,
        jsonMode: true,
      });
      const raw = r.jsonOnly || r.extracted;
      let j = null;
      try {
        j = JSON.parse(raw);
      } catch {
        const m = String(raw || '').match(/\{[\s\S]*\}/);
        if (m) j = JSON.parse(m[0]);
      }
      const facts = Array.isArray(j?.facts) ? j.facts : Array.isArray(j) ? j : [];
      const issues = [];
      if (!j) issues.push('parse-fail');
      for (const f of facts) {
        if (!Array.isArray(f.subjects) || f.subjects.some((s) => typeof s !== 'number' && !/^\d+$/.test(String(s)))) {
          issues.push('subjects-not-numeric');
        }
        if (/jo[aã]o|maria|pedro/i.test(String(f.subjects))) issues.push('subjects-names');
      }
      // ideally has at least one fact about car/poste with subject 0
      const hasCar =
        facts.some((f) => /carro|poste/i.test(String(f.summary || '')) && String(f.subjects).includes('0'));
      if (facts.length && !hasCar) issues.push('weak-fact');
      const ok = !issues.includes('parse-fail') && !issues.includes('subjects-names') && !issues.includes('subjects-not-numeric');
      report.memory.push({ i, ok, issues, ms: r.ms, nFacts: facts.length, hasCar });
      console.log(ok ? '✓' : '✗', `#${i}`, `facts=${facts.length}`, issues.join(',') || 'ok');
    } catch (e) {
      report.memory.push({ i, ok: false, issues: [e.message] });
      console.log('✗', `#${i}`, e.message);
    }
  }

  // ASSAULT STORY (short budget check)
  console.log(`\n--- ${model} ASSAULT STORY x${N_ASSAULT} ---`);
  const assaultSystem = `Roteirista de filme besteirol BR de assalto. Formato:
🎬 TÍTULO:
CENA 1 — PREPARAÇÃO
CENA 2 — AÇÃO
CENA 3 — FUGA / CONSEQUÊNCIA
EPÍLOGO
900–1800 chars. NÃO invente coins/%. Só o roteiro.`;
  for (let i = 0; i < N_ASSAULT; i += 1) {
    try {
      const r = await rawComplete(model, {
        system: assaultSystem,
        prompt: 'Assalto a BANCO com SUCESSO. Gênero: comédia pastelão. Arma: pistola. Sem números de coins.',
        temperature: 0.95,
        maxTokens: 1200,
        jsonMode: false,
      });
      const text = String(r.extracted || r.contentPreview || '');
      const issues = [];
      if (text.length < 200) issues.push('short');
      if (!/cena\s*1|t[ií]tulo|ep[ií]logo/i.test(text)) issues.push('missing-structure');
      if (/\b\d{2,}\s*coins?\b/i.test(text)) issues.push('invented-coins');
      if (looksLikeIncompleteOrMeta(text.slice(0, 80)) && text.length < 150) issues.push('meta');
      const ok = issues.length === 0;
      report.assault.push({ i, ok, issues, ms: r.ms, len: text.length });
      console.log(ok ? '✓' : '✗', `#${i}`, `${r.ms}ms`, `len=${text.length}`, issues.join(',') || 'ok');
    } catch (e) {
      report.assault.push({ i, ok: false, issues: [e.message] });
      console.log('✗', `#${i}`, e.message);
    }
  }

  return report;
}

function summarize(report) {
  const rate = (arr) => {
    const n = arr.length || 1;
    const ok = arr.filter((x) => x.ok).length;
    return { ok, total: arr.length, rate: ok / n };
  };
  const inventTitles = report.invent.map((x) => x.title).filter(Boolean);
  const inventMs = report.invent.map((x) => x.ms).filter(Boolean);
  const flavorMs = report.flavor.map((x) => x.ms).filter(Boolean);
  const softInvent = report.invent.filter((x) => x.softOk).length;

  const inventR = rate(report.invent);
  const flavorR = rate(report.flavor);
  const chaosR = rate(report.chaos);
  const profileR = rate(report.profile);
  const tarotR = rate(report.tarot);
  const memoryR = rate(report.memory);
  const assaultR = rate(report.assault);

  // weighted score 0-100
  const score =
    inventR.rate * 30 +
    flavorR.rate * 20 +
    chaosR.rate * 15 +
    profileR.rate * 10 +
    tarotR.rate * 10 +
    memoryR.rate * 10 +
    assaultR.rate * 5;

  return {
    model: report.model,
    score: Math.round(score * 10) / 10,
    invent: {
      ...inventR,
      softOk: softInvent,
      avgMs: avg(inventMs),
      p50Ms: p50(inventMs),
      diversityJaccardMax: Math.round(pairMaxJaccard(inventTitles) * 100) / 100,
      titles: inventTitles,
      issues: report.invent.flatMap((x) => x.issues || []),
    },
    flavor: {
      ...flavorR,
      avgMs: avg(flavorMs),
      diversityJaccardMax: Math.round(
        pairMaxJaccard(report.flavor.map((x) => x.preview || x.text || '')) * 100
      ) / 100,
    },
    chaos: chaosR,
    profile: profileR,
    tarot: tarotR,
    memory: memoryR,
    assault: assaultR,
    errorCount: report.errors.length,
  };
}

async function main() {
  console.log('=== MODEL COMPARE (no bot wiring) ===');
  console.log({ BASE, MODELS, N_INVENT, N_FLAVOR, N_CHAOS, N_PROFILE, N_TAROT, N_MEMORY, N_ASSAULT });

  try {
    const tags = await fetch(`${BASE.replace(/\/+$/, '')}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    }).then((r) => r.json());
    console.log(
      'available:',
      (tags.data || []).map((m) => m.id).join(', ')
    );
  } catch (e) {
    console.error('proxy offline?', e.message);
    process.exit(1);
  }

  const summaries = [];
  for (const model of MODELS) {
    const report = await evalModel(model);
    const sum = summarize(report);
    summaries.push(sum);
    console.log(`\n--- summary ${model} ---`);
    console.log(JSON.stringify(sum, null, 2));
  }

  console.log('\n\n========== COMPARISON ==========');
  // table
  const cols = ['model', 'score', 'invent%', 'flavor%', 'chaos%', 'profile%', 'tarot%', 'memory%', 'assault%', 'invent_ms', 'div_jacc'];
  console.log(cols.join('\t'));
  for (const s of summaries) {
    console.log(
      [
        s.model,
        s.score,
        Math.round(s.invent.rate * 100),
        Math.round(s.flavor.rate * 100),
        Math.round(s.chaos.rate * 100),
        Math.round(s.profile.rate * 100),
        Math.round(s.tarot.rate * 100),
        Math.round(s.memory.rate * 100),
        Math.round(s.assault.rate * 100),
        s.invent.avgMs,
        s.invent.diversityJaccardMax,
      ].join('\t')
    );
  }

  const ranked = [...summaries].sort((a, b) => b.score - a.score);
  console.log('\n=== WINNER ===');
  if (ranked.length >= 2) {
    const [a, b] = ranked;
    console.log(`1º ${a.model} (score ${a.score})`);
    console.log(`2º ${b.model} (score ${b.score})`);
    const gap = a.score - b.score;
    if (gap < 3) console.log('Empate técnico — diferença < 3 pontos.');
    else console.log(`Vantagem clara de ${gap.toFixed(1)} pontos para ${a.model}.`);

    // qualitative bullets
    console.log('\nPontos:');
    for (const s of ranked) {
      console.log(
        `- ${s.model}: invent ${Math.round(s.invent.rate * 100)}% @${s.invent.avgMs}ms, flavor ${Math.round(s.flavor.rate * 100)}%, chaos ${Math.round(s.chaos.rate * 100)}%, divers invent jaccMax=${s.invent.diversityJaccardMax}`
      );
    }
  } else if (ranked[0]) {
    console.log(ranked[0].model, ranked[0].score);
  }
  console.log('\n(Não aplicado ao bot.)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
