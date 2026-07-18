/**
 * Avaliação avulsa do modelo glm_5_2 em http://127.0.0.1:3300
 * NÃO altera config do bot — só testes de qualidade.
 *
 *   node fun/scripts/probe-glm52-eval.mjs
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
} from '../economy/eventPipeline.js';
import { listCompanies } from '../economy/companies.js';
import { sanitizeFlavor, looksLikeScoreboardEcho } from '../llm/flavorService.js';

const BASE = process.env.GLM_EVAL_BASE || 'http://127.0.0.1:3300';
const MODEL = process.env.GLM_EVAL_MODEL || 'glm_5_2';

function scoreInvent(parsed, raw) {
  const issues = [];
  if (!parsed) {
    issues.push('parse-fail');
    return { ok: false, issues, rawLen: String(raw || '').length };
  }
  if (!parsed.title || parsed.title.length < 8) issues.push('title-short');
  if (!parsed.body || parsed.body.length < 40) issues.push('body-short');
  if (/category uma das|companyId DEVE|itself\?|Actually/i.test(parsed.title)) {
    issues.push('prompt-echo-title');
  }
  return {
    ok: issues.length === 0,
    issues,
    title: parsed.title,
    companyId: parsed.companyId,
    category: parsed.category,
    archetype: parsed.archetype,
    bodyLen: parsed.body?.length || 0,
    source: parsed.salvaged ? 'salvage' : 'json',
  };
}

function scoreFlavor(text) {
  const issues = [];
  const t = String(text || '').trim();
  if (!t) issues.push('empty');
  if (looksLikeIncompleteOrMeta(t)) issues.push('meta');
  if (looksLikeScoreboardEcho(t)) issues.push('scoreboard');
  if (!/[áàâãéêíóôõúç]/i.test(t) && /\b(the|which|respond|english)\b/i.test(t)) {
    issues.push('english');
  }
  if (t.length < 12) issues.push('short');
  if (t.length > 400) issues.push('long');
  return { ok: issues.length === 0, issues, preview: t.slice(0, 140), len: t.length };
}

async function rawComplete({ system, prompt, temperature, maxTokens, jsonMode }) {
  const body = {
    model: MODEL,
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
    signal: AbortSignal.timeout(90_000),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`http-${res.status} ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  return {
    ms,
    finish: data.choices?.[0]?.finish_reason,
    contentLen: String(msg.content || '').length,
    reasoningLen: String(msg.reasoning_content || msg.reasoning || '').length,
    contentPreview: String(msg.content || '').slice(0, 200),
    extracted: extractChatText(data),
    jsonOnly: extractJsonFromChat(data),
    data,
  };
}

async function run() {
  console.log('=== GLM eval ===');
  console.log({ BASE, MODEL });

  // health
  const tags = await fetch(`${BASE.replace(/\/+$/, '')}/v1/models`, {
    signal: AbortSignal.timeout(5000),
  }).then((r) => r.json());
  const ids = (tags.data || []).map((m) => m.id);
  console.log('models:', ids.join(', '));
  if (!ids.includes(MODEL)) {
    console.warn(`WARN: model ${MODEL} not in list — trying anyway`);
  }

  const inventPrompt = buildInventUserPrompt({
    recentFingerprints: [],
    recentArchetypes: ['quiet_week'],
    narrativeSeed: 'down',
    companyMoods: listCompanies().map((c) => ({ id: c.id, mood: 'warm' })),
  });

  // --- INVENT x5 ---
  console.log('\n--- INVENT (jsonMode) x5 ---');
  const inventResults = [];
  for (let i = 0; i < 5; i += 1) {
    try {
      const r = await rawComplete({
        system: EVENT_INVENT_SYSTEM,
        prompt: inventPrompt + '\nGere UM evento. Só JSON.',
        temperature: 0.75,
        maxTokens: 1200,
        jsonMode: true,
      });
      const rawText = r.jsonOnly || r.extracted || r.contentPreview;
      const parsed = parseInventResponse(rawText);
      const score = scoreInvent(parsed, rawText);
      inventResults.push({ i, ...score, ms: r.ms, finish: r.finish, contentLen: r.contentLen, reasoningLen: r.reasoningLen });
      console.log(
        score.ok ? '✓' : '✗',
        `#${i}`,
        `${r.ms}ms`,
        score.title || score.issues.join(','),
        `body=${score.bodyLen || 0}`
      );
    } catch (e) {
      inventResults.push({ i, ok: false, issues: [e.message], ms: 0 });
      console.log('✗', `#${i}`, e.message);
    }
  }

  // --- FLAVOR x4 ---
  console.log('\n--- FLAVOR (prose) x4 ---');
  const flavorCases = [
    { key: 'flip_win', prompt: 'Comente em 1–3 frases pt-BR (tom de zap) vitória no cara ou coroa. Ângulo: azar cósmico. NÃO diga coins/XP. Só o texto final.' },
    { key: 'roulette_win', prompt: 'Comente em 1–3 frases pt-BR roleta ganhou no vermelho 17. Ângulo: inveja do grupo. Sem placar. Só o texto.' },
    { key: 'ship', prompt: 'Zoação leve de ship 42% entre Ana e Bruno. 1–2 frases pt-BR zap. Só o texto.' },
    { key: 'illuminati', prompt: 'Uma teoria Illuminati engraçada com Eduardo no centro (Wi-Fi, pão). 2–3 frases pt-BR. Só a teoria.' },
  ];
  const flavorSystem =
    'Narrador de zap BR. 1–3 frases COMPLETAS em pt-BR. Sem raciocínio, sem meta, sem inglês, sem inventar coins/XP. Só o texto final.';
  const flavorResults = [];
  for (const fc of flavorCases) {
    try {
      const r = await rawComplete({
        system: flavorSystem,
        prompt: fc.prompt,
        temperature: 0.95,
        maxTokens: 280,
        jsonMode: false,
      });
      const clean = sanitizeFlavor(r.extracted || r.contentPreview, 400);
      const score = scoreFlavor(clean || r.extracted);
      flavorResults.push({ key: fc.key, ...score, ms: r.ms, rawEmpty: !r.extracted && !r.contentPreview });
      console.log(
        score.ok ? '✓' : '✗',
        fc.key,
        `${r.ms}ms`,
        score.issues.join(',') || 'ok',
        JSON.stringify(score.preview || '')
      );
    } catch (e) {
      flavorResults.push({ key: fc.key, ok: false, issues: [e.message] });
      console.log('✗', fc.key, e.message);
    }
  }

  // --- PROFILE EXTRACT x2 ---
  console.log('\n--- PROFILE EXTRACT (json) x2 ---');
  const profileSystem = `Extraia JSON: {"nickname":string|null,"bio":string|null,"birthday":string|null,"title":string|null,"extras":string|null}
NÃO invente. Só JSON.`;
  const profileText =
    'me chamam de dudu, sou um proano que nunca pisou no fabio e conhecido por adorar o cachorro chupetão faço aniversario 28/11 e sou negro';
  let profileOk = 0;
  for (let i = 0; i < 2; i += 1) {
    try {
      const r = await rawComplete({
        system: profileSystem,
        prompt: `Texto:\n"""${profileText}"""\nExtraia campos.`,
        temperature: 0.3,
        maxTokens: 400,
        jsonMode: true,
      });
      const raw = r.jsonOnly || r.extracted;
      let j = null;
      try {
        j = JSON.parse(raw);
      } catch {
        const m = String(raw).match(/\{[\s\S]*\}/);
        if (m) j = JSON.parse(m[0]);
      }
      const nickOk = /dudu/i.test(String(j?.nickname || ''));
      const bdayOk = /28/.test(String(j?.birthday || ''));
      const extrasOk = /proano|negro|fabio/i.test(String(j?.extras || j?.bio || ''));
      const ok = nickOk && bdayOk;
      if (ok) profileOk += 1;
      console.log(ok ? '✓' : '✗', `#${i}`, JSON.stringify(j));
    } catch (e) {
      console.log('✗', `#${i}`, e.message);
    }
  }

  // --- LATENCY / empty content ---
  console.log('\n--- SUMMARY ---');
  const inventOk = inventResults.filter((x) => x.ok).length;
  const flavorOk = flavorResults.filter((x) => x.ok).length;
  const inventMs = inventResults.filter((x) => x.ms).map((x) => x.ms);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  console.log(
    JSON.stringify(
      {
        model: MODEL,
        base: BASE,
        invent: { ok: inventOk, total: inventResults.length, avgMs: avg(inventMs) },
        flavor: { ok: flavorOk, total: flavorResults.length },
        profile: { ok: profileOk, total: 2 },
        inventTitles: inventResults.map((x) => x.title || x.issues).filter(Boolean),
        flavorPreviews: flavorResults.map((x) => ({ key: x.key, ok: x.ok, preview: x.preview })),
      },
      null,
      2
    )
  );

  // verdict
  const inventRate = inventOk / inventResults.length;
  const flavorRate = flavorOk / flavorResults.length;
  console.log('\n=== VERDICT ===');
  if (inventRate >= 0.8 && flavorRate >= 0.5) {
    console.log('PROMISING — invent forte; flavor utilizável com sanitize.');
  } else if (inventRate >= 0.6) {
    console.log('MIXED — invent ok-ish; flavor frágil.');
  } else {
    console.log('WEAK — muitas falhas de parse/qualidade.');
  }
  console.log('(Não aplicado ao bot — só avaliação.)');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
