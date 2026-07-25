#!/usr/bin/env node
/**
 * Test harness para a função extractFacts do groupMemoryService.
 * Reproduz o bug do "fact linking cross-thread":
 *   - Buffer com DOIS threads distintos (com time gap).
 *   - Natasha responde "essa eu sei q vai acabar cmg tá" no thread A (sobre outra coisa).
 *   - No thread B, Paulo organiza compra coletiva.
 *   - Esperado: NÃO salvar fato ligando Natasha à compra do Paulo.
 *
 * Pode chamar Zen (default :3300) ou Ollama (default :11434).
 * Uso:
 *   node scripts/probe-extract.js                       # roda 3 cenários
 *   node scripts/probe-extract.js --model zen          # só Zen
 *   node scripts/probe-extract.js --model ollama       # só Ollama
 *   node scripts/probe-extract.js --scenario bug       # só cenário do bug
 *   node scripts/probe-extract.js --prompt-variant v2  # testa o prompt v2
 */

const fs = require('node:fs');
const path = require('node:path');

// === Configuração dos modelos ===
const ZEN = {
  baseUrl: process.env.ZEN_BASE_URL || 'http://127.0.0.1:3300',
  model: process.env.ZEN_MODEL || 'glm_5_2',
  apiKey: process.env.ZEN_API_KEY || '',
};
const OLLAMA = {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'gemma4:latest',
};

// === SYSTEM PROMPTS (espelha o groupMemoryService) ===
const EXTRACT_SYSTEM_V1 = `Você extrai FATOS engraçados ou úteis de um trecho de chat de WhatsApp BR (grupo de amigos).

REGRAS OBRIGATÓRIAS:
1. Responda SOMENTE com JSON válido (objeto ou array). Sem markdown, sem texto fora do JSON.
2. Formato preferido: {"facts":[...]} ou array [...]. Cada fato:
   {"kind":"running_gag|rivalry|catchphrase|epic_fail|ship_lore|nickname|event","summary":"1 frase ≤150 chars","subjects":[0],"keywords":["kw1"],"score":35-95}
3. "subjects" DEVE ser array de IDs NUMÉRICOS do batch (ex: 0, 1, 2). NUNCA nomes, NUNCA strings de pessoa.
4. O ID em subjects é o índice da mensagem [N] que identifica o AUTOR/sujeito do fato (quem FEZ a ação ou é o foco real). Não confunda quem fala sobre quem.
5. Só salve engraçado, mico, rivalidade, bordão, apelido, lore social. Se nada valer: {"facts":[]}
6. NÃO invente o que não está no trecho. NÃO salve: bom dia, ok, comando de bot, links, spam, dados sensíveis.
7. summary em pt-BR, como alguém contaria no grupo depois (tom de zap), sem aspas externas.
Só o JSON.`;

const EXTRACT_SYSTEM_V2 = `Você extrai FATOS engraçados ou úteis de um trecho de chat de WhatsApp BR (grupo de amigos).

REGRAS OBRIGATÓRIAS:
1. Responda SOMENTE com JSON válido (objeto ou array). Sem markdown, sem texto fora do JSON.
2. Formato preferido: {"facts":[...]} ou array [...]. Cada fato:
   {"kind":"running_gag|rivalry|catchphrase|epic_fail|ship_lore|nickname|event","summary":"1 frase ≤150 chars","subjects":[0],"keywords":["kw1"],"score":35-95}
3. "subjects" DEVE ser array de IDs NUMÉRICOS do batch (ex: 0, 1, 2). NUNCA nomes, NUNCA strings de pessoa.
4. O ID em subjects é o índice da mensagem [N] que identifica o AUTOR/sujeito do fato (quem FEZ a ação ou é o foco real). Não confunda quem fala sobre quem.
5. Só salve engraçado, mico, rivalidade, bordão, apelido, lore social. Se nada valer: {"facts":[]}
6. NÃO invente o que não está no trecho. NÃO salve: bom dia, ok, comando de bot, links, spam, dados sensíveis.
7. summary em pt-BR, como alguém contaria no grupo depois (tom de zap), sem aspas externas.
8. ATENÇÃO: o batch pode ter MÚLTIPLOS threads de conversa misturados. Há marcadores "[GAP: Xm]" entre mensagens distantes no tempo. Mensagens separadas por um GAP provavelmente são de assuntos diferentes. NÃO conecte uma resposta ao thread errado só porque está fisicamente próxima. Se não tiver certeza do contexto da resposta, descarte o fato.
9. Sujeito do fato é quem PROFERIU/É O FOCO da fala que contém o conteúdo engraçado/útil. Se alguém REAGE a um plano, o subject é essa pessoa reagindo (não o autor do plano), mas só se a reação for CLARAMENTE sobre o assunto próximo. Em dúvida, descarte.
Só o JSON.`;

