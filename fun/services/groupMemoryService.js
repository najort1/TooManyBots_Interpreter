/**
 * Memória seletiva por grupo — buffer → extract LLM (IDs de batch) → fatos com JID.
 * Zero confusão de pessoas: subjects só via índices [0],[1] mapeados para JID.
 * Injeção seletiva com <group_lore> (não RAG genérico).
 */

import { openaiChatComplete } from '../llm/openaiClient.js';
import { ollamaGenerate } from '../llm/ollamaClient.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { recordLlmHit } from '../llm/llmMetrics.js';

const VALID_KINDS = new Set([
  'running_gag',
  'rivalry',
  'catchphrase',
  'epic_fail',
  'ship_lore',
  'nickname',
  'event',
]);

const EXTRACT_SYSTEM = `Você extrai FATOS engraçados ou úteis de um trecho de chat de WhatsApp BR (grupo de amigos).

REGRAS OBRIGATÓRIAS:
1. Responda SOMENTE com JSON válido (objeto ou array). Sem markdown, sem texto fora do JSON.
2. Formato preferido: {"facts":[...]} ou array [...]. Cada fato:
   {"kind":"running_gag|rivalry|catchphrase|epic_fail|ship_lore|nickname|event","summary":"1 frase ≤150 chars","subjects":[0],"keywords":["kw1"],"score":35-95}
3. "subjects" DEVE ser array de IDs NUMÉRICOS do batch (ex: 0, 1, 2). NUNCA nomes, NUNCA strings de pessoa. subjects SEMPRE como array, mesmo que com 1 elemento: [4], NUNCA 4, nunca vazio se houver autor claro.
4. O ID em subjects é o índice da mensagem [N] que contém o CONTEÚDO do fato (a fala engraçada/útil). Não confunda o autor do conteúdo com quem é o assunto da mensagem.
5. Só salve engraçado, mico, rivalidade, bordão, apelido, lore social. Se nada valer: {"facts":[]}
6. NÃO invente o que não está no trecho. NÃO salve: bom dia, ok, comando de bot, links, spam, dados sensíveis.
7. summary em pt-BR, como alguém contaria no grupo depois (tom de zap), sem aspas externas.
8. THREADS DISTINTOS: o batch pode misturar threads de conversa diferentes. Marcadores "--- [GAP: Xm] ---" entre mensagens mostram onde acabou um assunto e começou outro (gap >= 15min). Mensagens separadas por um GAP são de assuntos DIFERENTES — NÃO conecte uma resposta ao thread errado só porque está fisicamente perto. Se não dá pra saber com certeza a qual thread uma fala se refere, descarte o fato ({"facts":[]}).
9. Em caso de dúvida, prefira descartar a inventar conexão entre threads.
Só o JSON.`;

const PERSONA_SYSTEM = `Resuma o clima de um grupo WhatsApp BR em 3 a 5 bullets curtos de lore cômica, com base nos fatos dados.
Cada bullet: observação específica (você inventa o ângulo), tom de quem vive o chat.
pt-BR, sem inventar nomes que não estejam nos fatos. Máx 450 caracteres. Sem markdown pesado. Só o texto.`;

const PERSONA_CACHE_TTL_MS = 30 * 60_000;

