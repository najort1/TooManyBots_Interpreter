export function createPersonaIdentityService({ personaIdentityRepository } = {}) {
  if (!personaIdentityRepository) throw new Error('[fun/personaIdentityService] personaIdentityRepository required');
  function get(scopeKey) { return personaIdentityRepository.get(scopeKey) || { scopeKey, voiceStyle: [], allowedTones: [], forbiddenTones: [], signatureTraits: [], groupLoreSummary: '' }; }
  function refresh({ scopeKey, voiceStyle, groupLoreSummary, now = Date.now() } = {}) {
    const current = get(scopeKey);
    const style = Array.isArray(voiceStyle) && voiceStyle.length ? voiceStyle : current.voiceStyle;
    return personaIdentityRepository.upsert({ scopeKey, voiceStyle: style, allowedTones: current.allowedTones, forbiddenTones: current.forbiddenTones, signatureTraits: style.slice(0, 3), groupLoreSummary: String(groupLoreSummary || current.groupLoreSummary || ''), now });
  }
  return { get, refresh };
}