// === Cenários de teste ===
const SCENARIOS = {
  // Cenário "user's example": apenas o trecho de 5 msgs.
  // Aqui a LIGAÇÃO de Natasha→Paulo é tecnicamente defensável,
  // mas queremos ver se a LLM ainda erra (subjects vazios, p.ex.).
  tiny: {
    name: 'tiny-5msgs (user example)',
    msgs: [
      { idx: 0, name: 'Paulo', text: 'melhor comprar online' },
      { idx: 1, name: 'Paulo', text: 'deixa um tempo até todo mundo ver a msg @all' },
      { idx: 2, name: 'Paulo', text: 'ai agt compra' },
      { idx: 3, name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto lá' },
      { idx: 4, name: 'natasha🕷️', text: 'essa eu sei q vai acabar cmg tá' },
    ],
    goodSummary: 'Natasha já se prepara pra ser a responsável quando rola compra em grupo',
    badSummaryShouldNotMention: ['compra online', 'desconto', 'carteira de estudante', '@all'],
  },

  // Cenário BUG: buffer grande, DOIS threads, time gap.
  // Natasha fala "essa eu sei q vai acabar cmg tá" NO THREAD A (sobre academia, não compra).
  // Paulo organiza compra no THREAD B.
  // LLM NÃO deve salvar fato ligando Natasha à compra.
  bug: {
    name: 'bug-cross-thread (2h gap, 2 threads)',
    msgs: [
      // === THREAD A: viagem/academia (2h antes) ===
      { idx: 0, name: 'Marina', text: 'mano vcs foram na academia hj?' },
      { idx: 1, name: 'Lucas', text: 'fui, mas tava vazia demais, achei estranho' },
      { idx: 2, name: 'Marina', text: 'eh pq tava todo mundo no role de ontem kkk' },
      { idx: 3, name: 'natasha🕷️', text: 'pior q eu falei q ia voltar a treinar hj e nada, essa eu sei q vai acabar cmg tá' },
      { idx: 4, name: 'Marina', text: 'kkk sempre assim cmg natasha' },
      { idx: 5, name: 'Lucas', text: 'vamo marca de novo amanha?' },
      { idx: 6, name: 'Marina', text: 'bora' },
      // === GAP 2h ===
      // === THREAD B: Paulo organizando compra ===
      { idx: 7, name: 'Paulo', text: 'galera comprei ingresso do festival, melhor comprar online' },
      { idx: 8, name: 'Paulo', text: 'deixa um tempo até todo mundo ver a msg @all' },
      { idx: 9, name: 'Paulo', text: 'ai agt compra' },
      { idx: 10, name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto lá' },
      { idx: 11, name: 'Anne', text: 'eu quero 1!!' },
    ],
    // O que DEVE ser extraído (fato do thread A):
    goodSummaryHint: 'Natasha sempre fala que vai voltar a treinar mas nunca vai',
    goodSubject: 3, // natasha
    // O que NÃO deve ser extraído:
    badSubject: 11, // Anne
    badSummaryShouldNotMention: ['compra online', 'desconto', 'carteira de estudante', '@all', 'ingresso', 'festival'],
  },

  // Cenário "thread-break long": time gap gigante no meio.
  longGap: {
    name: 'long-gap-1h (Paulo compra, 1h gap, outra conversa)',
    msgs: [
      { idx: 0, name: 'Paulo', text: 'galera comprei ingresso do festival' },
      { idx: 1, name: 'Paulo', text: 'melhor comprar online, @all ve ai' },
      { idx: 2, name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto' },
      // GAP 1h
      { idx: 3, name: 'Heitor', text: 'e ai, jogo do brasil hj?' },
      { idx: 4, name: 'Carla', text: '21h, vamo ver no boteco do ze' },
      { idx: 5, name: 'Heitor', text: 'bora, eu levo a carne' },
    ],
    // Esperado: NÃO salvar fato sobre o jogo ligando ao Paulo, MAS
    // o problema do bug original é o INVERSO: não ligar Natasha a Paulo.
    // Aqui, se aparecer algum fato, deve ser sobre o jogo (Carla/Heitor).
    goodSubjectCandidates: [3, 4, 5],
    badSummaryShouldNotMention: ['festival', 'ingresso', 'compra online', 'carteira de estudante', 'desconto'],
  },
};

// === Timestamps simulados (pra formatar com gap) ===
function withTimestamps(scenario) {
  const out = [];
  let now = Date.UTC(2026, 6, 24, 14, 0); // 14:00 UTC base
  for (let i = 0; i < scenario.msgs.length; i++) {
    const m = scenario.msgs[i];
    out.push({ ...m, at: now });
    // gap diferente entre cenários
    if (scenario.name.includes('2h gap')) {
      if (i === 6) now += 2 * 60 * 60 * 1000; // gap de 2h
    } else if (scenario.name.includes('1h gap')) {
      if (i === 2) now += 60 * 60 * 1000; // gap de 1h
    } else {
      now += 90 * 1000; // 90s entre msgs
    }
  }
  return out;
}

function formatBatchV1(batch) {
  return batch.map((m, i) => `[${i}] ${m.name}: ${m.text}`).join('\n');
}

function formatBatchV2(batch) {
  const lines = [];
  let prevAt = null;
  for (let i = 0; i < batch.length; i++) {
    const m = batch[i];
    if (prevAt != null) {
      const gapMs = m.at - prevAt;
      if (gapMs >= 15 * 60 * 1000) {
        const gapMin = Math.round(gapMs / 60000);
        const gapLabel = gapMin >= 60 ? `${Math.floor(gapMin / 60)}h${gapMin % 60 ? `${gapMin % 60}m` : ''}` : `${gapMin}m`;
        lines.push(`--- [GAP: ${gapLabel}] ---`);
      }
    }
    lines.push(`[${i}] ${m.name}: ${m.text}`);
    prevAt = m.at;
  }
  return lines.join('\n');
}

function buildUserPrompt(batch, variant) {
  const knownLimit = 24;
  const existing = []; // vazio
  const known = existing
    .slice(0, knownLimit)
    .map((f) => `- [${f.kind}] (${f.subjects?.map((s) => s).join(', ') || '?'}) ${f.summary}`)
    .join('\n');
  const lines = variant === 'v2' ? formatBatchV2(batch) : formatBatchV1(batch);
  const promptLines = [
    `Analise as seguintes mensagens do grupo (${batch.length} msgs, IDs entre colchetes).`,
    variant === 'v2'
      ? 'Leia o trecho como conversa contínua, mas ATENÇÃO a marcadores [GAP] — mensagens separadas por gap geralmente são threads diferentes.'
      : 'Leia o trecho como conversa contínua (contexto importa — quem responde a quem).',
    lines,
    '',
    'Regras:',
    '1. Extraia apenas fatos engraçados ou úteis (0 a 2).',
    '2. Em subjects use OBRIGATORIAMENTE os IDs numéricos das mensagens (ex: 0, 2). Nunca nomes.',
    '3. subjects = quem FEZ / é o foco do fato (não confunda falante com assunto).',
    '4. NÃO invente. Se não souber o sujeito com ID claro, não extraia o fato.',
    '5. Use o contexto das mensagens vizinhas pra entender o fato (não isole 1 linha).',
    '6. Retorne JSON: {"facts":[...]}',
    '',
    known || 'Sem lore prévia.',
    '',
    'Exemplo de shape:',
    '{"facts":[{"kind":"epic_fail","summary":"João bateu o carro no poste","subjects":[0],"keywords":["carro","poste"],"score":72}]}',
  ];
  return promptLines.join('\n');
}

// === Chamada Zen ===
async function callZen(system, prompt) {
  const r = await fetch(`${ZEN.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ZEN.apiKey ? { Authorization: `Bearer ${ZEN.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: ZEN.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 700,
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) throw new Error(`Zen HTTP ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callOllama(system, prompt) {
  const r = await fetch(`${OLLAMA.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      format: 'json',
      stream: false,
      options: { temperature: 0.45, num_predict: 400 },
      think: false,
    }),
  });
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.message?.content || '';
}

function parseFacts(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  let parsed;
  try { parsed = JSON.parse(text); } catch { return []; }
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.facts)) return parsed.facts;
  return [];
}

