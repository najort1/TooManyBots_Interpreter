/**
 * Memória seletiva por grupo — buffer de chat → extract LLM (Zen→Ollama) → fatos.
 * Só salva o ouro (engraçado/útil); dedup + cap + TTL.
 */

import { openaiChatComplete } from '../llm/openaiClient.js';
import { ollamaGenerate } from '../llm/ollamaClient.js';

const EXTRACT_SYSTEM = `Você extrai FATOS engraçados ou úteis de um trecho de chat de WhatsApp BR (grupo de amigos).

REGRAS:
- Retorne JSON array (sem markdown): [] ou até 2 objetos.
- Cada objeto: {"kind":"running_gag|rivalry|catchphrase|epic_fail|ship_lore|nickname|event","summary":"1 frase curta ≤150 chars","subjects":["nome1"],"keywords":["kw1","kw2"],"score":35-95}
- Só salve o que for engraçado, mico, rivalidade, bordão, apelido, lore social.
- NÃO salve: bom dia, ok, sticker vazio, comando de bot, links, spam, dados sensíveis (telefone, endereço, senha, PIX real).
- NÃO invente o que não está no trecho.
- Se nada valer a pena: []
- summary em pt-BR, tom de zap, sem aspas externas.
Só o JSON.`;

const PERSONA_SYSTEM = `Resuma o clima de um grupo WhatsApp BR em 3 a 5 bullets curtos (lore cômica), com base nos fatos dados.
pt-BR, sem inventar nomes que não estejam nos fatos. Máx 450 caracteres. Sem markdown pesado. Só o texto.`;

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

function looksSensitive(text) {
  const t = String(text || '');
  if (/\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}\b/.test(t)) return true; // cpf-ish
  if (/\b\d{10,13}\b/.test(t) && /(zap|whats|telefone|celular|pix)/i.test(t)) return true;
  if (/(senha|password|token|api[_-]?key)\s*[:=]/i.test(t)) return true;
  return false;
}

function isCommandLike(text, prefix = '/') {
  const t = String(text || '').trim();
  return t.startsWith(String(prefix || '/'));
}

function parseFactsJson(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  // tenta array direto
  let m = text.match(/\[[\s\S]*\]/);
  if (!m) {
    // objeto único
    const o = text.match(/\{[\s\S]*\}/);
    if (o) m = [`[${o[0]}]`];
  }
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === 'object')
      .map((x) => ({
        kind: String(x.kind || 'event').trim().toLowerCase(),
        summary: String(x.summary || '').trim().slice(0, 160),
        subjects: Array.isArray(x.subjects)
          ? x.subjects.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 6)
          : [],
        keywords: Array.isArray(x.keywords)
          ? x.keywords.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean).slice(0, 10)
          : [],
        score: Math.max(0, Math.min(100, Math.round(Number(x.score) || 50))),
      }))
      .filter((x) => x.summary.length >= 12 && !looksSensitive(x.summary));
  } catch {
    return [];
  }
}

