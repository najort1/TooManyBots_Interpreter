import { buildPersonaIdentityBlock } from './personaPromptBuilder.js';

function defaults(scopeKey) {
  return {
    scopeKey,
    voiceStyle: [],
    allowedTones: [],
    forbiddenTones: [],
    signatureTraits: [],
    groupLoreSummary: '',
    botName: '',
    botAliases: [],
    botRole: '',
    botTraits: [],
    botOpinions: [],
    botCatchphrases: [],
  };
}

export function createPersonaIdentityService({ personaIdentityRepository } = {}) {
  if (!personaIdentityRepository) throw new Error('[fun/personaIdentityService] personaIdentityRepository required');

  function get(scopeKey) {
    return { ...defaults(scopeKey), ...(personaIdentityRepository.get(scopeKey) || {}) };
  }

  function refresh({ scopeKey, voiceStyle, groupLoreSummary, now = Date.now() } = {}) {
    const current = get(scopeKey);
    const style = Array.isArray(voiceStyle) && voiceStyle.length ? voiceStyle : current.voiceStyle;
    const summary = String(groupLoreSummary || current.groupLoreSummary || '');
    const styleUnchanged = JSON.stringify(style) === JSON.stringify(current.voiceStyle);
    const summaryUnchanged = summary === current.groupLoreSummary;
    if (styleUnchanged && summaryUnchanged) return { ok: true, identity: current };

    return personaIdentityRepository.upsert({
      ...current,
      scopeKey,
      voiceStyle: style,
      signatureTraits: style.slice(0, 3),
      groupLoreSummary: summary,
      now,
    });
  }

  function configure({ scopeKey, now = Date.now(), ...identity } = {}) {
    const current = get(scopeKey);
    return personaIdentityRepository.upsert({ ...current, ...identity, scopeKey, now });
  }

  function buildPromptBlock(scopeKeyOrIdentity) {
    const identity = typeof scopeKeyOrIdentity === 'string'
      ? get(scopeKeyOrIdentity)
      : (scopeKeyOrIdentity && typeof scopeKeyOrIdentity === 'object' ? scopeKeyOrIdentity : {});
    return buildPersonaIdentityBlock(identity);
  }

  return { get, refresh, configure, buildPromptBlock };
}