// === Análise do resultado ===
function analyze(scenario, facts) {
  const result = { facts, flags: [], pass: true, notes: [] };
  const bad = scenario.badSummaryShouldNotMention || [];
  for (const f of facts) {
    const summary = String(f.summary || '').toLowerCase();
    for (const term of bad) {
      if (summary.includes(term.toLowerCase())) {
        result.flags.push(`WRONG-LINK: summary "${f.summary}" mentions "${term}" (likely cross-thread link)`);
        result.pass = false;
      }
    }
    const subs = Array.isArray(f.subjects) ? f.subjects : [];
    if (subs.length === 0) {
      result.flags.push(`MALFORMED: empty subjects (validateExtractedFact should drop this)`);
      result.pass = false;
    }
    for (const s of subs) {
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) {
        result.flags.push(`MALFORMED: subject "${s}" is not a valid integer index`);
        result.pass = false;
      }
    }
  }
  if (scenario.goodSubjectCandidates && facts.length) {
    const ok = facts.some((f) =>
      (f.subjects || []).some((s) => scenario.goodSubjectCandidates.includes(s))
    );
    if (!ok) {
      result.notes.push(`NOTE: nenhum fato com subject em ${JSON.stringify(scenario.goodSubjectCandidates)}`);
    }
  }
  if (scenario.goodSubject != null && facts.length) {
    const ok = (facts[0].subjects || []).includes(scenario.goodSubject);
    if (!ok) {
      result.notes.push(`NOTE: fato principal não tem subject=${scenario.goodSubject}`);
    }
  }
  return result;
}

