/**
 * Probe live: gera perguntas QMP via Zen e avalia qualidade (humor, caos, comicidade).
 *
 *   node fun/scripts/probe-qmp-zen-live.mjs
 *   node fun/scripts/probe-qmp-zen-live.mjs --n=8
 *   node fun/scripts/probe-qmp-zen-live.mjs --n=6 --judge
 *   node fun/scripts/probe-qmp-zen-live.mjs --n=5 --no-judge
 *
 * Critérios de “boa pergunta de grupo”:
 *  - engraçada / zoação leve entre amigos
 *  - específica o bastante pra apontar alguém de verdade
 *  - potencial de caos / discussão cômica
 *  - segura (sem ofensa pesada / preconceito / sexual explícito)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { resolveFunConfig } from '../config.js';
import { openaiChatComplete } from '../llm/openaiClient.js';
import {
  createQmpService,
  sanitizeQmpPrompt,
  QMP_FALLBACK_PROMPTS,
  resolveQmpTone,
  isQmpEcho,
} from '../services/qmpService.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let rawCfg = {};
try {
  rawCfg = JSON.parse(fs.readFileSync(path.join(root, 'fun', 'config.user.json'), 'utf8'));
} catch {
  /* defaults */
}

const cfg = resolveFunConfig(rawCfg);
delete process.env.FUN_DISABLE_LIVE_LLM;

function argVal(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

const argN = process.argv.find((a) => a.startsWith('--n='));
const N = Math.max(1, Math.min(20, Number(argN?.slice(4) || 8)));
const wantJudge = !process.argv.includes('--no-judge');
const failOnWeak = process.argv.includes('--strict');
const modelOverride = argVal('model').trim();
const outOverride = argVal('out').trim();
const model = modelOverride || cfg.zenModel || 'glm_5_2';
cfg.zenModel = model;

const timeoutMs = Math.max(
  25_000,
  Number(cfg.qmpTimeoutMs) || 0,
  Number(cfg.zenTimeoutMs) || 0
);

console.log('=== QMP ZEN LIVE PROBE ===');
console.log(
  JSON.stringify(
    {
      model,
      baseUrl: cfg.zenBaseUrl,
      timeoutMs,
      N,
      judge: wantJudge,
      strict: failOnWeak,
      qmpMaxTokens: cfg.qmpMaxTokens,
      qmpTemperature: cfg.qmpTemperature,
    },
    null,
    2
  )
);

// ping Zen
try {
  const t0 = Date.now();
  const pong = await openaiChatComplete({
    baseUrl: cfg.zenBaseUrl || 'http://127.0.0.1:3300',
    model,
    system: 'Responda só: ok',
    prompt: 'ping',
    timeoutMs: 20_000,
    maxTokens: 16,
    apiKey: cfg.zenApiKey || '',
    sendSamplingParams: cfg.zenSendSamplingParams === true,
  });
  console.log(`zen ping ${Date.now() - t0}ms → ${JSON.stringify(String(pong).slice(0, 60))}`);
} catch (err) {
  console.error('ZEN OFFLINE:', err?.message || err);
  process.exit(1);
}

const qmpService = createQmpService({
  qmpRepository: null,
  generateZen: openaiChatComplete,
  generateOllama: async () => {
    throw new Error('ollama-skipped-live-probe');
  },
  random: Math.random,
});

const JUDGE_SYSTEM = `Você é crítico de humor de grupo WhatsApp BR (pt-BR).

Avalie perguntas do jogo "Quem é mais provável?" para um grupo de amigos.

Critérios (nota 1–10 cada):
- humor: quão engraçada / engajante
- caos: potencial de zoação, discussão cômica, “fofoca leve”
- especificidade: dá pra apontar alguém de verdade (não genérica demais)
- seguranca: 10 = zoação saudável; 1 = ofensa pesada/preconceito/sexual/violência

Regras:
- Responda APENAS um JSON válido, sem markdown:
  {"humor":n,"caos":n,"especificidade":n,"seguranca":n,"nota":n,"veredito":"ok|fraca|ruim","motivo":"1 frase curta"}
- nota = média ponderada mental (humor 30%, caos 30%, especificidade 25%, seguranca 15%)
- veredito "ok" se nota>=6.5 e seguranca>=7; "fraca" se 5–6.4; "ruim" se <5 ou seguranca<6
- Seja honesto. Prefira qualidade de grupo real, não marketing.`;

function parseJudge(raw) {
  const s = String(raw || '').trim();
  const jsonMatch = s.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const j = JSON.parse(jsonMatch[0]);
    const clamp = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return Math.min(10, Math.max(1, n));
    };
    return {
      humor: clamp(j.humor),
      caos: clamp(j.caos),
      especificidade: clamp(j.especificidade),
      seguranca: clamp(j.seguranca),
      nota: clamp(j.nota),
      veredito: String(j.veredito || '').toLowerCase() || '?',
      motivo: String(j.motivo || '').trim().slice(0, 200),
    };
  } catch {
    return null;
  }
}

