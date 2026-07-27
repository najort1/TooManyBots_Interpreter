/**
 * Mensagens de erro padronizadas — contextuais e acionáveis.
 * Nunca "Não deu pra..." sem motivo.
 */

/**
 * @param {{ required: number, current: number, command?: string }} opts
 */
export function insufficientBalance({ required, current, command } = {}) {
  const cmd = command ? ` \`${command}\`` : '';
  if (required != null && current != null) {
    return `💸 Saldo insuficiente. Precisa: *${required}*c · Você tem: *${current}*c.${cmd}`;
  }
  if (current != null) {
    return `💸 Saldo insuficiente (*${current}* coins).${cmd}`;
  }
  return `💸 Saldo insuficiente.${cmd}`;
}

/**
 * @param {{ target?: string, command?: string }} opts
 */
export function targetNotFound({ target, command } = {}) {
  const cmd = command ? ` \`${command}\`` : '';
  const who = target ? ` *${target}*` : '';
  return `👤 Pessoa não encontrada${who}. Verifique a menção ou o nome.${cmd}`;
}

/**
 * @param {{ item?: string, command?: string }} opts
 */
export function itemNotFound({ item, command } = {}) {
  const cmd = command ? ` \`${command}\`` : '';
  const what = item ? ` *${item}*` : '';
  return `❓ Item${what} não encontrado.${cmd}`;
}

/**
 * @param {{ reason?: string, command?: string }} opts
 */
export function genericError({ reason, command } = {}) {
  const cmd = command ? ` \`${command}\`` : '';
  const why = reason ? ` (${reason})` : '';
  return `Algo deu errado. Tente de novo.${why}${cmd}`;
}

/**
 * @param {{ command?: string }} opts
 */
export function notAvailable({ command } = {}) {
  const cmd = command ? ` \`${command}\`` : '';
  return `Indisponível no momento.${cmd}`;
}

/**
 * @param {{ name?: string }} opts
 */
export function alreadyOwned({ name } = {}) {
  const item = name ? ` *${name}*` : '';
  return `Você já possui${item}.`;
}

/**
 * @param {{ limit?: number }} opts
 */
export function limitReached({ limit } = {}) {
  const lim = limit != null ? ` (máx. *${limit}*)` : '';
  return `Limite atingido${lim}. Venda ou remova algo antes.`;
}