export function createGroupMemoryService({
  memoryRepository,
  getContactDisplayName = null,
  random = Math.random,
  getLogger = () => null,
  generateZen = openaiChatComplete,
  generateOllama = ollamaGenerate,
} = {}) {
  if (!memoryRepository) throw new Error('[fun/groupMemoryService] memoryRepository required');

  /** @type {Map<string, { msgs: object[], lastFlushAt: number, flushing: boolean }>} */
  const buffers = new Map();

  function opts(funConfig = {}) {
    return {
      enabled: funConfig.memoryEnabled !== false,
      maxFacts: Math.max(10, Math.min(120, Math.floor(numOr(funConfig.memoryMaxFacts, 50)))),
      summaryMax: Math.max(80, Math.min(200, Math.floor(numOr(funConfig.memorySummaryMaxChars, 160)))),
      personaMax: Math.max(200, Math.min(800, Math.floor(numOr(funConfig.memoryPersonaMaxChars, 500)))),
      bufferSize: Math.max(8, Math.min(60, Math.floor(numOr(funConfig.memoryBufferSize, 24)))),
      flushMin: Math.max(3, Math.min(40, Math.floor(numOr(funConfig.memoryFlushMinMessages, 8)))),
      flushMs: Math.max(60_000, Math.floor(numOr(funConfig.memoryFlushIntervalMs, 12 * 60_000))),
      minChars: Math.max(6, Math.floor(numOr(funConfig.memoryMinMsgChars, 12))),
      extractTimeout: Math.max(5_000, Math.floor(numOr(funConfig.memoryExtractTimeoutMs, 28_000))),
      ttlDays: Math.max(7, Math.floor(numOr(funConfig.memoryTtlDays, 45))),
      minScore: Math.max(0, Math.min(80, Math.floor(numOr(funConfig.memoryMinScore, 35)))),
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
    // comando antes do minChars — "/lore" é curto mas não é chat
    if (isCommandLike(body, o.prefix)) return { observed: false, reason: 'command' };
    if (body.length < o.minChars) return { observed: false, reason: 'short' };
    if (looksSensitive(body)) return { observed: false, reason: 'sensitive' };
    // mídia sem legenda
    if (!body && messageType && messageType !== 'text') {
      return { observed: false, reason: 'media-empty' };
    }

    const buf = getBuf(scopeKey);
    buf.msgs.push({
      userJid: String(userJid || ''),
      name: displayOf(userJid),
      text: body.slice(0, 280),
      at: Number(now) || Date.now(),
    });
    if (buf.msgs.length > o.bufferSize) {
      buf.msgs = buf.msgs.slice(-o.bufferSize);
    }

    const dueByCount = buf.msgs.length >= o.flushMin;
    const dueByTime = buf.lastFlushAt > 0 && now - buf.lastFlushAt >= o.flushMs;
    const firstFill = buf.lastFlushAt === 0 && buf.msgs.length >= o.flushMin;

    if ((dueByCount || dueByTime || firstFill) && !buf.flushing) {
      // async sem await no caller
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
    const batch = buf.msgs.slice(-o.bufferSize);
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
        const hit = findSimilar(existing, fact);
        if (hit) {
          memoryRepository.reinforceFact(hit.id, {
            summary: fact.summary.slice(0, o.summaryMax),
            score: fact.score,
            keywords: fact.keywords,
            now,
          });
          reinforced += 1;
        } else {
          // resolve subjects names → keep as names (not always jid)
          const rec = memoryRepository.insertFact({
            scopeKey,
            kind: fact.kind,
            summary: fact.summary.slice(0, o.summaryMax),
            subjects: resolveSubjects(batch, fact.subjects),
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

      memoryRepository.decayAndPurge(scopeKey, {
        ttlDays: o.ttlDays,
        minScore: o.minScore,
        now,
      });
      memoryRepository.pruneToCap(scopeKey, o.maxFacts);

      // persona a cada flush com mudanças ou a cada ~3 flushes
      if (inserted + reinforced > 0 || random() < 0.35) {
        await refreshPersona(scopeKey, funConfig, o);
      }

      return { ok: true, inserted, reinforced, batchSize: batch.length };
    } finally {
      buf.flushing = false;
    }
  }

  function resolveSubjects(batch, names) {
    const out = [];
    const nameMap = new Map();
    for (const m of batch) {
      if (m.userJid) nameMap.set(normalizeKey(m.name), m.userJid);
    }
    for (const n of names || []) {
      const jid = nameMap.get(normalizeKey(n));
      out.push(jid || String(n));
    }
    // always include speakers from batch if empty
    if (!out.length) {
      for (const m of batch.slice(-3)) {
        if (m.userJid && !out.includes(m.userJid)) out.push(m.userJid);
      }
    }
    return out.slice(0, 6);
  }

  function findSimilar(existing, fact) {
    const fTokens = tokenSet(fact.summary);
    const fKw = new Set((fact.keywords || []).map(normalizeKey).filter(Boolean));
    let best = null;
    let bestScore = 0;
    for (const e of existing) {
      const eTokens = tokenSet(e.summary);
      const sim = jaccard(fTokens, eTokens);
      const kwSim = jaccard(fKw, new Set((e.keywords || []).map(normalizeKey)));
      const s = Math.max(sim, kwSim * 0.9);
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    // limiar: evita duplicata
    if (bestScore >= 0.42) return best;
    // substring quase igual
    const n = normalizeKey(fact.summary);
    for (const e of existing) {
      const en = normalizeKey(e.summary);
      if (n && en && (n.includes(en) || en.includes(n)) && Math.min(n.length, en.length) >= 20) {
        return e;
      }
    }
    return null;
  }

  async function extractFacts(batch, existing, funConfig, o) {
    const lines = batch.map((m) => `${m.name}: ${m.text}`).join('\n');
    const known = existing
      .slice(0, 12)
      .map((f) => `- [${f.kind}] ${f.summary}`)
      .join('\n');
    const prompt = [
      'Trecho recente do grupo:',
      lines,
      '',
      known ? `Já sabemos (NÃO repita; só reforce se for o MESMO fato):\n${known}` : 'Sem lore prévia.',
      '',
      'Extraia 0–2 fatos novos engraçados/úteis em JSON array.',
    ].join('\n');

    if (process.env.FUN_DISABLE_LIVE_LLM === '1') {
      return [];
    }

    // Zen
    if (funConfig.zenEnabled !== false) {
      try {
        const raw = await generateZen({
          baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3000',
          model: funConfig.zenModel || 'mimo-v2.5-free',
          system: EXTRACT_SYSTEM,
          prompt,
          timeoutMs: o.extractTimeout,
          maxTokens: 500,
          temperature: 0.55,
          apiKey: funConfig.zenApiKey || '',
        });
        const parsed = parseFactsJson(raw);
        if (parsed.length) return parsed;
      } catch (err) {
        getLogger?.()?.warn?.(
          { err: { message: err?.message || 'zen-memory' } },
          'Fun memory Zen extract fail'
        );
      }
    }

    // Ollama fallback
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
          temperature: 0.55,
        });
        return parseFactsJson(raw);
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
      return { ok: true, empty: true };
    }

    const list = facts.map((f) => `• (${f.kind}, ${f.score}) ${f.summary}`).join('\n');
    let text = '';

    if (process.env.FUN_DISABLE_LIVE_LLM !== '1' && funConfig.zenEnabled !== false) {
      try {
        text = await generateZen({
          baseUrl: funConfig.zenBaseUrl || 'http://127.0.0.1:3000',
          model: funConfig.zenModel || 'mimo-v2.5-free',
          system: PERSONA_SYSTEM,
          prompt: `Fatos do grupo:\n${list}\n\nResuma o clima (≤${o.personaMax} chars):`,
          timeoutMs: o.extractTimeout,
          maxTokens: 280,
          temperature: 0.7,
          apiKey: funConfig.zenApiKey || '',
        });
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
      // template persona
      text = facts
        .slice(0, 5)
        .map((f) => `• ${f.summary}`)
        .join('\n')
        .slice(0, o.personaMax);
    } else {
      text = String(text).trim().slice(0, o.personaMax);
    }

    memoryRepository.setPersona(scopeKey, text, facts.length);
    return { ok: true, text };
  }

  /**
   * Bloco de contexto pra injetar em prompts de flavor/caos.
   */
  function buildLoreContext(scopeKey, { userJids = [], limit = 5, funConfig = {} } = {}) {
    const o = opts(funConfig);
    if (!o.enabled || !scopeKey) return '';

    const persona = memoryRepository.getPersona(scopeKey);
    const facts = memoryRepository.listFacts(scopeKey, {
      limit: o.maxFacts,
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

    const top = scored.slice(0, Math.max(1, Math.min(8, limit))).map((x) => x.f);
    const lines = [];
    if (persona.personaText) {
      lines.push(`Clima do grupo: ${persona.personaText.replace(/\n+/g, ' · ').slice(0, 280)}`);
    }
    if (top.length) {
      lines.push('Lore (use só se encaixar, não force):');
      for (const f of top) {
        lines.push(`- [${f.kind}] ${f.summary}`);
      }
    }
    return lines.join('\n');
  }

  function formatLoreList(scopeKey, { limit = 12, funConfig = {} } = {}) {
    const o = opts(funConfig);
    const facts = memoryRepository.listFacts(scopeKey, {
      limit,
      minScore: 0,
    });
    const persona = memoryRepository.getPersona(scopeKey);
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
      lines.push(`• _${f.kind}_ · ${f.summary} _(★${f.score} · ×${f.hits})_`);
    }
    lines.push('', `_Cap *${o.maxFacts}* · \`/esquecelore @user\` · \`/esquecelore tudo sim\``);
    return lines.join('\n');
  }

  function forgetAll(scopeKey) {
    const n = memoryRepository.deleteByScope(scopeKey);
    memoryRepository.clearPersona(scopeKey);
    buffers.delete(String(scopeKey || ''));
    return n;
  }

  function forgetSubject(scopeKey, userJid) {
    return memoryRepository.deleteBySubject(scopeKey, userJid);
  }

  /** Força flush (testes / debug). */
  async function forceFlush(scopeKey, funConfig = {}) {
    return flushScope(scopeKey, funConfig, Date.now());
  }

  /** Injeta msgs no buffer (testes). */
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
    findSimilar,
    _pushRaw,
    _buffers: buffers,
  };
}

export { parseFactsJson, normalizeKey, jaccard, tokenSet };
