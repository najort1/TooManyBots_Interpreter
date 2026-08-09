import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function mapHint(row) {
  return {
    scopeKey: String(row?.scope_key || ''),
    participantJid: String(row?.participant_jid || ''),
    hintText: String(row?.hint_text || ''),
    confidence: Number(row?.confidence) || 0,
    socialSignal: String(row?.social_signal || 'neutral'),
    updatedAt: Number(row?.updated_at) || 0,
  };
}

export function createFunPersonaSocialHintRepository({ getDatabase = getDb } = {}) {
  function ensureSchema() {
    applyFunSchema(getDatabase());
  }

  function upsertHints(scopeKey, hints = [], now = Date.now()) {
    ensureSchema();
    const db = getDatabase();
    const ts = Number(now) || Date.now();
    const insert = db.prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_persona_social_hints
       (scope_key, participant_jid, hint_text, confidence, social_signal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_key, participant_jid, hint_text) DO UPDATE SET
         confidence = excluded.confidence, social_signal = excluded.social_signal, updated_at = excluded.updated_at`
    );
    let saved = 0;
    const run = db.transaction(() => {
      for (const hint of hints) {
        const participantJid = String(hint?.participantJid || '').trim();
        const hintText = String(hint?.hintText || '').trim().slice(0, 600);
        const confidence = Math.max(0, Math.min(100, Math.round(Number(hint?.confidence) || 50)));
        const socialSignal = ['positive', 'negative', 'neutral'].includes(String(hint?.socialSignal))
          ? String(hint.socialSignal)
          : 'neutral';
        if (!participantJid || !hintText) continue;
        insert.run(String(scopeKey || ''), participantJid, hintText, confidence, socialSignal, ts, ts);
        saved += 1;
      }
    });
    run();
    return saved;
  }

  // Pistas são "do grupo", não de um participante: retorna as mais recentes/confiantes
  // do scope, independente de quem originou a piada.
  function listByScope(scopeKey, { limit = 8 } = {}) {
    ensureSchema();
    if (!scopeKey) return [];
    const overallLimit = Math.max(1, Math.min(90, Number(limit) || 8));
    const perSignalLimit = Math.max(1, Math.min(30, overallLimit));
    const rows = getDatabase().prepare(
      `WITH ranked AS (
         SELECT scope_key, participant_jid, hint_text, confidence, social_signal, updated_at,
                ROW_NUMBER() OVER (
                  PARTITION BY social_signal
                  ORDER BY confidence DESC, updated_at DESC
                ) AS signal_rank
         FROM ${ANALYTICS_SCHEMA}.fun_persona_social_hints
         WHERE scope_key = ?
       )
       SELECT scope_key, participant_jid, hint_text, confidence, social_signal, updated_at
       FROM ranked
       WHERE signal_rank <= ?
       ORDER BY confidence DESC, updated_at DESC
       LIMIT ?`
    ).all(String(scopeKey), perSignalLimit, overallLimit);
    return rows.map(mapHint);
  }

  return { upsertHints, listByScope };
}
