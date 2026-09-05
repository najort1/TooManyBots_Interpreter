import { getDb } from '../../db/context.js';
import { ensureFunSchema as applyFunSchema } from '../schema.js';

const ANALYTICS_SCHEMA = 'analytics';

function parse(value, fallback = []) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function list(value, max = 20) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, max)
    : [];
}

function map(row) {
  if (!row) return null;
  return {
    scopeKey: String(row.scope_key || ''),
    voiceStyle: parse(row.voice_style_json),
    allowedTones: parse(row.allowed_tones_json),
    forbiddenTones: parse(row.forbidden_tones_json),
    signatureTraits: parse(row.signature_traits_json),
    groupLoreSummary: String(row.group_lore_summary || ''),
    botName: String(row.bot_name || ''),
    botAliases: parse(row.bot_aliases_json),
    botRole: String(row.bot_role || ''),
    botTraits: parse(row.bot_traits_json),
    botOpinions: parse(row.bot_opinions_json),
    botCatchphrases: parse(row.bot_catchphrases_json),
    updatedAt: Number(row.updated_at) || 0,
  };
}

export function createFunPersonaIdentityRepository({ getDatabase = getDb } = {}) {
  const ensureSchema = () => applyFunSchema(getDatabase());

  function get(scopeKey) {
    ensureSchema();
    return map(getDatabase().prepare(
      `SELECT * FROM ${ANALYTICS_SCHEMA}.fun_persona_identities WHERE scope_key = ?`
    ).get(String(scopeKey || '')));
  }

  function upsert(input = {}) {
    ensureSchema();
    const scopeKey = String(input.scopeKey || '').trim();
    if (!scopeKey.endsWith('@g.us')) return { ok: false, reason: 'invalid' };
    const now = Number(input.now) || Date.now();
    const current = get(scopeKey) || {};
    const identity = {
      voiceStyle: list(input.voiceStyle ?? current.voiceStyle),
      allowedTones: list(input.allowedTones ?? current.allowedTones),
      forbiddenTones: list(input.forbiddenTones ?? current.forbiddenTones),
      signatureTraits: list(input.signatureTraits ?? current.signatureTraits),
      groupLoreSummary: String(input.groupLoreSummary ?? current.groupLoreSummary ?? '').slice(0, 12_000),
      botName: String(input.botName ?? current.botName ?? '').trim().slice(0, 80),
      botAliases: list(input.botAliases ?? current.botAliases, 30),
      botRole: String(input.botRole ?? current.botRole ?? '').trim().slice(0, 240),
      botTraits: list(input.botTraits ?? current.botTraits),
      botOpinions: list(input.botOpinions ?? current.botOpinions, 40),
      botCatchphrases: list(input.botCatchphrases ?? current.botCatchphrases, 40),
    };

    getDatabase().prepare(
      `INSERT INTO ${ANALYTICS_SCHEMA}.fun_persona_identities (
        scope_key, voice_style_json, allowed_tones_json, forbidden_tones_json,
        signature_traits_json, group_lore_summary, bot_name, bot_aliases_json,
        bot_role, bot_traits_json, bot_opinions_json, bot_catchphrases_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope_key) DO UPDATE SET
        voice_style_json = excluded.voice_style_json,
        allowed_tones_json = excluded.allowed_tones_json,
        forbidden_tones_json = excluded.forbidden_tones_json,
        signature_traits_json = excluded.signature_traits_json,
        group_lore_summary = excluded.group_lore_summary,
        bot_name = excluded.bot_name,
        bot_aliases_json = excluded.bot_aliases_json,
        bot_role = excluded.bot_role,
        bot_traits_json = excluded.bot_traits_json,
        bot_opinions_json = excluded.bot_opinions_json,
        bot_catchphrases_json = excluded.bot_catchphrases_json,
        updated_at = excluded.updated_at`
    ).run(
      scopeKey,
      JSON.stringify(identity.voiceStyle),
      JSON.stringify(identity.allowedTones),
      JSON.stringify(identity.forbiddenTones),
      JSON.stringify(identity.signatureTraits),
      identity.groupLoreSummary,
      identity.botName,
      JSON.stringify(identity.botAliases),
      identity.botRole,
      JSON.stringify(identity.botTraits),
      JSON.stringify(identity.botOpinions),
      JSON.stringify(identity.botCatchphrases),
      now
    );

    return { ok: true, identity: get(scopeKey) };
  }

  return { get, upsert };
}