async function runOne(label, scenario, system, promptVariant, caller) {
  const batch = withTimestamps(scenario);
  const prompt = buildUserPrompt(batch, promptVariant);
  const t0 = Date.now();
  let raw;
  try {
    raw = await caller(system, prompt);
  } catch (e) {
    return { label, error: e.message, elapsed: Date.now() - t0 };
  }
  const elapsed = Date.now() - t0;
  const facts = parseFacts(raw);
  const analysis = analyze(scenario, facts);
  return { label, raw, facts, elapsed, analysis };
}

function pickArgs() {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : null;
  };
  return {
    model: get('model') || 'both',
    scenario: get('scenario'),
    promptVariant: get('prompt-variant') || 'v1',
  };
}

async function main() {
  const args = pickArgs();
  const sysV1 = EXTRACT_SYSTEM_V1;
  const sysV2 = EXTRACT_SYSTEM_V2;
  const sys = args.promptVariant === 'v2' ? sysV2 : sysV1;
  const scenarios = args.scenario ? { [args.scenario]: SCENARIOS[args.scenario] } : SCENARIOS;
  const models = args.model === 'both' ? ['zen', 'ollama'] : [args.model];
  for (const scnKey of Object.keys(scenarios)) {
    const scn = SCENARIOS[scnKey];
    if (!scn) {
      console.log(`Cenário "${scnKey}" não existe. Opções: ${Object.keys(SCENARIOS).join(', ')}`);
      continue;
    }
    console.log('\n========================================');
    console.log(`CENÁRIO: ${scn.name}  (prompt: ${args.promptVariant})`);
    console.log('========================================');
    for (const m of models) {
      const caller = m === 'zen' ? callZen : callOllama;
      const label = `${m}-${args.promptVariant}-${scnKey}`;
      const res = await runOne(label, scn, sys, args.promptVariant, caller);
      if (res.error) {
        console.log(`\n[${label}] ERRO: ${res.error} (${res.elapsed}ms)`);
        continue;
      }
      const status = res.analysis.pass ? '✅ PASS' : '❌ FAIL';
      console.log(`\n[${label}] ${status}  (${res.elapsed}ms)`);
      console.log('RAW:', res.raw.slice(0, 600));
      console.log('FACTS:', JSON.stringify(res.facts, null, 2));
      for (const flag of res.analysis.flags) console.log('  ⚠', flag);
      for (const note of res.analysis.notes) console.log('  ℹ', note);
    }
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
