/**
 * Persistência de lore seletiva por grupo.
 */

import { randomUUID } from 'crypto';
import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';
import { tokenSet, jaccard } from '../utils/textSimilarity.js';

const ANALYTICS_SCHEMA = 'analytics';

const KINDS = new Set([
  'running_gag',
  'rivalry',
  'catchphrase',
  'epic_fail',
  'ship_lore',
  'nickname',
  'event',
]);

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(String(raw || '[]'));
    return Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mapFact(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    scopeKey: String(row.scope_key || ''),
    kind: String(row.kind || 'event'),
    summary: String(row.summary || ''),
    subjects: parseJsonArray(row.subjects_json),
    keywords: parseJsonArray(row.keywords_json),
    score: Number(row.score) || 0,
    hits: Number(row.hits) || 1,
    source: String(row.source || 'chat'),
    evidenceStatus: String(row.evidence_status || 'pending'),
    createdAt: Number(row.created_at) || 0,
    lastSeenAt: Number(row.last_seen_at) || 0,
  };
}

export function createFunMemoryRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function insertFact({
    scopeKey,
    kind = 'event',
    summary,
    subjects = [],
    keywords = [],
    score = 50,
    source = 'chat',
    now = Date.now(),
    id = null,
  }) {
    ensureSchema();
    const factId = id || randomUUID();
    const ts = Number(now) || Date.now();
    const k = KINDS.has(String(kind)) ? String(kind) : 'event';
    // sem limite: summary vai completo pro banco (e do banco pro prompt).
    const sum = String(summary || '').trim();
    if (!sum || !scopeKey) return null;

    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_memories
         (id, scope_key, kind, summary, subjects_json, keywords_json, score, hits, source, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(
        factId,
        String(scopeKey),
        k,
        sum,
        JSON.stringify((subjects || []).map(String).slice(0, 8)),
        JSON.stringify((keywords || []).map(String).slice(0, 12)),
        Math.max(0, Math.min(100, Math.round(Number(score) || 50))),
        String(source || 'chat'),
        ts,
        ts
      );
    return getFact(factId);
  }

  function getFact(id) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE id = ?`)
      .get(String(id || ''));
    return mapFact(row);
  }

  function listFacts(scopeKey, { limit = 50, minScore = 0 } = {}) {
    ensureSchema();
    const rows = getDatabase()
      .prepare(
        `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_memories
         WHERE scope_key = ? AND score >= ?
         ORDER BY score DESC, last_seen_at DESC
         LIMIT ?`
      )
      .all(String(scopeKey || ''), Math.max(0, Number(minScore) || 0), Math.max(1, Math.min(200, Number(limit) || 50)));
    return rows.map(mapFact).filter(Boolean);
  }

  function countFacts(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(
        `SELECT COUNT(*) AS n FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE scope_key = ?`
      )
      .get(String(scopeKey || ''));
    return Number(row?.n) || 0;
  }

  /**
   * Reforça fato: hits++, last_seen_at reseta (TTL “renova”).
   * overwriteSummary=true (default se summary vier): atualiza o texto (fatos recentes sobrescrevem).
   */
  function reinforceFact(id, { summary, score, keywords, overwriteSummary = true, now = Date.now() } = {}) {
    ensureSchema();
    const current = getFact(id);
    if (!current) return null;
    const ts = Number(now) || Date.now();
    const incoming = summary ? String(summary).trim() : '';
    const nextSummary =
      incoming && overwriteSummary !== false ? incoming : current.summary;
    const nextScore = Math.max(
      current.score,
      Math.min(100, Math.round(Number(score != null ? score : current.score) || current.score))
    );
    const nextKeywords =
      Array.isArray(keywords) && keywords.length
        ? [...new Set([...current.keywords, ...keywords.map(String)])].slice(0, 12)
        : current.keywords;

    getDatabase()
      .prepare(
        `UPDATE ${ANALYTICS_SCHEMA}.fun_group_memories
         SET summary = ?, score = ?, hits = hits + 1, keywords_json = ?, last_seen_at = ?
         WHERE id = ?`
      )
      .run(nextSummary, nextScore, JSON.stringify(nextKeywords), ts, String(id));
    return getFact(id);
  }

  function updateFactAuthor(id, scopeKey, authorJid) {
    ensureSchema();
    const fact = getFact(id);
    if (!fact || fact.scopeKey !== String(scopeKey || '') || !authorJid) return null;
    const subjects = [...new Set([String(authorJid), ...fact.subjects.filter(subject => subject !== String(authorJid))])].slice(0, 8);
    getDatabase().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_group_memories SET subjects_json = ? WHERE id = ? AND scope_key = ?`)
      .run(JSON.stringify(subjects), String(id), String(scopeKey));
    return getFact(id);
  }

  function updateFactSummary(id, scopeKey, summary) {
    ensureSchema();
    // sem limite: summary vai completo pro banco (e do banco pro prompt).
    const text = String(summary || '').trim();
    if (!text) return null;
    const result = getDatabase().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_group_memories SET summary = ? WHERE id = ? AND scope_key = ?`)
      .run(text, String(id), String(scopeKey));
    return result.changes ? getFact(id) : null;
  }

  function setFactEvidenceStatus(id, scopeKey, status) {
    ensureSchema();
    const next = new Set(['verified', 'unverified', 'pending']).has(status) ? status : 'pending';
    const result = getDatabase().prepare(`UPDATE ${ANALYTICS_SCHEMA}.fun_group_memories SET evidence_status = ? WHERE id = ? AND scope_key = ?`)
      .run(next, String(id), String(scopeKey));
    return result.changes ? getFact(id) : null;
  }

  function deleteFact(id) {
    ensureSchema();
    const r = getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE id = ?`)
      .run(String(id || ''));
    return r.changes > 0;
  }

  function deleteByScope(scopeKey) {
    ensureSchema();
    const r = getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE scope_key = ?`)
      .run(String(scopeKey || ''));
    return r.changes || 0;
  }

  function deleteBySubject(scopeKey, userJid) {
    ensureSchema();
    const facts = listFacts(scopeKey, { limit: 200, minScore: 0 });
    const target = String(userJid || '');
    let n = 0;
    for (const f of facts) {
      if (f.subjects.includes(target)) {
        if (deleteFact(f.id)) n += 1;
      }
    }
    return n;
  }

  /**
   * Remove fatos em excesso garantindo cota protegida de até `minFactsPerMember` (default 5)
   * fatos independentes com score >= `minScoreQuota` (default 80) por membro do grupo.
   */
  function pruneToCapWithMemberQuota(
    scopeKey,
    maxFacts = 120,
    {
      minFactsPerMember = 5,
      minScoreQuota = 80,
      independenceThreshold = 0.55,
    } = {}
  ) {
    ensureSchema();
    const cap = Math.max(5, Math.floor(Number(maxFacts) || 120));
    const count = countFacts(scopeKey);
    if (count <= cap) return 0;
    const overflow = count - cap;

    const rows = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE scope_key = ?`)
      .all(String(scopeKey || ''));
    const allFacts = rows.map(mapFact).filter(Boolean);
    if (allFacts.length <= cap) return 0;

    const quota = Math.max(1, Math.floor(Number(minFactsPerMember) || 5));
    const scoreThreshold = Math.max(0, Math.min(100, Math.round(Number(minScoreQuota) || 80)));
    const indepThresh = Number.isFinite(independenceThreshold) ? independenceThreshold : 0.55;

    // 1. Agrupar fatos por membro
    const memberFacts = new Map();
    for (const f of allFacts) {
      for (const subj of f.subjects || []) {
        const jid = String(subj || '').trim();
        if (!jid) continue;
        if (!memberFacts.has(jid)) memberFacts.set(jid, []);
        memberFacts.get(jid).push(f);
      }
    }

    // 2. Identificar fatos protegidos pela cota (até `quota` fatos independentes com score >= scoreThreshold por membro)
    const protectedFactIds = new Set();
    const factTokenCache = new Map();

    const getTokens = (fact) => {
      if (!factTokenCache.has(fact.id)) {
        const text = `${fact.summary} ${(fact.keywords || []).join(' ')}`;
        factTokenCache.set(fact.id, tokenSet(text));
      }
      return factTokenCache.get(fact.id);
    };

    for (const [, facts] of memberFacts.entries()) {
      // Ordena por maior score, mais hits e mais recente
      const sorted = [...facts].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.hits !== a.hits) return b.hits - a.hits;
        return b.lastSeenAt - a.lastSeenAt;
      });

      const memberProtectedTokens = [];
      for (const f of sorted) {
        if (f.score < scoreThreshold) continue;
        if (memberProtectedTokens.length >= quota) break;

        const fTokens = getTokens(f);
        // Verifica independência contra os já protegidos para este membro
        const isDependent = memberProtectedTokens.some(
          (prevTokens) => jaccard(fTokens, prevTokens) >= indepThresh
        );
        if (!isDependent) {
          memberProtectedTokens.push(fTokens);
          protectedFactIds.add(f.id);
        }
      }
    }

    // 3. Separar candidatos a evicção (não protegidos)
    const candidates = allFacts.filter((f) => !protectedFactIds.has(f.id));

    // Mapa de contagem de fatos por membro para penalizar excedentes
    const memberTotalCounts = new Map();
    for (const [jid, list] of memberFacts.entries()) {
      memberTotalCounts.set(jid, list.length);
    }
    const maxMemberCountForFact = (fact) => {
      let maxCount = 0;
      for (const subj of fact.subjects || []) {
        const c = memberTotalCounts.get(String(subj || '').trim()) || 0;
        if (c > maxCount) maxCount = c;
      }
      return maxCount;
    };

    // Ordenação de prioridade de remoção (piores primeiro):
    // 1º: score < scoreThreshold (os mais fracos primeiro: score ASC, lastSeenAt ASC)
    // 2º: fatos de membros com mais fatos acumulados (quem tem mais fatos cede vaga primeiro)
    // 3º: menor score, mais antigo
    candidates.sort((a, b) => {
      const aSub80 = a.score < scoreThreshold;
      const bSub80 = b.score < scoreThreshold;
      if (aSub80 !== bSub80) return aSub80 ? -1 : 1;

      if (!aSub80) {
        // Ambos >= scoreThreshold: quem é de membro mais excedente sai antes
        const countA = maxMemberCountForFact(a);
        const countB = maxMemberCountForFact(b);
        if (countB !== countA) return countB - countA;
      }

      if (a.score !== b.score) return a.score - b.score;
      return a.lastSeenAt - b.lastSeenAt;
    });

    // 4. Selecionar IDs a deletar
    const toDeleteIds = [];
    for (let i = 0; i < overflow && i < candidates.length; i++) {
      toDeleteIds.push(candidates[i].id);
    }

    // Caso de borda extremo: candidatos < overflow (muitos membros qualificados protegidos)
    if (toDeleteIds.length < overflow) {
      const remainingNeeded = overflow - toDeleteIds.length;
      const protectedList = allFacts
        .filter((f) => protectedFactIds.has(f.id) && !toDeleteIds.includes(f.id))
        .sort((a, b) => {
          if (a.score !== b.score) return a.score - b.score;
          return a.lastSeenAt - b.lastSeenAt;
        });
      for (let i = 0; i < remainingNeeded && i < protectedList.length; i++) {
        toDeleteIds.push(protectedList[i].id);
      }
    }

    if (!toDeleteIds.length) return 0;

    const del = getDatabase().prepare(
      `DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_memories WHERE id = ?`
    );
    const deleteMany = getDatabase().transaction((ids) => {
      let count = 0;
      for (const id of ids) {
        del.run(id);
        count++;
      }
      return count;
    });

    return deleteMany(toDeleteIds);
  }

  /** Remove os de menor score até ficar em maxFacts respeitando cota por membro. */
  function pruneToCap(scopeKey, maxFacts = 50, quotaOpts = {}) {
    return pruneToCapWithMemberQuota(scopeKey, maxFacts, quotaOpts);
  }

  /** Score decai e remove velhos com score baixo. */
  function decayAndPurge(scopeKey, { ttlDays = 45, minScore = 35, now = Date.now() } = {}) {
    ensureSchema();
    const ttlMs = Math.max(1, Number(ttlDays) || 45) * 24 * 60 * 60_000;
    const cutoff = (Number(now) || Date.now()) - ttlMs;
    const r = getDatabase()
      .prepare(
        `DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_memories
         WHERE scope_key = ? AND last_seen_at < ? AND score < ?`
      )
      .run(String(scopeKey || ''), cutoff, Math.max(0, Number(minScore) || 35));
    return r.changes || 0;
  }

  function getPersona(scopeKey) {
    ensureSchema();
    const row = getDatabase()
      .prepare(`SELECT * FROM ${ANALYTICS_SCHEMA}.fun_group_persona WHERE scope_key = ?`)
      .get(String(scopeKey || ''));
    if (!row) {
      return { scopeKey: String(scopeKey || ''), personaText: '', factCount: 0, updatedAt: 0 };
    }
    return {
      scopeKey: String(row.scope_key || ''),
      personaText: String(row.persona_text || ''),
      factCount: Number(row.fact_count) || 0,
      updatedAt: Number(row.updated_at) || 0,
    };
  }

  function setPersona(scopeKey, personaText, factCount = 0, now = Date.now()) {
    ensureSchema();
    const ts = Number(now) || Date.now();
    getDatabase()
      .prepare(
        `INSERT INTO ${ANALYTICS_SCHEMA}.fun_group_persona
         (scope_key, persona_text, fact_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           persona_text = excluded.persona_text,
           fact_count = excluded.fact_count,
           updated_at = excluded.updated_at`
      )
      .run(
        String(scopeKey || ''),
        String(personaText || '').slice(0, 800),
        Math.max(0, Math.floor(Number(factCount) || 0)),
        ts
      );
    return getPersona(scopeKey);
  }

  function clearPersona(scopeKey) {
    ensureSchema();
    getDatabase()
      .prepare(`DELETE FROM ${ANALYTICS_SCHEMA}.fun_group_persona WHERE scope_key = ?`)
      .run(String(scopeKey || ''));
  }

  return {
    KINDS,
    insertFact,
    getFact,
    listFacts,
    countFacts,
    reinforceFact,
    updateFactAuthor,
    updateFactSummary,
    setFactEvidenceStatus,
    deleteFact,
    deleteByScope,
    deleteBySubject,
    pruneToCap,
    pruneToCapWithMemberQuota,
    decayAndPurge,
    getPersona,
    setPersona,
    clearPersona,
  };
}
