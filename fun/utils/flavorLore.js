/**
 * Injeta <group_lore> + identidade nos vars do flavor/chaos.
 * SEM limite de fatos — usuário pediu para enviar toda a lore do grupo
 * pro modelo, sem cap artificial de 8 fatos.
 */

import { displayNameOnly } from './userLabel.js';

export function withGroupLore(
  vars = {},
  {
    groupMemoryService = null,
    profileService = null,
    scopeKey = '',
    userJids = [],
    funConfig = {},
    limit = Infinity,
    now = Date.now(),
  } = {}
) {
  const out = { ...(vars || {}) };
  const scope = String(scopeKey || out.scopeKey || out.__scopeKey || '').trim();
  if (scope) {
    out.scopeKey = scope;
    out.__scopeKey = scope;
  }

  // Garante que o autor da ação (quem rodou o comando) chegue ao prompt como
  // nome legível. Sem isso o flavor fica sem sujeito e a IA atribui o feito a
  // um nome qualquer da lore (ex.: chamou o Eduardo de Gabriel).
  if (!out.user || String(out.user).trim() === '') {
    const actorJid = (userJids || []).find(Boolean);
    if (actorJid) {
      const name = displayNameOnly(null, actorJid).trim();
      if (name) out.user = name;
    }
  }

  if (out.groupLore || !scope) return out;

  let lore = '';
  try {
    if (typeof groupMemoryService?.buildLoreContext === 'function') {
      lore =
        groupMemoryService.buildLoreContext(scope, {
          userJids: (userJids || []).filter(Boolean),
          limit: Number.isFinite(limit) && limit > 0 ? limit : Infinity,
          funConfig: funConfig || {},
          now,
        }) || '';
    }
  } catch {
    lore = '';
  }

  try {
    if (typeof profileService?.buildIdentityBlock === 'function') {
      const idBlock = profileService.buildIdentityBlock(
        scope,
        (userJids || []).filter(Boolean),
        funConfig || {}
      );
      if (idBlock) lore = lore ? `${lore}\n${idBlock}` : idBlock;
    }
  } catch {
    // ignore
  }

  if (lore) out.groupLore = lore;
  return out;
}

/**
 * Wrapper padrão: italicLine com lore do grupo.
 */
export async function flavorWithLore(flavorService, scenario, vars, loreCtx = {}) {
  if (!flavorService?.italicLine) return null;
  try {
    const enriched = withGroupLore(vars, loreCtx);
    return await flavorService.italicLine(scenario, enriched);
  } catch {
    return null;
  }
}
