#!/usr/bin/env node
/**
 * Roda o mesmo cenário N vezes para capturar variabilidade do modelo.
 * Imprime frequência de cada padrão de output.
 *
 * Uso:
 *   node scripts/probe-stability.cjs --scenario bug --n 5
 *   node scripts/probe-stability.cjs --scenario tiny --n 5 --model ollama
 */

const ZEN = {
  baseUrl: process.env.ZEN_BASE_URL || 'http://127.0.0.1:3300',
  model: process.env.ZEN_MODEL || 'glm_5_2',
  apiKey: process.env.ZEN_API_KEY || '',
};
const OLLAMA = {
  baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'gemma4:latest',
};

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

const SCENARIOS = {
  bug: [
    { idx: 0, name: 'Marina', text: 'mano vcs foram na academia hj?' },
    { idx: 1, name: 'Lucas', text: 'fui, mas tava vazia demais, achei estranho' },
    { idx: 2, name: 'Marina', text: 'eh pq tava todo mundo no role de ontem kkk' },
    { idx: 3, name: 'natasha🕷️', text: 'pior q eu falei q ia voltar a treinar hj e nada, essa eu sei q vai acabar cmg tá' },
    { idx: 4, name: 'Marina', text: 'kkk sempre assim cmg natasha' },
    { idx: 5, name: 'Lucas', text: 'vamo marca de novo amanha?' },
    { idx: 6, name: 'Marina', text: 'bora' },
    { idx: 7, name: 'Paulo', text: 'galera comprei ingresso do festival, melhor comprar online' },
    { idx: 8, name: 'Paulo', text: 'deixa um tempo até todo mundo ver a msg @all' },
    { idx: 9, name: 'Paulo', text: 'ai agt compra' },
    { idx: 10, name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto lá' },
    { idx: 11, name: 'Anne', text: 'eu quero 1!!' },
  ],
  tiny: [
    { idx: 0, name: 'Paulo', text: 'melhor comprar online' },
    { idx: 1, name: 'Paulo', text: 'deixa um tempo até todo mundo ver a msg @all' },
    { idx: 2, name: 'Paulo', text: 'ai agt compra' },
    { idx: 3, name: 'Paulo', text: 'quem n tiver carteira de estudante eu consigo aquele desconto lá' },
    { idx: 4, name: 'natasha🕷️', text: 'essa eu sei q vai acabar cmg tá' },
  ],
};

function buildPrompt(msgs) {
  const lines = msgs.map((m, i) => `[${i}] ${m.name}: ${m.text}`).join('\n');
  return [
    `Analise as seguintes mensagens do grupo (${msgs.length} msgs, IDs entre colchetes).`,
    'Leia o trecho como conversa contínua (contexto importa — quem responde a quem).',
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
    'Sem lore prévia.',
    '',
    'Exemplo de shape:',
    '{"facts":[{"kind":"epic_fail","summary":"João bateu o carro no poste","subjects":[0],"keywords":["carro","poste"],"score":72}]}',
  ].join('\n');
}

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

function categorize(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'empty';
  // tenta parse
  try {
    const p = JSON.parse(s);
    const facts = Array.isArray(p) ? p : Array.isArray(p.facts) ? p.facts : [];
    if (facts.length === 0) return 'empty-facts';
    // checa subjects
    const malformed = facts.filter((f) => !Array.isArray(f.subjects) || f.subjects.length === 0);
    if (malformed.length === facts.length) return 'malformed-all-empty-subjects';
    if (malformed.length > 0) return 'partial-malformed';
    return 'valid';
  } catch (e) {
    // ver se tem subjects":,
    if (/subjects"\s*:/.test(s) && /subjects"\s*:\s*,/.test(s)) return 'malformed-trailing-comma';
    return 'invalid-json';
  }
}

function summarize(text) {
  // primeiro campo summary
  const m = text.match(/"summary"\s*:\s*"([^"]{0,120})/);
  if (m) return m[1];
  return text.slice(0, 100);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : null;
  };
  const scenario = get('scenario') || 'bug';
  const n = Number(get('n') || 5);
  const model = get('model') || 'zen';
  const caller = model === 'zen' ? callZen : callOllama;
  const msgs = SCENARIOS[scenario];
  if (!msgs) { console.log('Cenário não existe'); return; }
  const prompt = buildPrompt(msgs);
  const counter = {};
  for (let i = 0; i < n; i++) {
    const raw = await caller(EXTRACT_SYSTEM_V1, prompt);
    const cat = categorize(raw);
    counter[cat] = (counter[cat] || 0) + 1;
    console.log(`\n--- run ${i + 1} [${cat}] ---`);
    console.log('RAW:', raw.slice(0, 400));
    if (cat !== 'empty') console.log('SUMM:', summarize(raw));
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log('\n========== RESUMO ==========');
  for (const [k, v] of Object.entries(counter)) {
    console.log(`  ${k}: ${v}/${n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
