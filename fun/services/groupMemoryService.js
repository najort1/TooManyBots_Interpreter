/**
 * Memória seletiva por grupo — buffer → extract LLM (IDs de batch) → fatos com JID.
 * Zero confusão de pessoas: subjects só via índices [0],[1] mapeados para JID.
 * Injeção seletiva com <group_lore> (não RAG genérico).
 */

import { openaiChatComplete } from '../llm/openaiClient.js';
import { resolveZenTaskParams } from '../llm/zenTaskParams.js';
import { resolveZenEndpoint } from '../llm/zenEndpoint.js';
import { recordLlmHit } from '../llm/llmMetrics.js';
import {
  buildFactTemporalContext,
  formatDatedFact,
  resolveFactTimeZone,
} from '../utils/factTemporalContext.js';

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
   {"kind":"running_gag|rivalry|catchphrase|epic_fail|ship_lore|nickname|event","summary":"1 frase ≤150 chars","target":["P0"],"evidence_msg":0,"keywords":["kw1"],"score":35-95}
3. "target": array com o ID de participante (ex: ["P1"], ["P0"]) ou nome/apelido da pessoa SOBRE QUEM é o fato.
   ATENÇÃO: NUNCA coloque o autor da mensagem se o fato for sobre outra pessoa citada na conversa! Se João disse que Pedro caiu da escada, o target é Pedro ("P1"), NÃO João ("P0")! Se for uma história/mico do próprio autor, use o ID dele.
4. "evidence_msg": índice numérico da mensagem [0, 1, 2...] que contém a fala ou evidência.
5. Só salve engraçado, mico, rivalidade, bordão, apelido, lore social. Se nada valer: {"facts":[]}
6. NÃO invente o que não está no trecho. NÃO salve: bom dia, ok, comando de bot, links, spam, dados sensíveis.
7. summary em pt-BR, como alguém contaria no grupo depois (tom de zap), sem aspas externas.
8. THREADS DISTINTOS: o batch pode misturar threads de conversa diferentes. Marcadores "--- [GAP: Xm] ---" entre mensagens mostram onde acabou um assunto e começou outro (gap >= 15min). Mensagens separadas por um GAP são de assuntos DIFERENTES — NÃO conecte uma resposta ao thread errado só porque está fisicamente perto. Se não dá pra saber com certeza a qual thread uma fala se refere, descarte o fato ({"facts":[]}).
9. Em caso de dúvida, prefira descartar a inventar conexão entre threads.
10. Palavrão, duplo sentido, flerte ou humor adulto entre participantes não são motivo de descarte automático. Quando o chat não indicar menor de idade, coerção, exploração, assédio direcionado, imagem íntima ou pedido para parar, trate como zoeira contextual e, se for recorrente ou marcante, extraia o running_gag/evento.
11. Ao registrar esse tipo de humor, resuma sem descrição gráfica e sem afirmar ato íntimo como fato; guarde o bordão, a dinâmica ou a piada interna. Não presuma consentimento fora do que o próprio contexto mostra.
Só o JSON.`;

/** Constrói o system do "clima" (persona) com o número de bullets configurado. */
function buildPersonaSystem(bullets) {
  return `Resuma o clima de um grupo WhatsApp BR em ${bullets} bullets curtos de lore cômica, com base nos fatos dados.