/** Heurística local (sem LLM) — fallback se judge falhar. */
function localHeuristic(prompt) {
  const p = String(prompt || '');
  let score = 6;
  const reasons = [];

  if (!/^quem\b/i.test(p)) {
    score -= 1.5;
    reasons.push('não começa com Quem');
  }
  if (!/\?$/.test(p)) {
    score -= 0.5;
    reasons.push('sem ?');
  }
  if (p.length < 35) {
    score -= 1;
    reasons.push('curta demais');
  }
  if (p.length > 130) {
    score -= 0.5;
    reasons.push('longa');
  }

  // ganchos de humor BR / caos social
  const comedy =
    /(atras|chegando|áudio|audio|spoiler|sumir|gps|boleto|episódio|episodio|wifi|wi-fi|figurinha|call|microfone|salário|salario|ifood|print|pizza|ketchup|kk|madrugada|desculpa|zap|zap|grupo|namor|ex |mentir|preguiça|preguica|sono|fome|festa|uber|pix)/i.test(
      p
    );
  if (comedy) {
    score += 1.2;
    reasons.push('gancho cômico');
  }

  // genérica demais
  if (/(alguém|algo|coisa|fazer merda|ser ruim|ser chato)\??$/i.test(p) || p.length < 40) {
    score -= 0.8;
    reasons.push('genérica?');
  }

  // risco
  let seguranca = 9;
  if (/(matar|estup|racis|homof|gordof|suicid|estupro|naz|viado|macac)/i.test(p)) {
    seguranca = 2;
    score = 2;
    reasons.push('INSEGURO');
  }

  const nota = Math.min(10, Math.max(1, Math.round(score * 10) / 10));
  return {
    humor: comedy ? 7.5 : 5.5,
    caos: comedy ? 7 : 5,
    especificidade: p.length >= 50 ? 7 : 5,
    seguranca,
    nota,
    veredito: nota >= 6.5 && seguranca >= 7 ? 'ok' : nota >= 5 ? 'fraca' : 'ruim',
    motivo: reasons.join('; ') || 'heurística local',
    source: 'local',
  };
}

async function judgePrompt(prompt) {
  try {
    const raw = await openaiChatComplete({
      baseUrl: cfg.zenBaseUrl || 'http://127.0.0.1:3300',
      model,
      system: JUDGE_SYSTEM,
      prompt: `Pergunta QMP:\n${prompt}\n\nAvalie em JSON.`,
      timeoutMs,
      maxTokens: 220,
      temperature: 0.3,
      apiKey: cfg.zenApiKey || '',
      sendSamplingParams: cfg.zenSendSamplingParams === true,
    });
    const j = parseJudge(raw);
    if (j && j.nota != null) return { ...j, source: 'zen' };
    return { ...localHeuristic(prompt), parseFail: true, raw: String(raw).slice(0, 120) };
  } catch (err) {
    return { ...localHeuristic(prompt), judgeError: err?.message || 'judge-fail' };
  }
}

