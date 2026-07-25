#!/usr/bin/env node
/**
 * Probe final: testa a função extractFacts do groupMemoryService já corrigida.
 * Carrega o módulo ESM e chama diretamente com mocks controlados.
 *
 * Uso:
 *   node scripts/probe-final.cjs
 *   node scripts/probe-final.cjs --model ollama
 *   node scripts/probe-final.cjs --scenario bug
 */

const path = require('node:path');

const ZEN = {
  baseUrl: process.env.ZEN_BASE_URL || 'http://127.0.0.1:3300',
  model: process.env.ZEN_MODEL || 'glm_5_2',
};
const OLLAMA = {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'gemma4:latest',
};

async function callZen(system, prompt) {
  const r = await fetch(`${ZEN.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  if (!r.ok) throw new Error(`Zen HTTP ${r.status}`);
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
  if (!r.ok) throw new Error(`Ollama HTTP ${r.status}`);
  const data = await r.json();
  return data.message?.content || '';
}

const SCENARIOS = {
  bug: {
    name: 'bug-cross-thread (2h gap, 2 threads)',
    msgs: [
      // THREAD A: academia (2h antes)
      { name: 'Marina', text: 'mano vcs foram na academia hj?' },
      { name: 'Lucas', text: 'fui, mas tava vazia demais, achei estranho' },
      { name: 'Marina', text: 'eh pq tava todo mundo no role de ontem kkk' },
      { name: 'natasha🕷️', text: 'pior q eu falei q ia voltar a treinar hj e nada, essa eu sei q vai acabar cmg tá' },
      { name: 'Marina', text: 'kkk sempre assim cmg natasha' },
      { name: 'Lucas', text: 'vamo marca de novo amanha?' },
      { name: 'Marina', text: 'bora' },
      // GAP 2h
      // THREAD B: Paulo organizando compra
      { name: 'Paulo', text: 'galera comprei ingresso do festival, melhor comprar online' },
      { name: 'Paulo', text: 'deixa um tempo até todo mundo ver a msg @all' },
      { name: 'Paulo', text: 'ai agt compra' },
      { name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto lá' },
      { name: 'Anne', text: 'eu quero 1!!' },
    ],
    timeGapAfterIdx: 6, // 2h gap após idx 6
    expected: {
      // o bug do user: Natasha (subject do thread A) ligada ao Paulo/compra (thread B).
      // Se algum fato tem Natasha como subject E o summary menciona termos do thread B → cross-thread link.
      crossThreadCheck: {
        // subject name → termos do thread OPOSTO que NÃO podem aparecer no summary
        forbiddenBySubject: [
          {
            subjectNames: ['natasha', 'Natasha', 'Marina', 'Lucas'],
            // eles não podem estar ligados ao thread B (Paulo/compra)
            rejectTerms: ['compra online', 'desconto', 'carteira de estudante', '@all', 'ingresso', 'festival', 'paulo'],
          },
        ],
      },
    },
  },
  tiny: {
    name: 'tiny-5msgs (user example)',
    msgs: [
      { name: 'Paulo', text: 'melhor comprar online' },
      { name: 'Paulo', text: 'deixa um tempo até todo mundo ver a msg @all' },
      { name: 'Paulo', text: 'ai agt compra' },
      { name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto lá' },
      { name: 'natasha🕷️', text: 'essa eu sei q vai acabar cmg tá' },
    ],
    timeGapAfterIdx: -1,
    expected: {
      acceptAny: true, // qualquer fato razoável é OK
    },
  },
  longGap: {
    name: 'long-gap-1h (Paulo compra, 1h gap, jogo)',
    msgs: [
      { name: 'Paulo', text: 'galera comprei ingresso do festival' },
      { name: 'Paulo', text: 'melhor comprar online, @all ve ai' },
      { name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto' },
      { name: 'Heitor', text: 'e ai, jogo do brasil hj?' },
      { name: 'Carla', text: '21h, vamo ver no boteco do ze' },
      { name: 'Heitor', text: 'bora, eu levo a carne' },
    ],
    timeGapAfterIdx: 2,
    expected: {
      // se algum fato for extraído, não pode ser sobre o festival/compra
      rejectSummaryTerms: ['festival', 'ingresso', 'compra online', 'carteira de estudante', 'desconto'],
    },
  },
};

function withTimestamps(scenario) {
  const out = [];
  let now = Date.UTC(2026, 6, 24, 14, 0);
  const gap2h = 2 * 60 * 60 * 1000;
  const gap1h = 60 * 60 * 1000;
  for (let i = 0; i < scenario.msgs.length; i++) {
    out.push({ ...scenario.msgs[i], at: now });
    if (scenario.timeGapAfterIdx === i) {
      now += scenario.name.includes('2h') ? gap2h : gap1h;
    } else {
      now += 90 * 1000; // 90s entre msgs normais
    }
  }
  return out;
}

// importa o módulo ESM via dynamic import
async function main() {
  const args = process.argv.slice(2);
  const get = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
  const modelFilter = get('model');
  const scenFilter = get('scenario');
  const url = 'file:///' + path.resolve('fun/services/groupMemoryService.js').replace(/\\/g, '/');
  const mod = await import(url);
  const {
    createGroupMemoryService,
    parseFactsJson,
    formatBatchLines: _ignored, // legacy
  } = mod;
  // pega formatBatchLinesWithContext do interior do serviço
  // (não está exportada). Vamos só reusar o que o serviço faz:
  // mock o groupMemoryService e capturar o prompt enviado
  const models = modelFilter ? [modelFilter] : ['zen', 'ollama'];
  const scenarios = scenFilter ? { [scenFilter]: SCENARIOS[scenFilter] } : SCENARIOS;
  let total = 0;
  let pass = 0;
  for (const sk of Object.keys(scenarios)) {
    const scn = SCENARIOS[sk];
    if (!scn) continue;
    for (const m of models) {
      total += 1;
      const caller = m === 'zen' ? callZen : callOllama;
      const u = (p) => '5511' + Math.random().toString().slice(2, 9) + '@s.whatsapp.net';
      // mock repo: grava em memória
      const mem = { facts: [] };
      const memRepo = {
        listFacts: () => mem.facts.slice(),
        insertFact: (f) => { const r = { id: 'f' + mem.facts.length, ...f }; mem.facts.push(r); return r; },
        reinforceFact: (id, patch) => { const f = mem.facts.find(x => x.id === id); if (f) Object.assign(f, patch); },
        decayAndPurge: () => {},
        pruneToCap: () => {},
        setPersona: () => {},
        getPersona: () => ({ personaText: '', factCount: 0 }),
        countFacts: (k) => mem.facts.filter(f => f.scopeKey === k).length,
      };
      let captured = null;
      const svc = createGroupMemoryService({
        memoryRepository: memRepo,
        generateZen: async (opts) => {
          if (opts?.jsonMode) {
            captured = { system: opts.system, prompt: opts.prompt };
            return caller(opts.system, opts.prompt);
          }
          return '• ok';
        },
        generateOllama: async (opts) => {
          captured = { system: opts.system, prompt: opts.prompt };
          return caller(opts.system, opts.prompt);
        },
      });
      const scope = '120363' + Math.random().toString().slice(2, 12) + '@g.us';
      const tBatch = withTimestamps(scn);
      // push as msgs do batch
      for (const m of tBatch) {
        svc._pushRaw(scope, { userJid: u(), name: m.name, text: m.text, at: m.at });
      }
      const cfg = {
        memoryEnabled: true,
        memoryMinScore: 30,
        memoryFlushMinMessages: 3,
        zenEnabled: m === 'zen',
        ollamaEnabled: m === 'ollama',
        zenBaseUrl: ZEN.baseUrl,
        zenModel: ZEN.model,
        ollamaBaseUrl: OLLAMA.baseUrl,
        ollamaModel: OLLAMA.model,
        memoryBufferSize: 100,
      };
      try {
        await svc.forceFlush(scope, cfg);
      } catch (e) {
        console.log(`[${m}/${sk}] ERRO flush: ${e.message}`);
        continue;
      }
      // avalia
      const ev = scn.expected || {};
      const summary = mem.facts.map(f => f.summary).join(' | ');
      let ok = true;
      const flags = [];
      if (mem.facts.length === 0 && !ev.acceptEmpty) {
        flags.push('no fact saved (pode ser OK se LLM descartou)');
      }
      // subject → userJid map: pegar do batch
      const jidToName = new Map();
      for (let i = 0; i < tBatch.length; i++) {
        // subject = idx do batch. Pra mapear de volta pro nome, precisaríamos
        // do nome do JID, mas no probe o JID é aleatório. Vou só verificar
        // via summary mesmo.
      }
      // 1) rejeição simples: summary contém termos proibidos
      for (const f of mem.facts) {
        const sl = f.summary.toLowerCase();
        for (const term of (ev.rejectSummaryTerms || [])) {
          if (sl.includes(term.toLowerCase())) {
            flags.push(`REJECT: summary "${f.summary}" contém "${term}"`);
            ok = false;
          }
        }
      }
      // 2) cross-thread check: se subject name é X e summary contém termo do thread oposto
      if (ev.crossThreadCheck) {
        // pra isso, preciso mapear o subject JID → nome. No probe, o userJid é aleatório,
        // mas o svc.groupMemoryService mantém map interno. Como alternativa, vou usar
        // um lookup simples: subjects são JIDs únicos, e eu posso pegar o nome via
        // o primeiro item do batch que fez o push com mesmo name.
        // MAIS SIMPLES: vou ler o que o repositório guardou e comparar
        // o nome que aparece no summary com os termos.
        for (const f of mem.facts) {
          const sl = f.summary.toLowerCase();
          for (const rule of ev.crossThreadCheck.forbiddenBySubject || []) {
            // qual subject? o JID... mas o probe tem nome em subjects?
            // o probe passa mem.facts com subjects = [jid]. Pra simplificar, vou
            // buscar via nome que aparece na frase.
            const subjectNameInSummary = rule.subjectNames.find((n) => sl.includes(n.toLowerCase()));
            if (!subjectNameInSummary) continue;
            for (const term of rule.rejectTerms) {
              if (sl.includes(term.toLowerCase())) {
                flags.push(
                  `CROSS-THREAD: subject "${subjectNameInSummary}" ligado a termo "${term}" em "${f.summary}"`
                );
                ok = false;
              }
            }
          }
        }
      }
      if (ok) pass += 1;
      const status = ok ? '✅' : '❌';
      console.log(`\n${status} [${m}/${sk}]  saved=${mem.facts.length}  summary="${summary.slice(0, 200)}"`);
      for (const fl of flags) console.log('   ', fl);
      if (captured?.prompt) {
        // mostra as primeiras linhas pra inspecionar timestamps
        const lines = captured.prompt.split('\n').filter(l => /\[GAP|\[\d{1,2}:\d{2}\]|\[\d+\]/.test(l));
        console.log('   [primeiras linhas do prompt com timestamps]:');
        for (const l of lines.slice(0, 8)) console.log('     ', l);
        if (lines.some(l => /\[GAP:/.test(l))) {
          console.log('   ✓ GAP markers presentes no prompt');
        } else {
          console.log('   ✗ GAP markers AUSENTES');
        }
      }
    }
  }
  console.log(`\n========== ${pass}/${total} cenários OK ==========`);
}

main().catch((e) => { console.error(e); process.exit(1); });