Cada bullet: observação específica (você inventa o ângulo), tom de quem vive o chat.
pt-BR, sem inventar nomes que não estejam nos fatos. Respeite o limite de caracteres informado no pedido. Sem markdown pesado. Só o texto.`;
}

const PERSONA_CACHE_TTL_MS = 30 * 60_000;

/**
 * Abaixo deste Jaccard entre o summary gravado e o novo, o reforço NÃO sobrescreve
 * o texto nem infla o score — texto muito divergente pode ser erro de atribuição
 * da LLM, e sobrescrever consolidaria o erro na lore.
 */
const TEXT_CONFLICT_THRESHOLD = 0.35;

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
 *   1) participante catalogado que aparece no summary
 *   2) nome que aparece MAIS vezes no summary (>=2 ocorrências) → forte sinal
 *   3) nome que aparece no INÍCIO do summary (primeiros 30 chars) → "X fez/disse/..."
 *   4) nome que aparece em qualquer posição do summary
 * Retorna { indices: number[], targetEntries?: object[], inferred: boolean, source: string } ou null.
 */
function inferSubjectIndicesFromSummary(summary, batch, participants = []) {
  if ((!Array.isArray(batch) || !batch.length) && (!Array.isArray(participants) || !participants.length)) {
    return null;
  }
  const sumNorm = normalizeKey(summary || '');
  if (!sumNorm || sumNorm.length < 8) return null;

  // 1. Se há participantes catalogados, tenta primeiro casar participantes conhecidos
  if (Array.isArray(participants) && participants.length) {
    const pCandidates = [];
    for (const p of participants) {
      const tok = normalizeKey(p.firstName || '');
      const nickTok = p.nickname ? normalizeKey(p.nickname) : '';
      if (!tok || tok.length < 3) continue;

      const reWord = new RegExp(`\\b${escapeRegex(tok)}\\b`, 'g');
      const matches = sumNorm.match(reWord);
      let count = matches ? matches.length : 0;
      if (nickTok && nickTok.length >= 3) {
        const reNick = new RegExp(`\\b${escapeRegex(nickTok)}\\b`, 'g');
        const nickMatches = sumNorm.match(reNick);
        if (nickMatches) count += nickMatches.length;
      }
      if (count === 0) continue;
      const isAtStart = sumNorm.startsWith(tok + ' ') || sumNorm.startsWith(tok + ',');
      pCandidates.push({
        idx: p.index,
        name: p.name,
        token: tok,
        count,
        isAtStart,
        pId: p.pId,
        participant: p,
      });
    }

    if (pCandidates.length) {
      pCandidates.sort((a, b) => {
        if (a.isAtStart !== b.isAtStart) return a.isAtStart ? -1 : 1;
        if (a.count !== b.count) return b.count - a.count;
        return a.idx - b.idx;
      });
      const best = pCandidates[0];
      if (pCandidates.length >= 2) {
        const second = pCandidates[1];
        const bestStrong = best.isAtStart || best.count >= 2;
        const secondStrong = second.isAtStart || second.count >= 2;
        if (!bestStrong && (secondStrong || second.count === best.count)) {
          return null; // ambíguo
        }
      }
      return {
        indices: [best.idx],
        targetEntries: [{ type: 'participant_id', pId: best.pId, index: best.idx, participant: best.participant }],
        inferred: true,
        source: 'summary-participant-name',
      };
    }
  }

  // 2. Fallback: conta ocorrências de cada nome no batch de mensagens
  const candidates = [];
  for (let i = 0; i < (batch || []).length; i++) {
    const tok = nameFirstToken(batch[i]?.name);
    if (!tok || tok.length < 3) continue;
    const reWord = new RegExp(`\\b${escapeRegex(tok)}\\b`, 'g');
    const matches = sumNorm.match(reWord);
    const count = matches ? matches.length : 0;
    if (count === 0) continue;
    const isAtStart = sumNorm.startsWith(tok + ' ') || sumNorm.startsWith(tok + ',');
    candidates.push({ idx: i, name: batch[i].name, token: tok, count, isAtStart });
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.isAtStart !== b.isAtStart) return a.isAtStart ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return a.idx - b.idx;
  });
  const best = candidates[0];
  if (candidates.length >= 2) {
    const second = candidates[1];
    const bestStrong = best.isAtStart || best.count >= 2;
    const secondStrong = second.isAtStart || second.count >= 2;
    if (!bestStrong && (secondStrong || second.count === best.count)) {
      return null;
    }
  }
  return { indices: [best.idx], inferred: true, source: 'summary-name' };
}

/**
 * Analisa identificador de target/subject (número, P0, ou nome de participante).
 */
export function parseTargetIdentifier(raw, participants = []) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) {
    return { type: 'index', index: raw, raw };
  }
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // Formato P0, P1, [P0]
  const pMatch = s.match(/^\[?\s*P(\d+)\s*\]?$/i);
  if (pMatch) {
    const idx = Number(pMatch[1]);
    const matchedP = Array.isArray(participants) ? participants.find((p) => p.pId === `P${idx}` || p.index === idx) : null;
    return { type: 'participant_id', pId: `P${idx}`, index: idx, participant: matchedP || null, raw: s };
  }

  // Formato número solto [0], "0"
  const m = s.match(/^\[?\s*(\d+)\s*\]?$/);
  if (m) {
    return { type: 'index', index: Number(m[1]), raw: s };
  }

  // Se houver participantes catalogados e vier string de nome/apelido
  if (Array.isArray(participants) && participants.length) {
    const norm = normalizeKey(s);
    if (norm && norm.length >= 2) {
      const matched = participants.find((p) => {
        const fn = normalizeKey(p.firstName || '');
        const full = normalizeKey(p.name || '');
        const nick = normalizeKey(p.nickname || '');
        return fn === norm || full === norm || (nick && nick === norm);
      });
      if (matched) {
        return { type: 'participant_name', pId: matched.pId, index: matched.index, participant: matched, raw: s };
      }
    }
  }

  return null;
}

/**
 * Escapa caracteres especiais de regex para uso em string dinâmica.
 */
function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normaliza campo subjects/target da LLM: array, número solto, "[0]", "P0" ou target singular.
 */
export function normalizeSubjectsField(fact) {
  if (!fact || typeof fact !== 'object') return [];
  const raw =
    fact.target !== undefined && fact.target !== null
      ? fact.target
      : fact.targets !== undefined && fact.targets !== null
        ? fact.targets
        : fact.subjects !== undefined && fact.subjects !== null
          ? fact.subjects
          : fact.subject !== undefined && fact.subject !== null
            ? fact.subject
            : [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'number' || typeof raw === 'string') return [raw];
  return [];
}

/** Summary com aliases que o modelo inventa (fact/text/description/quote). */
export function pickFactSummary(fact) {
  if (!fact || typeof fact !== 'object') return '';
  const raw =
    fact.summary ?? fact.fact ?? fact.text ?? fact.description ?? fact.quote ?? fact.content ?? '';
  return String(raw || '')
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '');
}

function unescapeJsonString(s) {
  return String(s || '')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
}

function parseSubjectsFromWindow(window) {
  const subjects = [];
  const subArr = window.match(/"(?:targets?|subjects?)"\s*:\s*(\[[^\]]*\])/i);
  if (subArr) {
    const inner = subArr[1].slice(1, -1).trim();
    if (inner) {
      for (const part of inner.split(',')) {
        const cleanPart = part.trim().replace(/^["']+|["']+$/g, '');
        if (cleanPart) {
          const num = Number(cleanPart);
          subjects.push(Number.isInteger(num) && num >= 0 ? num : cleanPart);
        }
      }
    }
    return subjects;
  }
  const subSingle = window.match(/"(?:targets?|subjects?)"\s*:\s*("?[^",}\s]+"?)/i);
  if (subSingle) {
    const clean = subSingle[1].trim().replace(/^["']+|["']+$/g, '');
    if (clean) {
      const num = Number(clean);
      subjects.push(Number.isInteger(num) && num >= 0 ? num : clean);
    }
  }
  return subjects;
}

function parseKeywordsFromWindow(window) {
  const kwMatch = window.match(/"keywords"\s*:\s*\[([^\]]*)\]/i);
  if (!kwMatch) return [];
  const inner = kwMatch[1].trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((x) => x.trim().replace(/^["']+|["']+$/g, ''))
    .filter((x) => x.length);
}

/**
 * Valida fato bruto pós-parse (antes do map de JID).
 * subjects ainda podem ser índices numéricos.
 * Se batch for passado e LLM não mandou subjects válidos, tenta inferir do summary.
 */
/** kind inventado pelo modelo (humor, joke, meme…) → bucket válido mais próximo. */
export function normalizeFactKind(raw) {
  const k = String(raw || 'event')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (VALID_KINDS.has(k)) return k;
  // aliases comuns do GLM / outros modelos
  if (/^(humou?r|joke|meme|funny|gag|piada|zoaç|zoacao|comedia)$/i.test(k)) return 'running_gag';
  if (/^(fail|mico|vergonha|blunder|fail_epic)$/i.test(k)) return 'epic_fail';
  if (/^(rival|beef|briga|fight|versus|vs)$/i.test(k)) return 'rivalry';
  if (/^(ship|crush|casal|romance|pairing)$/i.test(k)) return 'ship_lore';
  if (/^(nick|apelido|alias|handle)$/i.test(k)) return 'nickname';
  if (/^(phrase|bordao|catch|slogan|quote)$/i.test(k)) return 'catchphrase';
  // não descarta o fato por kind inventado — vira event
  return 'event';
}

/** score 0–1 (ex. 0.8) → 0–100; NaN → 50. */
export function normalizeFactScore(raw) {
  let score = Number(raw);
  if (!Number.isFinite(score)) return 50;
  if (score > 0 && score <= 1) score = score * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function validateExtractedFact(
  fact,
  { batchSize = 0, summaryMax = Infinity, batch = null, participants = [] } = {}
) {
  if (!fact || typeof fact !== 'object') return null;
  const kind = normalizeFactKind(fact.kind);

  let summary = pickFactSummary(fact);
  if (summary.length < 12) return null;
  if (looksSensitive(summary)) return null;
  // sem limite: summary vai completo pro modelo (até o que o extrator retornou).
  if (Number.isFinite(summaryMax) && summaryMax > 0) {
    summary = summary.slice(0, summaryMax);
  }

  const isTargetField = fact.target !== undefined || fact.targets !== undefined;
  const rawSubjects = normalizeSubjectsField(fact);
  const targetEntries = [];
  const indices = [];

  for (const s of rawSubjects) {
    // Se veio do campo legado "subjects", nomes soltos não são aceitos (exige número ou P0).
    // Nomes soltos só são resolvidos via catálogo se vierem pelo campo moderno "target".
    const parsed = parseTargetIdentifier(s, isTargetField ? participants : []);
    if (!parsed) continue;

    targetEntries.push(parsed);
    const idx = parsed.index;
    if (batchSize > 0 && idx >= batchSize && parsed.type === 'index') {
      if (!participants[idx]) continue;
    }
    if (idx != null && !indices.includes(idx)) indices.push(idx);
  }

  let subjectInferred = false;
  // zero alucinação de autoria: sem subject ID válido → tenta inferir do summary
  if (!indices.length) {
    if ((Array.isArray(batch) && batch.length) || (Array.isArray(participants) && participants.length)) {
      const inferred = inferSubjectIndicesFromSummary(summary, batch, participants);
      if (inferred && inferred.indices.length) {
        for (const i of inferred.indices) {
          if (batchSize > 0 && i >= batchSize && !participants[i]) continue;
          if (!indices.includes(i)) indices.push(i);
        }
        if (inferred.targetEntries?.length) {
          targetEntries.push(...inferred.targetEntries);
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

  const score = normalizeFactScore(fact.score);

  // Extrai evidência se fornecida
  let evidenceMsg = null;
  const rawEv = fact.evidence_msg ?? fact.evidenceMsg ?? fact.evidence_index ?? fact.evidence;
  const parsedEv = parseSubjectIndex(rawEv);
  if (parsedEv != null && (batchSize <= 0 || parsedEv < batchSize)) {
    evidenceMsg = parsedEv;
  } else if (indices.length === 1 && typeof indices[0] === 'number') {
    evidenceMsg = indices[0];
  }

  return {
    kind,
    summary,
    subjectIndices: indices.slice(0, 6),
    targetEntries,
    evidenceMsg,
    keywords,
    score,
    signature: keywordSignature(keywords, summary),
    subjectInferred,
  };
}

/**
 * Extrai fatos via regex de JSON malformado / schema inventado pelo modelo.
 * Tolera: "subjects":, · "subject":, · fact em vez de summary · sem kind · vírgulas trailing.
 * Retorna array de objetos parciais para validateExtractedFact.
 */
function looseParseFacts(text) {
  const cleaned = String(text || '');
  if (!cleaned.trim()) return [];
  const out = [];
  const seen = new Set();

  const pushFact = ({ kind, summary, subjects, keywords, score }) => {
    const sum = unescapeJsonString(summary);
    if (sum.length < 12) return;
    const key = normalizeKey(sum).slice(0, 80);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({
      kind: kind || 'event',
      summary: sum,
      subjects: subjects || [],
      keywords: keywords || [],
      score: score ?? 50,
    });
  };

  // 1) shape canônico: kind + summary no mesmo objeto (mesmo se subjects estiver quebrado)
  const reCanonical =
    /\{[^{}]*?"kind"\s*:\s*"([^"]+)"[^{}]*?"summary"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*?\}/g;
  let m;
  while ((m = reCanonical.exec(cleaned)) != null) {
    const window = m[0];
    pushFact({
      kind: m[1],
      summary: m[2],
      subjects: parseSubjectsFromWindow(window),
      keywords: parseKeywordsFromWindow(window),
      score: (() => {
        const sc = window.match(/"score"\s*:\s*(-?\d+(?:\.\d+)?)/);
        return sc ? Number(sc[1]) : 50;
      })(),
    });
  }

  // 2) aliases de summary que o GLM inventa: fact / text / description / quote
  //    Ex. real: {"facts":[{"subject":,"fact":"Gabriel se considera adulto..."}]}
  const reAlias =
    /"(?:summary|fact|text|description|quote|content)"\s*:\s*"((?:[^"\\]|\\.)*)"/gi;
  while ((m = reAlias.exec(cleaned)) != null) {
    const sum = m[1];
    const start = Math.max(0, m.index - 220);
    const end = Math.min(cleaned.length, m.index + m[0].length + 220);
    const window = cleaned.slice(start, end);
    let kind = 'event';
    const kindM = window.match(/"kind"\s*:\s*"([^"]+)"/i);
    if (kindM) kind = kindM[1];
    let score = 50;
    const sc = window.match(/"score"\s*:\s*(-?\d+(?:\.\d+)?)/);
    if (sc) score = Number(sc[1]);
    pushFact({
      kind,
      summary: sum,
      subjects: parseSubjectsFromWindow(window),
      keywords: parseKeywordsFromWindow(window),
      score,
    });
  }

  return out;
}

/**
 * Parse JSON de extract — aceita array, {facts:[]}, {items:[]}, ou objeto único.
 * Resiliente: se JSON.parse falha E o bloco {...} tem sintaxe quebrada (e.g. "subjects":,)
 * ainda extrai via regex para NÃO perder fato de modelo que manda JSON inválido.
 * maxFacts: teto pós-validação (default 8; extract passa maxExtract, derivado do o.maxFacts).
 * summaryMax: summary vai sem limite pro modelo — caller controla o cap do summary.
 */
export function parseFactsJson(
  raw,
  { batchSize = 0, summaryMax = 160, batch = null, maxFacts = 8, participants = [] } = {}
) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const cap = Math.max(1, Math.min(120, Math.floor(Number(maxFacts) || 8)));

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
        // JSON sintaticamente inválido (ex.: glm_5_2 manda "subject":, sem valor).
        loose = looseParseFacts(text);
      }
    } else {
      loose = looseParseFacts(text);
    }
  }

  // parse ok mas schema inventado / vazio útil → tenta loose como salvage
  let list = [];
  if (loose?.length) {
    list = loose;
  } else if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.facts)) list = parsed.facts;
    else if (Array.isArray(parsed.items)) list = parsed.items;
    else if (Array.isArray(parsed.data)) list = parsed.data;
    else if (pickFactSummary(parsed) || parsed.kind) list = [parsed];
  }

  let validated = list
    .map((x) => validateExtractedFact(x, { batchSize, summaryMax, batch, participants }))
    .filter(Boolean);

  // salvage: JSON.parse passou em wrapper mas items falharam validação (aliases/subjects)
  // OU parse falhou e loose canônico não pegou — tenta regex amplo
  if (!validated.length) {
    const salvaged = looseParseFacts(text)
      .map((x) => validateExtractedFact(x, { batchSize, summaryMax, batch, participants }))
      .filter(Boolean);
    if (salvaged.length) validated = salvaged;
  }

  return validated.slice(0, cap);
}

export function createGroupMemoryService({
  memoryRepository,
  profileService = null,
  getContactDisplayName = null,
  random = Math.random,
  getLogger = () => null,
  generateZen = openaiChatComplete,
  getNewsService = null,
  evidenceRepository = null,
  adapters = {},
  parseGuard = null,
  evidenceEnricher = null,
  bufferLock = null,
  batchDedup = null,
} = {}) {
  if (!memoryRepository) throw new Error('[fun/groupMemoryService] memoryRepository required');

  const effectiveParseGuard = parseGuard || adapters.parseGuard || null;
  const effectiveEvidenceEnricher = evidenceEnricher || adapters.evidenceEnricher || null;
  const effectiveBufferLock = bufferLock || adapters.bufferLock || null;
  const effectiveBatchDedup = batchDedup || adapters.batchDedup || null;

  /** @type {Map<string, { msgs: object[], lastFlushAt: number, flushing: boolean }>} */
  const buffers = new Map();
  /** @type {Map<string, { text: string, factCount: number, updatedAt: number, at: number }>} */
  const personaCache = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.memoryEnabled !== false,
      timeZone: resolveFactTimeZone(funConfig.worldTimezone),
      maxFacts: Math.max(10, Math.min(120, Math.floor(numOr(funConfig.memoryMaxFacts, 50)))),
      // sem limite: summary vai completo pro modelo (usuário pediu pra não cortar).
      summaryMax: Infinity,
      personaMax: Math.max(200, Math.min(800, Math.floor(numOr(funConfig.memoryPersonaMaxChars, 500)))),
      personaBullets: Math.max(3, Math.min(15, Math.floor(numOr(funConfig.memoryPersonaBullets, 8)))),
      // modelo grande: default ~100 msgs; clamp alto pra caber no orçamento de chars
      bufferSize: Math.max(8, Math.min(200, Math.floor(numOr(funConfig.memoryBufferSize, 100)))),
      flushMin: Math.max(3, Math.min(120, Math.floor(numOr(funConfig.memoryFlushMinMessages, 40)))),
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
      minFactsPerMember: Math.max(1, Math.min(10, Math.floor(numOr(funConfig.memoryMemberMinFactsQuota, 5)))),
      minScoreQuota: Math.max(70, Math.min(95, Math.floor(numOr(funConfig.memoryMemberMinScoreQuota, 80)))),
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
        updatedAt: hit.updatedAt,
        fromCache: true,
      };
    }
    const row = memoryRepository.getPersona(scopeKey);
    personaCache.set(k, {
      text: row.personaText || '',
      factCount: row.factCount || 0,
      updatedAt: row.updatedAt || 0,
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
    messageId = '',
    quotedText = '',
    quotedParticipant = '',
    quotedParticipantName = '',
    mentionedJids = [],
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
    if (evidenceRepository && messageId) {
      evidenceRepository.insertEvidence({
        scopeKey,
        messageId,
        authorJid: userJid,
        text: body,
        now,
        retentionDays: funConfig.selfHealEvidenceRetentionDays,
      });
    }

    const buf = getBuf(scopeKey);
    buf.msgs.push({
      userJid: String(userJid || ''),
      name: displayOf(userJid),
      text: body.slice(0, o.msgMaxChars),
      at: Number(now) || Date.now(),
      messageId: String(messageId || ''),
      quotedText: String(quotedText || '').slice(0, 300),
      quotedParticipant: String(quotedParticipant || ''),
      quotedParticipantName: String(quotedParticipantName || ''),
      mentionedJids: Array.isArray(mentionedJids) ? mentionedJids.map(String) : [],
    });
    if (buf.msgs.length > o.bufferSize) {
      buf.msgs = buf.msgs.slice(-o.bufferSize);
    }

    if (shouldFlushBuffer(buf, o, now) && !buf.flushing) {
      void flushScope(scopeKey, funConfig, now).catch((err) => {
        getLogger?.()?.warn?.(
          { err: { message: err?.message || 'memory-flush' }, scopeKey },
          'Fun memory flush failed'
        );
      });
      return { observed: true, flushScheduled: true };
    }
    return { observed: true, flushScheduled: false };
  }

  /**
   * Critério de flush — o extract SÓ chama a LLM daqui / flushDueScopes.
   * Trigger ÚNICO: contagem de mensagens (≥ memoryFlushMinMessages, default 40).
   * O trigger por tempo (memoryFlushIntervalMs) foi removido a pedido:
   * buffer abaixo do limite NÃO extrai, por mais velho que esteja.
   */
  function shouldFlushBuffer(buf, o) {
    if (!buf || buf.flushing) return false;
    if (buf.msgs.length < 3) return false;
    return buf.msgs.length >= o.flushMin;
  }

  async function flushScope(scopeKey, funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled' };

    const executeFlush = async () => {
      const buf = getBuf(scopeKey);
      if (buf.flushing) return { ok: false, reason: 'busy' };
      if (buf.msgs.length < 3) return { ok: false, reason: 'too-few' };

      buf.flushing = true;
      let rawMsgs = buf.msgs.slice(-o.bufferSize);

      if (effectiveBatchDedup) {
        const existingForDedup = memoryRepository.listFacts(scopeKey, {
          limit: o.maxFacts,
          minScore: 0,
        });
        const dedupRes = effectiveBatchDedup(rawMsgs, existingForDedup, { now });
        if (dedupRes?.filteredBatch) {
          rawMsgs = dedupRes.filteredBatch;
        }
      }

      // empacota o máximo de mensagens que couber no orçamento (~40k), priorizando as recentes
      const batch = packBatchForExtract(rawMsgs, o);
      buf.msgs = [];
      buf.lastFlushAt = now;

      const maxExtract = Math.max(2, Math.min(8, Math.round(batch.length / 12.5)));

      try {
        const existing = memoryRepository.listFacts(scopeKey, {
          limit: o.maxFacts,
          minScore: 0,
        });
        let extracted = await extractFacts(scopeKey, batch, existing, funConfig, o, maxExtract);

        if (effectiveParseGuard && extracted.length) {
          extracted = effectiveParseGuard(extracted, { scopeKey });
        }
        if (effectiveEvidenceEnricher && extracted.length) {
          extracted = effectiveEvidenceEnricher(extracted, batch, scopeKey);
        }

        let inserted = 0;
        let reinforced = 0;

        for (const fact of extracted.slice(0, maxExtract)) {
          if (fact.score < o.minScore) continue;
          if (!fact.subjects?.length) continue;

          const hit = findSimilar(existing, fact);
          if (hit) {
            // Anti-consolidação de erro: texto muito divergente do gravado não
            // sobrescreve o summary nem infla o score — reforço convergindo pra média.
            const textSim = jaccard(tokenSet(hit.summary), tokenSet(fact.summary));
            const compatible = textSim >= TEXT_CONFLICT_THRESHOLD;
            memoryRepository.reinforceFact(hit.id, {
              summary: fact.summary,
              score: compatible ? fact.score : Math.round((hit.score + fact.score) / 2),
              keywords: fact.keywords,
              overwriteSummary: compatible,
              now,
            });
            reinforced += 1;
            const idx = existing.findIndex((e) => e.id === hit.id);
            if (idx >= 0) {
              const prev = existing[idx];
              existing[idx] = {
                ...prev,
                summary: compatible ? fact.summary : prev.summary,
                score: compatible
                  ? Math.max(prev.score, fact.score)
                  : Math.max(prev.score, Math.round((prev.score + fact.score) / 2)),
                keywords: [
                  ...new Set([...(prev.keywords || []), ...(fact.keywords || [])]),
                ].slice(0, 12),
                hits: (prev.hits || 1) + 1,
                lastSeenAt: now,
              };
            }
          } else {
            const rec = memoryRepository.insertFact({
              scopeKey,
              kind: fact.kind,
              summary: fact.summary,
              subjects: fact.subjects,
              keywords: fact.keywords,
              score: fact.score,
              source: 'chat',
              now,
              _parseGuard: fact._parseGuard,
              evidence: fact.evidence,
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
                quote: fact.summary,
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
        memoryRepository.pruneToCap(scopeKey, o.maxFacts, {
          minFactsPerMember: o.minFactsPerMember,
          minScoreQuota: o.minScoreQuota,
        });

        if (inserted + reinforced > 0 || random() < 0.35) {
          await refreshPersona(scopeKey, funConfig, o, now);
        }

        return { ok: true, inserted, reinforced, batchSize: batch.length };
      } finally {
        // lock rigoroso: nunca deixa flushing preso após erro LLM
        buf.flushing = false;
      }
    };

    if (effectiveBufferLock) {
      return effectiveBufferLock.withLock(scopeKey, executeFlush);
    }
    return executeFlush();
  }

  /**
   * Mapeia subjectTokens/indices → JIDs reais do batch ou participantes catalogados.
   * Inclui validação cruzada anti-atribuição errada (quando o autor da mensagem falou de terceiro).
   */
  function mapSubjectsToJids(batch, factOrIndices, participants = []) {
    const isFactObj = factOrIndices && typeof factOrIndices === 'object' && !Array.isArray(factOrIndices);
    const subjectIndices = isFactObj ? factOrIndices.subjectIndices : factOrIndices;
    const targetEntries = isFactObj ? factOrIndices.targetEntries : null;
    const summary = isFactObj ? factOrIndices.summary : '';

    const jids = [];
    const pushJid = (jid) => {
      const s = String(jid || '').trim();
      if (s && s.includes('@') && !jids.includes(s)) jids.push(s);
    };

    // 1. Prioriza targetEntries se existirem
    if (Array.isArray(targetEntries) && targetEntries.length) {
      for (const entry of targetEntries) {
        if (entry.pId && Array.isArray(participants)) {
          const match = participants.find((p) => p.pId === entry.pId);
          if (match?.userJid) {
            pushJid(match.userJid);
            continue;
          }
        }
        if (entry.participant?.userJid) {
          pushJid(entry.participant.userJid);
          continue;
        }
        if (entry.type === 'index') {
          if (participants[entry.index]?.userJid) {
            pushJid(participants[entry.index].userJid);
            continue;
          }
          const m = batch[entry.index];
          if (m?.userJid) pushJid(m.userJid);
        }
      }
    }

    // 2. Fallback por subjectIndices
    if (!jids.length) {
      for (const idx of subjectIndices || []) {
        if (participants[idx]?.userJid) {
          pushJid(participants[idx].userJid);
          continue;
        }
        const m = batch[idx];
        if (m?.userJid) pushJid(m.userJid);
      }
    }

    // 3. Validação Cruzada Autor vs Terceiro Citado no Summary:
    // Se o fato atribuído tem 1 sujeito, mas o summary menciona claramente OUTRO participante
    // e NÃO menciona o participante atualmente atribuído (ex: "João disse que Pedro caiu da escada"):
    if (jids.length === 1 && summary && Array.isArray(participants) && participants.length) {
      const currentJid = jids[0];
      const sumNorm = normalizeKey(summary);
      const currentP = participants.find((p) => p.userJid === currentJid);
      const currentNameTok = currentP ? normalizeKey(currentP.firstName) : '';

      const authorMentioned =
        currentNameTok && currentNameTok.length >= 3 && sumNorm.includes(currentNameTok);

      if (!authorMentioned) {
        const otherMatches = [];
        for (const p of participants) {
          if (p.userJid === currentJid) continue;
          const fnTok = normalizeKey(p.firstName);
          const nickTok = p.nickname ? normalizeKey(p.nickname) : '';
          if (fnTok && fnTok.length >= 3) {
            const reWord = new RegExp(`\\b${escapeRegex(fnTok)}\\b`, 'i');
            if (reWord.test(sumNorm)) {
              otherMatches.push(p);
              continue;
            }
          }
          if (nickTok && nickTok.length >= 3) {
            const reNick = new RegExp(`\\b${escapeRegex(nickTok)}\\b`, 'i');
            if (reNick.test(sumNorm)) {
              otherMatches.push(p);
            }
          }
        }
        if (otherMatches.length === 1 && otherMatches[0].userJid) {
          return [otherMatches[0].userJid];
        }
      }
    }

    return jids.slice(0, 6);
  }

  function findSimilar(existing, fact) {
    const fSig = fact.signature || keywordSignature(fact.keywords, fact.summary);
    const fTokens = tokenSet(fact.summary);
    const fKw = new Set((fact.keywords || []).map(normalizeKey).filter(Boolean));
    const fSubjects = new Set((fact.subjects || []).map(String));

    // Anti-fusão de autoria: só trata como "mesmo fato" o que envolve a MESMA pessoa.
    // Sem subject em comum, dois resumos parecidos NUNCA se fundem — evita que um
    // erro de atribuição da LLM sobrescreva/consolide o fato de outra pessoa.
    const overlapsSubject = (e) => (e.subjects || []).some((x) => fSubjects.has(String(x)));

    // 1) assinatura barata (top-3 tokens)
    if (fSig) {
      for (const e of existing) {
        const eSig = keywordSignature(e.keywords, e.summary);
        if (eSig && eSig === fSig && overlapsSubject(e)) return e;
      }
    }

    let best = null;
    let bestScore = 0;
    for (const e of existing) {
      // Anti-fusão de autoria: sem subject em comum, o fato NUNCA casa — dois
      // eventos de pessoas diferentes não se fundem nem sobrescrevem (evita
      // consolidar erro de atribuição da LLM, ex.: trocar o autor de um mico).
      if (!overlapsSubject(e)) continue;

      const eTokens = tokenSet(e.summary);
      const sim = jaccard(fTokens, eTokens);
      const kwSim = jaccard(fKw, new Set((e.keywords || []).map(normalizeKey)));
      let s = Math.max(sim, kwSim * 0.9);

      // mesma kind + subject em comum → limiar mais baixo (overwrite)
      const sameKind = e.kind === fact.kind;
      if (sameKind) {
        s = Math.max(s, sim + 0.08);
        if (sim >= 0.3) s = Math.max(s, 0.45);
      }

      if (s >= 0.42 && s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    if (best) return best;

    const n = normalizeKey(fact.summary);
    for (const e of existing) {
      const en = normalizeKey(e.summary);
      if (!overlapsSubject(e)) continue;
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

  function buildParticipantsCatalog(batch = [], scopeKey = '') {
    const map = new Map();
    let idx = 0;

    const addParticipant = (jid, nameHint = '') => {
      if (!jid) return;
      const cleanJid = String(jid).trim();
      if (!cleanJid || !cleanJid.includes('@')) return;

      if (map.has(cleanJid)) {
        const existing = map.get(cleanJid);
        if (nameHint && (!existing.name || existing.name === '?' || existing.name.includes('@'))) {
          existing.name = nameHint;
          existing.firstName = firstName(nameHint);
        }
        return;
      }

      let profNick = '';
      if (profileService?.getProfile && scopeKey) {
        try {
          const prof = profileService.getProfile(cleanJid, scopeKey);
          if (prof?.nickname) profNick = String(prof.nickname).trim();
        } catch {
          // ignore
        }
      }

      const disp = nameHint || displayOf(cleanJid);
      const name = disp && !disp.includes('@') ? disp : (profNick || firstName(cleanJid) || `Participante ${idx}`);
      const fn = firstName(name);

      const p = {
        pId: `P${idx}`,
        index: idx,
        userJid: cleanJid,
        name,
        firstName: fn,
        nickname: profNick || '',
      };
      map.set(cleanJid, p);
      idx++;
    };

    for (const m of batch || []) {
      if (m?.userJid) addParticipant(m.userJid, m.name);
      if (m?.quotedParticipant) addParticipant(m.quotedParticipant, m.quotedParticipantName);
      if (Array.isArray(m?.mentionedJids)) {
        for (const mj of m.mentionedJids) addParticipant(mj);
      }
    }

    return Array.from(map.values());
  }

  /**
   * Render do batch com timestamp relativo, identificadores de participante, replies e separadores de GAP.
   * Cada linha: "[HH:MM] [N] [P0] Nome (em resposta a...): texto"
   * Entre blocos com gap >= 15min: insere linha "--- [GAP: 1h] ---".
   */
  function formatBatchLinesWithContext(batch, participantsCatalog = []) {
    const jidToPid = new Map((participantsCatalog || []).map((p) => [p.userJid, p.pId]));
    const lines = [];
    let prevAt = null;
    for (let i = 0; i < batch.length; i += 1) {
      const m = batch[i];
      const at = Number(m?.at) || 0;
      if (at && prevAt && at - prevAt >= 15 * 60_000) {
        lines.push(`--- [GAP: ${formatGap(at - prevAt)}] ---`);
      }

      const pid = jidToPid.get(m.userJid) || '';
      const pTag = pid ? `[${pid}] ` : '';
      const name = String(m.name || firstName(m.userJid) || '?').slice(0, 40);

      let replyContext = '';
      if (m.quotedText) {
        const qPid = jidToPid.get(m.quotedParticipant) || '';
        const qPidTag = qPid ? `[${qPid}] ` : '';
        const qWho = m.quotedParticipantName || firstName(m.quotedParticipant) || 'alguém';
        const qSnippet = String(m.quotedText).replace(/\s+/g, ' ').slice(0, 75);
        replyContext = ` (em resposta a ${qPidTag}${qWho}: "${qSnippet}")`;
      }

      let text = String(m.text || '').slice(0, 800);
      if (Array.isArray(m.mentionedJids) && m.mentionedJids.length && participantsCatalog?.length) {
        for (const mj of m.mentionedJids) {
          const matchPart = participantsCatalog.find((p) => p.userJid === mj);
          const num = String(mj).split('@')[0];
          if (matchPart && num) {
            text = text.replace(new RegExp(`@${num}\\b`, 'g'), `@${matchPart.name}`);
          }
        }
      }

      const ts = formatHm(at);
      const head = ts ? `[${ts}] [${i}] ${pTag}${name}${replyContext}` : `[${i}] ${pTag}${name}${replyContext}`;
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
      messageId: m.messageId || '',
      quotedText: m.quotedText || '',
      quotedParticipant: m.quotedParticipant || '',
      quotedParticipantName: m.quotedParticipantName || '',
      mentionedJids: Array.isArray(m.mentionedJids) ? m.mentionedJids : [],
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

  async function extractFacts(scopeKey, batch, existing, funConfig, o, maxExtract = 2) {
    const participants = buildParticipantsCatalog(batch, scopeKey);
    // usa versão com timestamps, identificadores de participante, replies e marcadores de GAP
    const lines = formatBatchLinesWithContext(batch, participants);
    const knownLimit = o.knownFactsInPrompt || 24;
    const maxFactsPrompt = `0 a ${maxExtract}`;
    const known = existing
      .slice(0, knownLimit)
      .map((f) => {
        const who = (f.subjects || [])
          .map((s) => firstName(s))
          .filter(Boolean)
          .slice(0, 3)
          .join(', ');
        return `- ${formatDatedFact(f, `[${f.kind}] (${who || '?'}) ${f.summary}`, o.timeZone)}`;
      })
      .join('\n');

    // header dinâmico: se o batch tem pelo menos um GAP, lembra a LLM da regra de não cruzar threads
    const hasGap = /---\s*\[GAP:/i.test(lines);
    const continuidadeLine = hasGap
      ? 'O batch contém MÚLTIPLOS threads separados por marcadores "--- [GAP: Xm] ---". Mensagens em threads diferentes são de assuntos DIFERENTES. NÃO conecte uma resposta ao thread errado só porque está fisicamente perto.'
      : 'Leia o trecho como conversa contínua (contexto importa — quem responde a quem).';

    const personaText = String(getPersonaCached(scopeKey)?.personaText || '').trim();
    const batchUserJids = [...new Set(batch.map((message) => String(message?.userJid || '').trim()).filter(Boolean))];
    const identityBlock = profileService?.buildIdentityBlock
      ? profileService.buildIdentityBlock(scopeKey, batchUserJids, funConfig)
      : '';

    const participantsList = participants
      .map((p) => {
        const nick = p.nickname ? ` (nick: "${p.nickname}")` : '';
        return `- [${p.pId}] ${p.name}${nick}`;
      })
      .join('\n');
    const participantsBlock = participants.length
      ? `PARTICIPANTES DO TRECHO (use estes IDs no campo "target"):\n${participantsList}`
      : '';

    const contextBlocks = [
      participantsBlock,
      personaText ? `Clima atual consolidado (use só como contexto; não reextraia nem contradiga sem evidência):\n${personaText.slice(0, 300)}` : '',
      identityBlock,
    ].filter(Boolean);

    const prompt = [
      buildFactTemporalContext({ now: batch.at(-1)?.at || Date.now(), timeZone: o.timeZone }),
      `Analise as seguintes mensagens do grupo (${batch.length} msgs, IDs entre colchetes).`,
      ...contextBlocks,
      contextBlocks.length ? '' : null,
      continuidadeLine,
      lines,
      '',
      'Regras:',
      `1. Extraia apenas fatos engraçados ou úteis (${maxFactsPrompt}).`,
      '2. Em "target", indique array com o ID do participante envolvido (ex: ["P0"], ["P1"]) ou seu nome. NUNCA atribua o fato ao autor da mensagem se o fato for sobre outra pessoa citada na conversa! (Exemplo: se [P0] João contou que [P1] Pedro bateu o carro, target é ["P1"], NÃO ["P0"]).',
      '3. Em "evidence_msg", indique o índice numérico da mensagem [0, 1, 2...] que contém a fala ou evidência.',
      '4. NÃO invente. Se não souber o sujeito com clareza, não extraia o fato.',
      '5. Palavrão, duplo sentido, flerte ou humor adulto entre participantes não invalidam um fato. Só descarte quando houver sinal de menor de idade, coerção, exploração, assédio direcionado, imagem íntima ou pedido para parar. Nesse caso, não salve detalhes.',
      '6. Para humor adulto permitido, registre a dinâmica/bordão interno sem descrição gráfica nem alegação de ato íntimo como fato.',
      '7. Use o contexto das mensagens vizinhas e respostas (quotes) pra entender o fato, MAS não conecte mensagens separadas por [GAP: ...].',
      '8. Retorne JSON: {"facts":[...]}',
      '',
      known
        ? `Já sabemos (NÃO repita; se for o MESMO fato, a gente reforça no backend):\n${known}`
        : 'Sem lore prévia.',
      '',
      'Exemplo de shape:',
      '{"facts":[{"kind":"epic_fail","summary":"Pedro bateu o carro no poste","target":["P1"],"evidence_msg":0,"keywords":["carro","poste"],"score":75}]}',
    ].join('\n');

    if (process.env.FUN_DISABLE_LIVE_LLM === '1') {
      return [];
    }

    const mapParsed = (raw) => {
      const validated = parseFactsJson(raw, {
        batchSize: batch.length,
        summaryMax: o.summaryMax,
        batch, // passado pra inferência de subject quando LLM mandou vazio
        maxFacts: maxExtract,
        participants,
      });
      const out = [];
      for (const f of validated) {
        const jids = mapSubjectsToJids(batch, f, participants);
        if (!jids.length) continue; // sem JID = descarta (anti-alucinação de autoria)
        out.push({
          kind: f.kind,
          summary: f.summary,
          subjects: jids,
          keywords: f.keywords,
          score: f.score,
          signature: f.signature,
          subjectInferred: f.subjectInferred === true,
          evidenceMsg: f.evidenceMsg,
        });
      }
      return out;
    };

    let lastRawPreview = '';

    // Zen + jsonMode — 3 retentativas (1 chamada + 3 retries = 4 totais) antes de
    // retornar vazio. Fallback Ollama foi descontinuado.
    if (funConfig.zenEnabled !== false) {
      const totalTries = Math.max(1, Math.min(8, Math.floor(Number(funConfig.zenMaxRetries) || 3) + 1));
      for (let attempt = 1; attempt <= totalTries; attempt += 1) {
        try {
          const task = resolveZenTaskParams('extract', funConfig);
          const ep = resolveZenEndpoint(funConfig);
          const raw = await generateZen({
            baseUrl: ep.baseUrl,
            model: ep.model,
            system: EXTRACT_SYSTEM,
            prompt,
            timeoutMs: Math.max(o.extractTimeout, task.timeoutMs, 45_000),
            maxTokens: Math.max(task.maxTokens, 700),
            temperature: task.temperature,
            apiKey: ep.apiKey,
            jsonMode: true,
            jsonOnly: true,
            sendSamplingParams: funConfig.zenSendSamplingParams === true,
          });
          if (raw) lastRawPreview = String(raw).slice(0, 240);
          const mapped = mapParsed(raw);
          if (mapped.length) {
            recordLlmHit('memory', 'zen', { n: mapped.length, attempt });
            return mapped;
          }
          if (raw) {
            getLogger?.()?.debug?.(
              { preview: lastRawPreview, batchSize: batch.length, attempt },
              'Fun memory Zen extract empty after parse'
            );
          }
        } catch (err) {
          getLogger?.()?.warn?.(
            { err: { message: err?.message || 'zen-memory' }, attempt },
            'Fun memory Zen extract fail'
          );
        }
      }
    }

    if (lastRawPreview) {
      getLogger?.()?.warn?.(
        { preview: lastRawPreview, batchSize: batch.length },
        'Fun memory extract: LLM respondeu mas nenhum fato válido'
      );
    }
    return [];
  }

  async function refreshPersona(
    scopeKey,
    funConfig = {},
    o = opts(funConfig),
    now = Date.now()
  ) {
    // Alimenta fatos suficientes para os bullets configurados (ex.: 8 bullets → 32 fatos)
    const facts = memoryRepository.listFacts(scopeKey, {
      limit: Math.max(15, Math.min(60, o.personaBullets * 4)),
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
        return `• ${formatDatedFact(f, `(${f.kind}, ${f.score}, ${who || '?'}) ${f.summary}`, o.timeZone)}`;
      })
      .join('\n');
    let text = '';

    if (process.env.FUN_DISABLE_LIVE_LLM !== '1' && funConfig.zenEnabled !== false) {
      const totalTries = Math.max(1, Math.min(8, Math.floor(Number(funConfig.zenMaxRetries) || 3) + 1));
      for (let attempt = 1; attempt <= totalTries; attempt += 1) {
        try {
          const task = resolveZenTaskParams('persona', funConfig);
          const ep = resolveZenEndpoint(funConfig);
          text = await generateZen({
            baseUrl: ep.baseUrl,
            model: ep.model,
            system: buildPersonaSystem(o.personaBullets),
            prompt: `${buildFactTemporalContext({ now, timeZone: o.timeZone })}\nFatos do grupo:\n${list}\n\nResuma o clima em ${o.personaBullets} bullets (≤${o.personaMax} chars). NÃO invente fatos novos. Só os bullets:`,
            timeoutMs: Math.max(o.extractTimeout, task.timeoutMs),
            maxTokens: task.maxTokens,
            temperature: task.temperature,
            apiKey: ep.apiKey,
            sendSamplingParams: funConfig.zenSendSamplingParams === true,
          });
          if (text) {
            recordLlmHit('persona', 'zen', { attempt });
            break;
          }
        } catch {
          text = '';
        }
      }
    }

    // Ollama fallback descontinuado — Zen tentou 1 + retries antes do fallback sintético.

    if (!text) {
      text = facts
        .slice(0, 5)
        .map((f) => `• ${f.summary}`)
        .join('\n');
    } else {
      text = String(text).trim();
    }

    memoryRepository.setPersona(scopeKey, text, facts.length);
    personaCache.set(String(scopeKey || ''), {
      text,
      factCount: facts.length,
      updatedAt: now,
      at: Date.now(),
    });
    return { ok: true, text };
  }

  const LORE_USAGE_RULES = [
    '- Estes são fatos, histórias, micos e apelidos reais do grupo.',
    '- Use a Lore ativamente para dar contexto, fazer piadas internas e zoar os membros pelas histórias deles.',
    '- NUNCA altere o sujeito da lore. Se a lore diz que [Nome] fez X, use contra [Nome], não atribua a outra pessoa.',
    '- NÃO invente detalhes absurdos que contradigam o fato registrado.',
  ];

  function renderLoreFacts(facts, timeZone) {
    return (facts || []).map((fact) => {
      const authors = (fact.subjects || [])
        .map((subject) => firstName(subject))
        .filter(Boolean)
        .slice(0, 3);
      const who = authors.length ? authors.join(', ') : '?';
      return `- ${formatDatedFact(fact, `[${fact.kind}] (Autor: ${who}): ${fact.summary}`, timeZone)}`;
    });
  }

  /**
   * Bloco estruturado <group_lore> pra injetar em prompts de flavor/caos.
   * Regras anti-alucinação + autor por primeiro nome (não JID cru).
   * SEM LIMITE de fatos — usuário pediu para enviar toda a lore do grupo
   * pro modelo (até o teto de `o.maxFacts` persistido, que já é o cap real).
   */
  function buildLoreContext(
    scopeKey,
    { userJids = [], limit = Infinity, funConfig = {}, now = Date.now() } = {}
  ) {
    const o = opts(funConfig);
    if (!o.enabled || !scopeKey) return '';

    const persona = getPersonaCached(scopeKey);
    // Sem cap artificial: usa `o.maxFacts` (default 50) como teto prático,
    // alinhado com o que o repositório já persiste.
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : o.maxFacts;
    const fetchLimit = cap;
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
      buildFactTemporalContext({ now, timeZone: o.timeZone }),
      'Regras de uso da Lore:',
      ...LORE_USAGE_RULES,
    ];

    if (persona.personaText) {
      lines.push(
        '',
        `Clima: ${formatDatedFact(persona, persona.personaText.replace(/\n+/g, ' · '), o.timeZone)}`
      );
    }
    if (top.length) {
      lines.push('', 'Fatos:', ...renderLoreFacts(top, o.timeZone));
    }
    lines.push('</group_lore>');
    return lines.join('\n');
  }

  /**
   * Lore integral exclusiva da persona: todos os fatos persistidos, sem ranking,
   * filtro de score ou corte por caracteres. Outros consumidores usam buildLoreContext.
   */
  function buildPersonaLoreContext(scopeKey, { funConfig = {}, now = Date.now() } = {}) {
    const o = opts(funConfig);
    if (!o.enabled || !scopeKey) return '';

    const facts = memoryRepository.listFacts(scopeKey, { limit: 200, minScore: 0 });
    if (!facts.length) return '';

    return [
      '<group_lore>',
      buildFactTemporalContext({ now, timeZone: o.timeZone }),
      'Regras de uso da Lore:',
      ...LORE_USAGE_RULES,
      '',
      'Fatos:',
      ...renderLoreFacts(facts, o.timeZone),
      '</group_lore>',
    ].join('\n');
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

  /**
   * Varre todos os buffers e faz flush dos que estão due.
   * Rede de segurança do world tick: só extrai buffer que JÁ bateu o limite
   * de mensagens (memoryFlushMinMessages) mas não conseguiu extrair no observe
   * (ex.: flush anterior ainda em andamento). NÃO extrai por tempo/idade.
   */
  async function flushDueScopes(funConfig = {}, now = Date.now()) {
    const o = opts(funConfig);
    if (!o.enabled) return { ok: false, reason: 'disabled', flushed: 0, results: [] };

    const results = [];
    let flushed = 0;
    // snapshot das keys — flushScope muta o map
    const keys = [...buffers.keys()];
    for (const scopeKey of keys) {
      if (!String(scopeKey || '').endsWith('@g.us')) continue;
      const buf = buffers.get(scopeKey);
      if (!buf || !shouldFlushBuffer(buf, o, now)) continue;
      try {
        const r = await flushScope(scopeKey, funConfig, now);
        results.push({
          scopeKey,
          kind: 'memory-extract',
          ok: Boolean(r?.ok),
          reason: r?.reason || null,
          inserted: r?.inserted ?? 0,
          reinforced: r?.reinforced ?? 0,
          batchSize: r?.batchSize ?? 0,
        });
        if (r?.ok) flushed += 1;
      } catch (err) {
        results.push({
          scopeKey,
          kind: 'memory-extract',
          ok: false,
          reason: err?.message || 'memory-flush-error',
        });
      }
    }
    return { ok: true, flushed, results };
  }

  function getBufferStats() {
    const out = [];
    for (const [scopeKey, buf] of buffers.entries()) {
      out.push({
        scopeKey,
        size: buf.msgs.length,
        flushing: buf.flushing,
        lastFlushAt: buf.lastFlushAt,
        oldestAt: buf.msgs[0]?.at || 0,
      });
    }
    return out;
  }

  function _pushRaw(scopeKey, msg) {
    const buf = getBuf(scopeKey);
    buf.msgs.push(msg);
  }

  return {
    observeMessage,
    flushScope,
    forceFlush,
    flushDueScopes,
    shouldFlushBuffer,
    getBufferStats,
    buildLoreContext,
    buildPersonaLoreContext,
    formatLoreList,
    forgetAll,
    forgetSubject,
    refreshPersona,
    getPersonaCached,
    parseFactsJson,
    validateExtractedFact,
    findSimilar,
    mapSubjectsToJids,
    packBatchForExtract,
    formatBatchLinesWithContext,
    buildParticipantsCatalog,
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
