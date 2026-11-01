/**
 * Guarda de comando granular alinhada ao roteador.
 *
 * O roteador (fun/commands/router.js) decide acesso por
 * `effectiveRates.disabledCommands` vindo de
 * `groupRepository.resolveEffectiveRates(scopeKey, funConfig)` — que respeita
 * override por grupo, `funConfig.disabledCommands` e os defaults da casa.
 * Triggers automáticos (ex.: rodada QMP do jornal) DEVEM resolver igual,
 * senão leem fonte diferente do router e abrem rodadas onde o comando está
 * desabilitado.
 */

export function isCommandEnabledForScope(command, groupRepository, scopeKey, funConfig = {}) {
  let disabledCommands = null;
  try {
    const effective =
      typeof groupRepository?.resolveEffectiveRates === 'function'
        ? groupRepository.resolveEffectiveRates(scopeKey, funConfig)
        : null;
    if (Array.isArray(effective?.disabledCommands)) {
      disabledCommands = effective.disabledCommands;
    }
  } catch {
    // Falha ao resolver taxas do grupo não pode derrubar o trigger; cai no
    // fallback da config global abaixo.
    disabledCommands = null;
  }

  if (!Array.isArray(disabledCommands)) {
    disabledCommands = Array.isArray(funConfig?.disabledCommands) ? funConfig.disabledCommands : [];
  }

  return !disabledCommands.includes(String(command || ''));
}