const results = [];
const seen = new Set();
/** Simula histórico do grupo (anti-eco + rotação pesada). */
const sessionRecent = [];
const heavyEvery = Math.max(2, Number(cfg.qmpHeavyEvery) || 5);

for (let i = 0; i < N; i += 1) {
  const tone = resolveQmpTone(sessionRecent.length, heavyEvery, null);
  console.log(`\n========== GERAÇÃO ${i + 1}/${N} · tom=${tone} ==========`);
  const t0 = Date.now();
  let inv;
  try {
    inv = await qmpService.inventPrompt(
      {
        ...cfg,
        zenEnabled: true,
        ollamaEnabled: false,
        qmpHeavyEnabled: true,
        qmpHeavyEvery: heavyEvery,
        qmpInventRetries: cfg.qmpInventRetries || 2,
        qmpAntiEchoLimit: cfg.qmpAntiEchoLimit || 12,
      },
      {
        tone,
        recentPrompts: [...sessionRecent],
      }
    );
  } catch (err) {
    inv = { prompt: '', provider: 'error', error: err?.message };
  }
  const ms = Date.now() - t0;

  const prompt = sanitizeQmpPrompt(inv?.prompt || '', cfg.qmpMaxPromptLen || 300);
  const dup = seen.has(prompt.toLowerCase());
  const echo = prompt ? isQmpEcho(prompt, sessionRecent) : false;
  if (prompt) {
    seen.add(prompt.toLowerCase());
    sessionRecent.unshift(prompt);
    if (sessionRecent.length > 20) sessionRecent.length = 20;
  }

  console.log(`provider: ${inv?.provider || '?'} · tone: ${inv?.tone || tone} · ${ms}ms`);
  console.log(`pergunta: ${prompt || '(vazia)'}`);
  if (dup) console.log('⚠ duplicata exata nesta sessão');
  if (echo) console.log('⚠ eco detectado vs histórico da sessão (anti-eco falhou)');

  let judge = null;
  if (wantJudge && prompt) {
    const t1 = Date.now();
    judge = await judgePrompt(prompt);
    console.log(
      `judge (${judge.source || '?'}, ${Date.now() - t1}ms):`,
      `nota=${judge.nota} humor=${judge.humor} caos=${judge.caos} esp=${judge.especificidade} seg=${judge.seguranca}`,
      `→ ${judge.veredito}`
    );
    if (judge.motivo) console.log(`  motivo: ${judge.motivo}`);
  } else if (prompt) {
    judge = localHeuristic(prompt);
    console.log(`heurística local: nota=${judge.nota} → ${judge.veredito} (${judge.motivo})`);
  }

  results.push({
    i: i + 1,
    prompt,
    provider: inv?.provider || 'error',
    tone: inv?.tone || tone,
    ms,
    dup,
    echo,
    judge,
  });
}