function numOr(v, fb) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(text) {
  return new Set(
    normalizeKey(text)
      .split(' ')
      .filter((t) => t.length >= 3)
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/** Hash barato: top-3 tokens/keywords ordenados. */
function keywordSignature(keywords = [], summary = '') {
  const fromKw = (keywords || []).map(normalizeKey).filter((t) => t.length >= 3);
  const fromSum = [...tokenSet(summary)];
  const toks = [...new Set([...fromKw, ...fromSum])].sort();
  return toks.slice(0, 3).join('|');
}

function looksSensitive(text) {
  const t = String(text || '');
  if (/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b/.test(t)) return true;
  if (/\b\d{10,13}\b/.test(t) && /(zap|whats|telefone|celular|pix)/i.test(t)) return true;
  if (/(senha|password|token|api[_-]?key)\s*[:=]/i.test(t)) return true;
  return false;
}

function isCommandLike(text, prefix = '/') {
  const t = String(text || '').trim();
  return t.startsWith(String(prefix || '/'));
}

/**
 * Extrai índice de subject da LLM: 0, "0", "[0]", "[1]".
 * Retorna null se for nome ou inválido.
 */
function parseSubjectIndex(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^\[?\s*(\d+)\s*\]?$/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * Extrai nome próprio (primeira palavra) do `name` de uma mensagem.
 * Usado pra inferir subject do summary.
 */
function nameFirstToken(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  // ignora emojis/símbolos do começo (natasha🕷️, ⚡Lucas, etc)
  const cleaned = raw.replace(/^[\W_]+/u, '').trim();
  const first = cleaned.split(/\s+/)[0] || cleaned;
  return normalizeKey(first); // lower + sem acento pra comparar
}

/**
 * Tenta inferir subjectIndices a partir do summary quando a LLM mandou vazio.
 * Estratégia (em ordem):
 *   1) nome que aparece MAIS vezes no summary (>=2 ocorrências) → forte sinal
 *   2) nome que aparece no INÍCIO do summary (primeiros 30 chars) → "X fez/disse/..."
 *   3) nome que aparece em qualquer posição do summary
 * batchEntry: { name, text, userJid, at }.
 * Retorna { indices: number[], inferred: boolean, source: 'summary-name' } ou null.
 */
function inferSubjectIndicesFromSummary(summary, batch) {
  if (!Array.isArray(batch) || !batch.length) return null;
  const sumNorm = normalizeKey(summary || '');
  if (!sumNorm || sumNorm.length < 8) return null;

  // conta ocorrências de cada nome (primeiro token) no summary
  // e também checa se o nome está no início do summary
  const candidates = []; // { idx, name, count, isAtStart, token }
  for (let i = 0; i < batch.length; i++) {
    const tok = nameFirstToken(batch[i]?.name);
    if (!tok || tok.length < 3) continue; // nomes curtos ("eu", "de") dão muito falso-positivo
    // conta ocorrências inteiras (palavra completa, case-insensitive)
    const reWord = new RegExp(`\\b${escapeRegex(tok)}\\b`, 'g');
    const matches = sumNorm.match(reWord);
    const count = matches ? matches.length : 0;
    if (count === 0) continue;
    const isAtStart = sumNorm.startsWith(tok + ' ') || sumNorm.startsWith(tok + ',');
    candidates.push({ idx: i, name: batch[i].name, token: tok, count, isAtStart });
  }
  if (!candidates.length) return null;

  // ranking: nome no início ganha +100, depois por count, depois por idx
  candidates.sort((a, b) => {
    if (a.isAtStart !== b.isAtStart) return a.isAtStart ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.idx - b.idx;
  });
  const best = candidates[0];
  // se há empate entre o melhor e o segundo, e nenhum tem count>=2 ou isAtStart, descarta (ambíguo)
  if (candidates.length >= 2) {
    const second = candidates[1];
    const bestStrong = best.isAtStart || best.count >= 2;
    const secondStrong = second.isAtStart || second.count >= 2;
    // se o segundo é quase tão bom quanto o primeiro e o primeiro não é claramente forte → ambíguo
    if (!bestStrong && (secondStrong || second.count === best.count)) {
      return null;
    }
  }
  return { indices: [best.idx], inferred: true, source: 'summary-name' };
}

/**
 * Escapa caracteres especiais de regex para uso em string dinâmica.
 */
function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Valida fato bruto pós-parse (antes do map de JID).
 * subjects ainda podem ser índices numéricos.
 * Se batch for passado e LLM não mandou subjects válidos, tenta inferir do summary.
 */
export function validateExtractedFact(fact, { batchSize = 0, summaryMax = 160, batch = null } = {}) {
  if (!fact || typeof fact !== 'object') return null;
  const kind = String(fact.kind || 'event')
    .trim()
    .toLowerCase();
  if (!VALID_KINDS.has(kind)) return null;

  let summary = String(fact.summary || '')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '');
  if (summary.length < 12) return null;
  if (looksSensitive(summary)) return null;
  summary = summary.slice(0, Math.max(80, Math.min(200, summaryMax)));

  const rawSubjects = Array.isArray(fact.subjects) ? fact.subjects : [];
  const indices = [];
  for (const s of rawSubjects) {
    const idx = parseSubjectIndex(s);
    if (idx == null) continue; // nome solto → ignora (não aceita)
    if (batchSize > 0 && idx >= batchSize) continue;
    if (!indices.includes(idx)) indices.push(idx);
  }
  let subjectInferred = false;
  // zero alucinação de autoria: sem subject ID válido → tenta inferir do summary
  if (!indices.length) {
    if (Array.isArray(batch) && batch.length) {
      const inferred = inferSubjectIndicesFromSummary(summary, batch);
      if (inferred && inferred.indices.length) {
        for (const i of inferred.indices) {
          if (batchSize > 0 && i >= batchSize) continue;
          if (!indices.includes(i)) indices.push(i);
        }
        subjectInferred = !!inferred.source;
      }
    }
    if (!indices.length) return null;
  }

  const keywords = Array.isArray(fact.keywords)
    ? fact.keywords
        .map((k) => String(k || '').trim().toLowerCase())
        .filter((k) => k.length >= 2)
        .slice(0, 10)
    : [];

  const score = Math.max(0, Math.min(100, Math.round(Number(fact.score) || 50)));

  return {
    kind,
    summary,
    subjectIndices: indices.slice(0, 6),
    keywords,
    score,
    signature: keywordSignature(keywords, summary),
    subjectInferred,
  };
}

/**
 * Extrai fatos via regex de JSON malformado (campos "naive": kind, summary, subjects, keywords, score).
 * Tolera: subjects":, (vazio malformado), vírgulas trailing, aspas mal escapadas, content com } dentro, etc.
 * Retorna array de objetos parciais (campos podem ser null).
 */
function looseParseFacts(text) {
  const out = [];
  // 1) encontra cada bloco "{" ... "}" no nível do array externo (heurística simples: split por '},{')
  //    mas tolerante: cada occurrence de `{"kind"` ou `{` no começo de um item.
  // Estratégia: achar cada objeto via match não-ganancioso de {kind":...summary":..."}
  const cleaned = String(text || '');
  // tenta primeiro: split por "},{" — heurística comum quando LLM lista vários facts
  // depois pra cada parte, extrair os campos.
  const reObject = /\{[^{}]*?"kind"\s*:\s*"([^"]+)"[^{}]*?"summary"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*?\}/g;
  let m;
  while ((m = reObject.exec(cleaned)) != null) {
    const obj = m[0];
    const kind = m[1];
    const summaryRaw = m[2];
    // desescapar \" \\ \n etc
    const summary = summaryRaw
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim();
    // subjects: pode ser [0,1], [], ou ausente/"subjects":, — varredura tolerante
    let subjects = [];
    const subMatch = obj.match(/"subjects"\s*:\s*(\[[^\]]*\])/);
    if (subMatch) {
      const inner = subMatch[1].slice(1, -1).trim();
      if (inner) {
        subjects = inner
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x.length)
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n >= 0);
      }
    }
    // keywords
    let keywords = [];
    const kwMatch = obj.match(/"keywords"\s*:\s*\[([^\]]*)\]/);
    if (kwMatch) {
      const inner = kwMatch[1].trim();
      if (inner) {
        keywords = inner
          .split(',')
          .map((x) => x.trim().replace(/^["']+|["']+$/g, ''))
          .filter((x) => x.length);
      }
    }
    // score
    let score = 50;
    const scMatch = obj.match(/"score"\s*:\s*(-?\d+(?:\.\d+)?)/);
    if (scMatch) score = Number(scMatch[1]);
    out.push({ kind, summary, subjects, keywords, score });
  }
  return out;
}

/**
 * Parse JSON de extract — aceita array, {facts:[]}, {items:[]}, ou objeto único.
 * Resiliente: se JSON.parse falha E o bloco {...} tem sintaxe quebrada (e.g. "subjects":,)
 * ainda extrai via regex para NÃO perder fato de modelo que manda JSON inválido.
 */
export function parseFactsJson(raw, { batchSize = 0, summaryMax = 160, batch = null } = {}) {
  const text = String(raw || '').trim();
  if (!text) return [];

  let parsed = null;
  let loose = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // tenta extrair bloco JSON embutido
    const arr = text.match(/\[[\s\S]*\]/);
    const obj = text.match(/\{[\s\S]*\}/);
    const candidate = arr?.[0] || obj?.[0];
    if (candidate) {
      try {
        parsed = JSON.parse(candidate);
      } catch {
        // JSON sintaticamente inválido (ex.: glm_5_2 manda "subjects":, sem valor).
        // Tenta extração por regex para não perder o fato.
        loose = looseParseFacts(text);
        if (!loose.length) return [];
      }
    }
  }

  let list = [];
  if (loose) {
    list = loose;
  } else if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.facts)) list = parsed.facts;
    else if (Array.isArray(parsed.items)) list = parsed.items;
    else if (Array.isArray(parsed.data)) list = parsed.data;
    else if (parsed.summary || parsed.kind) list = [parsed];
  }

  return list
    .map((x) => validateExtractedFact(x, { batchSize, summaryMax, batch }))
    .filter(Boolean)
    .slice(0, 2);
}