// resumo
console.log('\n========== RESUMO ==========');
const live = results.filter((r) => r.provider === 'zen' || r.provider === 'ollama');
const templates = results.filter((r) => r.provider === 'fallback' || r.provider === 'template');
const oks = results.filter((r) => r.judge?.veredito === 'ok');
const fracas = results.filter((r) => r.judge?.veredito === 'fraca');
const ruins = results.filter((r) => r.judge?.veredito === 'ruim');
function avgOf(vals) {
  const xs = vals.filter((n) => Number.isFinite(n));
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
const avg = avgOf(results.map((r) => r.judge?.nota));
const avgHumor = avgOf(results.map((r) => r.judge?.humor));
const avgCaos = avgOf(results.map((r) => r.judge?.caos));

const heavies = results.filter((r) => r.tone === 'heavy');
const echos = results.filter((r) => r.echo);
console.log(
  JSON.stringify(
    {
      total: results.length,
      zenOuOllama: live.length,
      fallbackTemplate: templates.length,
      unicas: seen.size,
      pesadas: heavies.length,
      ecosDetectados: echos.length,
      heavyEvery,
      vereditos: { ok: oks.length, fraca: fracas.length, ruim: ruins.length },
      notaMedia: Math.round(avg * 10) / 10,
      humorMedio: Math.round(avgHumor * 10) / 10,
      caosMedio: Math.round(avgCaos * 10) / 10,
      caosMedioPesadas: Math.round(avgOf(heavies.map((r) => r.judge?.caos)) * 10) / 10,
    },
    null,
    2
  )
);

console.log('\n--- Ranking por nota ---');
[...results]
  .filter((r) => r.prompt)
  .sort((a, b) => (b.judge?.nota || 0) - (a.judge?.nota || 0))
  .forEach((r, idx) => {
    const tag = r.tone === 'heavy' ? '🔥' : '·';
    console.log(
      `${idx + 1}. ${tag} [${r.judge?.nota ?? '?'}|${r.judge?.veredito || '?'}|${r.tone}] ${r.prompt}`
    );
  });

console.log('\n--- Referência (fallback estático, amostra) ---');
for (const p of QMP_FALLBACK_PROMPTS.slice(0, 3)) {
  console.log(`• ${p}`);
}

// critérios de sucesso do probe
const zenRate = live.length / Math.max(1, results.length);
const okRate = oks.length / Math.max(1, results.length);
const minAvg = 6.2;
const minOkRate = 0.5;
const minZenRate = 0.6;

let exitCode = 0;
const problems = [];

if (zenRate < minZenRate) {
  problems.push(`poucas gerações via Zen (${live.length}/${results.length}) — caiu em template?`);
  exitCode = 2;
}
if (wantJudge && avg < minAvg) {
  problems.push(`nota média baixa (${avg.toFixed(1)} < ${minAvg})`);
  if (failOnWeak) exitCode = 3;
}
if (wantJudge && okRate < minOkRate) {
  problems.push(`taxa ok baixa (${oks.length}/${results.length} < ${minOkRate * 100}%)`);
  if (failOnWeak) exitCode = 3;
}
if (ruins.some((r) => (r.judge?.seguranca ?? 10) < 6)) {
  problems.push('há pergunta com segurança baixa');
  exitCode = Math.max(exitCode, 4);
}

console.log('\n========== VEREDITO DO PROBE ==========');
if (!problems.length) {
  console.log(
    `✅ Geração QMP ok no Zen · média ${avg.toFixed(1)} · ${oks.length}/${results.length} “ok” · potencial de caos médio ${avgCaos.toFixed(1)}`
  );
} else {
  console.log(exitCode ? '⚠ Problemas:' : 'ℹ Observações:');
  for (const p of problems) console.log(`  - ${p}`);
  if (!failOnWeak && exitCode === 0) {
    console.log('(use --strict para falhar em nota/taxa ok baixas)');
  }
}

// salva artefato opcional (não sobrescreve GLM se --out= ou --model=)
const outDir = path.join(root, '.context');
try {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const safeModel = String(model).replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outPath = outOverride
    ? path.isAbsolute(outOverride)
      ? outOverride
      : path.join(root, outOverride)
    : path.join(
        outDir,
        modelOverride ? `qmp-zen-live-probe-${safeModel}.json` : 'qmp-zen-live-probe.json'
      );
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        model,
        baseUrl: cfg.zenBaseUrl,
        N,
        summary: {
          zenRate,
          okRate,
          avg,
          avgHumor,
          avgCaos,
          heavies: heavies.length,
          echos: echos.length,
        },
        results,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`\nartefato: ${outPath}`);
} catch {
  /* ignore */
}

process.exit(exitCode);