export function createGroupMemoryService({
  memoryRepository,
  getContactDisplayName = null,
  random = Math.random,
  getLogger = () => null,
  generateZen = openaiChatComplete,
  generateOllama = ollamaGenerate,
  getNewsService = null,
} = {}) {
  if (!memoryRepository) throw new Error('[fun/groupMemoryService] memoryRepository required');

  /** @type {Map<string, { msgs: object[], lastFlushAt: number, flushing: boolean }>} */
  const buffers = new Map();
  /** @type {Map<string, { text: string, factCount: number, at: number }>} */
  const personaCache = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.memoryEnabled !== false,
      maxFacts: Math.max(10, Math.min(120, Math.floor(numOr(funConfig.memoryMaxFacts, 50)))),
      summaryMax: Math.max(80, Math.min(200, Math.floor(numOr(funConfig.memorySummaryMaxChars, 160)))),
      personaMax: Math.max(200, Math.min(800, Math.floor(numOr(funConfig.memoryPersonaMaxChars, 500)))),
      // modelo grande: default ~100 msgs; clamp alto pra caber no orçamento de chars
      bufferSize: Math.max(8, Math.min(200, Math.floor(numOr(funConfig.memoryBufferSize, 100)))),
      flushMin: Math.max(3, Math.min(120, Math.floor(numOr(funConfig.memoryFlushMinMessages, 40)))),
      flushMs: Math.max(60_000, Math.floor(numOr(funConfig.memoryFlushIntervalMs, 10 * 60_000))),
      minChars: Math.max(6, Math.floor(numOr(funConfig.memoryMinMsgChars, 12))),
      extractTimeout: Math.max(5_000, Math.floor(numOr(funConfig.memoryExtractTimeoutMs, 45_000))),
      ttlDays: Math.max(7, Math.floor(numOr(funConfig.memoryTtlDays, 45))),
      minScore: Math.max(0, Math.min(80, Math.floor(numOr(funConfig.memoryMinScore, 35)))),
      extractMaxChars: Math.max(
        4_000,
        Math.min(40_000, Math.floor(numOr(funConfig.memoryExtractMaxChars, 36_000)))
      ),
      knownFactsInPrompt: Math.max(
        4,
        Math.min(40, Math.floor(numOr(funConfig.memoryKnownFactsInPrompt, 24)))
      ),
      msgMaxChars: Math.max(80, Math.min(800, Math.floor(numOr(funConfig.memoryMsgMaxChars, 400)))),
      prefix: funConfig.prefix || '/',
    };
  }

  function getBuf(scopeKey) {
    const k = String(scopeKey || '');
    if (!buffers.has(k)) {
      buffers.set(k, { msgs: [], lastFlushAt: 0, flushing: false });
    }
    return buffers.get(k);
  }

  function displayOf(jid) {
    if (typeof getContactDisplayName === 'function') {
      const n = getContactDisplayName(jid);
      if (n) return String(n);
    }
    return String(jid || '').split('@')[0] || '?';
  }

  function firstName(jidOrName) {
    const raw = String(jidOrName || '').trim();
    if (!raw) return '?';
    if (raw.includes('@')) {
      const dn = displayOf(raw);
      return dn.split(/\s+/)[0] || dn || '?';
    }
    return raw.split(/\s+/)[0] || raw;
  }

  function invalidatePersonaCache(scopeKey) {
    personaCache.delete(String(scopeKey || ''));
  }

  function getPersonaCached(scopeKey) {
    const k = String(scopeKey || '');
    const hit = personaCache.get(k);
    if (hit && Date.now() - hit.at < PERSONA_CACHE_TTL_MS) {
      return {
        scopeKey: k,
        personaText: hit.text,
        factCount: hit.factCount,
        updatedAt: hit.at,
        fromCache: true,
      };
    }
    const row = memoryRepository.getPersona(scopeKey);
    personaCache.set(k, {
      text: row.personaText || '',
      factCount: row.factCount || 0,
      at: Date.now(),
    });
    return { ...row, fromCache: false };
  }

  /**
   * Observa mensagem do grupo (fire-and-forget safe).
   */
  function observeMessage({
    scopeKey,
    userJid,
    text,
    messageType = 'text',
    funConfig = {},
    now = Date.now(),
    isGroup = true,
  }) {
    const o = opts(funConfig);
    if (!o.enabled || !isGroup || !scopeKey?.endsWith?.('@g.us')) {
      return { observed: false, reason: 'skip' };
    }
    const body = String(text || '').trim();
    if (!body) return { observed: false, reason: 'short' };
    if (isCommandLike(body, o.prefix)) return { observed: false, reason: 'command' };
    if (body.length < o.minChars) return { observed: false, reason: 'short' };
    if (looksSensitive(body)) return { observed: false, reason: 'sensitive' };
    if (!body && messageType && messageType !== 'text') {
      return { observed: false, reason: 'media-empty' };
    }

    const buf = getBuf(scopeKey);
    buf.msgs.push({
      userJid: String(userJid || ''),
      name: displayOf(userJid),
      text: body.slice(0, o.msgMaxChars),
      at: Number(now) || Date.now(),
    });
    if (buf.msgs.length > o.bufferSize) {
      buf.msgs = buf.msgs.slice(-o.bufferSize);
    }

    const dueByCount = buf.msgs.length >= o.flushMin;
    const dueByTime = buf.lastFlushAt > 0 && now - buf.lastFlushAt >= o.flushMs;
    const firstFill = buf.lastFlushAt === 0 && buf.msgs.length >= o.flushMin;

    if ((dueByCount || dueByTime || firstFill) && !buf.flushing) {
      void flushScope(scopeKey, funConfig, now).catch((err) => {
        getLogger?.()?.debug?.(
          { err: { message: err?.message || 'memory-flush' } },
          'Fun memory flush failed'
        );
      });
      return { observed: true, flushScheduled: true };
    }
    return { observed: true, flushScheduled: false };
  }

  async function flushScope(scopeKey, funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };
    const buf = getBuf(scopeKey);
    if (buf.flushing) return { ok: false, reason: 'busy' };
    if (buf.msgs.length < 3) return { ok: false, reason: 'too-few' };

    buf.flushing = true;
    // empacota o máximo de mensagens que couber no orçamento (~40k), priorizando as recentes
    const batch = packBatchForExtract(buf.msgs.slice(-o.bufferSize), o);
    buf.msgs = [];
    buf.lastFlushAt = now;

    try {
      const existing = memoryRepository.listFacts(scopeKey, {
        limit: o.maxFacts,
        minScore: 0,
      });
      const extracted = await extractFacts(batch, existing, funConfig, o);
      let inserted = 0;
      let reinforced = 0;

      for (const fact of extracted.slice(0, 2)) {
        if (fact.score < o.minScore) continue;
        if (!fact.subjects?.length) continue;

        const hit = findSimilar(existing, fact);
        if (hit) {
          memoryRepository.reinforceFact(hit.id, {
            summary: fact.summary.slice(0, o.summaryMax),
            score: fact.score,
            keywords: fact.keywords,
            overwriteSummary: true,
            now,
          });
          reinforced += 1;
          const idx = existing.findIndex((e) => e.id === hit.id);
          if (idx >= 0) {
            existing[idx] = {
              ...existing[idx],
              summary: fact.summary.slice(0, o.summaryMax),
              score: Math.max(existing[idx].score, fact.score),
              keywords: [
                ...new Set([...(existing[idx].keywords || []), ...(fact.keywords || [])]),
              ].slice(0, 12),
              hits: (existing[idx].hits || 1) + 1,
              lastSeenAt: now,
            };
          }
        } else {
          const rec = memoryRepository.insertFact({
            scopeKey,
            kind: fact.kind,
            summary: fact.summary.slice(0, o.summaryMax),
            subjects: fact.subjects,
            keywords: fact.keywords,
            score: fact.score,
            source: 'chat',
            now,
          });
          if (rec) {
            existing.push(rec);
            inserted += 1;
          }
        }
      }

      // Loga quotes notáveis no fun_daily_events para o jornal
      const ns = typeof getNewsService === 'function' ? getNewsService() : null;
      if (ns && typeof ns.log === 'function') {
        for (const fact of extracted) {
          if (!['catchphrase', 'running_gag', 'epic_fail'].includes(fact.kind)) continue;
          if (fact.score < Math.max(o.minScore, 50)) continue;
          const jid = fact.subjects?.[0];
          if (!jid) continue;
          ns.log(scopeKey, 'notable_quote', {
            userJid: jid,
            payload: {
              quote: fact.summary.slice(0, 200),
              kind: fact.kind,
            },
            now,
          });
        }
      }

      memoryRepository.decayAndPurge(scopeKey, {
        ttlDays: o.ttlDays,
        minScore: o.minScore,
        now,
      });
      memoryRepository.pruneToCap(scopeKey, o.maxFacts);

      if (inserted + reinforced > 0 || random() < 0.35) {
        await refreshPersona(scopeKey, funConfig, o);
      }

      return { ok: true, inserted, reinforced, batchSize: batch.length };
    } finally {
      // lock rigoroso: nunca deixa flushing preso após erro LLM
      buf.flushing = false;
    }
  }

  /**
   * Mapeia subjectIndices → JIDs reais do batch. Descarta se nenhum JID válido.
   */
  function mapSubjectsToJids(batch, subjectIndices) {
    const jids = [];
    for (const idx of subjectIndices || []) {
      const m = batch[idx];
      if (!m?.userJid) continue;
      const jid = String(m.userJid);
      if (!jids.includes(jid)) jids.push(jid);
    }
    return jids.slice(0, 6);
  }

  function findSimilar(existing, fact) {
    const fSig = fact.signature || keywordSignature(fact.keywords, fact.summary);
    const fTokens = tokenSet(fact.summary);
    const fKw = new Set((fact.keywords || []).map(normalizeKey).filter(Boolean));
    const fSubjects = new Set((fact.subjects || []).map(String));

    // 1) assinatura barata (top-3 tokens)
    if (fSig) {
      for (const e of existing) {
        const eSig = keywordSignature(e.keywords, e.summary);
        if (eSig && eSig === fSig) return e;
      }
    }

    let best = null;
    let bestScore = 0;
    for (const e of existing) {
      const eTokens = tokenSet(e.summary);
      const sim = jaccard(fTokens, eTokens);
      const kwSim = jaccard(fKw, new Set((e.keywords || []).map(normalizeKey)));
      let s = Math.max(sim, kwSim * 0.9);

      // mesma kind + subjects sobrepostos → limiar mais baixo (overwrite)
      const sameKind = e.kind === fact.kind;
      const subjOverlap = (e.subjects || []).some((x) => fSubjects.has(String(x)));
      if (sameKind && subjOverlap) {
        s = Math.max(s, sim + 0.08);
        if (sim >= 0.3) s = Math.max(s, 0.45);
      }

      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    if (bestScore >= 0.42) return best;

    const n = normalizeKey(fact.summary);
    for (const e of existing) {
      const en = normalizeKey(e.summary);
      if (n && en && (n.includes(en) || en.includes(n)) && Math.min(n.length, en.length) >= 20) {
        return e;
      }
    }
    return null;
  }

  /**
   * Formata HH:MM (ou HH:MM:SS se houver segundo) de um timestamp ms.
   */
  function formatHm(at) {
    if (!at || !Number.isFinite(Number(at))) return '';
    const d = new Date(Number(at));
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /**
   * Formata gap em ms como string curta: "12m", "1h", "2h15m".
   */
  function formatGap(gapMs) {
    if (!Number.isFinite(gapMs) || gapMs < 0) return '';
    const min = Math.round(gapMs / 60_000);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h${m}m` : `${h}h`;
  }

  /**
   * Separa o batch em "blocos" de conversa contínua, com base em gap temporal.
   * Default: gap >= 15min quebra o thread. Mensagens sem `at` ficam no bloco atual.
   */
  function splitBatchByGap(batch, gapMs = 15 * 60_000) {
    const blocks = [];
    let current = [];
    let prevAt = null;
    for (const m of batch) {
      const at = Number(m?.at) || 0;
      if (current.length && prevAt && at && at - prevAt >= gapMs) {
        blocks.push(current);
        current = [];
      }
      current.push(m);
      if (at) prevAt = at;
    }
    if (current.length) blocks.push(current);
    return blocks;
  }

  /**
   * Render do batch com timestamp relativo e separadores de GAP explícitos.
   * Cada linha: "[HH:MM] [N] Nome: texto" (sem HH:MM se msg não tem at).
   * Entre blocos com gap >= 15min: insere linha "--- [GAP: 1h] ---".
   * batch é reindexado 0..n-1 pra map de subjects.
   */
  function formatBatchLinesWithContext(batch) {
    const lines = [];
    let prevAt = null;
    for (let i = 0; i < batch.length; i += 1) {
      const m = batch[i];
      const at = Number(m?.at) || 0;
      if (at && prevAt && at - prevAt >= 15 * 60_000) {
        lines.push(`--- [GAP: ${formatGap(at - prevAt)}] ---`);
      }
      const name = String(m.name || firstName(m.userJid) || '?').slice(0, 40);
      const text = String(m.text || '').slice(0, 800);
      const ts = formatHm(at);
      const head = ts ? `[${ts}] [${i}] ${name}` : `[${i}] ${name}`;
      lines.push(`${head}: ${text}`);
      if (at) prevAt = at;
    }
    return lines.join('\n');
  }

  /**
   * Versão legada (sem timestamp/gap). Mantida exportada pra retro-compat.
   * Novas chamadas devem usar formatBatchLinesWithContext.
   */
  function formatBatchLines(batch) {
    return batch
      .map((m, i) => {
        const name = String(m.name || firstName(m.userJid) || '?').slice(0, 40);
        const text = String(m.text || '').slice(0, 800);
        return `[${i}] ${name}: ${text}`;
      })
      .join('\n');
  }

  /**
   * Monta o maior trecho possível de conversa sob o teto de chars.
   * Descarta as mais antigas se estourar; reindexa 0..n-1 pro map de subjects.
   */
  function packBatchForExtract(msgs, o) {
    const msgMax = o.msgMaxChars || 400;
    const budget = o.extractMaxChars || 36_000;
    const prepared = (msgs || []).map((m) => ({
      userJid: m.userJid,
      name: m.name,
      text: String(m.text || '').slice(0, msgMax),
      at: m.at,
    }));
    if (!prepared.length) return [];

    // tenta o lote inteiro; se passar do teto, remove do início (mais antigas)
    let selected = prepared;
    const lineCost = (m, i) => {
      const name = String(m.name || firstName(m.userJid) || '?').slice(0, 40);
      return `[${i}] ${name}: ${m.text}`.length + 1;
    };
    const totalCost = (arr) => arr.reduce((sum, m, i) => sum + lineCost(m, i), 0);

    while (selected.length > 12 && totalCost(selected) > budget) {
      selected = selected.slice(1);
    }
    // se ainda estoura com ≤12, trunca texto da mais antiga
    while (selected.length > 3 && totalCost(selected) > budget) {
      const head = { ...selected[0], text: String(selected[0].text || '').slice(0, 120) };
      if (head.text.length >= String(selected[0].text || '').length) {
        selected = selected.slice(1);
      } else {
        selected = [head, ...selected.slice(1)];
        if (totalCost(selected) > budget) selected = selected.slice(1);
      }
    }
    return selected;
  }

  async function extractFacts(batch, existing, funConfig, o) {
    // usa versão com timestamps + marcadores de GAP para a LLM detectar thread-breaks
    const lines = formatBatchLinesWithContext(batch);
    const knownLimit = o.knownFactsInPrompt || 24;
    const known = existing
      .slice(0, knownLimit)
      .map((f) => {
        const who = (f.subjects || [])
          .map((s) => firstName(s))
          .filter(Boolean)
          .slice(0, 3)
          .join(', ');
        return `- [${f.kind}] (${who || '?'}) ${f.summary}`;
      })
      .join('\n');

    // header dinâmico: se o batch tem pelo menos um GAP, lembra a LLM da regra de não cruzar threads
    const hasGap = /---\s*\[GAP:/i.test(lines);
    const continuidadeLine = hasGap
      ? 'O batch contém MÚLTIPLOS threads separados por marcadores "--- [GAP: Xm] ---". Mensagens em threads diferentes são de assuntos DIFERENTES. NÃO conecte uma resposta ao thread errado só porque está fisicamente perto.'
      : 'Leia o trecho como conversa contínua (contexto importa — quem responde a quem).';

    const prompt = [
      `Analise as seguintes mensagens do grupo (${batch.length} msgs, IDs entre colchetes).`,
      continuidadeLine,
      lines,
      '',
      'Regras:',
      '1. Extraia apenas fatos engraçados ou úteis (0 a 2).',
      '2. Em subjects use OBRIGATORIAMENTE os IDs numéricos das mensagens (ex: 0, 2). Nunca nomes. SEMPRE como array: [4] — nunca 4, nunca [] quando há autor claro.',
      '3. subjects = índice da mensagem que contém o CONTEÚDO do fato (a fala engraçada/útil), não o índice de quem é o assunto da mensagem.',
      '4. NÃO invente. Se não souber o sujeito com ID claro, não extraia o fato.',
      '5. Use o contexto das mensagens vizinhas pra entender o fato, MAS não conecte mensagens separadas por [GAP: ...].',
      '6. Retorne JSON: {"facts":[...]}',
      '',
      known
        ? `Já sabemos (NÃO repita; se for o MESMO fato, a gente reforça no backend):\n${known}`
        : 'Sem lore prévia.',
      '',
      'Exemplo de shape:',
      '{"facts":[{"kind":"epic_fail","summary":"João bateu o carro no poste","subjects":[0],"keywords":["carro","poste"],"score":72}]}',
    ].join('\n');

    if (process.env.FUN_DISABLE_LIVE_LLM === '1') {
      return [];
    }

    const mapParsed = (raw) => {
      const validated = parseFactsJson(raw, {
        batchSize: batch.length,
        summaryMax: o.summaryMax,
        batch, // passado pra inferência de subject quando LLM mandou vazio
      });
      const out = [];
      for (const f of validated) {
        const jids = mapSubjectsToJids(batch, f.subjectIndices);
        if (!jids.length) continue; // sem JID = descarta (anti-alucinação de autoria)
        out.push({
          kind: f.kind,
          summary: f.summary,
          subjects: jids,
          keywords: f.keywords,
          score: f.score,
          signature: f.signature,
          subjectInferred: f.subjectInferred === true,
        });
      }
      return out;
    };

    // Zen + jsonMode
    if (funConfig.zenEnabled !== false) {
      try {
        const task = resolveZenTaskParams('extract', funConfig);
        const raw = await generateZen({
          baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3300',
          model: funConfig.zenModel || 'glm_5_2',
          system: EXTRACT_SYSTEM,
          prompt,
          timeoutMs: Math.max(o.extractTimeout, task.timeoutMs, 45_000),
          maxTokens: Math.max(task.maxTokens, 700),
          temperature: task.temperature,
          apiKey: funConfig.zenApiKey || '',
          jsonMode: true,
          jsonOnly: true,
          sendSamplingParams: funConfig.zenSendSamplingParams === true,
        });
        const mapped = mapParsed(raw);
        if (mapped.length) {
          recordLlmHit('memory', 'zen', { n: mapped.length });
          return mapped;
        }
      } catch (err) {
        getLogger?.()?.warn?.(
          { err: { message: err?.message || 'zen-memory' } },
          'Fun memory Zen extract fail'
        );
      }
    }

    // Ollama + format json
    if (funConfig.ollamaEnabled !== false) {
      try {
        const raw = await generateOllama({
          baseUrl: funConfig.ollamaBaseUrl || 'http://127.0.0.1:11434',
          model: funConfig.ollamaModel || 'gemma4:latest',
          system: EXTRACT_SYSTEM,
          prompt,
          timeoutMs: Math.max(o.extractTimeout, 20_000),
          keepAlive: funConfig.ollamaKeepAlive ?? -1,
          think: false,
          numPredict: 400,
          temperature: 0.45,
          format: 'json',
        });
        return mapParsed(raw);
      } catch (err) {
        getLogger?.()?.warn?.(
          { err: { message: err?.message || 'ollama-memory' } },
          'Fun memory Ollama extract fail'
        );
      }
    }

    return [];
  }

  async function refreshPersona(scopeKey, funConfig = {}, o = opts(funConfig)) {
    const facts = memoryRepository.listFacts(scopeKey, {
      limit: 15,
      minScore: o.minScore,
    });
    if (!facts.length) {
      memoryRepository.setPersona(scopeKey, '', 0);
      invalidatePersonaCache(scopeKey);
      return { ok: true, empty: true };
    }

    const list = facts
      .map((f) => {
        const who = (f.subjects || []).map((s) => firstName(s)).join(', ');
        return `• (${f.kind}, ${f.score}, ${who || '?'}) ${f.summary}`;
      })
      .join('\n');
    let text = '';

    if (process.env.FUN_DISABLE_LIVE_LLM !== '1' && funConfig.zenEnabled !== false) {
      try {
        const task = resolveZenTaskParams('persona', funConfig);
        text = await generateZen({
          baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3300',
          model: funConfig.zenModel || 'glm_5_2',
          system: PERSONA_SYSTEM,
          prompt: `Fatos do grupo:\n${list}\n\nResuma o clima em 3–5 bullets (≤${o.personaMax} chars). NÃO invente fatos novos. Só os bullets:`,
          timeoutMs: Math.max(o.extractTimeout, task.timeoutMs),
          maxTokens: task.maxTokens,
          temperature: task.temperature,
          apiKey: funConfig.zenApiKey || '',
          sendSamplingParams: funConfig.zenSendSamplingParams === true,
        });
        if (text) recordLlmHit('persona', 'zen', {});
      } catch {
        text = '';
      }
    }

    if (!text && process.env.FUN_DISABLE_LIVE_LLM !== '1' && funConfig.ollamaEnabled !== false) {
      try {
        text = await generateOllama({
          baseUrl: funConfig.ollamaBaseUrl || 'http://127.0.0.1:11434',
          model: funConfig.ollamaModel || 'gemma4:latest',
          system: PERSONA_SYSTEM,
          prompt: `Fatos do grupo:\n${list}\n\nResuma o clima:`,
          timeoutMs: o.extractTimeout,
          keepAlive: funConfig.ollamaKeepAlive ?? -1,
          think: false,
          numPredict: 220,
          temperature: 0.7,
        });
      } catch {
        text = '';
      }
    }

    if (!text) {
      text = facts
        .slice(0, 5)
        .map((f) => `• ${f.summary}`)
        .join('\n')
        .slice(0, o.personaMax);
    } else {
      text = String(text).trim().slice(0, o.personaMax);
    }

    memoryRepository.setPersona(scopeKey, text, facts.length);
    personaCache.set(String(scopeKey || ''), {
      text,
      factCount: facts.length,
      at: Date.now(),
    });
    return { ok: true, text };
  }

  /**
   * Bloco estruturado <group_lore> pra injetar em prompts de flavor/caos.
   * Regras anti-alucinação + autor por primeiro nome (não JID cru).
   */
  function buildLoreContext(scopeKey, { userJids = [], limit = 8, funConfig = {} } = {}) {
    const o = opts(funConfig);
    if (!o.enabled || !scopeKey) return '';

    const persona = getPersonaCached(scopeKey);
    // Probe live: 4–8 fatos ranqueados > dump 24 (menos latência, mais hit de lore).
    const cap = Math.max(4, Math.min(12, Number(limit) || 8));
    const fetchLimit = Math.max(12, Math.min(24, cap * 2));
    const facts = memoryRepository.listFacts(scopeKey, {
      limit: fetchLimit,
      minScore: Math.max(0, o.minScore - 10),
    });
    if (!facts.length && !persona.personaText) return '';

    const want = new Set((userJids || []).map(String).filter(Boolean));
    const scored = facts
      .map((f) => {
        let boost = 0;
        if (want.size) {
          for (const s of f.subjects) {
            if (want.has(s)) boost += 25;
          }
        }
        return { f, rank: f.score + boost + Math.min(20, f.hits) };
      })
      .sort((a, b) => b.rank - a.rank);

    const top = scored.slice(0, cap).map((x) => x.f);
    const lines = [
      '<group_lore>',
      'Regras de uso da Lore:',
      '- Estes são fatos passados do grupo. Use-os APENAS se a mensagem atual tiver relação direta.',
      '- É PROIBIDO conectar um fato novo a uma lore antiga se a relação não for óbvia.',
      '- NUNCA altere o sujeito da lore. Se a lore diz que [Nome] fez X, não atribua a outra pessoa.',
      '- Se não houver conexão clara, IGNORE a lore por completo.',
      '- NÃO invente detalhes (números, medidas, causas) que não estejam no fato.',
    ];

    if (persona.personaText) {
      lines.push(
        '',
        `Clima: ${persona.personaText.replace(/\n+/g, ' · ').slice(0, 450)}`
      );
    }
    if (top.length) {
      lines.push('', 'Fatos:');
      for (const f of top) {
        const authors = (f.subjects || [])
          .map((s) => firstName(s))
          .filter(Boolean)
          .slice(0, 3);
        const who = authors.length ? authors.join(', ') : '?';
        lines.push(`- [${f.kind}] (Autor: ${who}): ${f.summary}`);
      }
    }
    lines.push('</group_lore>');
    return lines.join('\n');
  }

  function formatLoreList(scopeKey, { limit = 12, funConfig = {} } = {}) {
    const o = opts(funConfig);
    const facts = memoryRepository.listFacts(scopeKey, {
      limit,
      minScore: 0,
    });
    const persona = getPersonaCached(scopeKey);
    if (!facts.length) {
      return [
        '🧠 *Lore do grupo*',
        'Ainda não guardei micos úteis daqui.',
        '_Falo menos de “bom dia” e mais de vergonha alheia memorável._',
      ].join('\n');
    }
    const lines = ['🧠 *Lore do grupo*', ''];
    if (persona.personaText) {
      lines.push(persona.personaText, '');
    }
    for (const f of facts.slice(0, limit)) {
      const who = (f.subjects || [])
        .map((s) => firstName(s))
        .filter(Boolean)
        .slice(0, 2)
        .join(', ');
      const tag = who ? ` · ${who}` : '';
      lines.push(`• _${f.kind}_${tag} · ${f.summary} _(★${f.score} · ×${f.hits})_`);
    }
    lines.push('', `_Cap *${o.maxFacts}* · \`/esquecelore @user\` · \`/esquecelore tudo sim\``);
    return lines.join('\n');
  }

  function forgetAll(scopeKey) {
    const n = memoryRepository.deleteByScope(scopeKey);
    memoryRepository.clearPersona(scopeKey);
    buffers.delete(String(scopeKey || ''));
    invalidatePersonaCache(scopeKey);
    return n;
  }

  function forgetSubject(scopeKey, userJid) {
    const n = memoryRepository.deleteBySubject(scopeKey, userJid);
    if (n > 0) invalidatePersonaCache(scopeKey);
    return n;
  }

  async function forceFlush(scopeKey, funConfig = {}) {
    return flushScope(scopeKey, funConfig, Date.now());
  }

  function _pushRaw(scopeKey, msg) {
    const buf = getBuf(scopeKey);
    buf.msgs.push(msg);
  }

  return {
    observeMessage,
    flushScope,
    forceFlush,
    buildLoreContext,
    formatLoreList,
    forgetAll,
    forgetSubject,
    refreshPersona,
    parseFactsJson,
    validateExtractedFact,
    findSimilar,
    mapSubjectsToJids,
    packBatchForExtract,
    _pushRaw,
    _buffers: buffers,
    _personaCache: personaCache,
  };
}

export {
  parseSubjectIndex,
  normalizeKey,
  jaccard,
  tokenSet,
  keywordSignature,
  VALID_KINDS,
  // helpers expostos pra testes/probes:
  inferSubjectIndicesFromSummary,
  looseParseFacts,
};
